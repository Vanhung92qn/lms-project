import type { ReactNode } from 'react';
import { ClientLayout } from '@/components/layouts/ClientLayout';

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return <ClientLayout>{children}</ClientLayout>;
}
