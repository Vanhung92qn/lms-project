'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { useSession } from '@/lib/session';
import { api, ApiError, type PaymentDto } from '@/lib/api';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

/**
 * Admin-only payments console. Filter by status, inspect the user's
 * note (MoMo txn ref / timestamp / screenshot URL), and approve or
 * reject with an admin note. Approval automatically grants the
 * entitlement and enrols the student in the course — see
 * apps/api-core/src/modules/billing/billing.service.ts.
 */
export default function AdminPaymentsPage() {
  const { user, isLoading } = useSession();
  return (
    <AdminLayout>
      {isLoading ? null : !user?.roles.includes('admin') ? (
        <ForbiddenState />
      ) : (
        <PaymentsConsole />
      )}
    </AdminLayout>
  );
}

function ForbiddenState() {
  const t = useTranslations('admin.payments');
  return (
    <main className="grid min-h-[50vh] place-items-center p-6">
      <p className="text-text-muted">{t('admin_only')}</p>
    </main>
  );
}

function PaymentsConsole() {
  const t = useTranslations('admin.payments');
  const [status, setStatus] = useState<Status>('pending');
  const [rows, setRows] = useState<PaymentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      token = null;
    }
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await api.billing.admin.list(token, status));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <StatusFilter current={status} onChange={setStatus} />
      </header>

      {error ? (
        <div className="card text-center" style={{ color: '#ff6b6b' }}>
          {error}
        </div>
      ) : loading ? (
        <div className="card text-center text-text-muted">…</div>
      ) : rows.length === 0 ? (
        <div className="card text-center text-text-muted">{t('empty')}</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-code text-left text-[11px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-2">{t('col_user')}</th>
                <th className="px-4 py-2">{t('col_course')}</th>
                <th className="px-4 py-2">{t('col_amount')}</th>
                <th className="px-4 py-2">{t('col_method')}</th>
                <th className="px-4 py-2">{t('col_note')}</th>
                <th className="px-4 py-2">{t('col_created_at')}</th>
                <th className="px-4 py-2">{t('col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <PaymentRow key={p.id} payment={p} onChanged={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function StatusFilter({
  current,
  onChange,
}: {
  current: Status;
  onChange: (s: Status) => void;
}) {
  const t = useTranslations('admin.payments.status');
  const statuses: Status[] = ['pending', 'approved', 'rejected', 'cancelled'];
  return (
    <div role="tablist" className="flex gap-1 rounded-pill bg-code p-1">
      {statuses.map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={current === s}
          onClick={() => onChange(s)}
          className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${
            current === s ? 'bg-panel text-text shadow-soft' : 'text-text-muted hover:text-text'
          }`}
        >
          {t(s)}
        </button>
      ))}
    </div>
  );
}

function PaymentRow({
  payment,
  onChanged,
}: {
  payment: PaymentDto;
  onChanged: () => void;
}) {
  const t = useTranslations('admin.payments');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const token = () => {
    try {
      return sessionStorage.getItem('lms-access');
    } catch {
      return null;
    }
  };

  const approve = async () => {
    const tok = token();
    if (!tok) return;
    if (!window.confirm(t('confirm_approve'))) return;
    setBusy('approve');
    try {
      await api.billing.admin.approve(tok, payment.id);
      onChanged();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    const tok = token();
    if (!tok) return;
    const note = rejectNote.trim() || t('default_reject_note');
    setBusy('reject');
    try {
      await api.billing.admin.reject(tok, payment.id, note);
      onChanged();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(null);
      setRejecting(false);
    }
  };

  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-4 py-3">
          <div className="font-semibold text-text">{payment.userDisplayName}</div>
          <div className="text-xs text-text-muted">{payment.userEmail}</div>
        </td>
        <td className="px-4 py-3">
          <div className="font-mono text-xs text-text">{payment.courseSlug}</div>
          <div className="text-xs text-text-muted">{payment.courseTitle}</div>
        </td>
        <td className="px-4 py-3 font-mono text-sm tabular-nums text-text">
          {new Intl.NumberFormat('vi-VN').format(payment.amountCents / 100)} {payment.currency}
        </td>
        <td className="px-4 py-3">
          <span className="rounded-pill border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
            {payment.method}
          </span>
        </td>
        <td className="max-w-[240px] px-4 py-3">
          <div className="whitespace-pre-wrap break-words text-xs text-text-muted">
            {payment.userNote || '—'}
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-text-muted">
          {new Date(payment.createdAt).toLocaleString('vi-VN')}
        </td>
        <td className="px-4 py-3">
          {payment.status === 'pending' ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={approve}
                disabled={busy !== null}
                className="rounded-pill bg-accent px-3 py-1 text-[11px] font-semibold text-panel transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {busy === 'approve' ? '…' : t('approve')}
              </button>
              <button
                type="button"
                onClick={() => setRejecting((v) => !v)}
                disabled={busy !== null}
                className="rounded-pill border border-border px-3 py-1 text-[11px] text-text-muted hover:text-text"
              >
                {rejecting ? t('cancel') : t('reject')}
              </button>
            </div>
          ) : (
            <StatusBadge status={payment.status} />
          )}
        </td>
      </tr>
      {rejecting ? (
        <tr className="bg-code">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder={t('reject_note_placeholder')}
                className="input flex-1 text-xs"
              />
              <button
                type="button"
                onClick={reject}
                disabled={busy !== null}
                className="rounded-pill px-3 py-1 text-[11px] font-semibold text-panel transition-colors disabled:opacity-50"
                style={{ background: '#ef4444' }}
              >
                {busy === 'reject' ? '…' : t('confirm_reject')}
              </button>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const t = useTranslations('admin.payments.status');
  const palette: Record<Status, { bg: string; fg: string }> = {
    pending: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
    approved: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
    rejected: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    cancelled: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
  };
  const c = palette[status];
  return (
    <span
      className="rounded-pill px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: c.bg, color: c.fg }}
    >
      {t(status)}
    </span>
  );
}
