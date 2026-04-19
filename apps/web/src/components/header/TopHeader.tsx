import { Logo } from './Logo';
import { NavItems } from './NavItems';
import { SettingsMenu } from './SettingsMenu';
import { AuthActions } from './AuthActions';

/**
 * Full-width client/student top header.
 * Two visual variants:
 *   - `solid` (default): normal page background; sits flush at the top.
 *   - `glass`: translucent, intended to overlay a full-screen hero or video.
 *
 * Shape aligns with docs/architecture/layout-patterns.md §A.
 * Width: content capped at 1400px so ultra-wide screens still feel centered,
 * but the bar spans edge to edge.
 */
export function TopHeader({ variant = 'solid' }: { variant?: 'solid' | 'glass' }) {
  const outerClass =
    variant === 'glass'
      ? 'absolute inset-x-0 top-0 z-20 border-b border-white/10 bg-transparent backdrop-blur-md'
      : 'sticky top-0 z-20 border-b border-border bg-panel/80 backdrop-blur-md';

  return (
    <header className={outerClass}>
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-6">
        <Logo variant={variant} />
        <div className="mx-auto">
          <NavItems variant={variant} />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <SettingsMenu variant={variant} />
          <AuthActions variant={variant} />
        </div>
      </div>
    </header>
  );
}
