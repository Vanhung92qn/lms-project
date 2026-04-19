# ADR-003 — PostgreSQL Graph Tables over Neo4j for MVP Knowledge Graph

- **Status:** Accepted
- **Date:** 2026-04-19
- **Deciders:** Product owner, Tech Lead (AI agent)
- **Relates to:** ADR-001

## Context

The product needs a per-student Knowledge Graph (KG) that captures
mastery over concepts (`pointer`, `recursion`, `async-await`, …) and
the prerequisite/related edges between them. The graph drives
personalization: what to recommend next, what to revisit before
attempting a harder exercise.

Neo4j is the textbook answer. It brings Cypher, a dedicated graph
engine, and mature tooling. It also brings another process to
operate, another backup channel, another failure mode, and another
~700 MB of RSS we do not have in our 16 GB budget.

## Decision

For the MVP we model the Knowledge Graph as three Postgres tables:

```
knowledge_nodes (id, slug, title, domain)
knowledge_edges (from_id, to_id, weight, relation: prereq|related)
user_mastery    (user_id, node_id, score, confidence, last_updated)
```

All graph queries needed for MVP features are expressible as recursive
CTEs (example in `data-model.md §Knowledge Graph v1`). Typical query
shapes:

- Ancestors (all prerequisites of a target node) — bounded-depth CTE.
- Descendants (everything unlocked by mastering X) — mirror of above.
- Strong-connection cluster — `PageRank`-like weighting is unnecessary
  at MVP depth.

We will revisit with ADR-003b ("Adopt Neo4j for KG v2") if and when
**any** of the following is true:

1. Graph queries dominate query latency budget (e.g. p95 over 200 ms
   on a single recommendation call).
2. We need multi-hop query patterns that become unwieldy in CTE (e.g.
   shortest-path across weighted edges).
3. Graph size exceeds ~1M edges and Postgres can no longer keep the
   edge index hot.

## Consequences

### Positive

- One database to back up, monitor, and reason about.
- Atomic cross-table updates: mastery updates can participate in the
  same transaction as submission scoring, avoiding dual-write bugs.
- `pgvector` is already installed for future embeddings — vector +
  relational + graph in one engine is operationally cheap.
- No new binding / client library to maintain from Node or Python.
  Prisma and SQLAlchemy both speak plain SQL.

### Negative

- Recursive CTEs are harder to read than Cypher. We will be careful
  with query comments and will keep a small library of named graph
  queries in `apps/api-core/src/modules/analytics/queries/`.
- Bounded-depth CTE (`WHERE depth < 10`) is a blunt tool; if the
  graph grows deep we may hit the limit and silently under-return.
  We mitigate with test fixtures that exercise depth = max.
- If we later migrate to Neo4j, the migration is non-trivial —
  though the relational schema is already close to a graph model, so
  "migration" mostly means writing a sync job.

## Alternatives considered

- **Neo4j Community edition.** Rejected for MVP on operational and
  memory cost grounds.
- **DGraph / JanusGraph / ArangoDB.** Even more operationally heavy
  than Neo4j, with smaller ecosystems.
- **Hybrid (graph in Postgres, cache denormalized path in Redis).**
  Viable later; unnecessary complexity now.
