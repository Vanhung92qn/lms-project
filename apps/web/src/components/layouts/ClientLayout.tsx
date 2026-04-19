import type { ReactNode } from 'react';
import { TopHeader } from '@/components/header/TopHeader';

/**
 * Default wrapper for every page under `/[locale]/*` that is NOT the
 * cinematic landing. Applies the sticky top header defined in
 * docs/architecture/layout-patterns.md §A.
 *
 * The hero landing renders its own glass-over-video header inline and
 * deliberately bypasses this component to keep the video fullscreen.
 */
export function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopHeader variant="solid" />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
    </>
  );
}
