import { getTranslations, setRequestLocale } from 'next-intl/server';
import { api } from '@/lib/api';
import { Link } from '@/lib/i18n/routing';
import type { CourseSummary } from '@lms/shared-types';

// SSR'd catalog grid. Server fetches the list from api-core and hydrates the
// page. No client interactivity needed here — the enroll button lives on the
// detail page.

export default async function CoursesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('catalog');

  let items: CourseSummary[] = [];
  let fetchError: string | null = null;
  try {
    const res = await api.listCourses({ limit: 24, locale });
    items = res.items;
  } catch (err) {
    fetchError = (err as Error).message;
  }

  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-text md:text-4xl">{t('title')}</h1>
        <p className="mt-2 max-w-2xl text-text-muted">{t('subtitle')}</p>
      </header>

      {fetchError ? (
        <div className="card text-center text-text-muted">
          <p>{t('fetch_failed')}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center text-text-muted">
          <p>{t('empty')}</p>
        </div>
      ) : (
        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <CourseCard key={c.id} c={c} locale={locale} />
          ))}
        </section>
      )}
    </main>
  );
}

function CourseCard({ c, locale: _locale }: { c: CourseSummary; locale: string }) {
  const priceLabel =
    c.pricing_model === 'free'
      ? 'Miễn phí'
      : c.price_cents != null
        ? new Intl.NumberFormat('vi-VN').format(c.price_cents) + ' ' + (c.currency ?? '')
        : '—';
  return (
    <Link href={`/courses/${c.slug}` as never} className="group">
      <article className="card flex h-full flex-col gap-4 transition-all group-hover:translate-y-[-2px]">
        <div
          className="flex h-40 items-center justify-center rounded-box text-5xl font-bold text-text-muted"
          style={{ background: 'var(--bg-code)' }}
        >
          {c.title.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold leading-tight text-text">{c.title}</h2>
          <p className="mt-1 text-sm text-text-muted line-clamp-2">{c.description ?? ''}</p>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">{c.teacher.display_name}</span>
          <span className="rounded-pill bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            {priceLabel}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{c.lesson_count} bài học</span>
          <span>{c.locale.toUpperCase()}</span>
        </div>
      </article>
    </Link>
  );
}
