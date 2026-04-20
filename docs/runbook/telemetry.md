# Runbook — Telemetry (P5a)

Behavioural data store that feeds the knowledge-graph + recommendation
pipelines scheduled for P5b/P5c/P7. **Everything here is best-effort:**
if MongoDB is down, writes become no-ops and the lesson player / AI
tutor keep working — we never block a user on telemetry.

---

## Pipeline

```
  Student browser
    │ POST /api/v1/telemetry/event    (tab_switch, lesson_open, submit)
    │ POST /api/v1/telemetry/snapshot (30s-debounced editor autosave)
    ▼
  api-core :4000 — JwtAuthGuard + Throttler
    │ plus: tutor stream tees server-side into ai_chats (no browser call)
    ▼
  MongoService → MongoDB 7 :27017 (127.0.0.1-only)
    │
    ├─ ai_chats          — tutor conversations per (user, lesson)
    ├─ code_snapshots    — TTL 14 days
    └─ learning_events   — TTL 90 days
```

---

## Collections

### `ai_chats`
Upserted per (userId, lessonId). Each tutor turn pushes two entries
into `messages[]`: `{role: 'user', content, at}` + `{role: 'assistant',
content, at}`. `provider` is updated to reflect whichever backend
served the most recent turn (llama / deepseek).

Shape is intentionally loose — data-science reads with `find()`
cursors and we'd rather evolve the shape than run a migration. Every
document carries `schemaVersion: 1` so we can migrate later.

### `code_snapshots`
One insert per 30 s of editor activity (client-debounced). `source`
capped at 32 KB. TTL index drops documents past 14 days — the
knowledge tracker only looks at recent patterns anyway.

### `learning_events`
Generic event log. Current events the frontend fires:
- `lesson_open` — lesson mount
- `submit` — after a grading result lands
- `submit_error` — when grading itself 5xx'd
- `tab_switch` — Terminal ↔ AI Tutor flip
(Extensible — add new event names without touching the server.)

TTL 90 days. `metadata` is an opaque object projected by data-science.

---

## Operations

### Start / health
```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d mongo

docker exec lms-mongo mongosh --quiet --norc \
  -u lms -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  --eval 'db.runCommand({ping:1}).ok'
```

### Inspect
```bash
docker exec -it lms-mongo mongosh --norc \
  -u lms -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin lms_telemetry

> db.ai_chats.find({}).sort({lastActivityAt: -1}).limit(5).pretty()
> db.code_snapshots.countDocuments()
> db.learning_events.aggregate([{$group: {_id: "$event", n: {$sum: 1}}}])
```

### Storage budget
| Collection | Est. growth | TTL | Notes |
|---|---|---|---|
| `ai_chats` | ~2 KB × tutor turn × student | none | Trimmed by data-science once session processed |
| `code_snapshots` | ~2 KB × 1/30s × active student | 14 d | Bounded: ~120 docs/hour × student |
| `learning_events` | ~200 B × event | 90 d | Cheap; keep for longitudinal analysis |

At 500 students with pilot usage we expect <500 MB steady state — well
within the 1 GB WiredTiger cache we reserved.

### Backup
`mongodump` into `/opt/lms/backups/`, piggybacks on the existing daily
pg_dump cron. Full runbook lands with the generic backup cron in P8.

---

## Disabling telemetry

Set `MONGO_URL=` (empty) in `.env` and restart api-core. `MongoService`
logs a startup warning, all three collections resolve to `null`, and
every telemetry write becomes a silent no-op. Useful for smoke-testing
outside of the VPS.

---

## Privacy (P5-scope only — hardening deferred to P6 with payment)

- All three collections hold student-identifiable data. They live on
  127.0.0.1 and are never exposed to the public internet.
- No per-user export / delete endpoints yet — there is only one real
  user today. Shipping these alongside the payment flow in P6 is a
  blocker for onboarding real students past the pilot.
- Mongo root credentials live in `.env` (chmod 600 on the VPS) and are
  never committed.
