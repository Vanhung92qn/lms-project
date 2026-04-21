'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';

type Metrics = Awaited<ReturnType<typeof api.admin.metrics>>;

/**
 * Admin overview — platform health in one glance. Five card groups:
 *   - Users (total + by role + locked)
 *   - Courses (published/draft, free/paid)
 *   - Engagement (submissions total + AC + last 7d)
 *   - Revenue (approved topups total)
 *   - Liability (sum of all student wallet balances — what we owe if everyone refunded)
 */
export default function AdminOverviewPage() {
  const { user, isLoading } = useSession();
  return (
    <AdminLayout>
      {isLoading ? null : !user?.roles.includes('admin') ? (
        <ForbiddenState />
      ) : (
        <OverviewCards />
      )}
    </AdminLayout>
  );
}

function ForbiddenState() {
  const t = useTranslations('admin.overview');
  return (
    <main className="grid min-h-[50vh] place-items-center p-6">
      <p className="text-text-muted">{t('admin_only')}</p>
    </main>
  );
}

function OverviewCards() {
  const t = useTranslations('admin.overview');
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    api.admin
      .metrics(token)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : (e as Error).message));
  }, []);

  if (error) {
    return (
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="card text-center" style={{ color: '#ff6b6b' }}>
          {error}
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="card text-center text-text-muted">…</div>
      </main>
    );
  }

  const acRate =
    data.submissions.total === 0
      ? 0
      : Math.round((data.submissions.ac / data.submissions.total) * 100);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={t('users_total')}
          value={data.users.total.toString()}
          sub={t('users_breakdown', {
            active: data.users.active,
            locked: data.users.locked,
          })}
        />
        <MetricCard
          label={t('courses_published')}
          value={data.courses.published.toString()}
          sub={t('courses_breakdown', {
            total: data.courses.total,
            free: data.courses.freeCount,
            paid: data.courses.paidCount,
          })}
        />
        <MetricCard
          label={t('submissions_total')}
          value={data.submissions.total.toString()}
          sub={t('submissions_breakdown', { ac: data.submissions.ac, pct: acRate, last7d: data.submissions.last7d })}
        />
        <MetricCard
          label={t('revenue_total')}
          value={formatVnd(data.revenue.approvedTopupCents)}
          sub={t('revenue_breakdown', {
            count: data.revenue.approvedTopupCount,
            pending: formatVnd(data.revenue.pendingTopupCents),
          })}
          accent
        />
      </div>

      {/* Secondary — role breakdown + wallet liability */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
            {t('roles_title')}
          </h2>
          <ul className="flex flex-col gap-2">
            {Object.entries(data.users.byRole).map(([role, count]) => (
              <li key={role} className="flex items-center justify-between text-sm">
                <span className="text-text-muted">{role}</span>
                <span className="font-mono tabular-nums text-text">{count}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted">
            {t('wallet_title')}
          </h2>
          <p className="text-3xl font-bold text-text">{formatVnd(data.revenue.walletLiabilityCents)}</p>
          <p className="mt-2 text-xs text-text-muted">{t('wallet_caption')}</p>
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`card ${accent ? 'border border-accent/30' : ''}`}
      style={accent ? { background: 'rgba(var(--accent-rgb, 16,185,129),0.05)' } : undefined}
    >
      <p className="text-xs uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${accent ? 'text-accent' : 'text-text'}`}>
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-text-muted">{sub}</p> : null}
    </div>
  );
}

function formatVnd(cents: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(Math.round(cents / 100))} đ`;
}
