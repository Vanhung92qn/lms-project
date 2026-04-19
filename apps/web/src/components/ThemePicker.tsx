'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

const THEMES = ['light', 'dark', 'dracula', 'one-dark', 'material', 'tokyo-night'] as const;
type Theme = (typeof THEMES)[number];

/**
 * Client-side segmented control matching the bento.html demo. Persists the
 * selection into localStorage under `lms-theme`. The FOUC guard (rendered
 * server-side via <ThemeScript />) reads the same key before hydration.
 */
export function ThemePicker() {
  const t = useTranslations('theme');
  const [current, setCurrent] = useState<Theme>('light');

  useEffect(() => {
    const fromDom = (document.documentElement.getAttribute('data-theme') as Theme) ?? 'light';
    setCurrent(fromDom);
  }, []);

  const apply = (name: Theme) => {
    document.documentElement.setAttribute('data-theme', name);
    try {
      localStorage.setItem('lms-theme', name);
    } catch {
      /* quota or private-browsing: ignore */
    }
    setCurrent(name);
  };

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="inline-flex gap-1 rounded-pill border border-border bg-panel p-1 shadow-softer"
    >
      {THEMES.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => apply(name)}
          aria-pressed={current === name}
          className={[
            'rounded-pill px-3.5 py-2 text-xs font-medium transition-all',
            current === name ? 'bg-accent text-panel' : 'text-text-muted hover:text-text',
          ].join(' ')}
        >
          {t(name)}
        </button>
      ))}
    </div>
  );
}
