# Bounded Contexts (DDD)

In DDD terms, a **bounded context** is a linguistic and logical boundary
inside which a domain model and its ubiquitous language are consistent.
Cross-context communication goes through explicitly published contracts,
never by sharing internal models.

For the MVP, every bounded context below lives as a **NestJS module**
inside `apps/api-core/src/modules/`. This keeps the blast radius of
early refactors small while still enforcing the boundaries. When a
context later needs to become its own service, the contract is already
defined — the extraction is a packaging step, not a redesign.

## Context map

```
                  ┌─────────────────┐
                  │      IAM        │◄─── all contexts read identity
                  └─────────────────┘
                          ▲
                          │ authN + authZ
┌─────────────┐   ┌───────┴──────┐   ┌──────────────┐   ┌─────────────┐
│   Catalog   │◄─►│   Learning   │◄─►│  Assessment  │◄─►│   AI-Assist │
└─────────────┘   └──────────────┘   └──────────────┘   └─────────────┘
      ▲                 ▲                   ▲                 ▲
      │                 │                   │                 │
      └────────┬────────┴───────┬───────────┘                 │
               │                │                             │
         ┌─────┴──────┐    ┌────┴──────┐               ┌──────┴──────┐
         │    CMS     │    │  Billing  │               │  Analytics  │
         └────────────┘    └───────────┘               └─────────────┘
                                                              ▲
                                                              │
                                                      ┌───────┴──────┐
                                                      │ Notification │
                                                      └──────────────┘
```

## Context definitions

### IAM (Identity & Access Management)

- **Intent:** Authoritative answer to *who is this request* and *what may
  they do*.
- **Aggregates:** `User`, `Role`, `Session`, `RefreshToken`,
  `OAuthAccount`.
- **Commands:** `RegisterUser`, `AuthenticateUser`, `RotateRefreshToken`,
  `AssignRole`, `RevokeSession`.
- **Events published:** `UserRegistered`, `UserRoleChanged`, `UserLocked`.
- **Owns storage:** `users`, `roles`, `user_roles`, `refresh_tokens`,
  `oauth_accounts` (Postgres).
- **Cross-context rules:** Only IAM issues JWTs. Every other context
  treats the JWT's `sub` + `roles` claims as read-only truth.

### Catalog

- **Intent:** Shape the *discoverable* surface — what courses exist, what
  they cost, who teaches them.
- **Aggregates:** `Course`, `Module`, `Lesson` (metadata only — content
  lives in CMS).
- **Commands:** `PublishCourse`, `UnpublishCourse`, `ReorderModules`.
- **Events published:** `CoursePublished`, `CourseUnpublished`.
- **Owns storage:** `courses`, `modules`, `lessons` (structural rows
  only).

### CMS (Content Management)

- **Intent:** Author-side content lifecycle. Drafts, revisions, media
  uploads, Markdown rendering rules.
- **Aggregates:** `LessonDraft`, `MediaAsset`, `Exercise`, `TestCase`.
- **Commands:** `UpsertLessonDraft`, `AttachMedia`, `PromoteDraftToPublished`.
- **Events published:** `LessonContentChanged`, `ExerciseUpdated`.
- **Owns storage:** `lesson_content_versions`, `media_assets`,
  `exercises`, `test_cases`.
- **Invariant:** A lesson that is `type: exercise` must have ≥ 1
  `TestCase` with `is_sample = true` before it can be published.

### Learning (Enrollment & Progress)

- **Intent:** Track who is enrolled in what and how far they've got.
- **Aggregates:** `Enrollment`, `LessonProgress`.
- **Commands:** `EnrollStudent`, `UnenrollStudent`, `MarkLessonComplete`.
- **Events published:** `EnrollmentCreated`, `LessonCompleted`.
- **Owns storage:** `enrollments`, `lesson_progress`.
- **Guards:** Enrollment requires a valid `Entitlement` from Billing
  (free or paid — both are entitlements, see ADR-001).

### Assessment

- **Intent:** Judge student work. Submissions, verdicts, scoring.
- **Aggregates:** `Submission`, `SubmissionTestResult`.
- **Commands:** `SubmitSolution`, `RecordVerdict`.
- **Events published:** `SubmissionScored`, `SubmissionFailed`.
- **Owns storage:** `submissions`, `submission_test_results`.
- **Collaborators:** Calls `sandbox-orchestrator` for execution; emits
  `SubmissionScored` consumed by Learning (to update progress) and
  Analytics (to update mastery).

### AI-Assist

- **Intent:** All AI-mediated help: error explanations, code review,
  concept explanations, quiz generation.
- **Aggregates:** `ChatSession`, `GenerationJob`.
- **Commands:** `StartChatSession`, `StreamTutorReply`, `GenerateQuiz`.
- **Events published:** `AIReplyCompleted`, `AIRequestRateLimited`.
- **Owns storage:** `ai_chats`, `ai_generation_jobs` (MongoDB).
- **Guards:** Per-user rate limit (10/min) enforced via Redis token
  bucket; overflow routes to Gemini fallback.

### Analytics (Knowledge Graph)

- **Intent:** Long-running, batch-y "understand the learner" work.
- **Aggregates:** `KnowledgeNode`, `KnowledgeEdge`, `UserMastery`,
  `Recommendation`.
- **Commands:** `RebuildMastery`, `RecomputeRecommendations`.
- **Events consumed:** `LessonCompleted`, `SubmissionScored`,
  `AIReplyCompleted`.
- **Owns storage:** `knowledge_nodes`, `knowledge_edges`, `user_mastery`,
  `recommendations_cache` (Postgres + Redis).

### Billing

- **Intent:** Turning intent-to-pay into entitlements.
- **Aggregates:** `Order`, `Invoice`, `Entitlement`.
- **Commands:** `CreateOrder`, `ConfirmPayment`, `RefundOrder`,
  `GrantEntitlement`.
- **Events published:** `EntitlementGranted`, `EntitlementRevoked`.
- **Owns storage:** `orders`, `invoices`, `entitlements`.

### Notification

- **Intent:** Deliver messages to users (email, in-app, later: push).
- **Aggregates:** `NotificationTemplate`, `NotificationDelivery`.
- **Commands:** `SendNotification`, `RenderTemplate`.
- **Events consumed:** `UserRegistered`, `EnrollmentCreated`,
  `EntitlementGranted`, `SubmissionScored`.
- **Owns storage:** `notification_templates`, `notification_deliveries`.

## Anti-Corruption Layers (ACL)

- `ai-gateway` wraps both Ollama and Gemini. `api-core` asks for an
  intent (`fix-error`, `code-review`, `concept-explain`, `gen-quiz`);
  the gateway decides which backend serves it and what prompt to build.
- `billing` wraps VNPay and MoMo via a single `PaymentProvider`
  interface. Swapping a provider does not leak into `Order`.

## When to extract a context into its own service

Pull a module out of the monolith only when **one** of the following is
true and documented in an ADR:

1. It has a different scaling profile (e.g. `assessment` gets hammered
   at exam time — extracting lets us scale it without also scaling
   everything else).
2. It has a different deployment cadence for compliance reasons (e.g.
   `billing` has stricter change control).
3. It needs a non-TypeScript runtime (already true for sandbox / AI /
   data-science — those are separate services from day one).

Do not extract just for organizational reasons. Modules can be owned by
different people inside the same monolith.
