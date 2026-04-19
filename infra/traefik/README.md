# Traefik (dev)

In this phase Traefik is launched in insecure/dev mode directly from
`infra/docker-compose.yml`. For production we will add:

- An `acme.json` volume holding the Cloudflare Origin certificate.
- A static `traefik.yml` file with `providers.file` loading dynamic
  rules from `dynamic/` (rate-limit, CSP headers, middleware chains).
- Restricted dashboard access behind basic auth + IP allowlist.

For now, http://localhost:8081 gives the insecure dashboard.
