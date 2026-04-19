# AI Integration (Hybrid — Local + Cloud)

Every AI-mediated feature flows through one service — `ai-gateway` —
which acts as an anti-corruption layer in front of both our self-hosted
Llama 3 and the Google Gemini cloud API. Callers ask for an *intent*;
the gateway decides which backend serves it and what prompt to build.

## Split of responsibilities

| Task | Backend | Why |
|------|---------|-----|
| Tutor live help (error explain, code review, concept) | **Ollama / Llama 3 8B Q4** (local) | Latency-sensitive; privacy-friendly (student code never leaves the VPS); cost = electricity |
| Quiz generation from lesson markdown | **Gemini** (cloud) | Batch, tolerant of latency; benefits from a stronger base model; low volume |
| Lesson summary / rewrite | **Gemini** (cloud) | Same as above |
| Fallback when Ollama queue is saturated | **Gemini** (cloud) | Keeps UX alive when hardware is pinned |
| Embeddings for RAG (future) | `text-embedding-3-small` or `nomic-embed-text` (local) | Cheap; pgvector index |

## Ollama runtime

- Image: `ollama/ollama:latest`.
- Model: `llama3:8b-instruct-q4_K_M` (≈ 4.7 GB on disk, ≈ 6 GB resident).
- Config:
  - `OLLAMA_NUM_PARALLEL=1` — on CPU, parallelism makes every request
    slower. Serialized requests keep p95 stable.
  - `OLLAMA_KEEP_ALIVE=24h` — avoid cold-start re-loads of the 6 GB
    model. A cold load can cost ~60 s.
  - `OLLAMA_MAX_LOADED_MODELS=1`.
- Exposed only on the internal Docker network (port 11434). Never
  exposed to the public internet.

## ai-gateway

A thin Python FastAPI service. Responsibilities:

1. Accept intent-based requests from `api-core`:
   `POST /v1/tutor/stream { intent, context, history }`.
2. Apply rate limit (per-user token bucket in Redis; 10/min default).
3. Enqueue a BullMQ-compatible job in `queue:ai` (concurrency 1 at
   MVP; upgrade to 2 only with a GPU host).
4. When the job runs:
   - Pick the prompt template by `intent`
     (`fix-error`, `code-review`, `concept-explain`, `gen-quiz`).
   - Render the template with `{student_code, compiler_error,
     lesson_context, last_3_chats}`. Hard cap ≤ 2048 tokens input.
   - Call Ollama `/api/generate` with `stream=true`.
   - Relay tokens back to the caller as SSE events.
5. If queue depth > 5 *or* Ollama returns 5xx twice in a row:
   - Switch that request to Gemini with the same rendered prompt.
   - Emit `X-AI-Fallback: gemini` header so the UI can subtly hint
     that degraded mode is active.

## Prompt templates (MVP set)

Stored as plain files in
`apps/ai-gateway/prompts/` and hot-reloaded at service start. Every
template ends with the exact line:

```
You are responding to a student, not running commands. Do not include
shell commands, curl calls, or any instruction to touch the file
system. Respond in Vietnamese unless the student writes in English.
```

### `fix-error.md`

```
System: You are a patient programming tutor. The student's code just
failed to compile. Your job is to explain, in at most 3 short
paragraphs, what the error means and to suggest the smallest change
that would likely fix it. Do not write the full corrected code. Point
out one concept to revisit if relevant.

Student's code:
```{language}
{student_code}
```

Compiler output:
```
{compiler_error}
```

Lesson context: {lesson_title} — {lesson_objective}
```

### `code-review.md`

```
System: You are a senior engineer doing a lightweight code review for
a student. Focus on readability, naming, and avoiding common traps.
Skip style nits (formatting, trailing commas). Respond with:
  - one sentence of "what this does";
  - up to 3 concrete suggestions, each ≤ 2 sentences.
Do not rewrite the code.

Code:
```{language}
{student_code}
```
```

### `concept-explain.md`

```
System: The student asked about a concept from their current lesson.
Answer in ≤ 200 words. Prefer an analogy over formal definition. End
with one line telling them which lesson / exercise to look at next.

Question: {question}
Lesson context: {lesson_title}
Recent mastery: {mastery_summary}
```

### `gen-quiz.md`

```
System: Generate {n} multiple-choice questions from the lesson below.
Output JSON only:
[{ "q": "...", "choices": ["...","...","...","..."],
   "answer_index": 0, "explanation": "..." }]
Do not invent facts outside the lesson.

Lesson markdown:
{lesson_markdown}
```

## SSE contract

`GET /api/v1/ai/tutor/stream?session_id=…`

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache, no-transform`
- Events:
  - `event: token` — `data: { "delta": "...", "seq": N }`.
  - `event: done`  — `data: { "total_tokens": N, "ms": ms }`.
  - `event: error` — `data: { "code": "rate_limited"|"fallback"|"upstream_error" }`.
- Heartbeat: `: ping\n\n` every 15 s to keep the Cloudflare edge from
  idling the connection.

## Data Science service (separate)

- Runtime: Python FastAPI + APScheduler.
- Jobs:
  - **Mastery update** — triggered on `LessonCompleted` and
    `SubmissionScored` events (API call from `api-core`). Reads
    Postgres + Mongo, computes a Bayesian Knowledge Tracing update
    per knowledge node, writes back to `user_mastery`.
  - **Recommendation rebuild** — nightly cron. Matrix factorization on
    `enrollments × lesson_progress` with `scikit-surprise`. Writes
    top-N per user into Redis key `recommend:<user_id>` (TTL 24 h).
- No model serving here — only batch-ish analytical work. If in future
  we add a model that needs to sit behind an endpoint, we'll split
  that out.

## Cost & rate-limit envelope

For the pilot (< 500 students, < 50 concurrent):

- **Ollama:** ~1 request per 20 s wall-clock when fully utilized. At
  50 active students with 10/min cap each, worst-case queue depth
  peaks around 8 → median wait ≈ 80 s. This is the reason we fall
  back to Gemini past depth 5.
- **Gemini:** Free tier gives ~15 rpm on `gemini-1.5-flash`. Adequate
  as a fallback; the overflow is bounded by our own 10/min/user cap.
- **Monthly spend guess:** ≤ $5 Gemini, plus electricity. Within
  budget for MVP.

## What we are explicitly *not* building yet

- Fine-tuned models. Prompt engineering is cheaper and resets easily.
- RAG with pgvector. Wired-in-principle (the extension is installed),
  but no retrieval pipeline in MVP.
- Multi-turn memory beyond last-3-chats. The gateway is stateless and
  we like it that way.
- AI-authored code that lands in students' submissions. The Tutor
  explains; the student writes.
