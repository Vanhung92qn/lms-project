# Runbook — Wallet billing v1 (P6)

> **Scope:** wallet-based manual top-up.
> Student picks any amount, transfers via MoMo or VN-bank with a unique
> `TOPUP-XXXXXXXX` memo, admin manually verifies the receipt + approves
> → wallet balance credits. Student then spends the balance on any paid
> course — zero admin involvement per purchase.
>
> Rationale: decouple **money movement** (admin reviews) from **access
> grants** (student self-service). Admin cost stays constant as the
> course catalog grows.

---

## Pipeline

```
  Student /wallet
    │  "+ Nạp tiền" → picks amount + method
    │
    ▼  POST /api/v1/wallet/me/topups
  api-core generates reference = TOPUP-XXXXXXXX
           + VietQR URL encoding amount + memo
  WalletTopup row lands as `pending`
    │
    ▼  Student scans QR with VN banking app → auto-fills transfer
    ▼  Student submits real-world transfer
    │
    ▼  Admin /studio/topups
    ▼  PATCH /wallet/admin/topups/:id/approve
  api-core transaction:
    - WalletTopup.status = approved
    - users.wallet_balance_cents += amount
    │
  Student /wallet → balance updated

  Student /courses/:slug (paid)
    │  "Mua ngay · 50.000 đ"
    │
    ▼  POST /api/v1/wallet/me/purchase
  api-core transaction (atomic, guarded):
    - users.wallet_balance_cents -= price  (fails if insufficient)
    - Entitlement upsert (source=purchase)
    - Enrollment upsert (for dashboard)
    │
  Student is in the course, zero admin touch
```

---

## Data model

### `users.wallet_balance_cents`
Integer, VND cents. Only modified inside Prisma transactions that also
write a WalletTopup.approve or an Entitlement.purchase — so the balance
can't drift from its causes.

### `wallet_topups`
- `reference_code` UNIQUE — the `TOPUP-XXXXXXXX` code baked into the
  bank memo; 8 hex chars, ~4B possibilities, generated with
  `crypto.randomBytes(4).toString('hex')`. Service retries on P2002
  unique-constraint violation (astronomical chance at pilot scale but
  we handle it).
- `amount_cents` — user-chosen, clamped to [10,000 VND, 500M VND].
- `method` — `momo | bank`.
- `status` — `pending | approved | rejected | cancelled`.
- `user_note` — free-form (txn id, screenshot URL…).
- `admin_note` — admin's decision note.
- `approved_by_id`, `approved_at` — audit.

Indexes: `(user_id, created_at)`, `(status, created_at)`.

### `entitlements`
Unchanged shape from P5b. Added `amount_cents` snapshot so price
changes on the Course don't retroactively rewrite history.

---

## Endpoints

### Public
| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/v1/wallet/instructions` | `{momo, bank, currency}` for the topup form |

### Student
| Method | Path | Body / Notes |
|--------|------|--------------|
| GET | `/api/v1/wallet/me` | `{balanceCents, currency}` |
| POST | `/api/v1/wallet/me/topups` | `{amount_cents, method, user_note?}` |
| GET | `/api/v1/wallet/me/topups` | own history, all statuses |
| PATCH | `/api/v1/wallet/me/topups/:id/cancel` | cancel own pending |
| POST | `/api/v1/wallet/me/purchase` | `{course_slug}` — one-click deduct |

### Admin
| Method | Path | Role |
|--------|------|------|
| GET | `/api/v1/wallet/admin/topups?status=pending` | admin |
| PATCH | `/api/v1/wallet/admin/topups/:id/approve` | admin |
| PATCH | `/api/v1/wallet/admin/topups/:id/reject` | admin |

Approve / reject accept `{admin_note?: string}`.

---

## VietQR integration

VietQR is a VN-standard QR that every local bank app (Vietcombank,
Techcombank, MB, VIB, ACB…) recognizes. The free img.vietqr.io service
renders a pre-built QR PNG given the bank code, account, amount, and
memo — no API key required.

The server builds the URL when a topup's `method = bank`:

```
https://img.vietqr.io/image/{BIN}-{ACCOUNT}-compact2.png
  ?amount={vnd}
  &addInfo={TOPUP-XXXXXXXX}
  &accountName={HOLDER}
