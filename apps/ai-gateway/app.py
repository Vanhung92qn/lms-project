"""
ai-gateway — FastAPI service that fronts the LLM backends. Responsibilities:

  1) pick a prompt template by intent (fix-error / code-review /
     concept-explain);
  2) render it with the student's context (lesson title, code,
     compiler output, last N turns of chat);
  3) route the request to the provider api-core picked for this user:
       - `llama`    → self-hosted Ollama (Llama 3 8B Q4, CPU)
       - `deepseek` → DeepSeek API (cloud, OpenAI-compatible)
  4) for Llama, serialise through an asyncio.Lock (concurrency=1) —
     CPU-bound inference on 8 vCPU can't meaningfully serve two streams
     at once. DeepSeek has no such constraint so we bypass the lock;
  5) normalise each backend's streaming format into SSE events
     (`event: token` / `event: done` / `event: error`) so the api-core
     proxy and the frontend stay provider-agnostic.

Failures (backend down, context too long, upstream 5xx) are surfaced
as a final SSE `error` event so the client doesn't hang waiting for
tokens.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import AsyncIterator, Literal, Optional

import httpx
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ai-gateway")

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
# qwen2.5-coder:7b is code-specialist (Alibaba) — hallucinates less on C++/JS/
# Python review than Llama 3 8B at the same RAM footprint (~4.5 GB Q4). See
# docs/runbook/ai-tutor.md for the benchmark notes.
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:7b-instruct-q4_K_M")

DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")

MAX_HISTORY_MESSAGES = 6  # last 3 turns (user + assistant)

# --- prompt templates --------------------------------------------------------
#
# These prompts deliberately spell out the sandbox verdict as ground truth.
# Small quantised CPU models (Llama 3 8B Q4, Qwen 2.5-coder 7B Q4) love to
# hallucinate syntax errors on code they don't actually parse — e.g. telling
# a student that `using namespace std;` needs parentheses. The fix is to
# pin the model to the verdict we already computed in the sandbox: if the
# code compiled and passed tests, there are NO syntax errors by definition,
# and the model's job is to praise + suggest style improvements.

SYSTEM_TUTOR_VI = (
    "Bạn là một trợ giảng lập trình chuyên nghiệp, đang review code mà hệ "
    "thống sandbox đã biên dịch và chấm xong.\n"
    "\n"
    "QUY TẮC TUYỆT ĐỐI — KHÔNG ĐƯỢC VI PHẠM:\n"
    "1. Trường 'Verdict' là kết quả của sandbox thật, LUÔN đúng. Coi nó là "
    "sự thật tuyệt đối, không bao giờ nghi ngờ.\n"
    "2. Nếu Verdict là 'ac' (Accepted), code đã biên dịch thành công và "
    "đúng 100% về cú pháp. TUYỆT ĐỐI không bịa ra lỗi cú pháp. Ví dụ cấm: "
    "nói `using namespace std;` cần thêm dấu `()`, nói thiếu dấu `;`, nói "
    "sai kiểu biến khi code đã chạy — đều là BỊA.\n"
    "3. Khi Verdict là 'ac': khen ngắn gọn, giải thích VÌ SAO code chạy "
    "đúng (cơ chế), và gợi ý tối đa 1 cải tiến style (ví dụ thêm `\\n`, "
    "đổi tên biến cho rõ). Không được nói 'code của bạn sai'.\n"
    "4. Khi Verdict là 'ce'/'wa'/'tle'/'mle'/'re': đọc kỹ compiler output "
    "và chỉ gợi ý đúng dòng hoặc khái niệm cần sửa. Không viết lại full "
    "code — chỉ nêu vị trí + lý do.\n"
    "5. Nếu bạn KHÔNG CHẮC về một chi tiết, nói thẳng 'Mình không chắc "
    "chỗ này'. Cấm đoán mò.\n"
    "\n"
    "Format: tiếng Việt, tối đa 3 đoạn, mỗi đoạn ≤ 2 câu."
)

SYSTEM_TUTOR_EN = (
    "You are an expert programming tutor reviewing code that our sandbox "
    "has already compiled and graded.\n"
    "\n"
    "ABSOLUTE RULES — NEVER VIOLATE:\n"
    "1. The 'Verdict' field is the sandbox's real result and is ALWAYS "
    "correct. Treat it as ground truth; never second-guess it.\n"
    "2. If Verdict is 'ac' (Accepted), the code compiled and is 100% "
    "syntactically correct. NEVER invent syntax errors. Forbidden "
    "examples: claiming `using namespace std;` needs parentheses, "
    "claiming a missing semicolon, or flagging a type mismatch when the "
    "code ran — all of these are hallucinations.\n"
    "3. When Verdict is 'ac': congratulate briefly, explain WHY the code "
    "works (mechanism), and offer at most 1 clean-code suggestion (e.g. "
    "add `\\n`, rename a variable for clarity). Never say 'your code is "
    "wrong'.\n"
    "4. When Verdict is 'ce'/'wa'/'tle'/'mle'/'re': read the compiler "
    "output carefully and hint at the specific line or concept to fix. "
    "Do not rewrite the full code — just point at the spot.\n"
    "5. If you are UNSURE about a detail, say 'I'm not sure about this "
    "part' explicitly. Do not guess.\n"
    "\n"
    "Format: match the student's language, at most 3 paragraphs, "
    "2 sentences each."
)


class TutorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class TutorRequest(BaseModel):
    intent: Literal["fix-error", "code-review", "concept-explain"] = "fix-error"
    locale: Literal["vi", "en"] = "vi"
    # api-core resolves the tier (entitlement + daily cap) and tells us which
    # backend to hit. Default to the safe/free one so a stray direct call
    # can't burn DeepSeek credits.
    provider: Literal["llama", "deepseek"] = "llama"
    lesson_title: Optional[str] = None
    student_code: Optional[str] = None
    compiler_error: Optional[str] = None
    verdict: Optional[str] = None  # ac / wa / tle / ce / re …
    question: Optional[str] = None
    history: list[TutorMessage] = Field(default_factory=list, max_length=MAX_HISTORY_MESSAGES)


_VERDICT_BANNER_VI = {
    "ac": "VERDICT = AC → Code ĐÃ BIÊN DỊCH THÀNH CÔNG và chạy đúng. "
          "Không có lỗi cú pháp. Vai trò của bạn: khen + giải thích cơ chế "
          "+ gợi ý style.",
    "ce": "VERDICT = CE → Compile Error. Đọc kỹ compiler output bên dưới "
          "để gợi ý đúng vị trí.",
    "wa": "VERDICT = WA → Code biên dịch OK nhưng output sai. Logic có "
          "vấn đề, không phải cú pháp.",
    "tle": "VERDICT = TLE → Code chạy quá lâu. Thuật toán chưa tối ưu.",
    "mle": "VERDICT = MLE → Code dùng quá nhiều bộ nhớ.",
    "re": "VERDICT = RE → Runtime Error. Code biên dịch OK nhưng crash khi chạy.",
}
_VERDICT_BANNER_EN = {
    "ac": "VERDICT = AC → Code COMPILED AND RAN CORRECTLY. No syntax "
          "errors exist. Your job: praise + explain the mechanism + "
          "optionally suggest a style tweak.",
    "ce": "VERDICT = CE → Compile Error. Read the compiler output below "
          "and point at the exact location.",
    "wa": "VERDICT = WA → Code compiled fine, output is wrong. Logic "
          "problem, not a syntax problem.",
    "tle": "VERDICT = TLE → Code ran too long. Algorithm is not optimal.",
    "mle": "VERDICT = MLE → Code used too much memory.",
    "re": "VERDICT = RE → Runtime Error. Compiled fine but crashed while running.",
}


def build_prompt(req: TutorRequest) -> list[dict]:
    system = SYSTEM_TUTOR_VI if req.locale == "vi" else SYSTEM_TUTOR_EN
    msgs: list[dict] = [{"role": "system", "content": system}]

    # Verdict banner up front — we repeat it separately from the data dump
    # below because the small models we run on CPU skim the context window
    # and need the ground truth stated twice to actually believe it.
    if req.verdict:
        banners = _VERDICT_BANNER_VI if req.locale == "vi" else _VERDICT_BANNER_EN
        banner = banners.get(req.verdict.lower())
        if banner:
            msgs.append({"role": "system", "content": banner})

    # Inject context as a system addendum so the user's turn stays clean.
    context_lines: list[str] = []
    if req.lesson_title:
        context_lines.append(f"Lesson: {req.lesson_title}")
    if req.verdict:
        context_lines.append(f"Sandbox verdict (ground truth): {req.verdict}")
    if req.student_code:
        # Cap context at 4 KB to keep CPU inference fast.
        code = req.student_code[:4096]
        context_lines.append(f"Student code:\n```\n{code}\n```")
    if req.compiler_error:
        err = req.compiler_error[:2048]
        context_lines.append(f"Compiler output:\n```\n{err}\n```")

    if context_lines:
        msgs.append({"role": "system", "content": "\n\n".join(context_lines)})

    for m in req.history[-MAX_HISTORY_MESSAGES:]:
        msgs.append({"role": m.role, "content": m.content})

    if req.question:
        msgs.append({"role": "user", "content": req.question})
    elif req.intent == "fix-error" and not any(m["role"] == "user" for m in msgs):
        # Auto-trigger prompt — the student didn't type a question, they
        # clicked "Ask AI" from a failing submission.
        default_q = (
            "Tôi vừa submit và bị báo lỗi. Bạn gợi ý tôi nên sửa chỗ nào?"
            if req.locale == "vi"
            else "My submission failed. What should I fix?"
        )
        msgs.append({"role": "user", "content": default_q})

    return msgs


# --- concurrency gate --------------------------------------------------------

# Only Llama is serialised — DeepSeek is a cloud API and has its own
# server-side concurrency pool, so we let its traffic bypass the lock.
_llama_lock = asyncio.Lock()


# --- SSE helpers -------------------------------------------------------------

def sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


# --- Llama (Ollama) streaming -----------------------------------------------

async def stream_llama(messages: list[dict]) -> AsyncIterator[bytes]:
    started = time.perf_counter()
    total_tokens = 0
    async with _llama_lock:
        try:
            timeout = httpx.Timeout(connect=5.0, read=120.0, write=5.0, pool=5.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                payload = {
                    "model": OLLAMA_MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {
                        "num_predict": 400,
                        "temperature": 0.4,
                        "top_p": 0.9,
                    },
                }
                async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=payload) as resp:
                    if resp.status_code != 200:
                        body = (await resp.aread()).decode(errors="replace")[:300]
                        log.warning("ollama %d: %s", resp.status_code, body)
                        yield sse("error", {"code": "upstream_error", "message": f"ollama {resp.status_code}"})
                        return
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            obj = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if obj.get("done"):
                            elapsed_ms = int((time.perf_counter() - started) * 1000)
                            yield sse(
                                "done",
                                {"total_tokens": total_tokens, "ms": elapsed_ms, "model": OLLAMA_MODEL},
                            )
                            return
                        delta = (obj.get("message") or {}).get("content", "")
                        if delta:
                            total_tokens += 1
                            yield sse("token", {"delta": delta})
        except httpx.HTTPError as e:
            log.exception("llama stream http error")
            yield sse("error", {"code": "upstream_error", "message": str(e)[:200]})


# --- DeepSeek streaming ------------------------------------------------------

async def stream_deepseek(messages: list[dict]) -> AsyncIterator[bytes]:
    """
    DeepSeek speaks the OpenAI chat-completions streaming format:
      data: {"choices":[{"delta":{"content":"…"}}]}
      data: [DONE]
    We re-encode each delta as our own SSE `event: token` frame so api-core
    and the FE parse a single shape regardless of provider.
    """
    if not DEEPSEEK_API_KEY:
        log.error("deepseek request but DEEPSEEK_API_KEY is empty")
        yield sse("error", {"code": "deepseek_not_configured", "message": "DeepSeek API key missing"})
        return

    started = time.perf_counter()
    total_tokens = 0
    try:
        timeout = httpx.Timeout(connect=5.0, read=120.0, write=5.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            payload = {
                "model": DEEPSEEK_MODEL,
                "messages": messages,
                "stream": True,
                "temperature": 0.4,
                "top_p": 0.9,
                "max_tokens": 600,
            }
            headers = {
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            }
            async with client.stream(
                "POST",
                f"{DEEPSEEK_BASE_URL}/v1/chat/completions",
                json=payload,
                headers=headers,
            ) as resp:
                if resp.status_code != 200:
                    body = (await resp.aread()).decode(errors="replace")[:300]
                    log.warning("deepseek %d: %s", resp.status_code, body)
                    yield sse(
                        "error",
                        {"code": "upstream_error", "message": f"deepseek {resp.status_code}"},
                    )
                    return
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw:
                        continue
                    if raw == "[DONE]":
                        elapsed_ms = int((time.perf_counter() - started) * 1000)
                        yield sse(
                            "done",
                            {"total_tokens": total_tokens, "ms": elapsed_ms, "model": DEEPSEEK_MODEL},
                        )
                        return
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    delta = ""
                    for choice in obj.get("choices") or []:
                        delta = (choice.get("delta") or {}).get("content") or ""
                        if delta:
                            break
                    if delta:
                        total_tokens += 1
                        yield sse("token", {"delta": delta})
    except httpx.HTTPError as e:
        log.exception("deepseek stream http error")
        yield sse("error", {"code": "upstream_error", "message": str(e)[:200]})


# --- endpoint ----------------------------------------------------------------

app = FastAPI(title="lms ai-gateway", version="0.2.0")


@app.get("/healthz")
async def healthz() -> dict:
    return {
        "status": "ok",
        "service": "ai-gateway",
        "llama_model": OLLAMA_MODEL,
        "deepseek_configured": bool(DEEPSEEK_API_KEY),
        "deepseek_model": DEEPSEEK_MODEL,
    }


@app.post("/v1/tutor/stream")
async def tutor_stream(req: TutorRequest) -> StreamingResponse:
    messages = build_prompt(req)
    log.info(
        "tutor provider=%s intent=%s history=%d",
        req.provider,
        req.intent,
        len(req.history),
    )

    async def stream() -> AsyncIterator[bytes]:
        try:
            if req.provider == "deepseek":
                async for chunk in stream_deepseek(messages):
                    yield chunk
            else:
                async for chunk in stream_llama(messages):
                    yield chunk
        except Exception as e:  # pragma: no cover
            log.exception("tutor stream crash")
            yield sse("error", {"code": "internal_error", "message": str(e)[:200]})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx/traefik buffering if any
            "Connection": "keep-alive",
        },
    )
