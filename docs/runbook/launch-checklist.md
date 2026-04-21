# Launch checklist (P8 → go-live)

Everything that MUST be true before the first real pilot user touches
the platform. Run through these top-to-bottom. Do not skip.

Split into **Red** (blockers — cannot launch without), **Amber**
(strongly recommended), and **Green** (verify-only, already known
good).

---

## 🔴 Red — blockers

### Secrets
- [ ] `.env` on VPS does NOT contain any `change-me-in-prod` / `dev-fallback`
- [ ] `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` are cryptographically
      random, ≥32 bytes each (`openssl rand -base64 48`)
- [ ] `POSTGRES_PASSWORD` + `MONGO_ROOT_PASSWORD` rotated from default
- [ ] `DEEPSEEK_API_KEY` is the live key, **not** the one pasted in dev chat
- [ ] `.env` chmod is 600, owner root
- [ ] `/opt/lms/secrets/cloudflare-origin.{pem,key}` exist, 600, not committed

### Backups
- [ ] `scripts/backup.sh` runs cleanly on demand:
      `/home/root/lms-project/scripts/backup.sh`
- [ ] Cron entry installed: `cat /etc/cron.d/lms-backup`
- [ ] At least one successful automated run: `ls -lh /opt/lms/backups/`
- [ ] **Restore drill**: pick an old snapshot, restore to a scratch DB,
      verify row counts match — this is the only real test

### Firewall
- [ ] `ufw status` shows only 22 / 80 / 443 open to the Internet
- [ ] From another host, `nmap -p 3000,4000,5001,5002,5003,5432,6379,11434,27017
      <vps-ip>` returns filtered/closed for all of them
- [ ] Traefik dashboard (`:8081`) is 127.0.0.1-only — confirm:
      `ss -ltn | grep 8081` shows `127.0.0.1:8081` not `0.0.0.0:8081`

### Seed accounts
- [ ] Demo accounts (`student@khohoc.online`, `teacher@khohoc.online`)
      are **locked or removed** OR you've re-seeded with production
      accounts you actually own
- [ ] `admin@khohoc.online` email either points to an inbox you
      control OR replaced with your real email

### Sandbox
- [ ] `docker exec lms-postgres psql -U lms -d lms -c "SELECT count(*) FROM submissions WHERE verdict='ie'"` — count should be 0 or trivially small (Internal Error = orchestrator bug)
- [ ] Submit a known-good Hello World → returns AC within 5 seconds
- [ ] Submit a deliberately bad submission (`while(1);`) → gets TLE, not hang

### Data plane
- [ ] `./scripts/healthcheck.sh` — all 12 checks green
- [ ] Disk: `df -h /` shows >20% free (backups need headroom)
- [ ] RAM: `free -h` shows >2 GB free (we budgeted 14.7 GB, we want
      some breathing room)

---

## 🟡 Amber — strongly recommended

### Observability
- [ ] UptimeRobot (or equivalent) pinging `https://khohoc.online/api/v1/healthz`
      every 5 minutes with email/SMS alert on failure
- [ ] `GET /api/v1/metrics` returns a valid Prometheus response
- [ ] Log rotation set up for `/tmp/lms-logs/*.log` (logrotate or a cron
      that truncates at 100 MB) — otherwise disk fills in ~2 weeks

### Load
- [ ] `k6 run scripts/k6-smoke.js -e BASE=https://khohoc.online` passes
      thresholds: p95 < 800ms on reads, p95 < 1500ms on login, <1% errors
- [ ] Ollama model warm — hit `/api/v1/ai/tutor/ask` twice before demo
      to avoid the 60s cold-load on first real user

### Content
- [ ] At least 1 published course with at least 3 lessons (students
      land on an empty catalog is a worse experience than a locked door)
- [ ] Terms of service + privacy policy pages exist and are linked in footer
- [ ] Legal: VNPay/MoMo merchant terms signed if we're accepting real
      money (wallet manual approval is OK without for internal pilots)

### Security
- [ ] `pnpm audit` clean, or documented waivers
- [ ] OWASP ZAP baseline scan run once against staging copy; all
      Highs triaged
- [ ] Cloudflare WAF mode: **Challenge** (not Block) so legit VN users
      don't get stuck; enable Bot Fight Mode

---

## 🟢 Green — verify (already done)

These are implementation details the codebase already enforces:

- [x] Argon2id password hashing (verify: check a registered user's
      `password_hash` starts with `$argon2id$`)
- [x] JWT refresh rotation + reuse detection
      (`apps/api-core/src/modules/iam/auth/auth.service.ts`)
- [x] HTTPS everywhere + HSTS header (Helmet in api-core, Cloudflare
      Full-Strict)
- [x] Prisma parameterised queries — nothing uses `$queryRawUnsafe`
      (verify: `grep -r queryRawUnsafe apps/api-core/src` returns empty)
- [x] Sandbox isolation flags — see `docs/runbook/security-checklist.md` §Sandbox
- [x] Rate limits on auth + AI tutor + telemetry endpoints
- [x] Helmet + CORS whitelist in `apps/api-core/src/main.ts`

---

## Post-launch day-1 checks

After the first real user has signed up + done something:

1. Check `audit_log` for errors:
   ```sql
   SELECT event, count(*) FROM audit_log
    WHERE occurred_at > NOW() - INTERVAL '24 hours'
    GROUP BY event ORDER BY 2 DESC;
   ```
2. Check Prometheus metrics for anomalies:
   ```bash
   curl -s http://127.0.0.1:4000/api/v1/metrics
   ```
3. Check for spam signups (too many from same IP):
   ```sql
   SELECT ip, count(*) FROM audit_log
    WHERE event = 'user_registered' AND occurred_at > NOW() - INTERVAL '24 hours'
    GROUP BY ip HAVING count(*) > 5;
   ```
4. Skim api-core logs: `tail -200 /tmp/lms-logs/api.log | grep -iE "error|warn"`
5. Visit `/studio/overview` as admin — any number that looks wrong?

---

## Launch day cadence

| Time | Action |
|------|--------|
| T-24h | Rotate secrets, final backup, freeze main |
| T-2h  | Warm up Ollama (hit tutor 3 times), run `./scripts/healthcheck.sh` |
| T-1h  | k6 smoke against production URL |
| T-0   | Announce. Watch `tail -f /tmp/lms-logs/api.log` for the first 30 min |
| T+2h  | Run day-1 checks above |
| T+24h | Review metrics, user feedback, plan hotfixes |

---

## When to rollback

You roll back when:
- p95 latency jumps 3×+ and doesn't self-correct in 2 minutes
- Error rate > 2% sustained for 5 minutes
- Data corruption detected (wallet balance drift, missing entitlements)
- Security incident confirmed

See `docs/runbook/deploy.md` §Rollback for procedure.
