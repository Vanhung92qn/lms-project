# Architecture Overview (C4 Level 1–2)

## 1. System context

AI-LMS is a web-first Learning Management System targeted at programmers.
A single product surface (`khohoc.online`) is backed by a small set of
cooperating services behind one API Gateway.

```
 ┌────────┐   ┌────────┐   ┌────────┐
 │Student │   │Teacher │   │Admin   │   external actors
 └───┬────┘   └───┬────┘   └───┬────┘
     │            │            │
     └──────┬─────┴────────────┘
            │ HTTPS (SSR + REST + SSE)
            ▼
     ┌──────────────┐
     │ Cloudflare   │ DNS, WAF, free SSL
     └──────┬───────┘
            ▼
     ┌──────────────┐
     │ Traefik v3   │ reverse proxy, TLS termination, global rate limit
     └─┬──────────┬─┘
       │          │
       ▼          ▼
  ┌─────────┐ ┌──────────────────────────────────────────┐
  │ web     │ │                api-core                  │
  │ Next.js │ │  NestJS modular monolith                 │
  │ (SSR)   │ │  modules: iam • catalog • learning •     │
  └─────────┘ │           assessment • billing • cms •   │
              │           notification                   │
              └───┬─────────────────────────┬────────┬───┘
                  │                         │        │
                  ▼                         ▼        ▼
        ┌─────────────────────┐  ┌───────────────┐ ┌───────────────┐
        │ sandbox-orchestrator│  │  ai-gateway   │ │ data-science  │
        │    Python/FastAPI   │  │ Python/FastAPI│ │Python/FastAPI │
        │  spawns docker runs │  │ SSE to Ollama │ │ KG + recs     │
        └─────────────────────┘  └───────┬───────┘ └───────────────┘
                                         ▼
                                 ┌───────────────┐
                                 │   Ollama      │
                                 │ Llama 3 8B Q4 │ CPU inference
                                 └───────────────┘

 Shared data plane
 ┌─────────────────────────────────────────────────────────────┐
 │ Postgres 16 + pgvector │ MongoDB 7 │ Redis 7 (cache + BullMQ)│
 └─────────────────────────────────────────────────────────────┘
```

## 2. Why these components, and not others

- **Traefik over Nginx**: service discovery via Docker labels beats writing
  Nginx vhost files by hand when the service set is small and changes often.
- **NestJS modular monolith over microservices**: with 1 backend engineer
  and <50 concurrent users, microservices pay the overhead without
  returning the benefit. Modules inside NestJS still enforce DDD bounded
  contexts — we can extract them later without rewriting logic.
- **Python for sandbox / AI / data science**: Docker SDK, Ollama client,
  and numerical libraries (scikit-surprise, numpy) are best-of-breed in
  Python. Keeping the polyglot split at *integration* boundaries, not
  *business-logic* boundaries, is a deliberate trade-off.
- **Postgres + pgvector over Neo4j**: recursive CTEs cover the MVP graph
  queries. pgvector is in the box for future RAG. One DB to back up, one
  to monitor. See ADR-003.
- **MongoDB for behavioral logs**: schema drift is the rule, not the
  exception, for `ai_chats`, `code_snapshots`, and `learning_events`.
  Forcing them into Postgres JSONB works until it doesn't.
- **Redis + BullMQ over RabbitMQ/Kafka**: two queues (sandbox, ai) with
  concurrency 1–5. Kafka pays off past hundreds of partitions; BullMQ is
  operationally trivial and fits our 16 GB budget.

## 3. Runtime responsibilities

| Component | Owns | Does not own |
|-----------|------|--------------|
| `web` | SSR of UI, SEO metadata, form-heavy flows | Any business rule enforcement |
| `api-core` | All business rules, JWT issuance, RBAC, orchestrating submissions | Code execution, AI inference, graph math |
| `sandbox-orchestrator` | Taking source + tests, running in isolated Docker, returning verdict | Grading policy (that lives in `api-core`) |
| `ai-gateway` | Prompt templates, queue discipline, SSE fan-out, model routing (local ↔ Gemini) | Knowing *which* prompt to use for what (caller sends an intent) |
| `data-science` | Mastery updates, nightly recommendation rebuilds, graph analytics | Transactional reads/writes to user data |
| `Ollama` | Llama 3 8B token generation | Anything above HTTP |

## 4. Deployment topology (MVP)

Single VPS, Docker Compose. Every container listens on a private Docker
network; only Traefik is published to the host on 80/443. See
`infrastructure.md` for the RAM budget and container list.

When we outgrow one node:

1. **First split**: move Ollama to its own GPU VPS. Keeps everything else
   identical — only `AI_GATEWAY_OLLAMA_URL` changes.
2. **Second split**: move Postgres to managed DB (Neon / RDS / similar).
3. **Third split**: extract `sandbox-orchestrator` and scale it horizontally
   behind the internal Traefik. Each sandbox host needs its own Docker
   daemon; they do not share state.
4. **Only then** consider breaking `api-core` modules into separate
   NestJS services. By that point each module's traffic profile will tell
   us which one to peel off first.

## 5. Cross-cutting concerns

- **AuthN**: JWT RS256 issued by `api-core`. Public key is cached by every
  service that needs to verify. Rotation: new key in parallel, 7-day
  overlap, then retire old.
- **AuthZ**: Casbin policy evaluated in `api-core`. Downstream services
  trust the signed JWT claims + an internal service-to-service mTLS pair.
- **Observability**: Prometheus scrape on every service (`/metrics`), logs
  to Loki via Promtail, errors to Sentry. Tracing is wired (OpenTelemetry
  SDK) but export is off until we need it.
- **i18n**: `next-intl` at the web layer; API responses carry untranslated
  keys (`error_code`) so mobile clients can render in their own locale.

## 6. Further reading

- Bounded contexts: [bounded-contexts.md](bounded-contexts.md)
- Data model: [data-model.md](data-model.md)
- Security posture: [security.md](security.md)
- AI integration: [ai-integration.md](ai-integration.md)
- Deployment details: [infrastructure.md](infrastructure.md)
- Decisions: [../adr/](../adr/)
