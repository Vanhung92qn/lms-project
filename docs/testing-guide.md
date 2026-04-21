# Hướng dẫn test AI-LMS trên web

> **Dành cho:** thuyết trình đồ án + pilot test.
> **URL:** https://khohoc.online
> **Cập nhật:** 2026-04-21 (sau khi merge P5b + P5c).
>
> File này hướng dẫn bạn **chạy tay từng flow** trên trình duyệt để
> kiểm chứng toàn bộ tính năng đã ship. Đi từ "cold start" (xoá sạch
> session, mở trình duyệt) → hoàn thành 1 bài học → thấy mastery và
> gợi ý bài kế. Đọc một lần là nắm toàn bộ hệ thống để demo.

---

## 0. Chuẩn bị

### 0.1 Tài khoản mẫu (đã seed sẵn)
| Role | Email | Password |
|------|-------|----------|
| **Admin** | `admin@khohoc.online` | `Admin@12345` |
| **Teacher** | `teacher@khohoc.online` | `Teacher@12345` |
| **Student** | `student@khohoc.online` | `Student@12345` |

### 0.2 Trình duyệt
- Khuyên dùng **Chrome / Edge** (đã test 147).
- Mở **DevTools → Network** (F12) nếu muốn xem request cho bài thuyết trình.
- **Hard refresh** (Ctrl/Cmd + Shift + R) nếu thấy giao diện cũ — browser cache chunk cũ.

### 0.3 Mẹo khi demo
- Có sẵn 2 tab: tab Teacher và tab Student → chuyển qua lại không phải
  login đi lại.
- Nếu AI Tutor "im lặng" lâu → lần đầu sau 24h idle Ollama phải reload
  model (~60s). Chạy warm-up trước buổi thuyết trình bằng cách bấm
  thử 1 câu hỏi AI tutor 2 phút trước giờ demo.

---

## 1. Flow auth + locale

### 1.1 Landing + đăng ký
1. Mở https://khohoc.online → thấy hero "Simple learning for your coding
   journey" (theme mặc định light).
2. Click biểu tượng **Settings** (góc phải) → chuyển theme, chuyển ngôn
   ngữ Vi ↔ En — UI cập nhật lập tức không reload.
3. Click **Đăng ký** → form email + display name + password.
4. Điền `demo+today@khohoc.online` / tên bất kỳ / password ≥10 ký tự
   có chữ hoa và số → **Đăng ký**.
5. Bị redirect về `/vi/dashboard` — đã login tự động (access + refresh
   token lưu vào `sessionStorage`).

### 1.2 Đăng nhập OAuth (tuỳ)
1. Đăng xuất, quay về `/vi/login`.
2. Click **Tiếp tục với Google** (hoặc GitHub) → authorize → redirect
   về dashboard với avatar Google/GitHub.
3. Nếu thấy "oauth_not_configured" → env `GOOGLE_OAUTH_CLIENT_ID` rỗng
   trên VPS, setup ở `docs/runbook/oauth-setup.md`.

### 1.3 Avatar dropdown
1. Ở góc phải header, click avatar → menu: **Profile / Dashboard /
   Instructor studio / Sign out**.
2. Vào **Profile** → sửa display name + avatar URL + locale → **Lưu
   thay đổi** → thấy thông báo "Đã lưu".

---

## 2. Flow Student — từ đầu đến hết bài

### 2.1 Duyệt catalog
1. Ở dashboard, click **Duyệt catalog** → danh sách khoá học published.
2. Click card **"C++ từ căn bản đến nâng cao"**.
3. Thấy 3 phần: hero banner, Curriculum (modules + lessons), CTA
   **Đăng ký học ngay**.

### 2.2 Enroll
1. Click **Đăng ký học ngay** → **ở lại trang** (KHÔNG bounce sang
   dashboard — đây là fix của P3b.1), CTA đổi thành **✓ Đã đăng ký**
   + **Bắt đầu học →**.
2. Lesson list bên dưới đổi từ disabled text sang clickable links.

### 2.3 Mở lesson "Hello, world!"
1. Click lesson **Hello, world!** trong curriculum → vào Workspace
   Player.
2. Layout 3 panel:
   - **Trái**: theory Markdown (h1, code blocks, blockquote…)
   - **Phải trên**: Monaco editor với starter code, badge tên file
     `main.cpp`, nút **Reset to starter** + **Submit ⌘↵**.
   - **Phải dưới**: Tabbed panel, tab **Terminal** và tab **AI Tutor**.
3. Chỉ có **1 thanh header** trên cùng (fix của P3b.2 — trước đó bị
   nhân đôi).

