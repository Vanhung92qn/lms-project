import type { ReactNode } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';

export default function StudioLayout({ children }: { children: ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}
