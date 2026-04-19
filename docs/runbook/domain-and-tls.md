# Runbook — Domain & TLS (khohoc.online)

How `khohoc.online` is served end-to-end on the production VPS, and what
to do when the certificate needs rotating.

---

## Topology

```
  Browser
    │
    │  HTTPS (TLS 1.3, edge cert: Let's Encrypt via Cloudflare)
    ▼
  Cloudflare edge  (DNS proxied, orange cloud, "Full (strict)" SSL mode)
    │
    │  HTTPS (TLS 1.2+, origin cert: Cloudflare Origin CA)
    ▼
  VPS 45.76.159.66  ufw: allow 80,443 from Anywhere; 22; 172.16/12
    │
    │  plain TCP on 443 → container
    ▼
  Traefik v3     (in Docker; terminates TLS with origin cert)
    │
    │  HTTP over host-gateway
    ▼
  api-core :4000   (Node process on host — for now; containerise in P1.2)
  web      :3000   (Node process on host — for now; containerise in P1.2)
```

---

## Required assets on the VPS

| Path | Content | Permissions |
|------|---------|-------------|
| `/opt/lms/secrets/cloudflare-origin.pem` | Origin certificate (PEM) | `600 root:root` |
| `/opt/lms/secrets/cloudflare-origin.key` | Private key matching the cert | `600 root:root` |
| `/home/root/lms-project/infra/traefik/traefik.yml` | Static config (git) | `644` |
| `/home/root/lms-project/infra/traefik/dynamic/*.yml` | Routers, TLS, middlewares (git) | `644` |
| `/home/root/lms-project/.env` | Runtime env | `600 root:root` |

**The cert + key are NEVER committed to git.** Adding them to the
repository — in any form, even encrypted — is a review blocker.

---

## Cloudflare dashboard settings

- **DNS** — A record `khohoc.online` → `45.76.159.66`, **proxied**.
  A record `www` → `45.76.159.66`, **proxied**.
- **SSL/TLS → Overview** — mode **Full (strict)**.
- **SSL/TLS → Origin Server** — issue a 15-year Origin CA cert covering
  `khohoc.online` and `*.khohoc.online`. Download PEM + key; save to
  `/opt/lms/secrets/` with `chmod 600` (see below for the shell snippet).
- **SSL/TLS → Edge Certificates** — Always Use HTTPS: ON.
- **Security → Bot Fight Mode**: ON (free tier).

---

## First-time setup on a fresh VPS

```bash
sudo mkdir -p /opt/lms/secrets
sudo chmod 700 /opt/lms/secrets
sudo tee /opt/lms/secrets/cloudflare-origin.pem > /dev/null <<'EOF'
-----BEGIN CERTIFICATE-----
... paste certificate ...
-----END CERTIFICATE-----
EOF
sudo tee /opt/lms/secrets/cloudflare-origin.key > /dev/null <<'EOF'
-----BEGIN PRIVATE KEY-----
... paste key ...
-----END PRIVATE KEY-----
EOF
sudo chmod 600 /opt/lms/secrets/*

# Sanity-check that the cert and key match:
diff <(openssl rsa  -in /opt/lms/secrets/cloudflare-origin.key -pubout  2>/dev/null) \
     <(openssl x509 -in /opt/lms/secrets/cloudflare-origin.pem -pubkey -noout) \
     && echo "cert+key match" || echo "MISMATCH — re-download"
```

Firewall (ufw):

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp  comment 'http (cloudflare)'
sudo ufw allow 443/tcp comment 'https (cloudflare)'
sudo ufw allow from 172.16.0.0/12 comment 'docker bridges → host'
sudo ufw enable
```

(Post-MVP we'll tighten 80/443 to the Cloudflare IP allowlist only;
for now any source is accepted so Let's-Encrypt-style health checks
don't break.)

---

## Bring the stack up

```bash
cd /home/root/lms-project
cp .env.example .env            # then edit secrets / DB password
chmod 600 .env

