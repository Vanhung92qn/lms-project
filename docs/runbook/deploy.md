# Runbook — Deployment & Disaster Recovery (P8)

Operational playbook for the pilot stack on a single VPS. Covers
fresh deploy, routine pushes, rollback, and "oh no" scenarios.

---

## Stack at a glance

| Component | Where it runs | Restart cost |
|-----------|---------------|--------------|
| Postgres 16 + pgvector | Docker (`lms-postgres`) | ~3s, no data loss (volume) |
| Redis 7 | Docker (`lms-redis`) | <1s, rate-limit counters lost (acceptable) |
| Ollama | Docker (`lms-ollama`) | ~60s cold model reload |
| MongoDB 7 *(P5a)* | Docker (`lms-mongo`) | ~5s |
| api-core | Native Node, port 4000 | ~5s |
| web (Next.js) | Native Node, port 3000 | ~8s cold |
| sandbox-orchestrator | Native Python venv, port 5001 | ~2s |
| ai-gateway | Native Python venv, port 5002 | ~2s |
| data-science | Native Python venv, port 5003 | ~2s |
| Traefik | Docker, ports 80/443 | ~2s |

`scripts/healthcheck.sh` verifies every piece with one command.

---

## Routine push (main → prod)

Assuming you just merged a PR into `main` on GitHub:

```bash
cd /home/root/lms-project
git checkout main && git pull origin main

# Run any new migrations (no-op if nothing changed).
cd apps/api-core && set -a && . ../../.env && set +a && pnpm prisma migrate deploy

# Rebuild api-core.
rm -f tsconfig.tsbuildinfo && pnpm exec nest build

# Rebuild web (only needed when apps/web changed).
cd ../web && rm -rf .next && pnpm run build

# Restart native services. Data-plane containers can stay up.
cd /home/root/lms-project
kill $(pgrep -f 'node.*api-core/dist/main')  || true
kill $(pgrep -f 'next-server')               || true
sleep 2
kill -9 $(pgrep -f 'node.*api-core/dist/main') $(pgrep -f 'next-server') 2>/dev/null || true

set -a && . .env && set +a
cd apps/api-core && setsid nohup node dist/main.js > /tmp/lms-logs/api.log 2>&1 < /dev/null & disown
cd ../web        && setsid nohup pnpm exec next start -p 3000 > /tmp/lms-logs/web.log 2>&1 < /dev/null & disown

# Verify.
sleep 5 && ./scripts/healthcheck.sh
```

When only docs changed, skip builds — no rebuild needed.

### Python services (sandbox / ai-gateway / data-science)

Only when Python code changed:
```bash
cd apps/<service>
kill $(pgrep -f 'uvicorn.*:PORT')
set -a && . /home/root/lms-project/.env && set +a
setsid nohup .venv/bin/uvicorn app:app --host 127.0.0.1 --port PORT \
  > /tmp/lms-logs/<service>.log 2>&1 < /dev/null & disown
```
(Replace `PORT` + log path appropriately.)

---

## Fresh deploy from scratch

New VPS. Ubuntu 22.04+, Docker + Docker Compose installed.

```bash
# 1. Clone
cd /home/root
git clone git@github.com:Vanhung92qn/lms-project.git
cd lms-project

# 2. Env (never commit!)
cp .env.example .env
chmod 600 .env
# Fill in: JWT secrets, DB passwords, DeepSeek key, MoMo/bank info

# 3. Cloudflare Origin Cert (if using custom domain)
sudo mkdir -p /opt/lms/secrets
# Upload cloudflare-origin.pem + cloudflare-origin.key to /opt/lms/secrets/
sudo chmod 600 /opt/lms/secrets/*

# 4. Data-plane containers
docker compose -f infra/docker-compose.yml --env-file .env up -d
# Wait ~30s for Ollama model pull on first boot; also:
docker exec lms-ollama ollama pull qwen2.5-coder:7b-instruct-q4_K_M

# 5. Install + migrate + seed
pnpm install --frozen-lockfile
cd apps/api-core
set -a && . /home/root/lms-project/.env && set +a
pnpm prisma migrate deploy
pnpm prisma db seed

# 6. Build all apps
cd /home/root/lms-project && pnpm -r build
cd apps/web && pnpm run build

# 7. Bootstrap Python services
for svc in sandbox-orchestrator ai-gateway data-science; do
  cd /home/root/lms-project/apps/$svc
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
done

# 8. Start everything — see Routine Push above.

# 9. Verify
./scripts/healthcheck.sh
```

---

## Rollback

A push broke production. Get back to the last known-good commit:

```bash
# Find the last green commit (usually the parent of the bad merge).
git log --oneline -10

# Revert on GitHub (preferred — creates an audit trail):
gh pr revert <broken-pr-number>   # or click Revert in the web UI

# On the VPS, fast-forward to main + rebuild + restart (as Routine Push).
```