### 2.4 Submit code sai → CE verdict
Paste (hoặc gõ) code sai để test compile error:
```cpp
#include <iostream>
using namespace std;
int main() {
    cout << "Hello, world!"
}
```
1. Bấm **Submit** (hoặc Ctrl/Cmd + Enter).
2. Sau ~2s, tab Terminal hiện badge đỏ **CE — Compile Error** + output:
   `main.cpp: error: expected ';'`.
3. Tab **AI Tutor** xuất hiện chấm đỏ nhỏ (nudge — verdict ≠ AC).

### 2.5 Hỏi AI Tutor bằng tab chuyển qua lại
1. Click tab **AI Tutor**. Thấy panel trống với gợi ý + nút **"Hỏi AI
   vì sao kết quả là CE"**.
2. Click nút đó → token streaming xuất hiện sau 2–4s (badge
   `qwen2.5-coder:7b` ở header panel).
3. **Test P4c (fix streaming + history):** gõ code đang stream → chuyển
   tab Terminal → chờ 5s → chuyển lại AI Tutor → **lịch sử chat còn
   nguyên**, stream vẫn chạy dưới background.
4. **Test P4d (prompt hardened):** fix lại code (thêm `;`) → submit →
   verdict AC → hỏi AI "đọc code của em và chấm" → AI **không bịa lỗi
   về `using namespace std;`** (đây là bug cũ đã fix).

### 2.6 Sửa code → AC
Paste code đúng:
```cpp
#include <iostream>
using namespace std;
int main() {
    cout << "Hello, world!";
}
```
1. Bấm **Submit**.
2. Sau ~1-2s, terminal hiện badge xanh **AC — Accepted**, bảng
   `1/1 passed · 15 ms · AC`.
3. **Mới từ P5c:** phía trên bảng kết quả có **banner xanh**:
   - "✓ Chúc mừng! Bài chấm đã đạt"
   - "Bài học tiếp theo: [tên bài kế]"
   - Nút **Học tiếp →**
4. Click **Học tiếp →** → chuyển sang lesson kế.

### 2.7 Dashboard mastery widget (điểm mới P5c)
1. Quay về `/vi/dashboard` (click logo hoặc avatar → Dashboard).
2. Scroll xuống dưới danh sách khoá học đã đăng ký.
3. Thấy section **"Tiến độ kỹ năng"** với 2 cột:
   - **Bạn đang mạnh ở**: top-3 node với thanh progress xanh
   - **Cần luyện thêm**: bottom-3 với thanh amber (chỉ hiện khi có > 3
     node đã chạm)
4. Mỗi row: tên concept + thanh progress + % mastery.
5. **Nếu chưa submit bài nào**: widget không hiển thị (tránh empty
   state rỗng trơ).

---

## 3. Flow Teacher — tag knowledge + edit curriculum

### 3.1 Đăng nhập teacher
1. Logout student, login `teacher@khohoc.online` / `Teacher@12345`.
2. Click avatar → **Instructor studio** → `/vi/studio`.
3. Thấy bảng khoá học của mình: **C++ từ căn bản đến nâng cao** (1
   module, 2 lessons).

### 3.2 Tạo course mới
1. Click **+ New course**.
2. Form: Title, Slug, Description, Locale, Pricing (free/paid).
3. Điền và **Create course** → vào trang edit (draft).
4. **Add module** → gõ tên → thêm.
5. **Add lesson** trong module:
   - Title: "Biến trong C++"
   - Type: `exercise`
   - Est minutes: 10
   - Content (Markdown), starter code, solution code, test cases.

### 3.3 Tag knowledge node (mới P5c)
1. Ở trang edit course `cpp-from-zero`, dưới mỗi lesson có nút
   **"Gắn khái niệm"** (góc phải của row).
2. Click nút → panel expand inline với:
   - Heading: "Khái niệm bài học (0/3)".
   - Chips grouped by domain: **cpp / algo / ds**.
3. Click chip `io-basics` → tô màu accent (selected).
4. Click `variables-types` → selected luôn.
5. Click chip thứ 4 bất kỳ → không cho chọn (cap 3).
6. Click **Lưu** → hiện **✓ Đã lưu**.
7. Quay về `/vi/studio` → vào edit lại → chips vẫn còn selected (đã
   persist vào DB).

### 3.4 Publish course
1. Trong trang edit, nút **Publish** → status đổi draft → published.
2. Khoá xuất hiện ở `/vi/courses`.

---

## 4. Flow AI Tutor — test 2 tier

### 4.1 Free tier = qwen local
1. Login student, mở lesson trong khoá **free** (`cpp-from-zero`).
2. Mở tab AI Tutor → hỏi "Con trỏ trong C++ là gì?".
3. Header panel: `AI Tutor · qwen2.5-coder:7b` (KHÔNG có badge `premium`).
4. Stream 10–20 tok/s, hiện sau 2–4s first-token.
5. Response header `X-Tutor-Provider: llama` (mở DevTools Network để
   verify).

