'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { CourseSummary } from '@lms/shared-types';
import { MasteryWidget } from './MasteryWidget';
import { RecommendationsWidget } from './RecommendationsWidget';
import { OnboardingBanner } from './OnboardingBanner';

// Student dashboard. Session state (user profile) comes from SessionProvider;
// enrolled courses are fetched from /me/enrollments once we have a token.
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tCat = useTranslations('catalog');
  const router = useRouter();
  const { user, isLoading } = useSession();

  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [coursesLoading, setCoursesLoading] = useState(true);

  // Auth gate — once the session probe settles and there's no user, bounce
  // back to /login. Running inside useEffect so server render stays clean.
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    (async () => {
      try {
        setCoursesLoading(true);
        setCourses(await api.myEnrollments(token));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('load_failed'));
      } finally {
        setCoursesLoading(false);
      }
    })();
  }, [user, t]);

  if (isLoading || !user) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="card text-center">
          <p className="text-text-muted">…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">
          {t('welcome', { name: user.display_name })}
        </h1>
        <p className="mt-2 text-text-muted">{t('subtitle')}</p>
      </header>

      <OnboardingBanner />

      {error ? (
        <div className="card text-center">
          <p style={{ color: '#ff6b6b' }}>{error}</p>
        </div>
      ) : coursesLoading ? (
        <div className="card text-center text-text-muted">…</div>
      ) : courses.length === 0 ? (
        <>
          <div className="card flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-text-muted">{t('no_courses')}</p>
            <Link href="/courses" className="btn">
              {tCat('browse')}
            </Link>
          </div>
          <RecommendationsWidget />
        </>
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
          <MasteryWidget />
          <RecommendationsWidget />
        </>
      )}
    </main>
  );
}
