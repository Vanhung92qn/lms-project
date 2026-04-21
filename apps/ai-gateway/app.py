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


# --- quiz generation (P9.0) -------------------------------------------------
#
# One-shot (non-streaming) JSON endpoint that turns a lesson's markdown into
# a short multiple-choice formative quiz. api-core calls this once per lesson
# on first "Hoàn thành" click and caches the result in `lesson_quizzes`, so
# DeepSeek cost stays bounded. We deliberately don't expose Llama here: the
# 7B Q4 models hallucinate both the question and the "correct" answer too
# often to use as an assessment source. If DEEPSEEK_API_KEY is missing we
# return a stub quiz with a `fallback-local` marker so the feature still
# flows end-to-end in dev.


class QuizGenerateRequest(BaseModel):
    lesson_title: str
    lesson_content: str = Field(..., description="Markdown source of the lesson")
    locale: Literal["vi", "en"] = "vi"
    num_questions: int = Field(default=4, ge=3, le=6)


class QuizQuestion(BaseModel):
    id: str
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class QuizGenerateResponse(BaseModel):
    questions: list[QuizQuestion]
    model: str
    generated_ms: int


_QUIZ_SYSTEM_VI = (
    "Bạn là hệ thống sinh câu hỏi trắc nghiệm giáo dục. Đọc bài học sau và "
    "sinh CHÍNH XÁC __N__ câu hỏi trắc nghiệm 4 lựa chọn nhằm kiểm tra hiểu "
    "biết các khái niệm chính của bài.\n\n"
    "Quy tắc:\n"
    "- Câu hỏi tiếng Việt, tập trung khái niệm, không hỏi chi tiết vụn vặt.\n"
    "- Mỗi câu đúng 4 lựa chọn, CHỈ 1 đáp án đúng.\n"
    "- Kèm giải thích NGẮN (1 câu) cho đáp án đúng.\n"
    "- Không lặp lại câu hỏi. Không dùng 'tất cả đều đúng'.\n\n"
    "Trả về DUY NHẤT JSON object theo schema:\n"
    '{"questions":[{"id":"q1","question":"...","options":["A","B","C","D"],'
    '"correct_index":0,"explanation":"..."}]}'
)

_QUIZ_SYSTEM_EN = (
    "You are an educational multiple-choice quiz generator. Read the lesson "
    "below and produce EXACTLY __N__ multiple-choice questions that test "
    "understanding of the core concepts.\n\n"
    "Rules:\n"
    "- Questions in English, focus on concepts, not trivia.\n"
    "- Each question has exactly 4 options, ONLY 1 correct.\n"
    "- Include a SHORT explanation (1 sentence) for the correct answer.\n"
    "- Do not repeat questions. Do not use 'all of the above'.\n\n"
    "Return ONLY a JSON object matching this schema:\n"
    '{"questions":[{"id":"q1","question":"...","options":["A","B","C","D"],'
    '"correct_index":0,"explanation":"..."}]}'
)


def _fallback_quiz(n: int, locale: str) -> list[dict]:
    # Dev/test stub used when DEEPSEEK_API_KEY is not configured. Keeps the
    # completion flow unblocked on localhost without burning credits.
    tmpl_vi = {
        "question": "Câu hỏi mẫu số {i}: Khái niệm chính của bài học này là gì?",
        "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
        "explanation": "Đây là câu hỏi mẫu (fallback) — hãy cấu hình DEEPSEEK_API_KEY.",
    }
    tmpl_en = {
        "question": "Sample question {i}: What is the main concept of this lesson?",
        "options": ["Answer A", "Answer B", "Answer C", "Answer D"],
        "explanation": "This is a fallback sample — configure DEEPSEEK_API_KEY.",
    }
    tmpl = tmpl_vi if locale == "vi" else tmpl_en
    return [
        {
            "id": f"q{i+1}",
            "question": tmpl["question"].format(i=i + 1),
            "options": tmpl["options"],
            "correct_index": 0,
            "explanation": tmpl["explanation"],
        }
        for i in range(n)
    ]


