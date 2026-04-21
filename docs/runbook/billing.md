# Runbook — Billing v1 (P6, manual approval)

> **Scope:** manual-approval top-up for a **specific paid course**.
> Students transfer via MoMo / bank; admin verifies the real-world
> transfer and approves; approval grants `Entitlement` + auto-enrols.
> Automated gateway integration (MoMo IPN webhook, VNPay, Stripe) is
> explicitly deferred.

---

## Pipeline

```
  Student clicks "Mua khoá" on a paid course
    │
    ▼ opens modal, sees MoMo QR / bank info + note field
    │
    ▼ POST /api/v1/billing/payments
  api-core  →  Payment row (status=pending)
    │
    ▼ admin opens /studio/payments
    │
    ▼ PATCH /api/v1/billing/admin/payments/:id/approve
  api-core  →  Payment.status=approved
            →  Entitlement (source=purchase, paymentId=…)
            →  Enrollment (upsert)
  (all three in one Prisma transaction)
    │
    ▼ student refreshes the course page
    ▼ CTA flips to "✓ Bạn đã mua khoá này / Bắt đầu học →"
```

---

## Endpoints

### Student
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/v1/billing/instructions` | none | MoMo + bank info for the FE modal |
| POST | `/api/v1/billing/payments` | JWT | Body: `{course_slug, method, user_note?}` |
| GET | `/api/v1/billing/me/payments` | JWT | Own history |
| PATCH | `/api/v1/billing/me/payments/:id/cancel` | JWT | Cancel own pending |

### Admin
| Method | Path | Auth | Role |
|--------|------|------|------|
| GET | `/api/v1/billing/admin/payments?status=pending` | JWT | admin |
| PATCH | `/api/v1/billing/admin/payments/:id/approve` | JWT | admin |
| PATCH | `/api/v1/billing/admin/payments/:id/reject` | JWT | admin |

Approve / reject both accept a JSON body `{admin_note?: string}`.

---

## Data model

### `payments`
- `user_id`, `course_id` — who + what
- `amount_cents`, `currency` — snapshot at create time (student pays the
  price at the moment of submission; if teacher raises the price later,
  the pending row keeps the old amount)
- `method` — `momo` | `bank`
- `status` — `pending` | `approved` | `rejected` | `cancelled`
- `user_note` — free-form: MoMo txn id, bank ref, screenshot URL…
- `admin_note` — admin's decision note (why approved / why rejected)
- `approved_by_id`, `approved_at` — audit

Indexes: `(user_id, created_at)`, `(status, created_at)`, `(course_id)`.

### `entitlements`
- Composite PK `(user_id, course_id)` — one row per access grant
- `source` — `purchase` | `granted` | `free`
- `payment_id` — nullable, set when source=purchase
- `expires_at`, `revoked_at` — nullable; v1 never sets these

### Transaction atomicity
Approval runs 3 writes in one `prisma.$transaction`:
1. Payment.status → approved
2. Entitlement upsert (source=purchase, paymentId)
3. Enrollment upsert (idempotent)

If any fails, all roll back — student's access stays deterministic.

---

## Configuration

Add to `/home/root/lms-project/.env` (or per-env secrets file in prod):

```
MOMO_PHONE=0903123456
MOMO_HOLDER="NGUYEN VAN A"
MOMO_QR_URL=https://cdn.example.com/momo-qr.png   # optional
BANK_NAME=Vietcombank
BANK_ACCOUNT=0011001234567
BANK_HOLDER="NGUYEN VAN A"
```

MoMo QR is served as a plain image URL — generate one at https://qr.momo.vn
and host it on a CDN / your Cloudflare R2 bucket. Keep the file small
(< 100 KB). If you leave `MOMO_QR_URL` empty, the modal falls back to
showing just the phone number and holder name.

Values with spaces (holder name) must be quoted in `.env`.

---

## Operations — daily admin workflow

1. Open https://khohoc.online/vi/studio/payments (admin only).
2. Status tab defaults to **Pending**.
3. For each row, open Vietcombank app or MoMo statement, check the
   transfer against `userNote`.
4. If the money arrived + matches → click **Duyệt**.
5. If the money never arrived or note is suspicious → click **Từ chối**
   and paste a short reason.

Bulk approvals are not supported yet — intentional, to keep the admin
from rubber-stamping without checking.

### Finding a specific payment
```bash
docker exec lms-postgres psql -U lms -d lms -c "
  SELECT p.id, u.email, c.slug, p.amount_cents, p.method, p.status, p.user_note
    FROM payments p
    JOIN users u   ON u.id = p.user_id
    JOIN courses c ON c.id = p.course_id
   WHERE u.email = 'student@example.com'
   ORDER BY p.created_at DESC LIMIT 10;
"
```

### Manually revoke access (e.g. refund)
```sql
UPDATE entitlements SET revoked_at = NOW()
 WHERE user_id = '…' AND course_id = '…';
```
This immediately blocks access — the next lesson-endpoint call returns
`not_entitled`. The Payment row stays as historical record.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Student sees `course_not_paid` on submit | Course priceCents is 0 or pricingModel=free | Check teacher's studio form; set price + pricing_model=paid |
| Student sees `already_entitled` | Race — they already have an approved payment | Refresh the course page; CTA will flip to "✓ Bạn đã mua" |
| Approve fails with `payment_not_pending` | Someone else already acted on it | Refresh the admin list; tab should move the row out of Pending |
| Approve succeeds but student still locked out | Approval tx failed silently (rare) | Check api-core logs for the correlation id; manually insert Entitlement row |
| `.env` fails to load | Values with spaces not quoted | Wrap holder/name values in double quotes |

---

## Future upgrades (post-MVP)

- **Automatic MoMo IPN** — listen to the MoMo payment callback and auto-approve when amount + trace_id match. Reference: https://github.com/fdhhhdjd/Class-Payment-MOMO.
- **VNPay** — similar flow, different signature scheme.
- **Stripe** — international students; requires foreign-exchange + VAT handling.
- **Refund endpoints** — currently done via direct SQL; should be a `PATCH /admin/payments/:id/refund` with audit trail.
- **Multi-course bundles** — one Payment → many Entitlements. Requires dropping the `payment_id UNIQUE` constraint on Entitlement.
- **Teacher receiving accounts** — per-teacher MoMo / bank, so the platform routes money to each course's teacher. Requires a `receiving_account` table + admin-approved onboarding.
