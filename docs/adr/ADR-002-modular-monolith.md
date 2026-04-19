# ADR-002 — Modular Monolith (hybrid) over Full Microservices

- **Status:** Accepted
- **Date:** 2026-04-19
- **Deciders:** Product owner, Tech Lead (AI agent)
- **Relates to:** ADR-001

## Context

The original brief called for "a Microservices-oriented architecture".
On paper that is appealing: clean blast radius, independent scaling,
polyglot freedom. In practice, at our scale and team size, splitting
every bounded context into its own repo / pipeline / deploy unit
introduces more cost than it returns.

Traffic: <50 concurrent users. Team: 1 autonomous engineer + 1 human
reviewer. Infra: 1 VPS.

## Decision

Adopt a **hybrid topology**:

- **One Node.js service, `api-core`**, structured as a NestJS
  modular monolith. Each DDD bounded context (IAM, Catalog, CMS,
  Learning, Assessment, AI-Assist, Analytics, Billing, Notification)
  is a NestJS module under `apps/api-core/src/modules/*`. Cross-
  module calls go through published interfaces, not direct imports
  into another module's internals.

- **Three Python services kept separate from day one**, each for a
  reason that is *not* just "DDD says so":
  - `sandbox-orchestrator` — owns the Docker daemon, runs untrusted
    code, has a security perimeter that must never mix with
    application logic.
  - `ai-gateway` — proxies Ollama + Gemini, owns the AI queue
    discipline, and has very different memory/CPU characteristics.
  - `data-science` — batch-ish numerical work, scheduled cron jobs,
    different scaling profile.

- **One Next.js service, `web`**, for SSR/RSC and the user-facing UI.

## Consequences

### Positive

- The monolith gives us transactional consistency inside NestJS for
  free. No saga pattern needed for the simple "enroll → entitle →
  notify" flows that dominate the domain.
- A single Node deploy unit is easy to version, roll back, and
  debug. One set of logs to tail during incidents.
- Python services are only introduced where Python wins on merit,
  so we don't pay the polyglot tax for business-logic code.
- Bounded contexts remain strict — they just ship in one binary.
  When `assessment` or `billing` later needs its own deploy cadence,
  the module extracts into a service along its already-published
  interface.

### Negative

- Internal module coupling is a discipline problem. We rely on code
  review + NestJS's module boundary to catch leaks; there is no
  process boundary to fail loudly.
- A bad deploy can knock out all domains at once. Mitigations: blue-
  green deploys later; for now, small frequent releases keep blast
  radius small.
- Some engineers expect "microservices" to mean 12 services out of
  the gate; we need to communicate that the *logical* split is
  present, it is just not yet a *physical* split.

## Extraction triggers (when to peel a module out)

Pull a module into its own service **only if** one of these is true,
documented in a follow-up ADR:

1. Different scaling profile that would otherwise force us to over-
   provision the whole monolith (likely first candidate: `assessment`
   during exam spikes).
2. Different compliance / change-control cadence (likely: `billing`).
3. Requires a non-TypeScript runtime (already the case for sandbox /
   AI / data-science — hence they are split from day one).

Do not extract because a team "feels big" or because an article said
microservices are better. Those are not triggers.

## Alternatives considered

- **Full microservices from sprint 1.** Rejected above.
- **Single process, everything in Node (including sandbox + AI).**
  Rejected on security grounds (sandbox cannot share the Node
  process that issues JWTs) and operational grounds (AI inference
  would share the Node GC).
- **Two monoliths — one "public" Node, one "internal" Python.**
  Rejected because Python is not a general-purpose choice here, only
  a tool-fit choice for specific services.