def _validate_quiz_payload(data: dict, n: int) -> list[dict]:
    """Raise ValueError if the model returned something we can't trust."""
    if not isinstance(data, dict) or "questions" not in data:
        raise ValueError("missing `questions` key")
    qs = data["questions"]
    if not isinstance(qs, list) or not (3 <= len(qs) <= 6):
        raise ValueError(f"expected 3-6 questions, got {len(qs) if isinstance(qs, list) else 'non-list'}")
    cleaned: list[dict] = []
    for i, q in enumerate(qs):
        if not isinstance(q, dict):
            raise ValueError(f"question {i} is not an object")
        opts = q.get("options") or []
        if not isinstance(opts, list) or len(opts) != 4:
            raise ValueError(f"question {i}: need exactly 4 options, got {len(opts)}")
        ci = q.get("correct_index")
        if not isinstance(ci, int) or not (0 <= ci <= 3):
            raise ValueError(f"question {i}: invalid correct_index {ci!r}")
        cleaned.append(
            {
                "id": str(q.get("id") or f"q{i+1}"),
                "question": str(q.get("question") or "").strip(),
                "options": [str(o) for o in opts],
                "correct_index": ci,
                "explanation": str(q.get("explanation") or "").strip(),
            }
        )
    return cleaned


@app.post("/v1/quiz/generate", response_model=QuizGenerateResponse)
async def quiz_generate(req: QuizGenerateRequest) -> QuizGenerateResponse:
    started = time.perf_counter()

    if not DEEPSEEK_API_KEY:
        log.warning("quiz/generate: DEEPSEEK_API_KEY missing — returning fallback stub")
        elapsed = int((time.perf_counter() - started) * 1000)
        return QuizGenerateResponse(
            questions=[QuizQuestion(**q) for q in _fallback_quiz(req.num_questions, req.locale)],
            model="fallback-local",
            generated_ms=elapsed,
        )

    system = (_QUIZ_SYSTEM_VI if req.locale == "vi" else _QUIZ_SYSTEM_EN).replace(
        "__N__", str(req.num_questions)
    )
    # Cap lesson content at 6 KB — DeepSeek accepts more but we'd rather keep
    # latency + cost predictable. Most of our lessons are ≤ 3 KB.
    lesson = req.lesson_content[:6144]
    user_msg = (
        f"Tiêu đề: {req.lesson_title}\n\nNội dung bài học:\n{lesson}"
        if req.locale == "vi"
        else f"Title: {req.lesson_title}\n\nLesson content:\n{lesson}"
    )

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    try:
        timeout = httpx.Timeout(connect=5.0, read=60.0, write=5.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{DEEPSEEK_BASE_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as e:
        log.exception("quiz/generate deepseek http error")
        from fastapi import HTTPException
        raise HTTPException(502, detail={"code": "upstream_error", "message": str(e)[:200]})

    if resp.status_code != 200:
        log.warning("quiz/generate deepseek %d: %s", resp.status_code, resp.text[:300])
        from fastapi import HTTPException
        raise HTTPException(502, detail={"code": "upstream_error", "message": f"deepseek {resp.status_code}"})

    try:
        body = resp.json()
        content = body["choices"][0]["message"]["content"]
        data = json.loads(content)
        questions = _validate_quiz_payload(data, req.num_questions)
    except (KeyError, json.JSONDecodeError, ValueError) as e:
        log.warning("quiz/generate parse error: %s", e)
        from fastapi import HTTPException
        raise HTTPException(502, detail={"code": "invalid_model_output", "message": str(e)[:200]})

    elapsed = int((time.perf_counter() - started) * 1000)
    log.info("quiz/generate ok title=%r questions=%d ms=%d", req.lesson_title, len(questions), elapsed)
    return QuizGenerateResponse(
        questions=[QuizQuestion(**q) for q in questions],
        model=DEEPSEEK_MODEL,
        generated_ms=elapsed,
    )