# Bring up postgres / redis / traefik
docker compose -f infra/docker-compose.yml up -d

# First-time DB setup
pnpm install --frozen-lockfile
pnpm --filter api-core exec prisma migrate deploy
pnpm --filter api-core db:seed

# Start api-core + web (containerisation lands in P1.2)
pnpm --filter api-core build
pnpm --filter web build
cd apps/api-core && setsid nohup node dist/main.js   > /tmp/lms-logs/api.log  2>&1 < /dev/null & disown
cd ../web        && setsid nohup pnpm exec next start -p 3000 > /tmp/lms-logs/web.log  2>&1 < /dev/null & disown
```

Smoke test from outside:

```bash
curl -sI https://khohoc.online/api/v1/healthz
curl -s  https://khohoc.online/vi | head -c 200
```

Both should succeed within 1–2 s.

---

## Rotating the Origin certificate

When the Cloudflare Origin cert approaches expiry, is exposed, or when
the domain changes:

1. In Cloudflare → **SSL/TLS → Origin Server**, **Revoke** the old cert.
2. **Create Certificate** → 15-year validity, hostnames
   `khohoc.online, *.khohoc.online` → download **Origin Certificate** and
   **Private Key**.
3. On the VPS:

   ```bash
   sudo cp /opt/lms/secrets/cloudflare-origin.pem /opt/lms/secrets/cloudflare-origin.pem.old
   sudo cp /opt/lms/secrets/cloudflare-origin.key /opt/lms/secrets/cloudflare-origin.key.old
   sudo tee /opt/lms/secrets/cloudflare-origin.pem > /dev/null <<'EOF'
   -----BEGIN CERTIFICATE-----
   ... new cert ...
   -----END CERTIFICATE-----
   EOF
   sudo tee /opt/lms/secrets/cloudflare-origin.key > /dev/null <<'EOF'
   -----BEGIN PRIVATE KEY-----
   ... new key ...
   -----END PRIVATE KEY-----
   EOF
   sudo chmod 600 /opt/lms/secrets/*
   ```

4. Traefik hot-reloads the `dynamic/tls.yml` config; no restart needed.
   Verify with:

   ```bash
   docker exec lms-traefik cat /etc/traefik/certs/cloudflare-origin.pem \
     | openssl x509 -enddate -noout
   ```

5. Purge the `.old` files once you've verified the new cert serves
   traffic cleanly for 24 h:

   ```bash
   sudo rm /opt/lms/secrets/cloudflare-origin.{pem,key}.old
   ```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `502/504 Gateway Timeout` from Traefik to host | ufw dropping packets from docker bridge to host | `ufw allow from 172.16.0.0/12` |
| TLS handshake failure | Cert and key don't match | Re-run the `openssl` sanity-check above |
| `ERR_SSL_PROTOCOL_ERROR` in browser but works in curl | Cloudflare SSL mode is not "Full (strict)" | Switch to Full (strict) |
| 404 on `/api/*` but 200 on `/vi` | api-core not running OR routes.yml wrong | `tail -50 /tmp/lms-logs/api.log` |
| 521 "Web server is down" from Cloudflare | Traefik not listening on 443 | `docker ps` then `docker logs lms-traefik` |
| Let's-encrypt-style Cloudflare edge cert appears expired | Cloudflare automatically renews — if a recent dashboard change broke it, toggle "Always Use HTTPS" off → on | |

---

## Known limitations (P1 scope)

- api-core and web run as native node processes managed by `setsid nohup`.
  Not supervised; crash recovery is manual. **P1.2** wraps both in
  Dockerfiles so they join the compose stack and systemd restart policy
  becomes automatic.
- ufw currently allows 80/443 from any source. **P8** tightens to the
  Cloudflare IP allowlist (`curl -s https://www.cloudflare.com/ips-v4`).
- The Cloudflare dashboard dashboard under `http://127.0.0.1:8081` is
  served insecurely for local-only access. **P8** moves it behind
  HTTP-basic auth and an IP allowlist middleware.
