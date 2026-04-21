# Test accounts — https://khohoc.online

> **CẢNH BÁO:** những tài khoản dưới được seed cho pilot / demo. Đừng
> dùng email/mật khẩu này trong môi trường production thật.

## Accounts

| Role | Email | Password |
|------|-------|----------|
| **Admin** | `admin@khohoc.online` | `Admin@12345` |
| **Teacher** | `teacher@khohoc.online` | `Teacher@12345` |
| **Student** | `student@khohoc.online` | `Student@12345` |

Tạo lại bằng `pnpm --filter api-core exec prisma db seed` nếu DB reset.

## Phân quyền thực tế khi demo

### Admin
- Truy cập được tất cả (student + teacher features)
- Thêm các trang admin-only: `/studio/overview`, `/studio/users`,
  `/studio/topups`
- Có thể **khoá / mở khoá** user khác trong `/studio/users`
- AI Tutor: được DeepSeek tier (cap 200/ngày/user)

### Teacher
- Xem `/studio` (danh sách khoá mình sở hữu)
- Tạo / sửa / publish course + module + lesson
- Tag knowledge concepts cho lesson
- Xem `/studio/courses/:id/analytics` cho khoá mình
- Được DeepSeek tier cho khoá mình sở hữu

### Student
- Duyệt `/courses`
- Enroll free courses trực tiếp
- Paid courses: nạp ví ở `/wallet`, mua one-click
- AI Tutor trong lesson player (qwen local, hoặc DeepSeek nếu mua khoá paid)
- Xem mastery + recommendations trên `/dashboard`

## Tạo tài khoản test nhanh

```bash
# Đăng ký student mới qua API
curl -X POST https://khohoc.online/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test-student@example.com","password":"TestPass@123","display_name":"Test Student"}'
```

Admin muốn gán quyền teacher / admin cho một user:

```sql
-- Via docker exec lms-postgres psql -U lms -d lms
INSERT INTO user_roles (user_id, role_id)
  SELECT u.id, (SELECT id FROM roles WHERE name='teacher')
    FROM users u WHERE u.email='test-student@example.com';
```

## Demo data đã seed

- Course **`cpp-from-zero`** (free, published, published by teacher
  account). 1 module, 2 lessons (1 markdown + 1 exercise "Hello,
  world!").
- **15 knowledge nodes** trong graph: `io-basics`, `variables-types`,
  `operators`, `control-flow`, `loops`, `functions`, `arrays`,
  `strings`, `pointers`, `recursion`, `oop-basics`, `oop-inheritance`,
  `algo-sorting`, `algo-searching`, `ds-stack-queue`.
- **14 prereq edges** giữa các node.

## Demo data cần tạo thêm (để show paid flow)

Login teacher → Studio → New course với `pricing_model = paid`,
`price_cents = 50000` (500 VND) → tạo module + lesson → publish.

Sau đó login student → balance 0 → topup ít nhất 50k → admin duyệt →
student mua → thành công.
