# Runbook — Admin + Recommendations (P7)

Three feature blocks shipping under one phase:

1. **Admin user management** — lock/unlock accounts, filter by role/status.
2. **Admin platform overview** — health + revenue + engagement metrics.
3. **Course recommendations** on student dashboard (content-based on mastery).
4. **Teacher per-course analytics** — AC rate, weakest concepts.

---

## Endpoints

### Admin (role-gated — admin only)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/admin/metrics` | Platform overview snapshot |
| GET | `/api/v1/admin/users?q=&role=&status=` | User list with filters |
| PATCH | `/api/v1/admin/users/:id/status` | Body `{status: "active" | "locked"}` |

Locking a user also **revokes every active refresh token** on the
same transaction, so an already-signed-in student loses access on
their next token refresh (≤ 15 min).

Safety rails:
- Admin cannot lock themselves (`cannot_lock_self`).
- Admin cannot lock another admin (`cannot_lock_admin`).
- Lock is reversible — re-PATCH `status=active`.

### Knowledge (student-scoped)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/knowledge/me/recommendations` | Content-based course list |

Algorithm (v1):
1. Pull the student's top-3 mastery nodes (ordered by score DESC).
2. For those nodes, find all published courses whose lessons are tagged.
3. Aggregate per-course match score (more matched nodes = higher rank).
4. Exclude courses the student is already enrolled in.
5. Cold-start (no mastery yet) → most-enrolled published courses.

Returns up to 3 courses. Collaborative filtering (scikit-surprise
nightly cron) lands in P7+ when we have enough enrollment signal.

### Teacher
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/teacher/courses/:id/analytics` | Course owner or admin only |

Returns:
- `enrollmentCount`, `uniqueSubmitters`, `totalSubmissions`, `acSubmissions`, `acRate`
- `perLesson[]` — sorted hardest-first (lowest AC rate top)
- `weakestConcepts[]` — top-5 knowledge nodes by lowest AC rate

---

## Pages (web)

| Route | Role | Content |
|-------|------|---------|
| `/studio/overview` | admin | 4 metric cards + role breakdown + wallet liability |
| `/studio/users` | admin | Filterable user table with lock/unlock actions |
| `/studio/courses/:id/analytics` | teacher (owner) / admin | Per-course analytics table |
| `/dashboard` | student | Gains a `RecommendationsWidget` below the mastery widget |

Sidebar: admin sees **Overview / Courses / Duyệt nạp tiền /
Người dùng**. Teacher sees only **Courses**.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/studio/overview` shows 403 | User doesn't have admin role | Add role via SQL: `INSERT INTO user_roles (user_id, role_id) VALUES ('<uuid>', (SELECT id FROM roles WHERE name='admin'))` |
| Locked user can still access | Refresh token not yet expired | Access token lives 15 min; wait that out or tell user to refresh page |
| Recommendations widget blank | Student has no mastery yet + no other courses exist | Seed more courses, or have student submit an AC on a tagged lesson |
| Teacher analytics 404 | Wrong course id or not owner | Check `teacher_id` in DB matches the authenticated user |
| Wallet liability > revenue | Normal — it's a liability, not revenue | The number shows what we'd owe on mass refund |

---

## Privileged operations

### Grant admin role to an existing user
```sql
INSERT INTO user_roles (user_id, role_id)
  SELECT u.id, (SELECT id FROM roles WHERE name = 'admin')
    FROM users u
   WHERE u.email = 'someone@khohoc.online'
ON CONFLICT DO NOTHING;
```

### Revoke admin role
```sql
DELETE FROM user_roles
 WHERE user_id = (SELECT id FROM users WHERE email = 'someone@khohoc.online')
   AND role_id = (SELECT id FROM roles WHERE name = 'admin');
```

### Manually unlock a user (if the admin UI is broken)
```sql
UPDATE users SET status = 'active' WHERE email = '…';
```

---

## Post-MVP backlog

- **Grafana iframe embed** inside `/studio/overview` for time-series
  charts (deferred to P8 when observability lands).
- **Collaborative filtering** — swap content-based reco for CF trained
  nightly on enrollment + purchase signal.
- **Teacher class-roster view** — list every enrolled student with
  their submission history + mastery per concept.
- **Cohort analytics** — "students who bought this course also bought…"
  (proper CF once we have signal).
- **Audit log page** — admin sees every lock/unlock/refund action
  (table already exists, needs a UI).
