# Infrastructure & Deployment

Single VPS, Docker Compose, Cloudflare in front. Deliberately boring.
K8s, service meshes, and multi-node orchestration are explicitly out
of scope for the MVP (see ADR-001). This document captures what runs
where, how much RAM each piece gets, and how we move from one VPS to
two when (not if) we need to.

## Target host

| Attribute | Value |
|-----------|-------|
| Provider | A Vietnamese or SEA VPS provider with KVM virtualization |
| OS | Ubuntu 22.04 LTS |
| CPU | 4–8 vCPU (x86_64) |
| RAM | 16 GB |
| Disk | 80–120 GB NVMe |
| Swap | 8 GB (for bursts, not steady state) |
| Network | ≥ 100 Mbps, IPv4 public, IPv6 a bonus |

Direct IP access to the VPS is firewalled to Cloudflare's published IP
ranges; end users can only reach the box through the orange cloud.

## On-disk layout (prod)

```
/opt/lms/
├── docker-compose.prod.yml
├── .env                       # root:root 0600
├── data/
│   ├── postgres/              # volume
│   ├── mongo/                 # volume
│   ├── redis/                 # volume (AOF enabled)
│   ├── ollama/models/         # ~5 GB for llama3:8b-Q4
│   ├── traefik/acme.json      # Cloudflare Origin CA cert
│   └── uploads/               # user / lesson media
├── logs/
│   └── *.log                  # symlinked from containers
└── backups/
    ├── postgres/
    └── mongo/
```

## Container inventory (prod)

| Container | Image | Internal port | Public? | Notes |
|-----------|-------|---------------|---------|-------|
| `traefik` | `traefik:v3` | 80/443 | Yes | Only public-facing service |
| `web` | `ghcr.io/vanhung92qn/lms-web` | 3000 | No | Next.js SSR |
| `api-core` | `ghcr.io/vanhung92qn/lms-api-core` | 4000 | No | NestJS |
| `sandbox-orchestrator` | `ghcr.io/vanhung92qn/lms-sandbox` | 5001 | No | Needs `/var/run/docker.sock` |
| `ai-gateway` | `ghcr.io/vanhung92qn/lms-ai-gateway` | 5002 | No | Talks to `ollama` |
| `data-science` | `ghcr.io/vanhung92qn/lms-data-science` | 5003 | No | Cron + on-demand jobs |
| `ollama` | `ollama/ollama` | 11434 | No | Loaded with `llama3:8b-instruct-q4_K_M` |
| `postgres` | `postgres:16-alpine` | 5432 | No | `pgvector` extension enabled |
| `mongo` | `mongo:7` | 27017 | No | Replica set of 1 (for changestreams) |
| `redis` | `redis:7-alpine` | 6379 | No | AOF everysec |
| `prometheus` | `prom/prometheus` | 9090 | No | Scrapes all services |
| `grafana` | `grafana/grafana` | 3001 | Via Traefik `/grafana` admin-only | Dashboards |
| `loki` | `grafana/loki` | 3100 | No | Log storage |
| `promtail` | `grafana/promtail` | — | No | Log shipper |
| `node-exporter` | `prom/node-exporter` | 9100 | No | Host metrics |
| `cadvisor` | `gcr.io/cadvisor/cadvisor` | 8080 | No | Container metrics |

In addition, the `sandbox-orchestrator` transiently spawns per-request
`lms-runner-{cpp,node,python}` containers. They are ephemeral, capped
at 128 MB RAM each, and removed on exit.

## RAM budget (16 GB target)

| Component | Reserved |
|-----------|----------|
| Ollama (Llama 3 8B Q4 loaded) | 6 000 MB |
| PostgreSQL | 1 500 MB |
| MongoDB | 1 000 MB |
| Redis | 512 MB |
| api-core (Node.js) | 512 MB |
| web (Next.js SSR) | 512 MB |
| sandbox-orchestrator | 300 MB |
| ai-gateway | 300 MB |
| data-science | 300 MB |
| Observability stack (Prom + Grafana + Loki + Promtail + exporters) | 1 000 MB |
| Sandbox transient burst (≤ 4 concurrent runners × 128 MB) | 512 MB |
| OS + buffer/cache | 3 500 MB |
| **Total** | **≈ 15 000 MB** |

