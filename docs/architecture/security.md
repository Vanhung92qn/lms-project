# Security Posture

Security baseline for AI-LMS. Every engineer (human or AI) is expected
to read this before touching auth, the sandbox, or anything that
handles user input. Deviations require an ADR and a security review.

## Threat model (baseline)

Top-of-mind threats, ranked roughly by likelihood × impact:

1. **Sandbox escape (RCE on the host)** — student code reaches outside
   its container. Single highest-impact threat. Mitigated by container
   hardening (§3).
2. **Credential stuffing / account takeover** — attackers reuse leaked
   passwords. Mitigated by argon2id, rate-limited login, optional TOTP
   (post-MVP), leaked-password check against HIBP k-anonymity API.
3. **Token theft (stolen JWT / refresh)** — mitigated by short access
   TTLs (15 min), refresh rotation with reuse detection, secure cookie
   attributes (`HttpOnly`, `Secure`, `SameSite=Lax`).
4. **SQL injection** — mitigated by Prisma parameterized queries only;
   no raw string concatenation into `$queryRaw`.
5. **XSS on lesson content** — teachers can write Markdown with inline
   HTML. Mitigated by `rehype-sanitize` with an explicit allowlist.
6. **CSRF on state-changing form posts** — mitigated by double-submit
   token for cookie-auth endpoints; pure-JWT endpoints are CSRF-immune
   when tokens live in localStorage (with the XSS caveat above).
7. **Prompt injection via lesson content → AI Tutor** — malicious
   lesson content tricks Llama into exfiltrating context. Mitigated by
   stripping system-prompt delimiters from user content and by the AI
   never having write access to any DB.
8. **DoS on Ollama** — flood of AI requests OOMs the model host.
   Mitigated by Redis token bucket (10/min/user) + queue concurrency 1
   + global Traefik rate-limit.
9. **PII leakage in logs** — mitigated by pino/structlog redaction
   rules (`password`, `authorization`, `token` fields stripped).

## AuthN / AuthZ

- **Hashing:** `argon2id` with OWASP-recommended params (memory 19 MiB,
  iterations 2, parallelism 1). Timing-safe compare.
- **JWT:** RS256 (asymmetric). Keys rotated every 90 days with a 7-day
  overlap window. Claims: `sub`, `roles`, `iat`, `exp`, `jti`.
- **Access token TTL:** 15 minutes.
- **Refresh token:** opaque, stored hashed in Postgres, TTL 30 days,
  single-use (rotation on every refresh). Reuse detection — if an
  already-consumed refresh token is presented, we revoke the entire
  family and force re-login.
- **RBAC:** Casbin with RBAC-with-domains model. Policies live in
  `apps/api-core/src/iam/rbac/policy.csv`, checked in.
- **AI Engine role:** a scoped service account with only
  `read:logs`, `read:testcases`. No write endpoints accept this role;
  enforced in Casbin *and* by the Prisma client having a read-only DB
  user (`lms_ai_reader`). Defense in depth.
- **Cookies:** `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix
  on refresh cookie.

## Transport & gateway

- **TLS:** Cloudflare edge terminates TLS 1.3. Cloudflare Origin CA
  cert (15-year) terminates inside Traefik. Direct IP access blocked
  by a firewall allowlist limited to Cloudflare's IP ranges.
- **HSTS:** `max-age=31536000; includeSubDomains; preload` (once we're
  confident we'll never drop HTTPS).
- **CSP:** start with `default-src 'self'; img-src 'self' data: https:;
  style-src 'self' 'unsafe-inline'; script-src 'self'`. Tighten to
  nonce-based `script-src` after P3.
- **CORS:** strict allowlist of `https://khohoc.online` only for
  credentialed requests. Public endpoints (`/healthz`) are `*`.
- **Rate limit:** Traefik `RateLimit` middleware — 100 req/min/IP
  global; 10 req/min/user for `/api/v1/ai/*` (enforced at app layer
  with Redis for accuracy per user, not per IP).

## Sandbox isolation (assessment-critical)

