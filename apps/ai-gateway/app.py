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
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3:8b-instruct-q4_K_M")

DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")

MAX_HISTORY_MESSAGES = 6  # last 3 turns (user + assistant)

# --- prompt templates --------------------------------------------------------

SYSTEM_TUTOR_VI = (
    "Bạn là một trợ giảng lập trình kiên nhẫn, trả lời NGẮN GỌN, rõ ràng. "
    "Tuyệt đối không viết lại toàn bộ đoạn code hoàn chỉnh — chỉ gợi ý dòng "
    "cần sửa hoặc khái niệm cần xem lại. Hạn chế 3 đoạn văn, mỗi đoạn ≤ 2 "
    "câu. Luôn trả lời bằng tiếng Việt trừ khi học viên gõ tiếng Anh."
)

SYSTEM_TUTOR_EN = (
    "You are a patient programming tutor. Keep answers SHORT: at most 3 "
    "paragraphs, 2 sentences each. Never write the full corrected code — "
    "only hint at the line to change or the concept to revisit. Match the "
    "student's language."
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


def build_prompt(req: TutorRequest) -> list[dict]:
    system = SYSTEM_TUTOR_VI if req.locale == "vi" else SYSTEM_TUTOR_EN
    msgs: list[dict] = [{"role": "system", "content": system}]

    # Inject context as a system addendum so the user's turn stays clean.
    context_lines: list[str] = []
    if req.lesson_title:
        context_lines.append(f"Lesson: {req.lesson_title}")
    if req.verdict:
        context_lines.append(f"Last verdict: {req.verdict}")
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
