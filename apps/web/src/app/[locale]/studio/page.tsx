'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';
import type { CourseSummary } from '@lms/shared-types';

// Studio dashboard — lists the courses owned by the caller (admins see
// everyone's). Entry point for authoring: "Tạo khoá học mới" → /studio/courses/new.

const STATUS_LABEL: Record<string, string> = {
  draft: 'Bản nháp',
  published: 'Đã xuất bản',
  archived: 'Lưu trữ',
};

export default function StudioPage() {
  const t = useTranslations('studio');
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    (async () => {
      try {
        setCourses(await api.teacher.listMine(token));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('load_failed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  return (
    <div className="px-8 py-8">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <Link href="/studio/courses/new" className="btn">
          + {t('cta_new_course')}
        </Link>
      </header>

      {error ? (
        <div className="card" style={{ borderColor: '#ff6b6b' }}>
          <p className="text-sm" style={{ color: '#ff6b6b' }}>
            {error}
          </p>
        </div>
      ) : loading ? (
        <p className="text-text-muted">…</p>
      ) : courses.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-text-muted">{t('empty')}</p>
          <Link href="/studio/courses/new" className="btn">
            + {t('cta_new_course')}
          </Link>
        </div>
      ) : (
        <CoursesTable courses={courses} />
      )}
    </div>
  );
}

function CoursesTable({ courses }: { courses: CourseSummary[] }) {
  const t = useTranslations('studio');
  return (
    <div className="overflow-hidden rounded-card border border-border bg-panel">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-code text-left text-xs uppercase tracking-wider text-text-muted">
          <tr>
            <th className="px-4 py-3 font-semibold">{t('col_title')}</th>
            <th className="px-4 py-3 font-semibold">{t('col_slug')}</th>
            <th className="px-4 py-3 font-semibold">{t('col_status')}</th>
            <th className="px-4 py-3 font-semibold">{t('col_lessons')}</th>
            <th className="px-4 py-3 font-semibold">{t('col_pricing')}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => (
            <tr key={c.id} className="border-t border-border transition-colors hover:bg-code">
              <td className="px-4 py-3 font-medium text-text">{c.title}</td>
              <td className="px-4 py-3 font-mono text-xs text-text-muted">{c.slug}</td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
                    c.status === 'published'
                      ? 'bg-accent/15 text-accent'
                      : c.status === 'archived'
                        ? 'bg-code text-text-muted'
                        : 'bg-code text-text-muted'
                  }`}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </td>
              <td className="px-4 py-3 text-text-muted">{c.lesson_count}</td>
              <td className="px-4 py-3 text-text-muted">
                {c.pricing_model === 'free' ? t('free') : `${c.price_cents ?? 0}`}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/studio/courses/${c.id}` as never}
                  className="text-sm font-semibold text-accent hover:text-accent-hover"
                >
                  {t('edit')} →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
