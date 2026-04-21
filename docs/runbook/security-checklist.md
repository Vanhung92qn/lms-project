# Security checklist (P8)

OWASP Top 10 + Docker-sandbox-specific checks. Use this before every
real user touches the platform, and revisit quarterly.

**Current posture:** green for pilot (≤500 users, single-VPS). Red
items listed at the bottom are the pre-launch blockers.

---

## OWASP Top 10 (2021) — current state

| # | Category | Mitigation | Status |
|---|----------|------------|--------|
| A01 | Broken access control | Casbin RBAC + per-endpoint guards + data-level ownership checks (`assertOwn` in teacher service); admin role gated in `AdminService` | ✅ |
| A02 | Cryptographic failures | argon2id password hash; JWT HS256 with 32-byte secret; TLS everywhere via Cloudflare Origin Cert + Full (strict) | ✅ |
| A03 | Injection | Prisma parameterised queries everywhere; class-validator on every DTO; sandbox runs untrusted code with `--network=none --read-only --cap-drop=ALL` | ✅ |
| A04 | Insecure design | Trust boundary explicit: AI Engine role read-only; wallet deduct + entitlement writes in a single Prisma transaction; approval-only money movement | ✅ |
| A05 | Security misconfiguration | Helmet middleware; CORS whitelist (not `*`); data stores bound to `127.0.0.1`; no default credentials committed | ✅ |
| A06 | Vulnerable components | `pnpm audit` on every CI run *(to be wired — see red list)*; Dependabot disabled currently | ⚠️ |
| A07 | Authentication failures | Refresh token rotation with reuse detection; rate limit on `/auth/login` via Throttler; argon2 memory cost 19 MiB | ✅ |
| A08 | Software & data integrity | CI-signed commits not required but `conventional commits` enforced via commitlint; no unsigned npm postinstall scripts | ✅ |
| A09 | Security logging | pino JSON logs to stdout; `audit_log` table for security events (register/login/refresh); correlation id on every HTTP error | ✅ |
| A10 | SSRF | api-core only hits `localhost:5001/5002/5003` and DeepSeek API (hard-coded). No user-controlled URL fetching anywhere. | ✅ |

---

## Sandbox / Docker escape (our #1 bespoke risk)

Runner containers spawned by `sandbox-orchestrator` enforce:
```
--network=none                          # no egress
--read-only                             # rootfs immutable
--tmpfs /tmp:size=10m,mode=1777,exec,nosuid,nodev
--memory=128m --memory-swap=128m        # no swap blowup
--cpus=0.5 --pids-limit=64              # no fork-bomb
--cap-drop=ALL                          # no NET_ADMIN, no SYS_ADMIN
--security-opt=no-new-privileges        # no setuid escalation
--security-opt=seccomp=/etc/seccomp/default.json
--user=10001:10001                      # non-root
--ulimit nofile=64 --ulimit nproc=32
timeout: 3s wall, 2s CPU                # time-bomb protection
```
Each request gets a **fresh container** that is **removed immediately**.
Host Docker daemon runs with **user-namespace remapping** (root in the
container is a high-UID user on the host).

Known gaps we're aware of:
- Not running rootless Docker yet — blocker for P9+ if we grow. Rootless
  prevents kernel exploits from escalating above the docker user.
- Seccomp profile is default Docker profile, not custom-tuned. For a
  course platform, a stricter profile (block `ptrace`, `clone*`,
  `unshare`, `keyctl`, etc.) would narrow the attack surface.

---

## API surface hardening

- ✅ **JWT secret** strength enforced at boot — 32+ bytes minimum, startup
  aborts in `NODE_ENV=production` if the dev fallback is in use.
- ✅ **CORS** — `CORS_ORIGIN` env is a comma-separated allow-list; no
  wildcards in prod.
- ✅ **Rate limits**:
  - Traefik global 100 req/min/IP
  - Throttler 100 req/min/IP on api-core (fallback)
  - 10/min/user on `/ai/tutor/ask`
  - DeepSeek daily cap 200/user/day (server-enforced)
  - 60/min on telemetry, 30/min on snapshots, 120/min on events
- ✅ **Input validation** on every DTO (class-validator). Max-length caps
  on every free-text field (user_note capped 2000, source capped 32k, etc.).
- ✅ **Helmet** security headers: HSTS, X-Content-Type-Options,
  X-Frame-Options SAMEORIGIN, Referrer-Policy: no-referrer.
