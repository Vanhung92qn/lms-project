import type { ReactNode } from 'react';
import { ClientLayout } from '@/components/layouts/ClientLayout';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <ClientLayout>{children}</ClientLayout>;
}
