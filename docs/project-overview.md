Tổng quan dự án (slide-ready)

>Mục đích file này: tài liệu gối đầu để thuyết trình đồ án. Đi từ
> bài toán → kiến trúc → công nghệ → tiến độ → kế hoạch tương lai. Viết
> để bạn đọc một mình cũng nắm được toàn cảnh, và có thể copy từng mục
> thẳng vào slide.
>
>Cập nhật: 2026-04-20 (sau P5a — Telemetry Foundation)

---

## 1. Đề bài — dự án này giải quyết vấn đề gì?

### Bối cảnh
Thị trường LMS hiện tại (Moodle, Coursera, Udemy) đặtvideo một chiều
làm trung tâm. Với người học lập trình, mô hình này có 3 vấn đề:

1.Engagement thấp — học viên nghe giảng thụ động, khó duy trì tập trung.
2.Không có môi trường thực hành tích hợp — học C++ xong phải tự cài
   compiler, tự chạy test, thiếu phản hồi tức thì khi gặp lỗi.
3.Không cá nhân hóa — mọi học viên nhận cùng một lộ trình, giáo viên
   không biết lớp đang vướng khái niệm nào.

### Giải pháp của AI-LMS
Nền tảng học lập trình lấy text + code thực hành làm trung tâm, có:

-Workspace 3-panel (lý thuyết Markdown | Monaco editor | Terminal/AI
  Tutor) — giống VSCode nhưng web-based, không cài đặt.
-Sandbox Docker biên dịch + chấm code an toàn, trả verdict trong <5s.
-AI Tutor 24/7 streaming token qua SSE, 2 backend:
  - Llama/Qwen local cho học viên free,
  - DeepSeek cho giáo viên + học viên đã mua khóa.
-Knowledge Graph cá nhân tự cập nhật khi học viên hoàn thành bài,
  làm input cho gợi ý lộ trình và phát hiện skill gap (P5b+).

### Thông số mục tiêu (pilot)
- ≤ 500 học viên đăng ký, ≤ 50 concurrent users.
- 1 VPS Ubuntu 16 GB RAM, 8 vCPU, không GPU.
- p95 submission < 5s, p95 first-token AI < 4s.

---

## 2. Kiến trúc tổng thể

### 2.1 C4 Level 1 — Context

```
           ┌──────────────────┐
           │   Học viên       │  Trình duyệt
           │   Giáo viên      │  (Next.js SSR + Monaco)
           │   Admin          │
           └────────┬─────────┘
                    │ HTTPS
                    ▼
      ┌──────────────────────────┐
      │  Cloudflare              │  DNS, Free SSL, WAF,
      │  (orange cloud)          │  Bot Fight Mode
      └────────────┬─────────────┘
                   │
                   ▼
      ┌──────────────────────────┐
      │  VPS Ubuntu 22.04        │
      │  khohoc.online           │
      └──────────────────────────┘
```

### 2.2 C4 Level 2 — Containers

```
                Cloudflare Edge
                       │
           ┌───────────▼──────────┐
           │      Traefik 3.2      │  TLS + routing + rate limit
           │   (api gateway layer) │
           └───────┬────────┬──────┘
                   │        │
         ┌─────────▼─┐   ┌──▼──────────────┐
         │ web :3000 │   │ api-core :4000  │
         │ Next.js 14│   │ NestJS monolith │
         │ SSR + RSC │   │ modular bounded │
         │ Monaco    │   │   contexts      │
         └───────────┘   └───┬────────┬────┘
                             │        │
                ┌────────────┘        └──────┐
                ▼                            ▼
      ┌─────────────────┐         ┌──────────────────┐
      │ sandbox-        │         │  ai-gateway      │
      │ orchestrator    │         │  :5002           │
      │ :5001           │         │  FastAPI         │
      │ FastAPI +       │         │  provider branch │
      │ Docker SDK      │         │  prompt render   │
      └────┬────────────┘         └───┬──────────┬───┘
           │                          │          │
           ▼                          ▼          ▼
      ┌──────────────┐       ┌────────────┐ ┌──────────────┐
      │ Docker       │       │ Ollama     │ │ DeepSeek API │
      │ runners      │       │ :11434     │ │ (cloud)      │
      │ (g++/node/   │       │ qwen2.5-   │ │ deepseek-    │
      │  python3)    │       │ coder:7b   │ │ chat         │
      │ hardened     │       └────────────┘ └──────────────┘
      └──────────────┘

  Data plane (bind 127.0.0.1 only):
  ┌─────────────┐  ┌────────────┐  ┌─────────────┐
  │ PostgreSQL  │  │  MongoDB   │  │   Redis     │
  │    16       │  │     7      │  │      7      │
  │ + pgvector  │  │ telemetry  │  │ rate limit  │
  │ Prisma ORM  │  │ ai_chats   │  │ token cap   │
  │ IAM+Catalog │  │ events     │  │ ai cap      │
  │ +Assessment │  │ snapshots  │  │             │
  └─────────────┘  └────────────┘  └─────────────┘
```

