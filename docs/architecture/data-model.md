# Data Model (MVP)

Data lives in three stores, each chosen for a specific access pattern.

| Store | Role | Access pattern |
|-------|------|----------------|
| **PostgreSQL 16** (+ `pgvector`) | Transactional truth — users, courses, submissions, billing, knowledge graph | Relational reads/writes, FK integrity, recursive CTE for graph |
| **MongoDB 7** | Behavioral event trail — AI chats, code snapshots, learning events | Append-heavy, schema-flexible, low-value-per-row |
| **Redis 7** | Ephemeral: cache, session, rate-limit counters, BullMQ queues | µs reads, TTL-driven eviction |

The PostgreSQL schema is described below by bounded context. Each
context owns its own prefix; cross-context FKs are kept shallow so we
can extract a module later without rewriting every query.

## PostgreSQL — tables by context

### IAM

```
users (
  id              uuid PK,
  email           citext UNIQUE NOT NULL,
  password_hash   text NOT NULL,      -- argon2id
  display_name    text,
  avatar_url      text,
  locale          text DEFAULT 'vi',  -- 'vi' | 'en'
  status          text DEFAULT 'active', -- active|locked|pending
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
)

roles (
  id    smallserial PK,
  name  text UNIQUE   -- 'student' | 'teacher' | 'admin' | 'ai_engine'
)

user_roles (
  user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  role_id  smallint REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
)

refresh_tokens (
  id          uuid PK,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,         -- argon2id of opaque token
  family_id   uuid NOT NULL,         -- reuse-detection family
  issued_at   timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
)

oauth_accounts (
  provider     text,                -- 'google' | 'github'
  provider_id  text,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_id)
)
```

Indexes: `users (email)`, `refresh_tokens (user_id, family_id)`,
partial unique on `refresh_tokens (token_hash) WHERE revoked_at IS NULL`.

### Catalog / CMS

```
courses (
  id             uuid PK,
  slug           text UNIQUE,
  title          text NOT NULL,
  description    text,
  teacher_id     uuid REFERENCES users(id),
  status         text DEFAULT 'draft',   -- draft|published|archived
  pricing_model  text NOT NULL,          -- free|paid
  price_cents    integer,                -- null when free
  currency       char(3),                -- ISO 4217 (e.g. 'VND')
  cover_url      text,
  locale         text DEFAULT 'vi',
  published_at   timestamptz,
  created_at     timestamptz DEFAULT now()
)

modules (
  id         uuid PK,
  course_id  uuid REFERENCES courses(id) ON DELETE CASCADE,
  title      text NOT NULL,
  sort_order integer NOT NULL
)

lessons (
  id                uuid PK,
  module_id         uuid REFERENCES modules(id) ON DELETE CASCADE,
  title             text NOT NULL,
  sort_order        integer NOT NULL,
  type              text NOT NULL,   -- markdown|exercise|quiz
  content_markdown  text,
  est_minutes       integer
)

exercises (
  id              uuid PK,
  lesson_id       uuid UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
  language        text NOT NULL,     -- c|cpp|js|python
  starter_code    text,
  solution_code   text,              -- hidden from students
  memory_limit_mb integer DEFAULT 128,
  time_limit_ms   integer DEFAULT 3000
)

test_cases (
  id               uuid PK,
  exercise_id      uuid REFERENCES exercises(id) ON DELETE CASCADE,
  input            text,
  expected_output  text,
  is_sample        boolean DEFAULT false,   -- shown to students
  weight           integer DEFAULT 1
)
```

### Learning / Assessment

```
enrollments (
  id            uuid PK,
  user_id       uuid REFERENCES users(id),
  course_id     uuid REFERENCES courses(id),
  enrolled_at   timestamptz DEFAULT now(),
  progress_pct  numeric(5,2) DEFAULT 0,
  UNIQUE (user_id, course_id)
)

lesson_progress (
  user_id      uuid REFERENCES users(id),
  lesson_id    uuid REFERENCES lessons(id),
  status       text DEFAULT 'in_progress', -- in_progress|completed
  completed_at timestamptz,
  PRIMARY KEY (user_id, lesson_id)
)

submissions (
  id           uuid PK,
  user_id      uuid REFERENCES users(id),
  exercise_id  uuid REFERENCES exercises(id),
  source_code  text NOT NULL,
  language     text NOT NULL,
  verdict      text NOT NULL,   -- ac|wa|tle|mle|ce|re|pending
  runtime_ms   integer,
  memory_kb    integer,
  created_at   timestamptz DEFAULT now()
)

submission_test_results (
  submission_id  uuid REFERENCES submissions(id) ON DELETE CASCADE,
  test_case_id   uuid REFERENCES test_cases(id),
  passed         boolean,
  actual_output  text,
  PRIMARY KEY (submission_id, test_case_id)
)
```

