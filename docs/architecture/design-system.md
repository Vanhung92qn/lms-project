# Design System — Bento Grid (iOS-inspired)

This is the binding style contract for every UI surface in AI-LMS.
Violations block PR review. The living demo at
[`docs/demo/bento.html`](../demo/bento.html) is the source of truth
for tokens and interactions; this document explains the rules.

## 1. Philosophy

- **Bento Grid layout.** The canvas is a CSS grid; content lives in
  cards of varied sizes (`grid-column: span N; grid-row: span M`).
  Empty space is a feature, not a bug.
- **Shape.** No sharp corners, anywhere.
  - Cards: `border-radius: 24px`.
  - Buttons: `border-radius: 99px` (fully rounded pill).
  - Inner boxes / inputs / chips: `border-radius: 16px`.
- **Depth.** Separate surfaces with a *soft* shadow, not a hard line.
  Borders are 1 px, low-contrast, for definition only.
- **Typography.**
  - UI: `Outfit` (weights 400, 500, 600, 700).
  - Editor / Terminal: `Fira Code` (weights 400, 500; ligatures on).
- **Motion.** Every interactive element has
  `transition: all 0.3s ease` by default. Hover / focus shift color
  and shadow; they never shift position by more than 2 px.
- **Minimalism.** Padding is generous (24–32 px). Prefer one strong
  accent colour per card over rainbow badges. Less is more.

## 2. CSS token contract

**Every color, every shadow, every border** is read from a CSS
variable. Hard-coded hex values in component CSS are a lint error.

Core tokens, defined on `:root` and overridden per
`[data-theme="..."]`:

| Token | Purpose |
|-------|---------|
| `--bg-main` | Page background (the canvas behind cards) |
| `--bg-panel` | Bento card surface |
| `--bg-header` | Card header / toolbar / nav |
| `--bg-code` | IDE / terminal / monospace surfaces |
| `--text-main` | Headings and primary body text |
| `--text-muted` | Captions, hints, long-form paragraphs |
| `--border-color` | 1 px separators |
| `--accent` | Primary CTA fill, focus ring, active state |
| `--accent-hover` | Pressed / hovered CTA |
| `--shadow-color` | Box-shadow color for soft depth |
| `--code-keyword` | Keywords (if / return / class) |
| `--code-variable` | Identifiers, property names |
| `--code-string` | String literals |
| `--code-comment` | Comments, dimmed syntax |

Tailwind (if adopted later) **must** map its theme colors into these
variables. No parallel palette.

## 3. Theming

The app supports six themes out of the box:

- `light` — default, high-contrast, iOS-bright.
- `dark` — OLED-friendly, near-black canvas.
- `dracula` — purple/pink, classic editor palette.
- `one-dark-pro` — VS Code's default dark.
- `material` — Material Theme (Mariana) slate.
- `tokyo-night` — desaturated blues.

The active theme is set on `<html data-theme="<name>">` and persisted
via `localStorage.getItem('lms-theme')`.

### FOUC guard (required on every page)

Before the document body starts rendering, run:

```html
<script>
  (function () {
    try {
      var saved = localStorage.getItem('lms-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (e) { /* localStorage disabled — fall back to default */ }
  })();
</script>
```

In Next.js (App Router), this lives in `app/layout.tsx` as an inline
`<Script strategy="beforeInteractive">` at the top of `<head>`.

## 4. Component rules

When adding a new component (leaderboard, payment form, course
builder, …):

1. **Wrap it in its own grid cell** that declares its span. Do not
   span across unrelated concerns.
2. **Use only tokens.** `color: var(--text-main)`, never `color: #000`.
3. **Respect the padding rhythm.** 24 px inside normal cards, 32 px
   for hero / empty-state cards. Inner children use 16 px.
4. **Every interactive element** transitions `background`, `color`,
   `border-color`, and `box-shadow` over 0.3 s ease.
5. **Test under all six themes** before merging. A screenshot in the
   PR description is required for visual changes.

## 5. Grid sizing cheat-sheet

```
.bento {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: minmax(140px, auto);
  gap: 24px;
}
```

Common spans (desktop ≥ 1024 px):

- Hero card — `grid-column: span 7; grid-row: span 2`
- Stats ring — `grid-column: span 5; grid-row: span 2`
- Code editor — `grid-column: span 8; grid-row: span 2`
- AI Tutor chat — `grid-column: span 4; grid-row: span 2`
- Small stat chip — `grid-column: span 3`
- Wide list — `grid-column: span 6`

Below 1024 px everything collapses to `grid-template-columns: 1fr`.

## 6. What not to do

- No box-shadow colors expressed as rgba literals in components.
  Drive them from `--shadow-color`.
- No `transition: none` on interactive elements. If motion is a
  problem for an a11y reason, respect `@media (prefers-reduced-motion)`
  globally, do not disable per component.
- No nested scrollbars inside cards. Cards grow or paginate.
- No text smaller than 13 px on desktop.

## 7. Accessibility baseline

- Contrast ratio ≥ 4.5 : 1 for body text, ≥ 3 : 1 for large text.
  The six themes are tuned to satisfy this on default surfaces.
- Focus ring: 2 px outline at `--accent`, offset 2 px.
- Reduced motion honored: components should gate purely decorative
  transitions behind `@media (prefers-reduced-motion: no-preference)`.
- Keyboard navigation is non-negotiable. Hover-only interactions are
  banned.

## 8. Canonical example

See [`docs/demo/bento.html`](../demo/bento.html) for a single-file,
framework-free reference implementation that exercises every rule
above. Open it in a browser; the theme switcher at the top right
lets you verify tokens under every palette.