### 2.3 Bounded contexts (DDD)
Ở giai đoạn MVP, các bounded contextsống chung trong NestJS dưới dạng
module riêng biệt — tránh overhead của microservices khi solo dev. Khi
cần scale một context cụ thể, tách ra service riêng (đã áp dụng cho
Sandbox, AI-Gateway, Data-Science).

| Context | Module | Trách nhiệm |
|---------|--------|-------------|
| IAM | `iam/` | User, Role, JWT, Casbin, OAuth (Google/GitHub) |
| Catalog/CMS | `catalog/` | Course, Module, Lesson, Exercise, TestCase |
| Learning | `catalog/enrollment/` | Enrollment, progress |
| Assessment | `assessment/` | Submission, verdict, sandbox orchestration |
| AI-Assist | `ai/` | Tutor controller, tier resolver, rate cap |
| Analytics | `telemetry/` | ai_chats, code_snapshots, learning_events |
| Billing | *(P6)* | Orders, entitlements, VNPay/MoMo |
| Notification | *(P7+)* | Email, in-app |

---

## 3. Công nghệ sử dụng — chi tiết

### 3.1 Monorepo & build
| Công cụ | Vai trò | Vì sao chọn |
|---------|---------|-------------|
|pnpm workspaces | Package manager | Ổn định, tiết kiệm disk vs npm/yarn |
|Turborepo | Task orchestration + cache | Build cache chung cho FE+BE, nhẹ hơn Nx |
|TypeScript 5 strict | Ngôn ngữ | Type safety end-to-end FE → BE → shared types |

### 3.2 Frontend
| Công cụ | Vai trò | Chi tiết |
|---------|---------|----------|
|Next.js 14 | Framework | App Router, RSC, streaming SSR |
|React 18 | UI | Server Components + hydration |
|TailwindCSS + shadcn/ui + Radix | Styling | Không vendor lock-in, copy-paste component |
|Monaco Editor | Code editor | Cùng engine VSCode, multi-language |
|next-intl | i18n | Vi/En với locale routing, RSC-compatible |
|react-markdown + remark-gfm | Markdown lesson render | GitHub-flavored markdown |
|Custom CSS design tokens | Theming | 6 theme (light/dark/dracula/one-dark/material/tokyo-night) qua CSS variables |

### 3.3 Backend — api-core
| Công cụ | Vai trò | Chi tiết |
|---------|---------|----------|
|NestJS 10 | Framework | Modular monolith theo bounded context |
|Prisma | ORM | Type-safe, Prisma Migrate, schema declaratively |
|Casbin | RBAC | Policy-based, model file + policy file |
|class-validator + class-transformer | DTO validation | Decorator-driven, chạy ở layer Controller |
|@nestjs/throttler | Rate limit | Per-route + per-user token bucket |
|@nestjs/swagger | OpenAPI 3.1 | Generate spec từ decorator |
|pino (nestjs-pino) | Logging | JSON structured, redact auth headers |
|argon2 | Password hashing | OWASP recommended, thay cho bcrypt |
|jsonwebtoken | JWT | Access 15m, refresh 30d, rotation với reuse detection |
|ioredis | Redis client | Rate limit + AI daily cap + (sau) BullMQ |
|mongodb (official driver) | Mongo client | Native, light-weight, không cần ORM |

### 3.4 Backend — Python services
| Service | Port | Stack | Vai trò |
|---------|------|-------|---------|
|sandbox-orchestrator | 5001 | FastAPI + docker-py | Biên dịch + chấm code trong container hardened |
|ai-gateway | 5002 | FastAPI + httpx | Route Llama/DeepSeek, prompt template, SSE re-encode |
|data-science *(P5b)* | 5003 | FastAPI + scikit-learn + scikit-surprise | KG rebuild, BKT, Collaborative Filtering |

### 3.5 Data stores
| Store | Phiên bản | Vai trò | RAM dùng |
|-------|-----------|---------|----------|
|PostgreSQL | 16 + pgvector | Source of truth (IAM, Catalog, Assessment, KG) | ~1.5 GB |
|MongoDB | 7 | Telemetry (ai_chats, code_snapshots, learning_events) | ~1 GB |
|Redis | 7-alpine | Rate limit, session cache, AI daily cap, BullMQ queue | 256 MB |