Verdict codes follow competitive-programming conventions:
`ac` accepted · `wa` wrong answer · `tle` time-limit exceeded ·
`mle` memory-limit exceeded · `ce` compile error · `re` runtime error.

### Billing

```
orders (
  id               uuid PK,
  user_id          uuid REFERENCES users(id),
  course_id        uuid REFERENCES courses(id),
  amount_cents     integer NOT NULL,
  currency         char(3) NOT NULL,
  provider         text NOT NULL,   -- vnpay|momo|stripe
  status           text NOT NULL,   -- pending|paid|refunded|failed
  external_txn_id  text,
  created_at       timestamptz DEFAULT now(),
  paid_at          timestamptz
)

entitlements (
  id           uuid PK,
  user_id      uuid REFERENCES users(id),
  course_id    uuid REFERENCES courses(id),
  source       text NOT NULL,    -- purchase|free|granted
  granted_at   timestamptz DEFAULT now(),
  expires_at   timestamptz,
  UNIQUE (user_id, course_id)
)

invoices (
  id        uuid PK,
  order_id  uuid UNIQUE REFERENCES orders(id),
  pdf_url   text NOT NULL
)
```

### Knowledge Graph v1 (relational)

```
knowledge_nodes (
  id      uuid PK,
  slug    text UNIQUE,
  title   text NOT NULL,
  domain  text NOT NULL   -- e.g. 'c_programming','algorithms','web_backend'
)

knowledge_edges (
  from_id   uuid REFERENCES knowledge_nodes(id),
  to_id     uuid REFERENCES knowledge_nodes(id),
  weight    numeric(4,3) DEFAULT 1.000,
  relation  text NOT NULL,   -- 'prereq' | 'related'
  PRIMARY KEY (from_id, to_id, relation)
)

user_mastery (
  user_id       uuid REFERENCES users(id),
  node_id       uuid REFERENCES knowledge_nodes(id),
  score         numeric(4,3) NOT NULL,  -- 0.000..1.000
  confidence    numeric(4,3) NOT NULL,
  last_updated  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, node_id)
)
```

Graph queries use recursive CTEs, e.g. to compute prereqs:

```sql
WITH RECURSIVE chain AS (
  SELECT from_id, to_id, 1 AS depth
    FROM knowledge_edges WHERE to_id = $1 AND relation = 'prereq'
  UNION
  SELECT e.from_id, c.to_id, c.depth + 1
    FROM knowledge_edges e JOIN chain c ON e.to_id = c.from_id
   WHERE e.relation = 'prereq' AND c.depth < 10
)
SELECT DISTINCT from_id FROM chain;
```

## MongoDB — collections

```
db.ai_chats
{
  _id, user_id, session_id,
  context: { lesson_id?, exercise_id? },
  messages: [{ role, content, ts, tokens? }],
  model: { provider: 'ollama'|'gemini', name },
  started_at, last_ts
}

db.code_snapshots
{
  _id, user_id, exercise_id, session_id,
  captured_at, source_code,
  trigger: 'autosave'|'submit'|'idle'
}

db.learning_events
{
  _id, user_id, occurred_at,
  event: 'lesson_open'|'lesson_scroll'|'tab_blur'|'copy'|...,
  props: { lesson_id?, duration_ms?, ... }
}
```

Indexes:

- `ai_chats`: `{ user_id: 1, last_ts: -1 }`.
- `code_snapshots`: `{ user_id: 1, exercise_id: 1, captured_at: 1 }`,
  TTL 90 days.
- `learning_events`: `{ user_id: 1, occurred_at: -1 }`, TTL 180 days.

## Redis — namespaces

| Key pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `session:<jti>` | hash | 15 min | Decoded JWT cache (opt-in, read-through) |
| `jwt:blacklist:<jti>` | string | until exp | Revocation list |
| `ratelimit:api:<ip>` | counter | 60 s | Global API rate limit |
| `ratelimit:ai:<user_id>` | token bucket | 60 s | 10 req/min/user |
| `queue:sandbox:*` | BullMQ | — | Submission jobs |
| `queue:ai:*` | BullMQ | — | AI generation jobs |
| `recommend:<user_id>` | json | 24 h | Nightly recommender output |

## Migrations & seeds

- All Postgres migrations live in `apps/api-core/prisma/migrations/`
  and run via `prisma migrate deploy` on container start.
- MongoDB has no migration tool; index changes are applied idempotently
  at service boot by `api-core`'s `MongoBootstrapModule`.
- Seed data for local dev lives in `scripts/seed.ts` and covers: one
  teacher, one student, one free course with three lessons (one
  markdown, one C++ exercise, one quiz).
