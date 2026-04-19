# Runbook — OAuth Setup (Google + GitHub)

`/api/v1/auth/oauth/:provider/start` and `.../callback` are wired in
`api-core`. Flipping the "Continue with Google / GitHub" buttons on
becomes a matter of registering an app at each provider, pasting the
four env vars into `/home/root/lms-project/.env`, and restarting
api-core.

---

## Google

1. Go to https://console.cloud.google.com → **APIs & Services → Credentials**.
2. Click **+ Create credentials → OAuth client ID**. Configure the consent
   screen first if prompted (External, test users = your email).
3. Application type: **Web application**. Name: `khohoc.online`.
4. Authorized JavaScript origins:
   ```
   https://khohoc.online
   http://localhost:3000
   ```
5. Authorized redirect URIs:
   ```
   https://khohoc.online/api/v1/auth/oauth/google/callback
   http://localhost:4000/api/v1/auth/oauth/google/callback
   ```
6. Copy the **Client ID** and **Client secret**; paste into `.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=<client id>
   GOOGLE_OAUTH_CLIENT_SECRET=<client secret>
   ```

---

## GitHub

1. Go to https://github.com/settings/developers → **OAuth Apps → New OAuth App**.
2. Application name: `khohoc.online`. Homepage URL: `https://khohoc.online`.
3. Authorization callback URL (GitHub allows exactly one per app — create a
   second app for local dev if you need both):
   ```
   https://khohoc.online/api/v1/auth/oauth/github/callback
   ```
4. Register → click **Generate a new client secret**.
5. Paste into `.env`:
   ```
   GITHUB_OAUTH_CLIENT_ID=<client id>
   GITHUB_OAUTH_CLIENT_SECRET=<client secret>
   ```

---

## After updating .env

```bash
# Re-export env into current shell + restart api-core
set -a && source /home/root/lms-project/.env && set +a

pkill -f "node dist/main.js" || true
cd /home/root/lms-project/apps/api-core
pnpm exec nest build
setsid nohup node dist/main.js > /tmp/lms-logs/api.log 2>&1 < /dev/null & disown
```

Verify by clicking **Continue with Google** on https://khohoc.online/vi/login —
you should be redirected to Google's consent screen, then back to
`/vi/auth/oauth/callback`, then forwarded to `/vi/dashboard`.

---

## How the flow works

```
  browser        api-core              provider
     │              │                      │
     │  GET /auth/oauth/google/start       │
     │────────────▶│                      │
     │             │ set state cookie     │
     │             │ 302 consent url      │
     │◀────────────│                      │
     │                                    │
     │─── GET consent + user approves ───▶│
     │                                    │
     │◀── 302 /callback?code&state ───────│
     │              │                     │
     │  GET /auth/oauth/google/callback?code&state
     │────────────▶│                     │
     │             │ verify state cookie │
     │             │ POST code → token   │
     │             │──────────────────▶  │
     │             │◀── access_token ────│
     │             │ GET /userinfo       │
     │             │──────────────────▶  │
     │             │◀── profile ─────────│
     │             │ upsert user + link  │
     │             │ issue JWT pair      │
     │             │ 302 web/auth/oauth/callback#access=&refresh=
     │◀────────────│                     │
     │                                    │
     │  js reads fragment → sessionStorage
     │  router.replace('/dashboard')      │
```

Tokens live in the URL fragment, which is never sent to any server. The
web app reads them client-side, stores them, then strips the fragment
from the visible URL.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Clicking button returns `oauth_not_configured` | `.env` missing client id / secret | Paste credentials, re-run api-core with fresh env |
| `invalid_state` after consent | Cookie dropped (different subdomain) | Make sure api + web share the same apex domain |
| `redirect_uri_mismatch` on Google | Callback URL in console doesn't match request | Both https and http variants must be registered |
| GitHub `404 oauth/callback` | Only one callback URL allowed per GitHub OAuth App | Register two apps (one for prod, one for dev) |
| Works in dev, fails in prod with `Secure` cookie | `NODE_ENV=production` + http origin | Always use https in prod (Cloudflare provides) |
