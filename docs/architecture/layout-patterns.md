# Layout Patterns — Client vs Admin (BINDING)

AI-LMS has **two physically separate UI workspaces**. They share the
same design tokens (see [design-system.md](design-system.md)) but use
**different navigation shells**. Mixing them is a review blocker.

Before writing any UI component, identify which workspace it belongs
to and wrap it in the correct layout. If you think an exception is
warranted, open an ADR first.

---

## A. Client / Student workspace

**Route prefix:** `apps/web/src/app/[locale]/*` (everything that is
not under `/admin`).

**Layout shell:** `<ClientLayout>` → fixed **Top Header** + scrolling
content below. The header is sticky; content has room to breathe.

### Sitemap (always visible in the header, left-to-right)

```
Trang chủ   Duyệt lộ trình   Gia sư AI   Học tập   Thử thách ▾   Hoạt động ▾   Cộng đồng ▾
```

Dropdown contents:

- **Thử thách ▾** — Luyện tập, Thi đấu
- **Hoạt động ▾** — Cuộc thi, Xếp hạng
- **Cộng đồng ▾** — Thảo luận & Forum

Right-aligned in the header:

- Locale switch (vi / en)
- ThemePicker (the segmented control from `bento.html`)
- Avatar / account menu (falls back to `Đăng nhập` | `Đăng ký` when
  anonymous)

### Shape

```
 ┌─────────────────────────────────────────────────────────────────┐
 │ [K] khohoc.online   Trang chủ  Duyệt  Gia sư AI ...   [🌓] [A▾] │  ← <TopHeader /> fixed
 ├─────────────────────────────────────────────────────────────────┤
 │                                                                 │
 │                     <main> scrolling content                    │
 │                        (bento grid inside)                      │
 │                                                                 │
 └─────────────────────────────────────────────────────────────────┘
```

### Exceptions

- `app/[locale]/(auth)/*` — login / register / forgot-password: no
  header; a single card-centered view.
- Full-screen focus modes (future: exam, contest): no header; a thin
  top bar with only the timer + leave-contest button.

Both exceptions opt out by **not** wrapping in `<ClientLayout>`.

---

## B. Admin workspace

**Route prefix:** `apps/web/src/app/[locale]/admin/*`.

**Layout shell:** `<AdminLayout>` → fixed **Left Sidebar** + scrolling
content to the right. No top header (the sidebar *is* the nav).

### Sidebar sections

```
─ Dashboard             (overview cards)
─ Người dùng            (users, roles, audit log)
─ Khoá học              (catalog, CMS, lessons, exercises)
─ Học tập & Chấm điểm   (enrollments, progress, submissions)
─ Tài chính             (orders, invoices, entitlements)
─ AI & Tutor            (queue depth, prompt templates)
─ Hệ thống              (metrics iframe, feature flags, env info)
─────────────────────────
─ Đăng xuất
```

### Shape

```
 ┌───────────────┬─────────────────────────────────────────────────┐
 │ [K] khohoc    │                                                 │
 │               │                                                 │
 │ Dashboard     │                                                 │
 │ Người dùng    │         <main> data-heavy content               │
 │ Khoá học      │           (tables, charts, forms)               │
 │ ...           │                                                 │
 │               │                                                 │
 │ Đăng xuất     │                                                 │
 └───────────────┴─────────────────────────────────────────────────┘
   <AdminSidebar /> fixed, 240 px wide desktop, collapsible < 1024 px
```

### Rules

- **Minimal, data-heavy.** Tables, read-only metrics cards, charts.
  Very little decorative content.
- **Dense spacing.** Tables use 8–12 px cell padding (not the 24 px
  used on client cards). Buttons shrink to 8 × 16 px (`.btn.small`).
- **No `<TopHeader />`.** Importing it inside `admin/*` is a review
  blocker.
- **No dropdown menus in the shell.** All navigation is expressed as
  sidebar items; destinations are one click away.
- **Access control.** `<AdminLayout>` server-checks the caller has
  `admin` role; unauthorised users get redirected to `/` with a
  toast.

### Exceptions

- None at MVP. Admin screens always live inside `<AdminLayout>`.

---

## Implementing the layouts

Both layouts live in `apps/web/src/components/layouts/`:

- `ClientLayout.tsx` — renders `<TopHeader />` + `<main>`.
- `AdminLayout.tsx` — renders `<AdminSidebar />` + `<main class="admin-main">`.
  Guards the route server-side; redirects non-admins.

Both import design tokens from `src/styles/tokens.css` and must
respect the six-theme switcher: no hard-coded colours, no breakages
under `data-theme="dracula"` etc.

For a working reference of the tokens, keep
[`docs/demo/bento.html`](../demo/bento.html) open in a tab while you
work.

---

## Migration checklist for new UI PRs

Before opening a PR that adds or changes UI:

- [ ] Which workspace? Client or Admin — answer in the PR description.
- [ ] Correct layout wrapper applied?
- [ ] Sitemap updated if you added a top-level route (Client) or
      sidebar item (Admin).
- [ ] All colours / shadows / radii reference CSS variables (no
      `#rrggbb` in component CSS).
- [ ] Tested under all six themes (screenshot in PR).
- [ ] Responsive down to 720 px width.
