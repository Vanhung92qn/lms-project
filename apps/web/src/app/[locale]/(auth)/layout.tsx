import type { ReactNode } from 'react';
import { ClientLayout } from '@/components/layouts/ClientLayout';

// Auth routes (login, register, oauth callback) share the client top header
// even though layout-patterns.md §A flagged them as "card only" — in practice
// having the header keeps the ThemePicker / locale switch accessible from
// the login page, which is important for first-time visitors.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <ClientLayout>{children}</ClientLayout>;
}
