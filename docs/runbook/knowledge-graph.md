# Runbook — Knowledge Graph v1 (P5b)

Concept-level skill model feeding the student dashboard, the next-lesson
recommender (P5c), and eventually the collaborative-filtering course
recommender (P7). Implemented as three Postgres tables + one Python
microservice. No Neo4j — YAGNI per ADR-004.

---

## Pipeline

```
  Student submits code
    │
    ▼
  api-core /api/v1/submissions  ──► sandbox-orchestrator (grading)
    │  verdict
    │
    ▼ if verdict == ac
  MasteryTrigger (fire-and-forget POST)
    │
    ▼
  data-science :5003  /v1/mastery/rebuild/:userId
    │  reads submissions ⨝ lesson_knowledge_nodes
    │  runs BKT forward per node
    │
    ▼
  user_mastery  (upserted row per node the student has touched)
    │
    ▼
  Student hits GET /api/v1/knowledge/me/mastery (next phase: dashboard widget)
```

---

## Data model (Postgres)

### `knowledge_nodes`
Vocabulary of concepts. Seeded from `prisma/seed.ts` with 15 foundational
C++/algo/ds nodes. Extend the seed — we want the list to stay short and
opinionated rather than exhaustive.

```
id         uuid PK
slug       text unique  -- e.g. 'pointers', 'recursion', 'loops'
title      text         -- Vietnamese title for display
domain     text         -- 'cpp' | 'algo' | 'ds' | ...
created_at timestamptz
```

### `knowledge_edges`
Directed edges. Current v1 only uses `prereq`; `related` is reserved for
the sibling/association pass later.

```
id         uuid PK
from_id    uuid → knowledge_nodes(id)
to_id      uuid → knowledge_nodes(id)
weight     decimal(4,3) default 1.000
relation   enum('prereq', 'related') default 'prereq'
UNIQUE (from_id, to_id, relation)
```

### `lesson_knowledge_nodes`
Many-to-many join. Each lesson should be tagged with 1–3 nodes. Teachers
set these via `PUT /api/v1/knowledge/lessons/:lessonId/tags`.

### `user_mastery`
Write sink for the data-science service. Read by the dashboard widget.

```
user_id, node_id   -- composite PK
score              decimal(4,3)  -- BKT mastery in [0, 1]
confidence         decimal(4,3)  -- n/(n+5) heuristic
attempts           int           -- number of submissions contributing
last_updated_at    timestamptz
```

---

## API surface (api-core)

| Method | Path | Auth | Role | Notes |
|--------|------|------|------|-------|
| GET | `/api/v1/knowledge/nodes?domain=cpp` | none | any | Vocabulary list |
| GET | `/api/v1/knowledge/graph` | none | any | Nodes + edges together |
| GET | `/api/v1/knowledge/me/mastery` | JWT | any | Current user's scored nodes |
| PUT | `/api/v1/knowledge/lessons/:lessonId/tags` | JWT | teacher (must own the lesson's course) | Replace tags; max 3 |

Nodes/edges CRUD is intentionally missing — teachers can't create new
concepts. We seed via Prisma and extend via migration/seed when the
vocabulary needs to grow.

---

## Operations

### Start data-science
```bash
cd apps/data-science
python3 -m venv .venv                   # first time only
.venv/bin/pip install -r requirements.txt

set -a && . /home/root/lms-project/.env && set +a
setsid nohup .venv/bin/uvicorn app:app --host 127.0.0.1 --port 5003 \
  > /tmp/lms-logs/data-science.log 2>&1 < /dev/null & disown

curl -sf http://127.0.0.1:5003/healthz
```

### Rebuild a user manually
```bash
# Grab any user id from Postgres
USER_ID=$(docker exec lms-postgres psql -U lms -d lms -tAc \
  "SELECT id FROM users WHERE email='student@khohoc.online'")

curl -X POST http://127.0.0.1:5003/v1/mastery/rebuild/$USER_ID
```

### Inspect mastery for a user
```bash
docker exec lms-postgres psql -U lms -d lms -c "
  SELECT kn.slug, um.score, um.confidence, um.attempts
    FROM user_mastery um
    JOIN knowledge_nodes kn ON kn.id = um.node_id
   WHERE um.user_id = '$USER_ID'
   ORDER BY um.score DESC;
"
```

---

## BKT parameters (current defaults)

Static per-node priors:
```
P(L0) = 0.10   prior probability the learner already knows the skill
P(T)  = 0.20   transition rate from not-known to known per practice
P(S)  = 0.10   slip: correct answer while not knowing
P(G)  = 0.20   guess: correct answer despite not knowing
```

Update formulas per observation (passed ∈ {0,1}):
```
P(L | o=1) = P(L)·(1 - P(S))       / [P(L)·(1 - P(S))       + (1 - P(L))·P(G)]
P(L | o=0) = P(L)·P(S)             / [P(L)·P(S)             + (1 - P(L))·(1 - P(G))]
P(L_next)  = P(L | o) + (1 - P(L | o)) · P(T)
```

Tuning per node (learned from data) lands in P7 when we have enough
observations. Until then these defaults give a reasonable ramp —
5 passes on a node push score from 0.10 to ~0.66.

Confidence is a heuristic `n/(n+5)`, not a real posterior variance — if
the dashboard surfaces weird behaviour we upgrade to a Beta posterior.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `db_unavailable` from healthz | DATABASE_URL missing / wrong | Verify `/home/root/lms-project/.env` has DATABASE_URL set |
| Mastery doesn't update after AC | Lesson isn't tagged | Tag via `PUT /api/v1/knowledge/lessons/:id/tags` |
| Mastery doesn't update ever | `DATA_SCIENCE_URL` empty in api-core env | Set it + restart api-core |
| 404 `knowledge_node_not_found` on PUT tags | Slug typo | Check `GET /api/v1/knowledge/nodes` first |
| Scores stuck at 0.1 | No AC submissions for that node yet | BKT only updates on actual observations — CE/WA/etc. don't count yet (future: penalise failed attempts too) |

---

## Backlog (post-P5b)

- **Penalise failed attempts** in BKT (currently only AC triggers rebuild; we should rebuild on every verdict + use the observed pass/fail).
- **Per-node BKT params** learned from aggregate data (EM or simple grid search).
- **Graph viewer** in admin panel (P7) — D3 force layout, edges coloured by relation.
- **Prereq gating** on lesson suggestions (P5c) — don't suggest lesson B to a student whose mastery of B's prereqs is < 0.5.
- **Cold-start boost**: when student enrols in a new course, look at their past mastery in similar domains to seed priors better than 0.10.