- ✅ **Cookie hardening**: refresh token HttpOnly, Secure, SameSite=Strict;
  OAuth state cookie same flags + 5-min TTL.

---

## Secrets management

- ✅ `.env` chmod 600 on VPS, never committed (confirmed in `.gitignore`)
- ✅ Cloudflare Origin Cert mounted from `/opt/lms/secrets/` (600)
- ✅ DeepSeek key: user asked to rotate after accidental chat paste —
  confirmed rotated
- ⚠️ No `sops` / `dotenv-vault` — acceptable at pilot scale (one admin
  maintaining the host); needed before any multi-admin ops
- ⚠️ DB passwords are the default `change-me-in-prod` in `.env.example`
  — VPS MUST override. Check `.env` on fresh deploys.

---

## Data privacy

MVP scope:
- ✅ All data bound to `127.0.0.1` (Postgres, Redis, Mongo, Ollama)
- ✅ Only Traefik exposes 80/443; nothing else is Internet-reachable
- ✅ HTTPS everywhere via Cloudflare Full-Strict
- ✅ Password hashes never log (pino redact on `authorization`, `cookie`)

Gaps tracked for P9 (needed before GDPR-relevant jurisdictions):
- ⚠️ No per-user data export endpoint (GDPR Art. 15)
- ⚠️ No per-user data delete endpoint (GDPR Art. 17) — drops user +
  cascades to enrolments/submissions/ai_chats/code_snapshots
- ⚠️ No retention policy on audit log / admin notes

---

## Pre-launch red list (blockers)

Run through these before the first real pilot user:

- [ ] **Rotate every default secret** in `.env` on the VPS:
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (≥32 bytes random)
  - `POSTGRES_PASSWORD`
  - `MONGO_ROOT_PASSWORD`
  - `DEEPSEEK_API_KEY` (generate fresh if ever pasted anywhere)
- [ ] **Confirm backups run** — cron + `/opt/lms/backups/*.gz` growing
- [ ] **Test restore** — pick a snapshot and actually restore to a scratch DB
- [ ] **`pnpm audit`** clean, or waivers documented
- [ ] **UFW rules**: allow 22, 80, 443; deny everything else from Internet
- [ ] **UptimeRobot** pinging `/api/v1/healthz` every 5 minutes
- [ ] **OWASP ZAP baseline scan** run once; triage any Mediums+
- [ ] **k6-smoke.js** passes thresholds against production (10 VU, 30s)
- [ ] **Admin roles**: only you (the admin) have `role=admin`; no test
      accounts with `admin` in prod. Drop or lock seed accounts:
  ```sql
  UPDATE users SET status='locked' WHERE email IN (
    'student@khohoc.online', 'teacher@khohoc.online'
  );
  ```
  (Keep admin@khohoc.online if it's **you**, else rotate to your real email.)
- [ ] **Terms of service + privacy policy pages** live and linked in footer
      (skipped in dev; legal requirement for payment handling)

---

## What to run periodically

### Weekly
- `pnpm audit` — check for new CVEs in our dep tree
- Visit `/studio/overview` — scan the admin metrics for anomalies
- Review `audit_log` for suspicious patterns (brute-force login, mass
  OAuth attempts)

### Monthly
- Rotate JWT secrets (forces every user to re-login — communicate first)
- Backup restore drill on a scratch env
- Re-run OWASP ZAP baseline

### Quarterly
- Revisit this checklist top-to-bottom
- Review sandbox config — any new CVEs on the seccomp defaults?
- Bump LTS versions of runtime base images (postgres, mongo, ollama)

---

## Incident response

If you suspect a breach:

1. **Lock everything down** — `UPDATE users SET status='locked' WHERE id != '<your-admin-id>'`; revoke all refresh tokens:
   ```sql
   UPDATE refresh_tokens SET revoked_at = NOW() WHERE revoked_at IS NULL;
   ```
2. **Rotate secrets** — all JWT + DeepSeek + DB passwords. Restart api-core.
3. **Freeze writes** — stop api-core if you need to quarantine: `pkill -f node.*api-core/dist/main`
4. **Snapshot** — `./scripts/backup.sh` one more time for forensics
5. **Triage** — read `audit_log`; look for unusual IPs in `refresh_tokens.ip`
6. **Only then**, reopen — restart api-core with new secrets, unlock honest users