```

The student scans, their bank app auto-fills amount + memo, they
confirm → the reference code lands in admin's bank statement
automatically.

### Bank BIN codes (BANK_BIN env)
Common VN banks (full list at https://api.vietqr.io/v2/banks):

| Bank | BIN |
|------|-----|
| Vietcombank | `VCB` (or `970436`) |
| Techcombank | `TCB` (or `970407`) |
| MBBank | `MB` (or `970422`) |
| ACB | `ACB` (or `970416`) |
| VPBank | `VPB` (or `970432`) |
| TPBank | `TPB` (or `970423`) |
| VIB | `VIB` (or `970441`) |
| BIDV | `BIDV` (or `970418`) |

Either the 3-letter short code or the 6-digit number works.

MoMo does not expose a public QR-generator API for 3rd parties; we
fall back to showing `MOMO_QR_URL` (static PNG you host yourself from
qr.momo.vn) or plain phone + holder text.

---

## Configuration

```bash
# .env on the VPS — reload api-core after any change.
MOMO_PHONE=0903xxxxxxx
MOMO_HOLDER="NGUYEN VAN A"
MOMO_QR_URL=                        # optional hosted PNG of your MoMo QR
BANK_BIN=VCB
BANK_NAME=Vietcombank
BANK_ACCOUNT=0011001234567
BANK_HOLDER="NGUYEN VAN A"
```

Holder values with spaces must be quoted.

---

## Daily admin workflow

1. Open https://khohoc.online/vi/studio/topups (admin only).
2. Status tab defaults to **Pending**.
3. For each row, match `referenceCode` against the bank-app statement
   (the `TOPUP-XXXXXXXX` will be in the transfer memo).
4. Amount matches + memo matches + received OK → click **Duyệt**.
5. No transfer arrived / wrong amount / spoof → click **Từ chối** with
   a short note.

Approve is atomic — credit happens in the same tx as the status flip.

### Find a specific top-up
```bash
docker exec lms-postgres psql -U lms -d lms -c "
  SELECT t.id, t.reference_code, u.email, t.amount_cents/100 AS vnd,
         t.method, t.status, t.user_note
    FROM wallet_topups t
    JOIN users u ON u.id = t.user_id
   ORDER BY t.created_at DESC LIMIT 20;
"
```

### Check a user's balance
```bash
docker exec lms-postgres psql -U lms -d lms -c "
  SELECT email, wallet_balance_cents/100 AS vnd FROM users
   WHERE email = 'student@khohoc.online';
"
```

### Grant a free entitlement (comp a course)
```sql
INSERT INTO entitlements (id, user_id, course_id, source, amount_cents, granted_at)
SELECT gen_random_uuid(), u.id, c.id, 'granted', 0, NOW()
  FROM users u, courses c
 WHERE u.email = 'student@example.com' AND c.slug = 'cpp-advanced';

INSERT INTO enrollments (id, user_id, course_id, enrolled_at, progress_pct)
SELECT gen_random_uuid(), u.id, c.id, NOW(), 0
  FROM users u, courses c
 WHERE u.email = 'student@example.com' AND c.slug = 'cpp-advanced'
ON CONFLICT DO NOTHING;
```

### Manual refund (revert a wallet top-up)
```sql
-- 1. Deduct the amount from the user's wallet
UPDATE users SET wallet_balance_cents = wallet_balance_cents - 10000000
 WHERE email = 'student@example.com';
-- 2. Mark the topup as rejected retroactively
UPDATE wallet_topups SET status = 'rejected',
       admin_note = 'Refunded — reason: …'
 WHERE reference_code = 'TOPUP-ABCDEF01';
```

Currently no audit ledger; manual refunds should leave an `admin_note`
on the topup.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `amount_too_small` on create | below 10,000 VND | Increase amount |
| `reference_code_collision` | unique clash (astronomical) | Service already retries 5× — if seen, investigate RNG |
| Balance doesn't update after approve | Prisma tx failed silently (rare) | Check api-core logs for correlation id; re-run SQL |
| QR image 404s | `BANK_BIN` empty or unknown | Set `BANK_BIN=VCB` (or your bank's code) + restart |
| `insufficient_balance` on purchase | race — another purchase consumed the balance | Refresh wallet page, the new balance is correct |
| `already_entitled` on re-purchase | student already owns the course | Expected — UI shows the "Start learning" CTA instead |
| Admin sees nothing in pending | Status tab is wrong, or no new topups | Switch tab to "Tất cả" or query DB |

---

## Future upgrades (post-MVP)

- **Auto-duyệt qua MoMo IPN** — MoMo webhook with HMAC signature
  verification. Reference: https://github.com/fdhhhdjd/Class-Payment-MOMO.
- **VietQR + webhook** — some banks (Techcombank Pro) expose a webhook
  that fires on matching incoming transfers. Auto-approve if amount +
  memo match a pending row.
- **Transaction ledger table** — full append-only audit with
  type=topup/purchase/refund/grant, so we can reconstruct balance
  history from scratch if `wallet_balance_cents` ever drifts.
- **Currency support** — current schema is VND-only; add `currency`
  on `users.wallet_balance_cents` when admitting international users.
- **Teacher receiving accounts** — per-teacher MoMo / bank so the
  platform routes each course's revenue to its teacher instead of the
  single admin account. Requires a `receiving_accounts` table + admin
  onboarding flow.
- **Time-limited promo codes** — a separate table that grants free
  Entitlement (source=granted) when a promo is redeemed.