**Hard rollback** (no network, emergency):
```bash
cd /home/root/lms-project
git checkout <last-good-sha>      # detached HEAD, that's fine
cd apps/api-core && pnpm prisma migrate resolve --rolled-back <bad-migration>
# Then: rebuild + restart (as above)
# Remember to get back on main: git checkout main (after the hotfix merges)
```

---

## Disaster recovery — restore from backup

Postgres data corrupt / lost. Daily backups live in `/opt/lms/backups/`:

```bash
# Pick the snapshot
ls -lht /opt/lms/backups/
SNAP=/opt/lms/backups/20260421-020000   # example

# 1. Stop api-core so no writes land during restore
kill $(pgrep -f 'node.*api-core/dist/main')

# 2. Restore Postgres
gunzip -c "$SNAP/postgres.sql.gz" | \
  docker exec -i lms-postgres psql -U lms -d lms

# 3. Restore Mongo (if used)
if [ -f "$SNAP/mongo.archive.gz" ]; then
  docker exec -i lms-mongo mongorestore \
    --username lms --password "$MONGO_ROOT_PASSWORD" \
    --authenticationDatabase admin \
    --drop --gzip --archive < "$SNAP/mongo.archive.gz"
fi

# 4. Start api-core + verify
cd /home/root/lms-project/apps/api-core
set -a && . ../../.env && set +a
setsid nohup node dist/main.js > /tmp/lms-logs/api.log 2>&1 < /dev/null & disown
./scripts/healthcheck.sh
```

See `scripts/backup.sh` for what's captured + retention.

### Cron for daily backups
```
# /etc/cron.d/lms-backup  (root)
MAILTO=admin@khohoc.online
0 2 * * * root /home/root/lms-project/scripts/backup.sh >> /var/log/lms-backup.log 2>&1
```

Test the cron before you trust it:
```bash
sudo -u root /home/root/lms-project/scripts/backup.sh
ls -lh /opt/lms/backups/
```

---

## Common incidents

### "Site is down"
```bash
./scripts/healthcheck.sh
```
Any red ✗ tells you exactly what failed. Common flows:

- **api-core down** → `tail -50 /tmp/lms-logs/api.log` — usually an unhandled exception. Restart.
- **Postgres down** → `docker logs lms-postgres --tail 50` — usually disk full. `df -h`.
- **Ollama hung** → `docker restart lms-ollama`, wait 60s for model reload.
- **Traefik 502** → `docker restart lms-traefik`; check host-gateway extra_hosts.

### AI Tutor not responding
1. Hit `curl http://127.0.0.1:5002/healthz` — if fail, restart ai-gateway.
2. Hit `curl http://127.0.0.1:11434/api/version` — if fail, restart ollama.
3. Cold start: model reload takes up to 60s.

### Admin sees "Pending topups" piling up
Normal — admin has to manually verify bank transfers.
If the queue explodes, audit `wallet_topups` for obvious spam
(same email spamming ~50 requests = probably a bug).

### Wallet balance drift
```sql
SELECT
  (SELECT COALESCE(SUM(wallet_balance_cents),0) FROM users) as total_balance,
  (SELECT COALESCE(SUM(amount_cents),0) FROM wallet_topups WHERE status='approved') as total_topped_up,
  (SELECT COALESCE(SUM(amount_cents),0) FROM entitlements WHERE source='purchase') as total_spent
;
-- Should satisfy: total_balance + total_spent = total_topped_up
```

---

## Observability

Current (P8 MVP):
- **Logs**: `/tmp/lms-logs/*.log` (stdout redirect, JSON structured via pino)
- **Metrics**: `GET /api/v1/metrics` — plain Prometheus text format,
  can be scraped by any Prometheus or just `curl | grep` for spot checks

Deferred:
- Prometheus + Grafana container stack (needs ~800 MB RAM — hold off until
  real DAU justifies it)
- Loki + Promtail for log aggregation
- Sentry for error alerting
- UptimeRobot for external uptime (5-min pings to `/healthz`)

---

## Ports reference

| Port | Service | Exposed to |
|------|---------|------------|
| 22 | SSH | Internet (firewall) |
| 80, 443 | Traefik | Cloudflare proxy |
| 3000 | Next.js | 127.0.0.1 (behind Traefik) |
| 4000 | api-core | 127.0.0.1 |
| 5001 | sandbox-orchestrator | 127.0.0.1 |
| 5002 | ai-gateway | 127.0.0.1 |
| 5003 | data-science | 127.0.0.1 |
| 5432 | Postgres | 127.0.0.1 (published for Prisma tooling) |
| 6379 | Redis | 127.0.0.1 |
| 11434 | Ollama | 127.0.0.1 |
| 27017 | MongoDB | 127.0.0.1 |
| 8081 | Traefik dashboard | 127.0.0.1 only |

If any of the above is reachable from the Internet except 22/80/443, that's
a misconfiguration — check UFW or the Docker port binding (`127.0.0.1:PORT:PORT`).
