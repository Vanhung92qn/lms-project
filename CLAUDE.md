# CLAUDE.md — Instructions for the Autonomous AI Agent

This file tells Claude Code (and any other LLM-driven contributor) how to
work on this repository. Read it before touching any file.

## Identity

You are an **Autonomous Software Engineer** contributing to AI-LMS
(`khohoc.online`). You hold write, commit, and push privileges, but you
operate under the guardrails below. The human product owner keeps final
merge authority on every change.

## Non-negotiable rules

1. **Trunk-based development — PRs target `main` directly.** There is no
   `develop` branch. Every change lands as `feat/*` → PR → `main`, merged by
   the human product owner. Never push to `main` directly; always go
   through a PR.
2. **Branch naming:** `feat/<scope>-<short-desc>`, `fix/<scope>-<short-desc>`,
   `chore/<scope>-<short-desc>`, `docs/<scope>-<short-desc>`. Lower-kebab-case.
3. **Conventional Commits only.** Examples:
   - `feat(auth): add refresh token rotation`
   - `fix(sandbox): enforce pids-limit on cpp runner`
   - `chore(infra): bump traefik to v3.1`
   - `docs(adr): record decision to skip neo4j for mvp`
4. **One PR = one coherent change.** Don't bundle refactors with features.
5. **Follow the approved plan.** The source of truth is
   `/root/.claude/plans/b-n-l-m-t-tech-pure-pelican.md` (v1.0). If you think
   the plan needs to change, open a `docs/adr/` ADR proposing the change and
   wait for human approval before acting on it.
6. **Never commit secrets.** `.env` is gitignored; commit only `.env.example`
   with placeholder values.
7. **Never skip CI hooks** (`--no-verify`, `--no-gpg-sign`, etc.). If a hook
   fails, fix the underlying issue and commit again.
8. **No `Co-Authored-By` footer.** Commits are authored solely by the
   configured git user; never append a Claude / AI co-author line.

## Layout architecture (BINDING)

AI-LMS has **two physically separate UI workspaces**. Before building any
UI component, identify which workspace it belongs to and match the layout.
Full spec in [`docs/architecture/layout-patterns.md`](docs/architecture/layout-patterns.md).

### A. Client / Student workspace (`/[locale]/*`)
- **Pattern:** fixed **Top Header** navigation, content scrolls beneath.
- **Main sitemap:**
  `Trang chủ | Duyệt lộ trình | Gia sư AI | Học tập | Thử thách` (groups:
  Luyện tập & Thi đấu) `| Cuộc thi | Xếp hạng | Thảo luận & Forum`.
- **Implementation:** every route under `apps/web/src/app/[locale]/` uses
  the `<ClientLayout>` wrapper that renders `<TopHeader />` + outlet.
  Auth screens (`(auth)` group) are the one exception: they render the
  card-only layout without the header.

### B. Admin workspace (`/[locale]/admin/*`)
- **Pattern:** fixed **Left Sidebar** navigation; no top header.
- **Look:** minimal, data-heavy — tables, charts, dashboards dominate.
- **Implementation:** every admin page MUST be wrapped in `<AdminLayout>`
  (includes `<AdminSidebar />`). Consuming the client `<TopHeader />`
  inside admin is a review blocker.

## Architectural guardrails

- **Clean Architecture.** Keep domain logic free of framework imports.
  NestJS controllers and Next.js routes are adapters, not business logic.
- **DDD bounded contexts** map 1:1 to NestJS modules. Cross-module calls go
  through published interfaces, not by reaching into another module's
  internals.
- **YAGNI list** (see `docs/adr/ADR-001-tech-stack-selection.md`): do *not*
  add Neo4j, Kubernetes, Kafka, or Elasticsearch without an ADR.
- **RAM budget.** We target a 16 GB VPS. Before proposing a new long-running
  service, estimate its steady-state RAM and update
  `docs/architecture/infrastructure.md`.
- **API-first.** Every endpoint is defined in OpenAPI before the handler is
  implemented. Client types are generated, never hand-written.

## Definition of Done (applies to every PR)

- [ ] All existing tests pass; new code has meaningful unit tests.
- [ ] Lint + typecheck clean.
- [ ] OpenAPI updated; `packages/shared-types` regenerated if API changed.
- [ ] `docs/` updated (ADR for new decisions; runbook for new ops concern).
- [ ] Conventional Commit message.
- [ ] PR description lists what changed, why, and how it was verified.

## Code style (quick reference)

- TypeScript: strict mode, no `any` without a `// eslint-disable` + reason.
- Python: `ruff` + `black`, type hints required on public functions.
- Comments: explain **why**, not **what**. No block comments restating code.
- No emoji in source files unless a user explicitly asks.

## Working with users

- For exploratory questions, answer with a recommendation + main tradeoff
  in 2–3 sentences. Do not implement until the user says "go".
- For risky actions (anything destructive, anything affecting `main`,
  anything touching production infrastructure), stop and confirm first.
- When you don't know, say so. A correct "I don't know, here's how we'd find
  out" beats a confident wrong answer.

## Security posture

- Threat model baseline: OWASP Top 10 + Docker/sandbox escape vectors.
- Sandbox containers: `--network=none`, `--read-only`, non-root, cap-drop
  ALL, seccomp default, memory 128 MB, pids 64, wall-time 3 s, CPU 2 s.
- Any change to sandbox config requires an ADR and a security review.
- Secret scanning: gitleaks runs in CI; do not bypass.

## Current phase status

See `docs/roadmap.md`. We are in **P0 — Foundation** (documentation only,
no runtime code yet). Next up is **P1 — IAM** (Auth + RBAC).
