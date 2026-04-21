"""
data-science — FastAPI service that rebuilds a user's mastery scores
from their submission history using Bayesian Knowledge Tracing (BKT).

Called by api-core as a fire-and-forget POST after every AC submission:

    POST /v1/mastery/rebuild/{user_id}

The service reads Postgres directly (same database api-core uses) for two
reasons:

  1. Latency — avoiding a round trip through api-core lets us process a
     user's history in one transaction.
  2. Analytical workloads belong in the service that hosts them; api-core
     has no business ferrying rows it doesn't care about.

Eventually (P7) this service will also read MongoDB for chat-based
struggle signals and compute nightly Collaborative Filtering. v1 keeps
the footprint small: just Postgres, just BKT.

BKT parameters (static for v1; learned per-node in a future pass):
    P(L0) = 0.10  — prior probability of knowing the skill
    P(T)  = 0.20  — transition rate from not-known to known per practice
    P(S)  = 0.10  — slip: correct answer when not knowing
    P(G)  = 0.20  — guess: correct answer despite not knowing

Update rule for each observation o ∈ {0, 1}:
    P(L | o=1) = P(L) · (1 - P(S))  / [P(L) · (1 - P(S)) + (1 - P(L)) · P(G)]
    P(L | o=0) = P(L) · P(S)        / [P(L) · P(S)       + (1 - P(L)) · (1 - P(G))]
    P(L_next)  = P(L | o) + (1 - P(L | o)) · P(T)
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import asyncpg
from fastapi import FastAPI, HTTPException

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("data-science")

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Static BKT parameters. Tuning per-node (from data) is P7's job.
P_L0 = 0.10
P_T = 0.20
P_S = 0.10
P_G = 0.20


# --- lifecycle ---------------------------------------------------------------

_pool: asyncpg.Pool | None = None


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global _pool
    if not DATABASE_URL:
        log.warning("DATABASE_URL not set — mastery rebuild will 503")
    else:
        # asyncpg expects plain postgres:// URL without the ?schema= query
        # that Prisma appends.
        clean_url = DATABASE_URL.split("?")[0]
        _pool = await asyncpg.create_pool(clean_url, min_size=1, max_size=4)
        log.info("connected to postgres")
    try:
        yield
    finally:
        if _pool is not None:
            await _pool.close()


app = FastAPI(title="lms data-science", version="0.1.0", lifespan=lifespan)


# --- endpoints ---------------------------------------------------------------

@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"status": "ok", "service": "data-science", "db_ready": _pool is not None}


@app.post("/v1/mastery/rebuild/{user_id}")
async def rebuild_mastery(user_id: str) -> dict[str, Any]:
    """Recompute user_mastery rows for one user from their full submission
    history. Idempotent — safe to call on every AC submission."""
    if _pool is None:
        raise HTTPException(503, detail={"code": "db_unavailable"})

    async with _pool.acquire() as conn:
        # 1) Pull every *observation* — both AC/WA code submissions and
        #    passed/failed quiz attempts — joined with the knowledge nodes
        #    attached to each lesson. One row per (observation, node) pair;
        #    an observation on a lesson tagged with 2 nodes produces 2 rows
        #    and updates both node scores.
        #
        #    Code submissions are the strong signal (coding proves mastery);
        #    quiz attempts (P9.0) are weaker but cover non-code lessons.
        #    BKT treats both as a binary passed/failed observation — the
        #    update equation is the same either way.
        rows = await conn.fetch(
            """
            SELECT created_at, node_id, passed
              FROM (
                SELECT s.created_at              AS created_at,
                       kn.id                     AS node_id,
                       (s.verdict = 'ac')        AS passed
                  FROM submissions s
                  JOIN exercises e              ON e.id = s.exercise_id
                  JOIN lessons l                ON l.id = e.lesson_id
                  JOIN lesson_knowledge_nodes l_kn ON l_kn.lesson_id = l.id
                  JOIN knowledge_nodes kn       ON kn.id = l_kn.node_id
                 WHERE s.user_id = $1

                UNION ALL

                SELECT qa.attempted_at           AS created_at,
                       kn.id                     AS node_id,
                       qa.passed                 AS passed
                  FROM quiz_attempts qa
                  JOIN lessons l                ON l.id = qa.lesson_id
                  JOIN lesson_knowledge_nodes l_kn ON l_kn.lesson_id = l.id
                  JOIN knowledge_nodes kn       ON kn.id = l_kn.node_id
                 WHERE qa.user_id = $1
              ) AS observations
             ORDER BY created_at ASC
            """,
            user_id,
        )

        if not rows:
            return {"user_id": user_id, "updated_nodes": 0, "reason": "no_tagged_observations"}

        # 2) Group observations by node and run BKT forward.
        per_node: dict[str, list[bool]] = {}
        for r in rows:
            per_node.setdefault(r["node_id"], []).append(bool(r["passed"]))

        updated_nodes = []
        for node_id, observations in per_node.items():
            score, confidence = _bkt_forward(observations)
            await conn.execute(
                """
                INSERT INTO user_mastery (user_id, node_id, score, confidence, attempts, last_updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (user_id, node_id) DO UPDATE SET
                    score = EXCLUDED.score,
                    confidence = EXCLUDED.confidence,
                    attempts = EXCLUDED.attempts,
                    last_updated_at = EXCLUDED.last_updated_at
                """,
                user_id,
                node_id,
                round(score, 3),
                round(confidence, 3),
                len(observations),
            )
            updated_nodes.append(
                {"node_id": str(node_id), "score": round(score, 3), "attempts": len(observations)}
            )

    log.info("rebuilt user=%s nodes=%d", user_id, len(updated_nodes))
    return {"user_id": user_id, "updated_nodes": len(updated_nodes), "nodes": updated_nodes}


# --- BKT -------------------------------------------------------------------

def _bkt_forward(observations: list[bool]) -> tuple[float, float]:
    """Run the BKT update forward over a sequence of passed/failed attempts.
    Returns (mastery_score, confidence) both in [0, 1].

    Confidence is a simple heuristic: asymptotically approaches 1 as the
    number of attempts grows (n/(n+k) with k=5). It's not a real posterior
    variance — if we ever need one, switch to a full Beta distribution.
    """
    p_l = P_L0
    for passed in observations:
        if passed:
            numerator = p_l * (1 - P_S)
            denom = numerator + (1 - p_l) * P_G
        else:
            numerator = p_l * P_S
            denom = numerator + (1 - p_l) * (1 - P_G)
        p_l_given = numerator / denom if denom > 0 else p_l
        p_l = p_l_given + (1 - p_l_given) * P_T
        # Clamp to guard against numerical drift.
        p_l = max(0.0, min(1.0, p_l))

    n = len(observations)
    confidence = n / (n + 5)
    return p_l, confidence
