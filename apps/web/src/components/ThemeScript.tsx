/**
 * Blocks FOUC — reads `lms-theme` from localStorage and sets
 * `document.documentElement.dataset.theme` before React hydrates, so the
 * saved palette is visible on the very first paint.
 *
 * Rendered inside `<head>` via `next/script` with `strategy="beforeInteractive"`.
 * Inline source stays minimal to keep CSP-friendliness straightforward.
 */
export function ThemeScript() {
  const code = `(function(){try{var t=localStorage.getItem('lms-theme');if(t){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
