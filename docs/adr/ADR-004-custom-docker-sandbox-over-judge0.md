# ADR-004 — Custom Docker Sandbox over Judge0 / Piston

- **Status:** Accepted
- **Date:** 2026-04-19
- **Deciders:** Product owner, Tech Lead (AI agent)
- **Relates to:** ADR-001, `docs/architecture/security.md`

## Context

Running untrusted student code safely is the single highest-impact
security control in this product. A sandbox escape puts the whole VPS
at risk — including our Postgres, user PII, and payment records.

Two off-the-shelf options:

- **Judge0** — a mature competitive-programming grader. Exposes a
  REST API, supports many languages, used by several major CP sites.
  Ships as a stack of containers (Rails + isolate + PostgreSQL).
- **Piston** — lighter alternative from EngineerMan. Fewer features,
  simpler architecture.

Both would work. But both take opinions away from us on exactly how
each container is locked down, which seccomp profile applies, and
what kernel features are enabled.

## Decision

Build a **thin Python FastAPI service (`sandbox-orchestrator`)** that
drives the Docker daemon directly via `docker-py`. Per-language
runner images (`runner-cpp`, `runner-node`, `runner-python`) are
minimal Alpine-based images containing only the compiler/interpreter
and a non-root entrypoint.

Enforcement policy is declared once, in
[`docs/architecture/security.md §Sandbox isolation`](../architecture/security.md),
and is applied identically to every run:

- `--network=none`, `--read-only`, non-root user, cap-drop ALL,
  seccomp default, memory 128 MB, pids-limit 64, wall-time 3 s.

## Consequences

### Positive

- We own the security policy end to end. If a kernel CVE shifts our
  threat surface, we can change the seccomp profile in minutes
  without waiting for an upstream fix.
- Per-request container lifecycle (spawn → exit → `docker rm`) makes
  side-channel state leakage between requests effectively impossible.
- The code is ~400 lines of Python. The long-term maintenance cost is
  lower than dealing with Judge0's Rails + isolate dependency tree.
- User namespace remapping, rootless Docker (post-MVP), and other
  hardening levers are ours to pull when we choose.

### Negative

- We own the language-matrix problem. Adding a new language (Java,
  Go) is a new `runner-*` Dockerfile + a small dispatch map. Not
  free, but bounded.
- We own the CVE-watch problem. Base images must be rebuilt on a
  schedule (weekly) to pull in CVE patches; a GitHub Actions job
  handles this.
- No built-in problem catalog, diff-test harness, or competitive-
  programming-style grader UI. We do not need those yet.

## What a runner container looks like

Example (`runner-cpp.Dockerfile`):

```dockerfile
FROM alpine:3.19 AS build
RUN apk add --no-cache g++ musl-dev

FROM alpine:3.19
RUN apk add --no-cache libstdc++ && \
    addgroup -g 10001 runner && \
    adduser  -D -u 10001 -G runner runner
COPY --from=build /usr/bin/g++ /usr/bin/g++
WORKDIR /home/runner
USER runner:runner
ENTRYPOINT ["/home/runner/entry.sh"]
```

`entry.sh` compiles stdin (or a pre-copied source file), enforces
`ulimit -t 2` for CPU time, and invokes the binary.

## Alternatives considered

- **Judge0.** Rejected on control/opacity grounds; also a heavier
  component to run in our 16 GB budget.
- **Piston.** Lighter than Judge0 but still opaque; no clear win over
  our own minimal runner images.
- **WebAssembly sandbox (Wasmer / Wasmtime).** Attractive in theory
  (no Docker needed) but toolchain for C++/Node/Python → Wasm is
  immature for educational exercises.
- **gVisor / Kata Containers** as a second layer. Post-MVP
  enhancement; adds kernel isolation on top of Docker.