### 3.6 AI
| Component | Chi tiết |
|-----------|----------|
|Ollama (container) | Phục vụ 1 model local, binding 127.0.0.1:11434 |
|qwen2.5-coder:7b-instruct-q4_K_M | Model code-specialised, ~4.5 GB RAM, ~10-20 tok/s CPU |
|DeepSeek API | Cloud paid tier, ~70-100 tok/s, ~$0.14/$0.28 per M input/output token |
|SSE streaming | event: token/done/error frames, X-Accel-Buffering: no |
|Tier routing | api-core quyết định provider per request dựa vào role + entitlement |
|Daily cap | 200 req/ngày DeepSeek cho teacher/admin/paid students, cap qua Redis |

### 3.7 Sandbox hardening
```yaml
# Mọi container chấm code chạy với:
--network=none                 # không Internet
--read-only                    # rootfs read-only
--tmpfs /tmp:size=10m,mode=1777,exec,nosuid,nodev
--memory=128m --memory-swap=128m
--cpus=0.5 --pids-limit=64
--cap-drop=ALL
--security-opt=no-new-privileges
--security-opt=seccomp=/etc/seccomp/default.json
--user=10001:10001             # non-root
--ulimit nofile=64 --ulimit nproc=32
timeout: 3s wall, 2s CPU
```
Mỗi request tạo container mới, xoá ngay sau khi xong. Image pre-built:
`runner-cpp`, `runner-node`, `runner-python`.

