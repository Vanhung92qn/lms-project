# ADR-005 — Server-Sent Events (SSE) over WebSocket for AI Streaming

- **Status:** Accepted
- **Date:** 2026-04-19
- **Deciders:** Product owner, Tech Lead (AI agent)
- **Relates to:** ADR-001, `docs/architecture/ai-integration.md`

## Context

The AI Tutor is latency-sensitive: self-hosted Llama 3 8B on CPU
takes 10–30 seconds to finish a full response. Showing a spinner for
that long is unacceptable UX; we need to stream tokens as they are
produced so that the perceived latency drops to the time-to-first-
token (typically 1–3 s).

Two reasonable transports:

- **WebSocket (bidirectional).**
- **Server-Sent Events (server → client only, over HTTP).**

## Decision

Use **SSE** for the Tutor stream.

Specifically:

- `GET /api/v1/ai/tutor/stream?session_id=…` returns
  `Content-Type: text/event-stream`.
- Client uses the browser's native `EventSource` (with a polyfill for
  headers when needed) or our own `fetch()`-based reader.
- Heartbeat: `: ping\n\n` every 15 s to defeat Cloudflare's idle
  timeout.
- Upstream writes to the prompt (chat messages from the user) go over
  a separate plain `POST /api/v1/ai/chat`.

## Consequences

### Positive

- **Works cleanly through Cloudflare.** SSE is plain HTTP/1.1 chunked
  transfer; the Cloudflare edge handles it without extra config.
  WebSocket works but needs more tuning (Cloudflare enforces a 100 s
  idle timeout on free plan WS).
- **Simpler server code.** FastAPI's `StreamingResponse` is a
  one-liner; NestJS has `@Sse()`. No connection registry, no
  broadcast logic, no reconnection gymnastics.
- **Browser reconnect for free.** `EventSource` auto-reconnects with
  `Last-Event-ID`; we resume using our own `seq` field.
- **One direction matches the use case.** The tutor *streams tokens
  down*; user *sends messages up* infrequently. A full-duplex channel
  is solving a problem we don't have.
- **Observability is easier.** It's just HTTP — every request has a
  URL, a status code, a request ID in our logs and in Cloudflare's.
  WebSocket traces are noticeably harder to interpret.

### Negative

- We cannot cheaply push arbitrary realtime events from server to
  client (e.g. "a peer joined your study group"). If/when we need
  that, we'll adopt WebSocket *alongside* SSE — one transport per
  use case is fine, we don't have to pick globally.
- SSE has a per-connection concurrency cost on the server equal to
  an open HTTP/1.1 connection. At <50 concurrent users, with our
  AI queue concurrency of 1–2, this is a non-issue.

## Alternatives considered

- **WebSocket for everything.** Rejected above on complexity and
  Cloudflare-fit grounds.
- **Long-polling with a shared state store.** Works but is a worse
  experience: higher overhead and visible "stutter" between polls.
- **gRPC server streaming.** Excellent fit for service-to-service but
  a non-starter in browsers without `grpc-web`. Too much new
  machinery.
- **Return the full response only when done (no streaming).**
  Rejected because a student staring at a spinner for 30 s while a
  CPU-bound model thinks is the exact UX we are trying to avoid.