We are deliberately close to the ceiling. `cadvisor` watches per-
container usage; alerts fire at 85 % sustained for 5 min. Swap (8 GB)
is there as a buffer for short spikes; steady-state swap use > 200 MB
is an alert.

## Network topology

```
Internet
   │
   ▼
 Cloudflare (edge + WAF + free TLS 1.3)
   │  (Cloudflare ↔ origin: TLS via Origin CA)
   ▼
 VPS firewall — ufw allowlist on CF IPs for 80/443, deny all else
   │
   ▼
 Traefik v3 (80 → 443 redirect, routes by Host + Path)
   │
   ├─► web         (Host: khohoc.online)
   ├─► api-core    (Host: khohoc.online, Path: /api/*)
   ├─► grafana     (Host: khohoc.online, Path: /grafana/*, admin-only middleware)
   └─► (others: internal only, not routed)
```

Internal container-to-container traffic stays on the Docker
`lms_internal` bridge network. `ollama`, `postgres`, `mongo`, `redis`
are on a further-restricted `lms_data` network that only services
that need them join.

## Deployment flow

1. Dev pushes to a feature branch → GitHub Actions runs CI (lint,
   typecheck, tests, build).
2. Human merges PR into `develop`. CI builds and publishes images
   tagged `:develop-<sha>` to GHCR.
3. Staging deploy (manual or triggered) SSHes to the VPS:
   ```bash
   cd /opt/lms
   docker compose pull
   docker compose up -d
   ```
4. Smoke test hits `/healthz` and a canary auth flow.
5. When the release is cut, `develop → main` PR is merged; `:latest`
   and `:<sha>` images are published and rolled out the same way.

## Observability quick reference

- **Metrics:** `http://<vps>/grafana` (Grafana, admin-auth).
- **Dashboards (MVP):** HTTP latency & errors · DB (Postgres + Mongo
  + Redis) · AI queue depth & inference latency · Sandbox run rate
  and verdict distribution.
- **Logs:** Grafana → Explore → Loki. Labels: `service`, `level`,
  `correlation_id`.
- **Errors:** Sentry free-tier project `ai-lms`. 5k events/month
  envelope; we scrub PII before send.
- **Alerts (Grafana):**
  - CPU > 85 % for 5 min
  - RAM > 90 % for 5 min
  - Disk > 80 %
  - 5xx rate > 1 % for 5 min (per-service)
  - AI queue depth > 10 for 2 min
  - Ollama unreachable for > 30 s

## Backup & recovery

- **Daily at 03:00 ICT** — systemd timer runs
  `scripts/backup-db.sh`:
  - `pg_dump -Fc` → `/opt/lms/backups/postgres/<date>.dump`
  - `mongodump --archive --gzip` →
    `/opt/lms/backups/mongo/<date>.archive.gz`
  - Prune files older than 7 days.
- **Offsite copy** (post-MVP) — rsync / rclone to a B2 or S3 bucket.
- **Restore drill** (P8) — a full restore into a throwaway VPS must
  complete in < 30 min and the app must boot to healthy.

## Cloudflare configuration checklist

- [ ] `khohoc.online` A record → VPS IP, proxied (orange cloud).
- [ ] SSL/TLS mode: **Full (strict)**. Origin certificate uploaded to
      Traefik; browser-facing cert is Cloudflare Universal.
- [ ] Edge Certificates → Always Use HTTPS; HSTS on (after P8).
- [ ] Firewall: Bot Fight Mode on; geo-rules — review at P8.
- [ ] Page Rules: cache-all for `/_next/static/*`, bypass for `/api/*`
      and `/grafana/*`.
- [ ] Access (optional) — Cloudflare Access gate on `/grafana/*`.

## Scaling plan (when the pilot outgrows one box)

In order:

1. **Split Ollama onto a second VPS** (ideally with a GPU). Only
   `AI_GATEWAY_OLLAMA_URL` changes in `ai-gateway`.
2. **Move Postgres off the box** — managed (Neon / DigitalOcean /
   CrunchyBridge) or a second VPS. Two-digit-ms latency to API host.
3. **Horizontal sandbox pool** — multiple sandbox hosts behind
   `sandbox-orchestrator`'s dispatcher. Each host is a Docker daemon
   that only speaks to the orchestrator over mTLS.
4. **Split the monolith** by extracting whichever module has the
   highest traffic share. Likely `assessment` first.

Only after all of the above is K8s interesting. Until then, Compose
is the right tool.
