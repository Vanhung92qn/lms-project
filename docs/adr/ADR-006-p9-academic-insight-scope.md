# ADR-006 — P9 Scope: AI Insight & Demo-Ready for Duy Tân Academic Board

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Product owner, Tech Lead (AI agent)
- **Relates to:** ADR-001 (stack), ADR-003 (graph-over-neo4j),
  `/root/.claude/plans/b-n-l-m-t-tech-pure-pelican.md` (original plan §9),
  `docs/roadmap.md`

## Context

The MVP (P0–P8) is launch-ready: auth, CMS, workspace, AI Tutor,
Knowledge Graph v1, wallet, admin, hardening. Pilot runs on a single
16 GB VPS and passes the launch checklist.

The next audience is **not** end-users — it is the **Duy Tân University
Academic Board**, a graduation/academic review committee. That changes
what matters:

- They will evaluate the system against academic literature (Intelligent
  Tutoring Systems, Learning Analytics, Adaptive Learning).
- They will ask *"what's novel here vs Moodle or Coursera?"* — the
  answer has to be defensible, not marketing.
- Revenue dashboards, gamification, and wallet flows are largely
  irrelevant to this audience. Pedagogical depth is what they scrutinise.
- The current system already has the infrastructure to showcase
  insight (BKT, KG, MongoDB telemetry, ai_chats), but surfaces almost
  none of it in UI. We are under-selling the bespoke data plane.

Two additional issues surfaced during review:

1. **BKT blind spot for non-code lessons.** The mastery engine only
   updates when a submission is graded. Markdown/theory lessons yield
   no signal, so those concepts stay at score 0 — BKT looks broken.
2. **Sitemap redundancy.** `/vi/courses` is reachable from both
   `Duyệt lộ trình` and `Học tập`. Confusing and wastes nav real estate.

## Decision

Commit to a 4-week **Phase 9 — AI Insight & Demo-Ready**, split into
four sub-phases. Each sub-phase lands as its own feature branch and PR
against `main`, following the existing trunk-based workflow.

### P9.0 — Foundations (week 1)

Unblock the AI and seed enough data to make it visible.

- **Sitemap separation:** `Duyệt lộ trình` → public catalog (all
  published courses); `Học tập` → `/me/enrollments` (courses the
  student has enrolled in). Distinct nav items, distinct routes.
- **Non-code lesson completion via auto-generated quiz.** On a
  markdown lesson, the student sees a "Hoàn thành" action that opens
  a short (3–5 question) formative quiz. Quiz is generated once from
  the lesson content via DeepSeek and cached per-lesson. Quiz results
  (per-question correct/incorrect) map to the lesson's knowledge tags
  and fire a BKT rebuild. This replaces a naive "mark complete"
  button with a pedagogically defensible formative assessment.
- **`seed-massive.ts`:** 20 diverse courses, 500 virtual students
  with varied skill profiles, 50k submissions with realistic pass
  distributions. Makes Collaborative Filtering, Heatmap, and
  Dropout Alert all meaningful at demo time — solves cold-start.

### P9.1 — Teacher Insight Layer (week 2)

Surface the data plane to instructors.

- **Classroom Heatmap:** students (rows) × concepts (cols) grid,
  red-to-green cells based on `user_mastery.score`. Sort by concept
  weakness across the class — instantly tells a teacher what to
  re-teach. Renders in Studio per-course.
- **AI Tutor Insights:** mined from `ai_chats` (MongoDB) — the top
  questions students asked the tutor in a window, clustered by
  concept. Exposes real confusion patterns the teacher couldn't see
  before.
