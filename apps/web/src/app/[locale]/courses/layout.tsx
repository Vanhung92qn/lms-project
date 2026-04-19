import type { ReactNode } from 'react';
import { ClientLayout } from '@/components/layouts/ClientLayout';

export default function CoursesLayout({ children }: { children: ReactNode }) {
  return <ClientLayout>{children}</ClientLayout>;
}