### 4.2 Paid tier = DeepSeek (teacher trên khoá của mình)
1. Login teacher.
2. Tạo khoá paid mới (Pricing = paid, Price = 50000 VND, publish).
3. Mở lesson trong khoá đó.
4. Hỏi AI Tutor "So sánh mảng và vector".
5. Header panel: `AI Tutor · deepseek-chat` + **badge "premium"** màu
   accent.
6. Stream 70–100 tok/s (nhanh gấp 3–5× so với qwen).
7. Response header `X-Tutor-Provider: deepseek`.
8. **Test daily cap:** gọi liên tục 200 lần/ngày → request 201 sẽ tự
   downgrade sang qwen (silent, badge đổi về llama3/qwen). Cap dùng
   Redis, reset 00:00 UTC.

### 4.3 Test hardened prompt (verdict-aware)
1. Login student, mở Hello World lesson.
2. Paste code đúng (AC được), submit → verdict AC.
3. Tab AI Tutor → gõ "Đọc code của em và chấm nó".
4. **Kết quả đúng:** AI khen + giải thích `cout` + có thể thêm gợi ý
   `\n`. **KHÔNG** bịa lỗi "using namespace std; thiếu dấu ()".
5. Submit code sai (thiếu `;`), verdict CE → hỏi AI → AI chỉ đúng
   dòng thiếu dấu chấm phẩy.

---

## 5. Flow Knowledge Graph — gated next-lesson

### 5.1 Cần setup trước
Login teacher, đảm bảo khoá `cpp-from-zero` có 2 lesson:
- "Hello, world!" → tag `io-basics`, `variables-types`
- "3.Test Demo" (hoặc lesson thứ 3) → tag `loops`, `arrays`

### 5.2 Flow non-gated
1. Login student **mới** (tạo account mới để mastery = 0).
2. Vào Hello World → submit AC → banner **Next: 3.Test Demo**.
3. Click **Học tiếp** → bình thường.

### 5.3 Flow gated (warn user yếu prereq)
1. Với student mới đó, **KHÔNG** submit các bài tagged với
   `control-flow` (prereq của `loops`).
2. Submit AC Hello World → banner hiện "Next: 3.Test Demo" + **⚠
   Bài kế có kiến thức phụ thuộc bạn chưa vững — nên ôn lại trước."
3. CTA vẫn hoạt động (không chặn), chỉ cảnh báo.

### 5.4 Inspect DB để verify
```bash
# Xem mastery của student
docker exec lms-postgres psql -U lms -d lms -c "
  SELECT kn.slug, um.score, um.attempts
    FROM user_mastery um
    JOIN knowledge_nodes kn ON kn.id = um.node_id
    JOIN users u ON u.id = um.user_id
   WHERE u.email = 'demo+today@khohoc.online'
   ORDER BY um.score DESC;
"
```

Bạn sẽ thấy:
```
 slug            | score | attempts
-----------------+-------+----------
 io-basics       | 0.659 |        5
 variables-types | 0.659 |        5
```

Mỗi lần submit AC → data-science rebuild BKT → score tăng.

---

## 6. Smoke test nhanh qua curl (cho bài thuyết trình)

Có thể chạy trực tiếp trên máy mạng bất kỳ:

```bash
# 1. Đăng nhập lấy token
ACC=$(curl -s -X POST https://khohoc.online/api/v1/auth/login \
   -H 'Content-Type: application/json' \
   -d '{"email":"student@khohoc.online","password":"Student@12345"}' \
   | jq -r .tokens.access_token)
echo "Token length: ${#ACC}"

# 2. Public catalog
curl -s https://khohoc.online/api/v1/courses | jq '.[].slug'

# 3. Knowledge graph vocabulary
curl -s https://khohoc.online/api/v1/knowledge/nodes?domain=cpp | jq '.[] | .slug'

# 4. My mastery
curl -s https://khohoc.online/api/v1/knowledge/me/mastery \
  -H "Authorization: Bearer $ACC" | jq

# 5. AI tutor stream (10 token đầu)
curl -sN -X POST https://khohoc.online/api/v1/ai/tutor/ask \
  -H "Authorization: Bearer $ACC" -H 'Content-Type: application/json' \
  -d '{"intent":"concept-explain","locale":"vi","question":"cout là gì?"}' \
  | head -c 500
```

---

## 7. Checklist "kiểm tra sống" 5 phút

Nếu chỉ có 5 phút trước khi demo, chạy 5 flow này theo đúng thứ tự:

- [ ] Login `student@khohoc.online` → dashboard hiện courses + mastery widget.
- [ ] Mở lesson Hello World → thấy 3 panel + 1 header.
- [ ] Submit code đúng → verdict AC + **banner xanh có next-lesson CTA**.
- [ ] Submit code sai → verdict CE + **AI Tutor dot đỏ nudge**.
- [ ] AI Tutor stream token không giật (RAF buffer) → chuyển tab rồi
      chuyển lại → lịch sử chat còn.

