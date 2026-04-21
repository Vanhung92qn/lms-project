# Roadmap — AI-LMS MVP (14–16 weeks)

This roadmap is derived from the approved build plan and sequenced so that
each phase produces an independently testable increment. Every phase ends
with a PR into `develop`, a demo, and an updated changelog.

## Phase timeline

| Phase | Week | Goal | Key deliverables |
|-------|------|------|------------------|
| **P0** — Foundation | 1 | Set the table | Documentation, architecture, ADRs, repo layout, branching rules, CLAUDE.md, pdf-skill agent module |
| **P1** — IAM | 2–3 | Users can sign in | Monorepo scaffold, NestJS + Next.js apps, Postgres + Prisma, register/login/refresh, Casbin RBAC, i18n (vi/en), Cloudflare DNS + origin SSL |
| **P2** — Course CMS | 4–5 | Teachers publish courses | Course/Module/Lesson entities, Markdown editor UI, drag-drop ordering, asset uploads, publish flow |
| **P3** — Interactive Workspace | 6–7 | Students submit code | 3-panel layout (Markdown / Monaco / Terminal+Chat), sandbox-orchestrator (Python), 3 runner images (cpp/node/python), submission + verdict, test-case scoring |
| **P4** — AI Tutor (streaming) | 8–9 | Compiler error → hint in <5 s perceived | ai-gateway (Python), Ollama + Llama 3 8B Q4, SSE endpoint, chat UI, BullMQ queue concurrency=1, Gemini fallback when queue backed up |
| **P5** — Progress + Knowledge Graph v1 | 10–11 | The system learns about the learner | lesson_progress, submission history, data-science service, Bayesian mastery update, student dashboard |
| **P6** — Billing | 12 | Money can move | Orders, Entitlements, VNPay + MoMo integration, invoice download, paywall middleware |
| **P7** — Recommendation + Admin | 13–14 | Personalization + ops console | Nightly collaborative filtering, recommend widget, Super Admin panel (user management, server metrics iframe) |
| **P8** — Hardening & Launch | 15–16 | Go-live | k6 load test @ 50 VU, full observability, backup/restore rehearsal, OWASP baseline scan, go-live on `khohoc.online` |
| **P9** — AI Insight & Demo-Ready | 17–20 | Learning analytics surfaced for academic review | Auto-gen quiz for non-code lessons, massive seed, Classroom Heatmap, AI Tutor insights, Skill Radar, Interactive KG viz, explainable recommendations, dropout alert, mastery decay, AI code review. See [ADR-006](adr/ADR-006-p9-academic-insight-scope.md). |

## Definition of Done (per phase)

A phase is "done" when:

1. Unit test coverage of new code ≥ 60 %.
2. OpenAPI spec is updated; TypeScript client regenerated.
3. At least one Playwright E2E test covers the happy path.
4. Every non-obvious technical decision has an ADR in `docs/adr/`.
5. `docs/runbook/` has an operational entry for anything a human needs to
   run by hand (e.g. "how to rotate Ollama models").
6. PR is reviewed and merged into `develop` by a human.

## Deferred to post-MVP

These have been intentionally left out of the 16-week window. They will
land as follow-up ADRs when real demand shows up.

- Neo4j-backed Knowledge Graph v2 (MVP uses Postgres graph tables).
- Kubernetes / K3s migration (MVP runs on a single-node Docker Compose).
- Flutter / React Native mobile client.
- Native desktop client.
- Elasticsearch-backed full-text search (MVP uses Postgres FTS).
- Rootless Docker for sandboxes.
- Sentry self-hosted (MVP uses Sentry free tier).
- Offsite S3 / B2 backups (MVP uses local disk retention of 7 days).

## Risk watchlist

Tracked in detail in `docs/architecture/infrastructure.md`. High-impact
items that may force a replan:

- Llama 3 8B CPU latency consistently > 30 s → migrate to GPU VPS or
  fall back to Gemini-only AI Tutor.
- VPS RAM pressure > 90 % sustained → split Ollama onto a second VPS.
- VNPay/MoMo SDK instability → gate Paid Courses behind a manual
  invoice flow until resolved.