- **Concept Coverage Gap:** for each course, diff the
  concepts-taught set against the full Knowledge Graph. Suggest
  missing lessons ("Course X covers 12/15 prereq nodes — missing:
  `pointers`, `recursion`, `memory-management`").

### P9.2 — Student Insight Layer (week 3)

Make the student's own progress legible and motivating.

- **Skill Radar Chart:** 6–8 axis spider chart of the student's
  mastery across top-level skill categories. Rendered on profile
  and dashboard.
- **Interactive Knowledge Graph visualisation:** D3-based graph,
  nodes coloured by status (mastered / learning / locked). Click a
  locked node to see its prerequisites — makes the KG tangible and
  explains *why* certain recommendations come up.
- **Explainable recommendations:** every item in the recommendations
  widget carries a one-line "why" — e.g. *"Suggested because you've
  mastered `variables` (0.85) and `functions` (0.80), prerequisites
  for `pointers`."* Raw score → human-readable evidence.
- **Learning Velocity:** comparison to cohort median — *"You learned
  recursion 2× faster than the class average."* Motivation hook.

### P9.3 — Predictive & Intervention (week 4)

Move from descriptive to predictive analytics.

- **Predictive Dropout Alert:** a lightweight model
  (features: inactivity duration, WA-streak length, AI-chat
  frustration markers, session-gap trend) outputs a dropout
  probability. Surfaces on teacher/admin dashboards as a sorted
  watchlist. Target recall ≥70% on the seeded cohort; we explicitly
  do *not* need production-grade precision — this is a teaching
  demonstrator.
- **Struggle Moments Timeline:** per-student view of "aha" points
  (first AC on a hard exercise) vs "stuck zones" (≥5 consecutive WA
  on one exercise, or ≥10 min with no progress). Drawn from
  `submissions` + `code_snapshots`.
- **Teacher Intervention Suggestions:** AI-generated one-line
  actions per at-risk student ("Give student X a remedial exercise
  on topic Y"). Generated from mastery deltas.
- **Mastery Decay model:** BKT currently only moves up. Add a gentle
  decay (e.g. half-life 45 days) so untouched concepts slide down
  and re-enter recommendations — spaced-repetition signal.
- **AI Code Review on AC submissions:** after a correct submission,
  a second pass through DeepSeek explains the solution's
  time/space complexity and suggests an idiomatic variant. Gated to
  the paid (DeepSeek) tier, respecting existing daily caps.

### Academic positioning (5 pillars)

The demo narrative leans on five pillars, each with a citable
academic foundation — so the board sees this as a research-aware
build, not just a coding project:

1. **Adaptive Learning via Bayesian Knowledge Tracing** — Corbett &
   Anderson (1995). Already shipped in P5b; P9 surfaces it visually.
2. **Explainable AI Recommendations** — the XAI literature around
   making recommender systems interpretable to end-users.
3. **Learning Analytics Dashboard** — SoLAR community norms
   (Heatmap + Radar + cohort comparison).
4. **AI-assisted Formative Assessment** — VanLehn (2011) on
   effectiveness of intelligent tutoring; auto-gen quiz + code
   review are the concrete instantiations.
5. **Early Warning System** — educational data mining literature on
   at-risk learner detection.

The differentiator vs Moodle/Coursera stated plainly:
**per-user Knowledge Graph + explainable AI recommendations + local
LLM for privacy.** The first two are specific claims the board can
probe; the third is a defensible engineering choice given the VPS
constraints.

## Consequences

### Positive

- Every P9 feature reuses existing infrastructure — no new
  containers, no new data stores, no new languages. RAM budget
  stays within the 16 GB envelope.
- Academic positioning is defensible under questioning: each pillar
  has citable grounding and concrete UI artifacts.
- Auto-gen quiz closes the largest BKT blind spot (non-code
  lessons) more rigorously than a "mark complete" button would.
- Seed-massive unblocks every downstream analytics feature.
  Without it, Heatmap is monochrome and Dropout Alert has no
  signal.

### Negative

- 4 weeks of solo-dev effort on top of a system that is already
  launch-ready. Opportunity cost: no P10-style work on payment
  automation, GDPR endpoints, or multi-teacher features.
- Auto-gen quiz and AI Code Review both consume DeepSeek budget.
  The per-lesson quiz is generated once and cached, so the cost
  is bounded; AI Code Review is rate-limited by the existing
  200/day/user cap and only runs on AC (not every submission).
- Dropout prediction is a model — it will sometimes be wrong.
  UI copy has to phrase it as "risk signal", not "will drop out".

### Deferred / explicitly out of P9 scope

- Full gamification (badges, leaderboards beyond the existing
  `Xếp hạng` nav placeholder) — separate discussion, not
  academically load-bearing.
- Public learning portfolio (`/u/<handle>`) — nice to have, no
  direct pillar mapping.
- Adaptive exercise difficulty — interesting but doubles the
  content-authoring burden on the teacher; revisit post-pilot.
- GDPR export/delete endpoints — tracked separately as a P10
  compliance item (already flagged in `security-checklist.md`).

## Alternatives considered

- **Ship P9.0 + P9.1 only (2 weeks).** Safer if the demo date
  moves up. Rejected for now because the user has a 4-week runway;
  P9.2–9.3 are the parts that most differentiate from Moodle.
- **Add adaptive difficulty instead of Mastery Decay.** Decay is
  cheaper (one config + one cron job) and gives spaced-repetition
  for free; adaptive difficulty would need per-exercise variants
  authored by the teacher, multiplying content effort.
- **Neo4j for the Knowledge Graph viz.** Rejected: the existing
  Postgres `knowledge_nodes` / `knowledge_edges` tables fit under
  1k rows, D3 renders directly from JSON — no new datastore
  justified. Reaffirms ADR-003.
- **Build a custom BKT model from scratch.** Rejected — P5b's
  simple Bayesian update is literature-grounded and already
  shipping. Improving it is P10 territory, not P9.

## How we know P9 is done

A demo that follows the 5-pillar narrative end-to-end, showing:

1. A teacher opens Studio, sees the Classroom Heatmap, picks a
   red concept, and reads the top AI Tutor question on it.
2. A student lands on their dashboard and sees their Skill Radar,
   an explained recommendation, and Learning Velocity.
3. A student clicks a locked KG node and sees what to learn first.
4. A student finishes a markdown lesson by taking the auto-gen
   quiz; BKT mastery visibly updates.
5. Admin opens the dropout watchlist and sees ≥1 seeded at-risk
   student with an intervention suggestion; verdict-AC submissions
   show an AI code-review panel.

All five flows run against seeded (not live) data and complete
without new containers, new datastores, or RAM budget breach.
