'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';
import type { CourseDetail } from '@lms/shared-types';
import { EnrollButton } from './EnrollButton';

// Client-rendered so enrollment state can be authoritative (the SSR path
// can't see the caller's token, so `is_enrolled` would otherwise always
// be false on first paint). A brief "…" skeleton is the tradeoff vs. the
// prior SSR; keeps the UX trio (fetch with token → show enrollment →
// lesson links) aligned on a single render pass.

export default function CourseDetailPage() {
  // Next 14 client components get params synchronously via useParams();
  // the server's Promise-params pattern doesn't apply here.
  const { slug } = useParams<{ slug: string }>();
  const t = useTranslations('catalog');
  const router = useRouter();

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      /* ignore */
    }
    (async () => {
      try {
        const data = await api.getCourse(slug, token);
        setCourse(data);
        setEnrolled(data.is_enrolled);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          return;
        }
        /* fall through — showing loading with a retry would be ideal */
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  useEffect(() => {
    if (notFound) router.replace('/courses');
  }, [notFound, router]);

  if (loading) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-10 text-text-muted">…</main>
    );
  }
  if (!course) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <p className="text-text-muted">{t('fetch_failed')}</p>
      </main>
    );
  }

  const totalLessons = course.modules.reduce((n, m) => n + m.lessons.length, 0);
  const priceLabel =
    course.pricing_model === 'free'
      ? t('free')
      : course.price_cents != null
        ? `${new Intl.NumberFormat('vi-VN').format(course.price_cents)} ${course.currency ?? ''}`
        : '';

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Main column */}
        <article>
          <div className="mb-6 text-sm text-text-muted">
            <span>{course.teacher.display_name}</span>
            <span className="mx-2 text-border">·</span>
            <span className="uppercase">{course.locale}</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-text md:text-5xl">
            {course.title}
          </h1>
          {course.description ? (
            <p className="mt-4 max-w-2xl text-lg text-text-muted">{course.description}</p>
          ) : null}

          <section className="mt-10">
            <h2 className="mb-4 text-lg font-semibold text-text">{t('curriculum')}</h2>
            <div className="flex flex-col gap-3">
              {course.modules.map((m) => (
                <div key={m.id} className="card !py-4">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-text-muted">
                    {m.sort_order}. {m.title}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {m.lessons.map((l) =>
                      enrolled ? (
                        <li key={l.id}>
                          <Link
                            href={`/courses/${course.slug}/learn/${l.id}` as never}
                            className="flex items-center justify-between rounded-box bg-code px-4 py-2 text-sm text-text transition-colors hover:bg-accent/10"
                          >
                            <span className="flex items-center gap-3">
                              <LessonIcon type={l.type} />
                              <span>{l.title}</span>
                            </span>
                            {l.est_minutes ? (
                              <span className="text-xs text-text-muted">
                                {l.est_minutes} {t('minutes')}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      ) : (
                        <li
                          key={l.id}
                          className="flex items-center justify-between rounded-box bg-code px-4 py-2 text-sm text-text"
                        >
                          <span className="flex items-center gap-3">
                            <LessonIcon type={l.type} />
                            <span>{l.title}</span>
                          </span>
                          {l.est_minutes ? (
                            <span className="text-xs text-text-muted">
                              {l.est_minutes} {t('minutes')}
                            </span>
                          ) : null}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </article>

        {/* Sidecar */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="card flex flex-col gap-4">
            <div
              className="flex h-44 items-center justify-center rounded-box text-5xl font-bold text-text-muted"
              style={{ background: 'var(--bg-code)' }}
            >
              {course.title.slice(0, 2).toUpperCase()}
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-text">{priceLabel}</span>
              <span className="rounded-pill bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
                {t(course.pricing_model)}
              </span>
            </div>

            <EnrollButton
              slug={course.slug}
              enrolled={enrolled}
              firstLessonId={course.modules[0]?.lessons[0]?.id ?? null}
              onEnrolled={() => setEnrolled(true)}
            />

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-text-muted">{t('lessons')}</dt>
                <dd className="font-semibold text-text">{totalLessons}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t('locale')}</dt>
                <dd className="font-semibold text-text">{course.locale.toUpperCase()}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LessonIcon({ type }: { type: 'markdown' | 'exercise' | 'quiz' }) {
  const ch = type === 'markdown' ? 'M' : type === 'exercise' ? 'C' : 'Q';
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
      {ch}
    </span>
  );
}
