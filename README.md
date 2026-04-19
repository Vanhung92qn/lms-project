# AI-LMS — khohoc.online

An interactive, text-first Learning Management System with an integrated
AI Tutor (Llama 3 8B, self-hosted) and automatic Knowledge Graph
personalization. Built for learners who prefer *doing* over *watching*.

> **Status:** P0 — Foundation. Documentation and architecture only.
> No application code yet. See [docs/roadmap.md](docs/roadmap.md).

---

## What makes this LMS different

- **No videos.** Lessons are Markdown + live exercises. Students code in an
  embedded Monaco editor, submit to a secure Docker sandbox, and get instant
  verdicts.
- **Always-on AI Tutor.** A self-hosted Llama 3 8B model streams compilation-
  error analysis and clean-code hints directly into the workspace via SSE.
- **Self-calibrating Knowledge Graph.** Every submission, chat, and hesitation
  updates a per-student mastery graph that drives the next recommendation.
- **API-first / headless.** Next.js web today; Flutter / desktop clients are a
  future add-on, not a rewrite.

## Tech stack (MVP)

Monorepo (pnpm + Turborepo) · Next.js 14 (App Router) · NestJS 10 ·
PostgreSQL 16 + Prisma · MongoDB 7 · Redis 7 + BullMQ · Python FastAPI
(Sandbox / AI-Gateway / Data-Science) · Ollama + Llama 3 8B Q4 ·
Docker Compose · Traefik · Cloudflare Free SSL · GitHub Actions CI/CD.

See [docs/architecture/overview.md](docs/architecture/overview.md) for the
full picture and [docs/adr/](docs/adr/) for the reasoning behind each choice.

## Repository layout

```
lms-project/
├── apps/                    # (to be scaffolded in P1)
│   ├── web/                 # Next.js 14 user + instructor UI
│   ├── api-core/            # NestJS modular monolith
│   ├── sandbox-orchestrator/# Python FastAPI — Docker runner
│   ├── ai-gateway/          # Python FastAPI — Ollama proxy + SSE
│   └── data-science/        # Python FastAPI — KG + recommender
├── packages/                # Shared types, UI, configs
├── infra/                   # Docker Compose, Traefik, DB init
├── docs/                    # Architecture, ADRs, API, runbooks
├── pdf-skill/               # Agent skill for PDF form handling
└── scripts/                 # Deploy, backup, seed
```

## Where to start reading

| Audience | File |
|----------|------|
| Product / stakeholders | [docs/roadmap.md](docs/roadmap.md) |
| Architect / senior engineer | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Backend engineer | [docs/architecture/bounded-contexts.md](docs/architecture/bounded-contexts.md), [docs/architecture/data-model.md](docs/architecture/data-model.md) |
| SRE / DevOps | [docs/architecture/infrastructure.md](docs/architecture/infrastructure.md) |
| Security reviewer | [docs/architecture/security.md](docs/architecture/security.md) |
| AI/ML engineer | [docs/architecture/ai-integration.md](docs/architecture/ai-integration.md) |
| API consumer | [docs/api/api-design-principles.md](docs/api/api-design-principles.md) |
| AI agent contributor | [CLAUDE.md](CLAUDE.md) |

## Git workflow

- `main` — production; **never** pushed to directly.
- `develop` — integration branch.
- `feat/*`, `fix/*`, `chore/*`, `docs/*` — short-lived feature branches.
- Every change lands via a PR into `develop`. `develop → main` ships a release.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).

## Licensing

TBD — currently private.
