# Runbook — AI Tutor (P4a)

Self-hosted Llama 3 8B via Ollama, fronted by a thin `ai-gateway` that
renders prompt templates and streams Server-Sent Events back through
api-core to the lesson player.

---

## Pipeline

```
  Student browser
     │ POST /api/v1/ai/tutor/ask   (fetch, SSE body)
     ▼
  Traefik :443
     │
     ▼
  api-core :4000     — JwtAuthGuard + 10/min rate limit
     │ POST /v1/tutor/stream (SSE forward)
     ▼
  ai-gateway :5002   — prompt render + asyncio.Lock(concurrency=1)
     │ POST /api/chat stream=true
     ▼
  Ollama :11434      — llama3:8b-instruct-q4_K_M Q4_K_M on CPU
```

Key non-negotiable: `OLLAMA_NUM_PARALLEL=1` — Llama on CPU thrashes
when two requests share the same process, so serialising through a
queue inside ai-gateway gives a better p95.

---

## Services

### Ollama (in Docker)
Defined in `infra/docker-compose.yml`. `docker compose up -d ollama`
brings it up; bind-published only on `127.0.0.1:11434` because
there's nothing outside the VPS that should ever hit it directly.

Pull the model (first-time only, ~4.7 GB download):
```bash
docker exec lms-ollama ollama pull llama3:8b-instruct-q4_K_M
```

List loaded models + health:
```bash
docker exec lms-ollama ollama list
curl -sf http://127.0.0.1:11434/api/version
```

### ai-gateway (host Python)
Source: `apps/ai-gateway/app.py`. Dev launcher:
```bash
cd apps/ai-gateway
python3 -m venv .venv            # first time only
.venv/bin/pip install -r requirements.txt
setsid nohup .venv/bin/uvicorn app:app --host 127.0.0.1 --port 5002 \
  > /tmp/lms-logs/ai-gateway.log 2>&1 < /dev/null & disown

curl http://127.0.0.1:5002/healthz
```

### api-core wiring
`AI_GATEWAY_URL=http://127.0.0.1:5002` in `.env`. No other config
needed — the NestJS `TutorController` mounts at `POST /api/v1/ai/tutor/ask`.

---

## Expected latency (CPU inference)

| Signal | Observed (8 vCPU, warm model) |
|--------|---------------|
| First-token latency | 2–4 s |
| Subsequent tokens | ~10–20 tok/s |
| Typical 30-token reply | ~3–5 s wall |
| Typical 200-token reply | ~15–25 s wall |

Cold-start (model reload from disk) adds ~60 s on the first request
after 24 h of idle — controlled by `OLLAMA_KEEP_ALIVE=24h`.

The student experience relies on SSE streaming to hide the latency —
tokens appear within ~3 s of asking, and they see a running reply
rather than a spinner.

---

## Prompt templates

Hard-coded in `apps/ai-gateway/app.py`:

- **fix-error** (default) — "patient tutor, short, don't write full
  corrected code, hint a line or concept".
- **code-review** — same vibe, ≤ 3 suggestions, no rewrite.
- **concept-explain** — one-paragraph answer with a link to the next
  lesson.

All templates emit in Vietnamese by default (`locale: "vi"`) and
switch to English when the client asks. Context sent with every
request:
- lesson title
- student source (capped 4 KB)
- compiler output / verdict (capped 2 KB)
- last 6 chat messages

---

## Rate limiting

- **Per-user (10/min)** enforced by NestJS Throttler in api-core. On
  overflow, HTTP 429 with `Retry-After`.
- **Global (1 concurrent)** enforced by `asyncio.Lock` in ai-gateway.
  Requests queue in-memory — first-come-first-served.
- Future (P4b): back ai-gateway with BullMQ / Redis so api-core can
  drop the request on lock contention instead of blocking the HTTP
  worker.

---

## Diagnostic commands

```bash
# Gateway reachable?
curl -sf http://127.0.0.1:5002/healthz

# Ad-hoc smoke test the SSE stream (bypasses api-core)
curl -sN -X POST http://127.0.0.1:5002/v1/tutor/stream \
  -H 'Content-Type: application/json' \
  -d '{"intent":"fix-error","locale":"vi","student_code":"int main(){}","verdict":"re"}' \
  | head -c 2000

# End-to-end via the public API
ACC=$(curl -s -X POST https://khohoc.online/api/v1/auth/login \
   -H 'Content-Type: application/json' \
   -d '{"email":"student@khohoc.online","password":"Student@12345"}' \
   | jq -r .tokens.access_token)
curl -sN -X POST https://khohoc.online/api/v1/ai/tutor/ask \
  -H "Authorization: Bearer $ACC" -H 'Content-Type: application/json' \
  -d '{"question":"Chào","locale":"vi"}' | head -c 400

# Gateway logs
tail -f /tmp/lms-logs/ai-gateway.log

# Ollama logs
docker logs -f lms-ollama
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Every request times out after ~60 s | Cold-start model load | Wait and retry — subsequent calls are fast |
| `upstream_error` immediately | Ollama down or model not pulled | `docker compose up -d ollama` + `ollama pull` |
| SSE stream ends without tokens | api-core → ai-gateway network blocked | `curl ai-gateway/healthz` from api-core host |
| Frontend shows "upstream error" | Traefik buffering | Confirm `X-Accel-Buffering: no` header is set (it is) |
| Out-of-memory kill mid-generation | Another service leaked RAM | `free -h`; consider restarting the container |

---

## Known limits (P4b backlog)

- Ollama runs on CPU; GPU upgrade is the single largest UX win.
- No real queue — concurrent requests block each other in-memory.
  Swap for a BullMQ producer in api-core + a consumer in ai-gateway.
- No Gemini fallback when Ollama is overloaded / down — planned for
  P4b.
- Conversation state lives in the client only (message history sent
  with each request). Server-side sessions arrive alongside the
  Mongo chat log in P5.
