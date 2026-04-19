import { Link } from '@/lib/i18n/routing';

/**
 * Brand mark. Uses the Instrument Serif display font + superscript registered
 * mark, echoing the hero design. Kept compact; no tagline here (that lives
 * on the landing page).
 */
export function Logo({ variant: _variant = 'solid' }: { variant?: 'solid' | 'glass' }) {
  // Theme-aware: the logo always reads from the active palette's --text-main.
  const colorClass = 'text-text';
  return (
    <Link
      href="/"
      className={`flex items-center gap-2 transition-all hover:opacity-90 ${colorClass}`}
    >
      <span
        className="text-2xl tracking-tight md:text-3xl"
        style={{ fontFamily: "'Instrument Serif', serif" }}
      >
        khohoc<sup className="text-xs">®</sup>
      </span>
    </Link>
  );
}
