'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';
import type { CourseSummary, UserSummary } from '@lms/shared-types';

// Student dashboard. Renders from the token held in sessionStorage; if no
// token, redirects to /login. Shows the enrolled courses as bento cards and
// a prompt to browse the catalog when the list is empty.

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tCat = useTranslations('catalog');
  const router = useRouter();

  const [me, setMe] = useState<UserSummary | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      token = null;
    }
    if (!token) {
      router.replace('/login');
      return;
    }
    const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
    (async () => {
      try {
        const [mineRes, meRes] = await Promise.all([
          api.myEnrollments(token!),
          fetch(`${BASE}/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        setCourses(mineRes);
        if (meRes) setMe(meRes);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('load_failed'));
      }
    })();
  }, [router, t]);

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">
          {t('welcome', { name: me?.display_name ?? '…' })}
        </h1>
        <p className="mt-2 text-text-muted">{t('subtitle')}</p>
      </header>

      {error ? (
        <div className="card text-center">
          <p style={{ color: '#ff6b6b' }}>{error}</p>
        </div>
      ) : courses.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-text-muted">{t('no_courses')}</p>
          <Link href="/courses" className="btn">
            {tCat('browse')}
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text">{t('enrolled')}</h2>
            <Link href="/courses" className="text-sm text-accent hover:text-accent-hover">
              {tCat('browse')} →
            </Link>
          </div>
          <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => (
              <Link key={c.id} href={`/courses/${c.slug}` as never}>
                <article className="card flex h-full flex-col gap-4 transition-all hover:-translate-y-[2px]">
                  <div
                    className="flex h-32 items-center justify-center rounded-box text-3xl font-bold text-text-muted"
                    style={{ background: 'var(--bg-code)' }}
                  >
                    {c.title.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold leading-tight text-text">{c.title}</h3>
                    <p className="mt-1 text-xs text-text-muted">{c.teacher.display_name}</p>
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span>{c.lesson_count} bài học</span>
                    <span className="font-semibold text-accent">{t('continue')}</span>
                  </div>
                </article>
              </Link>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
