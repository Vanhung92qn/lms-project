import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { Link } from '@/lib/i18n/routing';
import { EnrollButton } from './EnrollButton';

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('catalog');

  // SSR: fetch as anonymous. `is_enrolled` is updated client-side by the
  // EnrollButton after the user interacts — avoids leaking tokens through
  // the server fetch path.
  let course;
  try {
    course = await api.getCourse(slug);
  } catch {
    notFound();
  }
  if (!course) notFound();

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
                      // Open the lesson player directly. The backend gates
                      // on enrollment and sends non-enrolled users back to
                      // this page — no need to toggle the UI here.
                      course.is_enrolled ? (
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

            <EnrollButton slug={course.slug} initialEnrolled={course.is_enrolled} />

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
