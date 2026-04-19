# API Design Principles

The API is the contract between the AI-LMS backend and every client
that will ever be built against it — today's Next.js web, tomorrow's
Flutter / desktop / third-party integrations. It gets the most care.

## 1. API-first, always

- Every endpoint is defined in **OpenAPI 3.1** before a handler is
  written. The spec is the source of truth; `@nestjs/swagger`
  decorators on controllers are what *generate* the spec.
- The spec is linted on every PR with **Spectral** using a ruleset
  that enforces naming, status codes, and the presence of examples.
- TypeScript client types for the web app are generated via
  `openapi-typescript` into `packages/shared-types`. Hand-written
  request/response types are forbidden.
- A JSON snapshot of the spec (`docs/api/openapi.json`) is committed
  and diffed in PRs so changes are reviewable.

## 2. Versioning

- URL-based: every public endpoint lives under `/api/v1/…`.
- Breaking changes introduce `/api/v2/…` in parallel. We keep v1
  running for at least one release cycle, with a deprecation header
  on responses:
  ```
  Deprecation: true
  Sunset: Wed, 31 Dec 2026 23:59:59 GMT
  Link: </api/v2/courses>; rel="successor-version"
  ```
- Non-breaking additions (new endpoints, new optional fields) never
  bump the major version.

## 3. Resource naming

- Plural, kebab-case resources: `/courses`, `/test-cases`.
- IDs in the path: `/courses/{courseId}/modules`.
- Query filters use snake_case for consistency with JSON fields
  (see §4): `?sort_by=created_at&order=desc`.
- No verbs in paths. Actions are expressed as sub-resources or, for
  genuinely non-CRUD operations, RPC-style under `/commands/` with a
  name that reads like an imperative:
  - `POST /courses/{id}/publish` — preferred form.
  - `POST /commands/rebuild-knowledge-graph` — only when there is no
    natural resource.

## 4. Request / response shape

- Fields are **snake_case**. Not because either style is objectively
  better, but because we pick one and stop debating.
- Timestamps are RFC 3339 strings in UTC: `2026-04-19T07:32:11.000Z`.
- Money is expressed in integer minor units + currency code:
  `{ "amount_cents": 4900000, "currency": "VND" }`.
- Envelope: **no envelope for single resources**. The resource *is*
  the body. Lists use:
  ```json
  {
    "items": [...],
    "page": { "cursor": "...", "limit": 20, "has_more": true }
  }
  ```
- Enumerations are string constants, lowercase, snake_case
  (`verdict: "time_limit_exceeded"`). No opaque integers.

## 5. Errors

- Use standard HTTP status codes. `422` for validation, `409` for
  business-rule conflicts, `429` for rate limits, `503` for AI
  upstream failures.
- Response body follows a fixed shape:
  ```json
  {
    "error": {
      "code": "enrollment_requires_entitlement",
      "message": "Human-readable default in English.",
      "message_vi": "…",
      "details": { ... },
      "correlation_id": "01HXY…"
    }
  }
  ```
- `code` is a stable machine identifier. Clients should branch on
  `code`, not on `message`.
- `correlation_id` is always present and also echoed in the
  `X-Correlation-Id` response header. Clients surface it to users
  in error toasts so support requests are easy to trace.

## 6. Pagination

- Cursor-based by default (`?cursor=…&limit=…`). Offset-based only
  where the underlying store can't provide a cursor cheaply.
- `limit` defaults to 20, max 100. Requests asking for more get
  `422` with `code: "limit_out_of_range"`.

## 7. Idempotency

- All unsafe methods that could retry (e.g. `POST /orders`,
  `POST /submissions`) accept an `Idempotency-Key` header. Duplicate
  keys within a 24 h window return the original response.
- Webhooks (VNPay / MoMo callbacks) must be idempotent; we store the
  provider transaction ID and short-circuit replays.

## 8. Authentication & authorization

- `Authorization: Bearer <access_jwt>` on every protected endpoint.
- Refresh is a POST with the refresh token in an `HttpOnly` cookie.
- RBAC errors are `403 Forbidden` with
  `code: "forbidden_by_policy"`, *never* `404` as a leakage
  dodge — leaking existence to a logged-in user is not a threat we
  need to defend against, and returning `404` breaks client logic.
- The AI Engine service account uses a signed internal JWT; those
  endpoints are *not* listed in the public OpenAPI spec, only in
  `docs/api/internal.openapi.json`.

## 9. Streaming (SSE)

- Dedicated endpoint per stream; never multiplex different streams
  on the same connection.
- Content type `text/event-stream`, `Cache-Control: no-cache,
  no-transform`.
- Named events with a monotonic `seq` field in each payload so
  clients can reconnect with `Last-Event-ID` and we can emit a
  `resume-from` event.
- A stream always ends with either a `done` or `error` event; never
  a silent EOF.

## 10. Rate limiting

- Per-IP global limit is applied by Traefik; per-user limits by the
  app layer using a Redis token bucket. Both surface the same
  response shape:
  ```
  HTTP/1.1 429 Too Many Requests
  Retry-After: 17
  X-RateLimit-Limit: 10
  X-RateLimit-Remaining: 0
  X-RateLimit-Reset: 1713507600
  ```

## 11. Caching

- `GET` responses for public, stable resources (published courses,
  lesson markdown) carry `ETag` and honour `If-None-Match`.
- Cloudflare caches `/_next/static/*`; we explicitly bypass `/api/*`.
- Never cache `Authorization`-bearing requests at the edge.

## 12. Observability of the API itself

- Every response carries `X-Correlation-Id`.
- Access logs (`method path status duration_ms`) and structured error
  logs ship to Loki with labels `service=api-core`,
  `route=<normalized>`.
- Metrics exported at `/metrics`:
  `http_requests_total{method,route,status}`,
  `http_request_duration_seconds` histogram.

## 13. Deprecation etiquette

- Announce in `CHANGELOG.md` + release notes.
- Emit `Deprecation` + `Sunset` headers for ≥ one full release
  cycle before removal.
- Provide a migration snippet in `docs/api/migrations.md`.
- Keep the old endpoint functional until the announced sunset date.

## 14. What we explicitly do *not* do

- We do not use GraphQL. Everyone knows REST; we need shipping
  velocity more than query flexibility.
- We do not use gRPC for the public API. We may use it later for
  internal service-to-service if hotspot evidence justifies it.
- We do not ship SOAP / XML envelopes. Ever.
