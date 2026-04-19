import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeScript } from '@/components/ThemeScript';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'khohoc.online — AI-LMS',
    template: '%s · khohoc.online',
  },
  description:
    'Interactive, text-first LMS with a self-hosted AI tutor and automatic personalised learning paths.',
  metadataBase: new URL('https://khohoc.online'),
};

/**
 * Root HTML scaffold. next-intl takes over inside [locale]/layout.tsx — here
 * we only set up fonts, the FOUC guard, and the default palette.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" data-theme="light" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Fira+Code:wght@400;500&family=Inter:wght@400;500&family=Instrument+Serif&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
