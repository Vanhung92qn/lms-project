'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/lib/i18n/routing';

const THEMES = ['light', 'dark', 'dracula', 'one-dark', 'material', 'tokyo-night'] as const;
type Theme = (typeof THEMES)[number];

const LOCALES = ['vi', 'en'] as const;
type Locale = (typeof LOCALES)[number];

/**
 * Settings dropdown — gear icon in the header. Houses the theme picker
 * (moved here from the top bar per updated UX spec) and the locale switch.
 *
 * Theme selection persists to localStorage under `lms-theme`, matching the
 * FOUC guard script in <ThemeScript />.
 */
export function SettingsMenu({ variant = 'solid' }: { variant?: 'solid' | 'glass' }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');
  const [locale, setLocale] = useState<Locale>('vi');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const dom = (document.documentElement.getAttribute('data-theme') as Theme) ?? 'light';
    setTheme(dom);
    const segment = window.location.pathname.split('/')[1];
    if (segment === 'vi' || segment === 'en') setLocale(segment);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const applyTheme = (name: Theme) => {
    document.documentElement.setAttribute('data-theme', name);
    try {
      localStorage.setItem('lms-theme', name);
    } catch {
      /* private browsing — ignore */
    }
    setTheme(name);
  };

  const switchLocale = (next: Locale) => {
    router.replace(pathname, { locale: next });
    setLocale(next);
    setOpen(false);
  };

  // Theme-aware across both variants — trigger pill always uses tokens.
  const triggerColor = 'text-text-muted hover:text-text';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={t('label')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`grid h-9 w-9 place-items-center rounded-pill border border-border transition-all ${triggerColor} ${
          variant === 'glass' ? 'bg-panel/70 backdrop-blur-md' : 'bg-panel'
        }`}
      >
        {/* gear icon — inline SVG avoids adding lucide-react just for one glyph */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-72 origin-top-right rounded-card border border-border bg-panel p-4 shadow-soft"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t('theme')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => applyTheme(name)}
                aria-pressed={theme === name}
                className={`rounded-box border px-2 py-2 text-xs font-medium capitalize transition-all ${
                  theme === name
                    ? 'border-accent bg-accent text-panel'
                    : 'border-border bg-code text-text-muted hover:text-text'
                }`}
              >
                {name.replace('-', ' ')}
              </button>
            ))}
          </div>

          <div className="my-4 border-t border-border" />

          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t('locale')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => switchLocale(l)}
                aria-pressed={locale === l}
                className={`rounded-box border px-3 py-2 text-sm font-medium transition-all ${
                  locale === l
                    ? 'border-accent bg-accent text-panel'
                    : 'border-border bg-code text-text-muted hover:text-text'
                }`}
              >
                {l === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