Nếu cả 5 pass → hệ thống ready cho demo.

---

## 8. Khi gặp sự cố

### Browser thấy giao diện cũ
→ **Ctrl/Cmd + Shift + R** (hard refresh). Next.js chunk có hash, nhưng
cache trình duyệt có thể giữ HTML cũ reference.

### AI Tutor im lặng > 60s
→ Cold-start Ollama reload model. Chạy `docker exec lms-ollama ollama
list` — nếu `qwen2.5-coder` chưa có thì pull lại. Log: `tail -f
/tmp/lms-logs/ai-gateway.log`.

### Submission pending mãi
→ sandbox-orchestrator down. Log: `tail -f /tmp/lms-logs/sandbox.log`.
Verify Docker: `curl -sf http://127.0.0.1:5001/healthz`.

### Mastery không update sau AC
→ data-science service không chạy. Kiểm tra:
```bash
curl -sf http://127.0.0.1:5003/healthz
tail -f /tmp/lms-logs/data-science.log
```
Khởi động lại (xem `docs/runbook/knowledge-graph.md`).

### Enroll báo "not_enrolled"
→ Session token hết hạn. Đăng xuất + đăng nhập lại để refresh.

### CI lint fail trước khi PR merge
→ Chạy local `pnpm lint` trước khi push. Lỗi phổ biến: import không
dùng đến.

---

## 9. Feature matrix (nhanh để thuyết trình)

| Flow | Phase | Trạng thái | Test ở mục |
|------|-------|------------|------------|
| Đăng ký + đăng nhập | P1 | ✅ | §1.1 |
| OAuth Google/GitHub | P1.1 | ✅ | §1.2 |
| Profile edit | P2.1 | ✅ | §1.3 |
| Catalog + enrollment | P2 | ✅ | §2.1-2 |
| Workspace 3-panel + Monaco | P3b | ✅ | §2.3 |
| Submit code → verdict | P3a | ✅ | §2.4, 2.6 |
| Sample + hidden test cases | P3b.2 | ✅ | §2.6 |
| AI Tutor qwen local | P4a+d | ✅ | §4.1 |
| AI Tutor DeepSeek paid | P4b | ✅ | §4.2 |
| Token streaming không giật | P4c | ✅ | §2.5 step 3 |
| Chat history giữ khi chuyển tab | P4c | ✅ | §2.5 step 3 |
| Prompt hardened (verdict-aware) | P4d | ✅ | §4.3 |
| Studio CMS: course/module/lesson | P2.2 | ✅ | §3.2 |
| Studio: tag knowledge | P5c | ✅ | §3.3 |
| Dashboard mastery widget | P5c | ✅ | §2.7 |
| Next-lesson suggestion (gated) | P5c | ✅ | §5.2-3 |
| Knowledge graph BKT mastery | P5b | ✅ | §5.4 |
| Telemetry ai_chats + snapshots | P5a | ⏳ đang PR, chưa merge | - |
| Billing VNPay/MoMo | P6 | ⏳ đang dev | - |
| Recommendation CF | P7 | ⏸ chưa bắt đầu | - |
| Observability full | P8 | ⏸ chưa bắt đầu | - |

---

## 10. Câu hỏi hay gặp khi demo

**Q: AI trả lời chậm thế?**
A: qwen local chạy CPU 8 vCPU, ~10-20 tok/s. Teacher + paid student
dùng DeepSeek nhanh 70-100 tok/s. GPU upgrade → 10× tốc độ, ~$40/tháng
(trên roadmap P8+).

**Q: Sandbox có an toàn không?**
A: `--network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges
--memory=128m --pids-limit=64 --user=10001 --timeout=3s`. Container
mới mỗi request, xoá ngay sau. Chưa ghi nhận escape.

**Q: Data học sinh có được bảo vệ?**
A: JWT RS256, password argon2id, refresh token rotation + reuse
detection. Mongo + Postgres + Redis đều bind 127.0.0.1 only. Privacy
export/delete endpoints ship ở P6 (đang dev).

**Q: Mô hình AI có bị bịa (hallucinate) không?**
A: Trước P4d có — Llama 3 8B bịa lỗi cú pháp. Đã fix bằng (1) đổi
sang qwen2.5-coder (code-specialist), (2) prompt hardened với sandbox
verdict làm ground truth, (3) cấm đoán mò bằng rule "không chắc thì
nói không chắc". Xem §4.3.

**Q: Scale lên 1000 user được không?**
A: 1 VPS hiện tại cover 500 users pilot. 1000+ cần GPU cho AI + tách
Ollama sang VPS riêng + Postgres read replica. Chi tiết roadmap ở
`docs/project-overview.md` §10.