Student code runs in a per-request Docker container. The policy below
is **non-negotiable** — changes require an ADR, a security review, and
an added regression test.

```bash
docker run \
  --rm \
  --network=none \
  --read-only \
  --tmpfs /tmp:size=10m,mode=1777,noexec,nosuid,nodev \
  --memory=128m --memory-swap=128m \
  --cpus=0.5 \
  --pids-limit=64 \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --security-opt=seccomp=/etc/seccomp/default.json \
  --user=10001:10001 \
  --ulimit nofile=64 --ulimit nproc=32 \
  --name=run-<uuid> \
  lms-runner-<lang>:latest \
  "$CODE_HASH"
```

Additional host-level controls:

- **User namespace remapping** enabled on the Docker daemon
  (`dockerd --userns-remap=default`) so UID 0 in the container is an
  unprivileged UID on the host.
- **Image minimalism:** each runner image contains only the compiler /
  interpreter and a non-root `runner` user. No shell utilities beyond
  `busybox` strictly needed for the entrypoint.
- **Pre-pulled images** at build time. Runtime `docker pull` is
  disabled via a seccomp rule.
- **Wall-time cutoff:** 3 s, enforced by the orchestrator (not relying
  solely on the container). CPU-time cutoff: 2 s, enforced by `ulimit`
  inside the container.
- **Output cap:** 64 KB stdout / 64 KB stderr. Longer output is
  truncated and flagged.
- **Container lifecycle:** `docker rm` immediately after exit. Any
  orphaned container older than 60 s is killed by a janitor.

### Regression tests the sandbox must pass

- `while(1) {}` → killed with `tle`, no host impact.
- `malloc(1 GB)` → `mle`, process OOM-killed within the container.
- `fork()` 1000× → capped by `pids-limit`, returns `re`.
- `socket(AF_INET, ...)` / `curl evil.com` → fails (network=none).
- Writing to `/etc/passwd` → fails (`--read-only`).
- Reading `/proc/self/status` → succeeds but shows unprivileged UID
  thanks to userns remap.
- Running a pre-built binary uploaded as stdin → rejected (no binary
  execution path exists).

## Input validation

- Every controller uses NestJS `ValidationPipe` with
  `whitelist: true, forbidNonWhitelisted: true`. DTOs use
  `class-validator` decorators; no endpoint accepts unvalidated JSON.
- Frontend mirrors the schema with `zod`; shared DTO → zod generation
  is a P1 chore.
- File uploads (lesson media) validated by magic-byte sniffing, not
  extension; stored outside the web root; served via a signed URL.

## Secrets

- `.env` on the VPS is owned by `root:root`, mode `600`.
- No secrets in source control. `gitleaks` runs as a pre-commit hook
  and in CI.
- `dotenv-vault` or `sops+age` is a P8 task; MVP uses plain `.env`
  with access restricted to the deploy user.
- Never log secrets. Redaction list: `password`, `token`,
  `authorization`, `cookie`, `secret`, `api_key`, `private_key`.

## Backup & recovery

- Daily `pg_dump` + `mongodump` to `/opt/lms/backups/`, retained 7
  days. Restore rehearsal is a P8 deliverable — we don't have a
  backup until we've restored from one.
- Redis is treated as disposable; any data we cannot afford to lose
  lives in Postgres.

## Audit & observability

- Every auth event (`login`, `login_failed`, `refresh`, `refresh_reuse`,
  `logout`, `password_change`, `role_change`) lands in an append-only
  `audit_log` Postgres table with the `user_id`, IP, user agent, and a
  monotonically increasing `seq`.
- 5xx, 401, and 403 responses emit a structured log with a correlation
  ID; Loki alert fires if 5xx rate > 1 % over 5 minutes.
- Sentry captures uncaught exceptions with stack traces and session
  context; PII is scrubbed before send.

## Responsible disclosure

(Post-MVP) — a `/.well-known/security.txt` will be published at
`khohoc.online/.well-known/security.txt` with a contact address.
