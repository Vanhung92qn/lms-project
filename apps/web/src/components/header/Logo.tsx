import { Link } from '@/lib/i18n/routing';

/**
 * Brand mark. Uses the Instrument Serif display font + superscript registered
 * mark, echoing the hero design. Kept compact; no tagline here (that lives
 * on the landing page).
 */
export function Logo({ variant = 'solid' }: { variant?: 'solid' | 'glass' }) {
  const colorClass = variant === 'glass' ? 'text-[#0a0a0a]' : 'text-text';
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
