'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from '@/lib/i18n/routing';
import { useSession } from '@/lib/session';
import { AdminSidebar } from '@/components/studio/AdminSidebar';

/**
 * Wraps every route under `/[locale]/studio/*`. Three responsibilities:
 * 1) Enforce the role gate — teachers and admins only; everyone else is
 *    bounced to the landing page once the session probe settles.
 * 2) Mount the AdminSidebar (no TopHeader — see layout-patterns.md §B).
 * 3) Hand the rest of the viewport to a scrolling <main>.
 */
export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!user.roles.includes('teacher') && !user.roles.includes('admin')) {
      router.replace('/');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-main text-text-muted">…</div>
    );
  }
  if (!user.roles.includes('teacher') && !user.roles.includes('admin')) {
    return null; // effect above redirects; render nothing in the meantime
  }

  return (
    <div className="flex min-h-screen bg-main">
      <AdminSidebar />
      <main className="min-w-0 flex-1 overflow-x-auto">{children}</main>
    </div>
  );
}