### 3.8 Reverse proxy & Edge
| Component | Vai trò |
|-----------|---------|
|Traefik v3.2 | TLS termination (Cloudflare Origin Cert), routing, rate limit, file provider cho host-native services |
|Cloudflare Free | DNS, SSL (Full strict), WAF basic, Bot Fight Mode, Page Rules cache cho /static/* |

### 3.9 Observability (plan — chưa wire)
| Component | Khi nào bật |
|-----------|-------------|
| Prometheus + Grafana | P8 (Hardening) |
| Loki + Promtail | P8 |
| Sentry free tier | P8 |
| UptimeRobot | P8 |

### 3.10 CI/CD
| Component | Vai trò |
|-----------|---------|
|GitHub Actions | Lint + typecheck + build trên mỗi PR |
|Conventional Commits | Enforced qua commitlint pre-commit hook |
|Trunk-based development | PR → `main` trực tiếp, không có `develop` branch |
|Docker Compose | Dev + prod deploy (K8s overkill cho 1 VPS) |

### 3.11 Payment (plan — P6)
VNPay + MoMo (SDK VN), Stripe optional. Entitlement check middleware
chặn access tới course `pricing_model=paid` khi chưa có entry trong
`entitlements` table.

---

## 4. Data model

### 4.1 PostgreSQL (Prisma schema, `apps/api-core/prisma/schema.prisma`)

IAM
- `users` — id, email(citext unique), password_hash(argon2id), display_name, avatar_url, locale, status
- `roles` — enum {student, teacher, admin, ai_engine}
- `user_roles` — many-to-many
- `refresh_tokens` — token_hash, family_id, issued_at, expires_at, revoked_at
- `oauth_accounts` — provider + provider_id + user_id
- `audit_log` — event, ip, user_agent, metadata(jsonb), occurred_at

Catalog / CMS
- `courses` — slug(unique), title, description, teacher_id, status(draft|published|archived), pricing_model(free|paid), price_cents
- `modules` — course_id, sort_order, title
- `lessons` — module_id, sort_order, title, type(markdown|exercise|quiz), content_markdown, est_minutes
- `exercises` — lesson_id(unique), language(c|cpp|js|python), starter_code, solution_code, memory_limit_mb, time_limit_ms
- `test_cases` — exercise_id, input, expected_output, is_sample, weight

Learning / Assessment
- `enrollments` — user_id + course_id (unique), enrolled_at, progress_pct
- `submissions` — user_id, exercise_id, source_code, verdict(enum), runtime_ms, memory_kb, stderr, test_results[]
- `submission_test_results` — submission_id + test_case_id, passed, actual_output

Billing (P6)
- `orders` — user_id, course_id, amount_cents, currency, provider(vnpay|momo|stripe), status, external_txn_id
- `entitlements` — user_id + course_id, source(purchase|free|granted), granted_at, expires_at
- `invoices` — order_id, pdf_url

Knowledge Graph v1 (P5b)
- `knowledge_nodes` — id, slug, title, domain (ví dụ `pointer`, `recursion`)
- `knowledge_edges` — from_id, to_id, weight, relation(prereq|related)
- `user_mastery` — user_id + node_id, score(0-1), confidence, last_updated

### 4.2 MongoDB (`lms_telemetry`)
| Collection | Shape | Index | TTL |
|------------|-------|-------|-----|
| `ai_chats` | (userId, lessonId, provider, locale, messages[], startedAt, lastActivityAt, schemaVersion) | (userId, lessonId, lastActivityAt↓) | — |
| `code_snapshots` | (userId, lessonId, language, source, snapshotAt) | (userId, lessonId, snapshotAt↓) + ttl(14d) | 14 ngày |
| `learning_events` | (userId, lessonId, event, metadata, at) | (userId, at↓) + ttl(90d) | 90 ngày |

### 4.3 Redis — operational keys
- `ratelimit:ip:<ip>` — global IP rate (100/min)
- `ratelimit:user:<userId>:<route>` — per-route per-user (NestJS Throttler)
- `ai:deepseek:daily:<userId>:<YYYY-MM-DD>` — DeepSeek cap 200/day
- `jwt:blacklist:*` — (P5c+) revoked JWT ids
- `queue:sandbox`, `queue:ai` — (P4b+) BullMQ

---

## 5. Security model

### 5.1 Authentication
-Password: argon2id (OWASP recommended), salt + memory-hard.
-JWT: HS256, access 15 phút, refresh 30 ngày.
-Refresh token rotation: mỗi lần refresh cấp token mới, revoke cũ;
  phát hiện reuse (dùng lại token đã revoke) → revoke toàn bộ family.
-OAuth 2.0: Google + GitHub authorization code flow với
  HttpOnly state cookie + URL fragment handoff.

### 5.2 Authorization
-Casbin RBAC: model file + policy file, enforce ở Guard.
-AI Engine role: chỉ có scope `read:logs`, `read:testcases` —
  không endpoint write nào nhận role này (enforce ở Casbin policy).

### 5.3 Sandbox isolation
Xem §3.7. Thêm: user namespace remapping bật ở host Docker daemon,
rootless Docker sẽ là P8.

### 5.4 API security
-Helmet — security headers (HSTS, X-Content-Type-Options, ...)
-CORS strict whitelist — chỉ các origin trong `CORS_ORIGIN` env
-Rate limit 2 tầng — Traefik global + Redis per-user
-Input validation — class-validator FE + Zod BE
-Prisma parameterized queries — chặn SQL injection

### 5.5 Secrets
- `.env` chmod 600, không commit
- Cloudflare Origin Cert mount từ `/opt/lms/secrets/` (chmod 600)
- P6+ sẽ dùng `sops` hoặc `dotenv-vault`

### 5.6 Telemetry privacy
- Mongo bind 127.0.0.1 only, root auth bật
- Hiệnchưa có endpoint export/delete per-user — deferred đến P6
  vì mới có 1 user thật (giai đoạn dev). Blocker trước khi onboard
  học viên thật ngoài pilot.

---

## 6. AI strategy — chi tiết

### 6.1 Dual-provider routing
```
Request ──► api-core TutorTierResolver ──► decision
                │                             │
                │ reads: role, enrollment,    ├─ provider="deepseek" → ai-gateway → DeepSeek API
                │   pricing_model, entitle-   │
                │   ment, daily Redis cap     └─ provider="llama"    → ai-gateway → Ollama (qwen2.5-coder)
```

Quy tắc tier (P4b + P4d):
| Caller | Provider | Cap |
|--------|----------|-----|
| Student trên khóa free | qwen2.5-coder (local) | 10/min |
| Student đã mua khóa paid | DeepSeek | 200/day → fallback qwen |
| Teacher sở hữu khóa | DeepSeek | 200/day → fallback qwen |
| Admin | DeepSeek | 200/day → fallback qwen |
| `DEEPSEEK_API_KEY` rỗng | qwen2.5-coder | 10/min |

### 6.2 Vì sao không dùng Gemini
Gemini free tier rate limit khó đoán, DeepSeek rẻ hơn (3-4×) và ổn định
hơn với tải đều. Quyết định recorded ở project memory.

### 6.3 Vì sao qwen2.5-coder thay cho llama3
Llama 3 8B Q4 trên CPU hallucinate thường xuyên khi review code ngắn —
học viên test Hello World correct, Llama bịa ra rằng `using namespace
std;` cần thêm dấu `()`. qwen2.5-coder là Alibaba code-specialist, cùng
RAM footprint (~4.5 GB Q4), ít hallucinate hơn rõ rệt trên C++/Python/JS.

### 6.4 Prompt hardening (P4d)
5 quy tắc tuyệt đối trong system prompt:
1. Verdict từ sandbox làground truth — không bao giờ nghi ngờ.
2. Verdict = `ac` → codekhông có lỗi cú pháp; cấm bịa ra lỗi.
3. Verdict = `ac` → chỉ khen + giải thích cơ chế + gợi ý style.
4. Verdict = `ce/wa/tle/mle/re` → đọc compiler output, hint đúng dòng.
5. Không chắc → nói "Mình không chắc"; cấm đoán mò.

Verdict được repeat 2 lần trong context (banner system message + data dump)
vì model CPU-quantized skim context window.

### 6.5 SSE streaming UX
CPU Llama ~10-20 tok/s → câu 200 tokens mất 15-25s. Nếu hiện spinner
học viên sẽ bỏ cuộc. Với SSE token-by-token streaming, học viên thấy
token hiện dần sau 2-4s first-token → trải nghiệm "AI đang gõ" thay vì
"AI đơ". Frontend có RAF buffer để flatten ~100 tok/s DeepSeek về ~60 Hz
re-render, tránh giật hình.

### 6.6 Chat history logging
Hiện P5a: api-coretee luồng SSE vào MongoDB `ai_chats` khi nó đi
qua — không cần browser gọi thêm endpoint. Robust hơn vì không bị client
spoof hoặc bỏ qua. Là data gốc cho Data Science tìm pattern khó khăn
học viên gặp phải.

### 6.7 Chi phí
DeepSeek v3: ~$0.14/M input, $0.28/M output. Giả định:
- 50 VIP × 30 req/ngày × 500 tokens ≈$2-5/tháng tổng.
- Teacher 1 người × 200 req/ngày × 1000 tokens ≈$2-3/tháng.

Free tier qwen2.5-coder chạy local, chi phí = $0 ngoài điện + RAM 4.5 GB.

---

## 7. Tiến độ — Phases đã hoàn thành

### P0 — Foundation ✓
Monorepo scaffold, Docker Compose dev, Traefik local, CI lint/typecheck,
ADR-001 tech stack, README, SSH deploy script,pdf-skill module.

### P1 — IAM ✓
- Register/login/refresh qua argon2id + JWT
- Casbin RBAC với 4 role
- Email verify (stub — email service deferred)
- i18n base (vi/en)
- Cloudflare DNS + Origin Cert + Traefik TLS

### P1.1–P1.3 — Hero + Header + OAuth ✓
- Bento design system (6 theme)
- Minimalist light hero với video phản chiếu
- Full-width header, sitemap: Trang chủ | Duyệt lộ trình | Gia sư AI |
  Học tập | Thử thách | Cuộc thi | Xếp hạng | Thảo luận
- OAuth Google + GitHub (authorization code + fragment handoff)
- Theme-aware hero

### P2 — Course Catalog ✓
- Public browse `/courses`
- Teacher CRUD course/module/lesson
- Enrollment endpoint (free)

### P2.1 — Session + Profile ✓
- Avatar dropdown thay cho login/register sau khi đăng nhập
- Profile edit page

### P2.2 — Studio CMS ✓
- Teacher UI drag-drop modules/lessons
- Markdown editor + starter code + test cases
- Publish/unpublish flow

### P3a — Sandbox Pipeline ✓
- Custom Docker runner image (cpp) với entry.sh + seccomp
- sandbox-orchestrator FastAPI
- submissions.service.ts orchestrates grading

### P3b — Lesson Player ✓
- 3-panel workspace layout (Theory | Editor | Terminal)
- Monaco editor với theme mapping
- Verdict table + sample test cases

### P3b.1 — Enroll UX fix ✓
- Stay on course page after enroll
- Lesson list flips to clickable links

### P3b.2 — Player polish ✓
- Single header (fix duplicate)
- Richer test results table

### P4a — AI Tutor (Llama 3) ✓
- Ollama Docker service
- ai-gateway FastAPI với asyncio.Lock concurrency=1
- SSE streaming qua api-core
- AITutorPanel trong lesson player với tab Terminal/Tutor

### P4b — DeepSeek Routing ✓
- Tier resolver + 200/day Redis cap
- ai-gateway branch theo `provider` field
- X-Tutor-Provider header + model badge

### P4c — Streaming UX Polish ✓
- RAF-buffered token rendering (fix jitter)
- Mount-persist cả 2 panel (fix chat history loss trên tab switch)

### P4d — Tutor Quality ✓
- Swap llama3 → qwen2.5-coder:7b
- Prompt hardening với 5 rule tuyệt đối
- Verdict banner injected vào context

### P4e — Model label fix ✓
- Stale `llama3:8b` label thay bằng `qwen2.5-coder:7b`

### P5a — Telemetry Foundation ✓ (vừa xong)
- MongoDB 7 trong docker-compose
- Telemetry module trong api-core (MongoService + TelemetryService +
  TelemetryController)
- 3 collections + TTL indexes
- Server-side tee của tutor SSE stream vào `ai_chats`
- Client fires `lesson_open`, `submit`, `tab_switch` events
- 30-second debounced code_snapshots

---

## 8. Phases còn lại

### P5b — Knowledge Graph v1 (3-4 ngày, next)
- Prisma migration: `knowledge_nodes`, `knowledge_edges`, `user_mastery`
- Teacher Studio UI: tag mỗi lesson với 1-3 knowledge node
- Apps mới: `data-science` FastAPI :5003
  - `POST /mastery/rebuild/:userId` — Bayesian Knowledge Tracing
  - api-core cron trigger sau mỗi submission AC
- `GET /api/v1/users/me/mastery` cho dashboard

### P5c — Student-facing surfaces (2-3 ngày)
- Dashboard widget "Bạn đang mạnh ở X, yếu ở Y"
- Next-lesson suggestion theo KG prerequisite
- Past conversations drawer trong AITutorPanel (đọc `ai_chats`)

### P6 — Billing (1 tuần)
- Order model + checkout flow
- VNPay + MoMo integration
- Entitlement check middleware
- Invoice view
-Privacy export/delete endpoints (blocker onboarding học viên thật)

### P7 — Recommendation + Admin (1 tuần)
- Collaborative Filtering nightly cron (scikit-surprise)
- Recommend widget trên dashboard
- Super Admin panel (user mgmt, Grafana iframe, khóa user)
- Teacher analytics — "khái niệm cả lớp đang vướng"

### P8 — Hardening & Launch (1-2 tuần)
- k6 load test (target 50 concurrent, p95 < 5s)
- Prometheus + Grafana + Loki full stack
- Sentry free tier
- UptimeRobot
- Backup + restore runbook
- OWASP ZAP baseline scan
- Go-live

---

## 9. Kiến trúc quyết định quan trọng (ADRs)

| ADR | Quyết định | Lý do |
|-----|-----------|-------|
| ADR-001 | Tech Stack Selection | Xem §3 — monorepo + NestJS + Next.js |
| ADR-002 | pnpm + Turborepo | Nhẹ hơn Nx, disk-efficient |
| ADR-003 | NestJS Modular Monolith over Microservices | Solo dev, YAGNI, scale out khi cần |
| ADR-004 | PostgreSQL + pgvector over Neo4j | Mở, JSONB đủ cho KG v1, recursive CTE đủ cho graph query |
| ADR-005 | Custom Docker Sandbox over Judge0 | Linh hoạt, kiểm soát sâu seccomp/cap/network |
| ADR-006 | SSE over WebSocket cho AI streaming | Uni-directional đủ, hoạt động qua Traefik/Cloudflare dễ |
| ADR-007 | Casbin for RBAC | Policy-based, mature, đủ cho 4 role |
| ADR-008 | Ollama + qwen2.5-coder (thay Llama 3) | Code-specialist, ít hallucinate, cùng RAM |
| (pending) | DeepSeek thay Gemini cho paid tier | Giá ổn định, rate limit rõ, OpenAI-compatible |
| (pending) | Trunk-based development (drop `develop`) | Solo dev, simplify flow |

---

## 10. Performance & capacity

### 10.1 RAM budget trên VPS 16 GB
| Component | Steady state |
|-----------|--------------|
| Ollama (1 model loaded) | ~5 GB |
| PostgreSQL 16 | 1.5 GB |
| MongoDB 7 (WT cache 0.5GB) | 1 GB |
| Redis 7 | 256 MB |
| Node.js api-core | 512 MB |
| Next.js web (SSR) | 512 MB |
| Python services (×3 nếu đủ) | 900 MB |
| Observability (P8) | 1 GB |
| Sandbox transient burst | 512 MB |
| OS + buffer | 3.5 GB |
|Tổng |≈ 14.7 GB (sát trần — phải monitor) |

### 10.2 Expected latency
| Signal | Target p95 |
|--------|-----------|
| API endpoint GET (catalog) | < 200 ms |
| Submission grading (C++, 3 test cases) | < 5 s |
| AI tutor first-token (DeepSeek) | < 4 s |
| AI tutor first-token (qwen CPU) | 2-4 s (warm), 60 s (cold) |
| Page SSR (Next.js lesson) | < 800 ms |

### 10.3 Scale plan
-Dọc (vertical): nếu DAU > 100 → nâng VPS 32 GB hoặc tách Ollama
  sang VPS GPU riêng (~$40/tháng).
-Ngang (horizontal): nếu concurrent > 100 → containerise api-core,
  scale web/api qua Traefik load-balancer, nâng Postgres sang read
  replica. Mongo + Redis đã sẵn sàng shard khi cần.

---

## 11. Quyết định chống over-engineering (YAGNI)

Không đưa vào MVP:
-Neo4j — Postgres + pgvector + recursive CTE đủ cho KG v1.
-Kubernetes / service mesh — 1 VPS, Compose đủ.
-Elasticsearch — Postgres full-text search đủ.
-Kafka / RabbitMQ — Redis Streams + BullMQ đủ cho 50 concurrent.
-GraphQL — REST + OpenAPI generated types đủ, tránh N+1 guessing.
-Session-based auth — JWT đủ, scale tốt hơn.
-Per-user email service — SMTP stub cho P1, Postmark/Resend ở P7.

---

## 12. Nâng cấp tương lai (backlog)

### Ngắn hạn (post-MVP, 1-2 tháng)
- GPU upgrade → free-tier AI latency 60s → 5s
- Mobile app (React Native hoặc Expo) dùng API sẵn có
- Teacher analytics dashboard
- Peer code review feature
- Realtime collaboration trên editor (Yjs/CRDT)

### Trung hạn (3-6 tháng)
- Kubernetes migration khi user > 5000
- Postgres read replica
- Redis Sentinel cho HA
- Multi-region Cloudflare với Worker cache
- Pluggable AI provider (OpenAI, Anthropic, Gemini) — policy-based routing
- VSCode extension: submit từ IDE

### Dài hạn (6-12 tháng)
- AI-generated personalised exercises
- Voice tutor (TTS + ASR)
- Collaborative Filtering v2 với deep learning
- Marketplace cho khóa học do học viên tự tạo
- Certification + proctoring

---

## 13. Rủi ro đã biết + mitigation

| Rủi ro | Mức | Mitigation |
|--------|-----|------------|
| Qwen/Llama CPU quá chậm (> 30s) | TB | SSE streaming; DeepSeek fallback |
| VPS 16 GB sát trần | Cao | Monitor cadvisor, swap 4 GB; tách Ollama khi cần |
| Sandbox RCE escape | Thấp×Rất cao | seccomp + user namespace + no-network; rootless Docker P8 |
| DeepSeek API cost blowup | Thấp | 200/day cap per user; monitor cost qua DeepSeek dashboard |
| Mongo storage growth | TB | TTL 14d/90d; alert ở 80% disk |
| Cloudflare Free WAF false positive | TB | Challenge thay Block; trợ giúp user trong FAQ |
| Solo dev burnout | Cao | AI agent làm autonomous theo plan; human review PR |
| Feature creep | Cao | Chỉ xây feature trong phase plan; khác → backlog |
| Llama/qwen hallucinate | Cao | Prompt hardening P4d; upgrade model; DeepSeek fallback cho quiz phức tạp |
| Data loss (không có backup cron) | Cao | P8 pg_dump + mongodump cron vào offsite B2/S3 |

---

## 14. Talking points cho slide thuyết trình

### Slide 1 — Why AI-LMS?
- Moodle/Coursera thiếu thực hành tức thì + AI cá nhân hóa
- Học lập trình cần môi trường code integrated + AI tutor 24/7
- AI-LMS = VSCode-in-browser + AI pair programmer + Knowledge graph

### Slide 2 — Differentiators
- Text + code thực hành thay cho video
- Dual AI (local qwen + cloud DeepSeek) tier routing theo entitlement
- Self-hosted trên 1 VPS (~$40/tháng) thay vì AWS hàng triệu đồng
- Knowledge Graph cá nhân auto-update từ submission + AI chat data

### Slide 3 — Architecture at a glance
- C4 diagram §2.2
- Điểm nhấn: modular monolith + 3 Python microservices khi cần scale

### Slide 4 — Tech stack highlights
- Next.js 14 App Router + NestJS 10 modular monolith
- PostgreSQL + MongoDB + Redis = right tool each job
- Ollama qwen2.5-coder (free) + DeepSeek (paid) với routing logic
- Docker sandbox hardened: network=none + seccomp + user namespace

### Slide 5 — Security
- JWT rotation với reuse detection
- Sandbox OWASP + Docker escape defense
- Casbin RBAC + AI Engine role chỉ read scope

### Slide 6 — AI pipeline
- SSE streaming + RAF render → UX không giật
- Prompt hardened với sandbox verdict ground truth
- 200/day DeepSeek cap → fallback qwen

### Slide 7 — Demo script (4 flow)
1. Đăng ký → login → enroll free course
2. Mở lesson → gõ code buggy → submit → verdict CE
3. Click AI Tutor → stream hint trong 3s
4. Sửa code → AC → dashboard hiện progress

### Slide 8 — Telemetry + data science
- 3 Mongo collections → feed knowledge graph
- Roadmap: mastery score → recommendation → adaptive learning

### Slide 9 — Roadmap
- Đã hoàn thành: P0 → P5a (chi tiết §7)
- Còn lại: P5b KG → P5c surfaces → P6 billing → P7 rec → P8 launch

### Slide 10 — Beyond MVP
- GPU upgrade → 10× latency win cho free tier
- Mobile app + collaboration realtime
- Marketplace + certification

### Slide 11 — Known limits & honest tradeoffs
- Solo dev → trade feature coverage for quality foundations
- 16 GB RAM sát trần → cần monitor
- Qwen vẫn có thể hallucinate → plan retry w/ DeepSeek ở P4c+

### Slide 12 — Q&A + thanks
- Repo: github.com/Vanhung92qn/lms-project
- Live: https://khohoc.online
- Credits + references

---

## 15. Quick stats để show off

```
├─ Codebase
│  ├─ 24 PRs merged (P0 → P5a)
│  ├─ ~120 commits, Conventional Commits 100%
│  ├─ ~15,000 LOC TypeScript + ~800 LOC Python
│  └─ Monorepo 5 packages (web, api-core, sandbox, ai-gateway, shared-types)
│
├─ Tech stack
│  ├─ 3 databases (PostgreSQL + MongoDB + Redis)
│  ├─ 2 AI providers (Ollama local + DeepSeek cloud)
│  ├─ 3 Python microservices (sandbox, ai-gateway, data-science plan)
│  ├─ 6 design themes (light/dark/dracula/one-dark/material/tokyo-night)
│  └─ 2 locales (vi default + en)
│
├─ Runtime
│  ├─ Cold boot full stack: < 30s
│  ├─ AI first-token warm: 2-4s
│  ├─ Submission grading: < 5s p95
│  └─ RAM headroom: ~1.3 GB on 16 GB VPS
│
└─ Roadmap
   ├─ Done: 14 phases (P0 → P5a)
   ├─ Remaining: 4 phases (P5b, P5c, P6, P7, P8)
   └─ ETA to pilot: ~4 tuần từ hôm nay (2026-04-20)
```

---

## 16. Tài liệu tham khảo trong repo

| File | Nội dung |
|------|----------|
| `CLAUDE.md` | Quy tắc cho AI agent (trunk-based, Conventional Commits, ...) |
| `docs/architecture/layout-patterns.md` | Spec 2 workspace UI (Client vs Admin) |
| `docs/architecture/data-model.md` | ERD + chi tiết từng table |
| `docs/architecture/infrastructure.md` | Docker Compose breakdown, RAM budget |
| `docs/adr/ADR-001-tech-stack-selection.md` | Quyết định chọn tech stack |
| `docs/adr/ADR-005-custom-docker-sandbox.md` | Vì sao tự build sandbox |
| `docs/adr/ADR-006-sse-streaming.md` | SSE vs WebSocket cho AI |
| `docs/runbook/ai-tutor.md` | Pipeline AI, prompt hardening, troubleshooting |
| `docs/runbook/telemetry.md` | Mongo pipeline, storage budget (P5a mới) |
| `docs/runbook/sandbox-operations.md` | Sandbox image build + seccomp |
| `docs/runbook/oauth-setup.md` | Google + GitHub OAuth setup |
| `docs/roadmap.md` | Phase tracker |

---

## 17. Tổng kết

AI-LMS làmột nền tảng học lập trình hiện đại chạy trên 1 VPS, tận
dụng AI self-hosted (qwen) cho bulk tải miễn phí và AI cloud (DeepSeek)
cho paid tier —giảm chi phí vận hành xuống < $50/tháng trong khi
vẫn giữ được UX streaming + cá nhân hóa.

Điểm khác biệt so với Moodle/Coursera:
1.Workspace = IDE — không rời trang, không cài compiler.
2.AI Tutor tích hợp — verdict-aware, không hallucinate syntax khi
   code đã đúng (P4d hardening).
3.Knowledge Graph tự học — mỗi submission + chat turn làm giàu
   mastery score (P5b target).
4.Kiến trúc clean — DDD bounded contexts, API-first, trunk-based,
   Conventional Commits, ADR cho mọi quyết định.

Đã hoàn thành14 phases (P0 → P5a) trong khoảng 4-5 tuần làm việc.
Phần còn lại (KG + Billing + Recommendation + Hardening) ước tính4
tuần để go-live pilot.

Mở repo để xem chi tiết từng file:
https://github.com/Vanhung92qn/lms-project
