'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';

type User = Awaited<ReturnType<typeof api.admin.listUsers>>[number];
type Status = 'active' | 'locked' | 'pending';
type Role = 'student' | 'teacher' | 'admin' | 'ai_engine';

/**
 * Admin user-management console.
 *   - Search by email / display name.
 *   - Filter by role / status.
 *   - Lock or unlock with one click. Locking also revokes every active
 *     refresh token on the server side so the session can't outlive the
 *     block.
 */
export default function AdminUsersPage() {
  const { user, isLoading } = useSession();
  return (
    <AdminLayout>
      {isLoading ? null : !user?.roles.includes('admin') ? (
        <ForbiddenState />
      ) : (
        <UsersConsole />
      )}
    </AdminLayout>
  );
}

function ForbiddenState() {
  const t = useTranslations('admin.users');
  return (
    <main className="grid min-h-[50vh] place-items-center p-6">
      <p className="text-text-muted">{t('admin_only')}</p>
    </main>
  );
}

function UsersConsole() {
  const t = useTranslations('admin.users');
  const [rows, setRows] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<Status | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setRows(
        await api.admin.listUsers(token, {
          q: q.trim() || undefined,
          role: role || undefined,
          status: status || undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, role, status]);

  useEffect(() => {
    const handle = setTimeout(refresh, 250);
    return () => clearTimeout(handle);
  }, [refresh]);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      {/* Filters */}
      <div className="card mb-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search_placeholder')}
          className="input flex-1 min-w-[240px] text-sm"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role | '')}
          className="input text-sm"
        >
          <option value="">{t('all_roles')}</option>
          <option value="student">student</option>
          <option value="teacher">teacher</option>
          <option value="admin">admin</option>
          <option value="ai_engine">ai_engine</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | '')}
          className="input text-sm"
        >
          <option value="">{t('all_statuses')}</option>
          <option value="active">active</option>
          <option value="locked">locked</option>
          <option value="pending">pending</option>
        </select>
      </div>

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
                <th className="px-4 py-2">{t('col_roles')}</th>
                <th className="px-4 py-2">{t('col_balance')}</th>
                <th className="px-4 py-2">{t('col_status')}</th>
                <th className="px-4 py-2">{t('col_joined')}</th>
                <th className="px-4 py-2">{t('col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <UserRow key={u.id} user={u} onChanged={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function UserRow({ user, onChanged }: { user: User; onChanged: () => void }) {
  const t = useTranslations('admin.users');
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next: 'active' | 'locked' = user.status === 'locked' ? 'active' : 'locked';
    if (next === 'locked' && !window.confirm(t('confirm_lock', { email: user.email }))) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setBusy(true);
    try {
      await api.admin.setUserStatus(token, user.id, next);
      onChanged();
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-3">
        <div className="font-semibold text-text">{user.displayName}</div>
        <div className="text-xs text-text-muted">{user.email}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {user.roles.map((r) => (
            <span
              key={r}
              className="rounded-pill bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent"
            >
              {r}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-sm tabular-nums text-text">
        {new Intl.NumberFormat('vi-VN').format(Math.round(user.walletBalanceCents / 100))} đ
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={user.status} />
      </td>
      <td className="px-4 py-3 text-xs text-text-muted">
        {new Date(user.createdAt).toLocaleDateString('vi-VN')}
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          disabled={busy || user.roles.includes('admin')}
          className={`rounded-pill px-3 py-1 text-[11px] font-semibold transition-colors disabled:opacity-30 ${
            user.status === 'locked'
              ? 'bg-accent text-panel hover:bg-accent-hover'
              : 'border border-border text-text-muted hover:border-text hover:text-text'
          }`}
          title={user.roles.includes('admin') ? t('cannot_lock_admin') : undefined}
        >
          {busy ? '…' : user.status === 'locked' ? t('unlock') : t('lock')}
        </button>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const palette: Record<Status, { bg: string; fg: string }> = {
    active: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
    locked: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    pending: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
  };
  const c = palette[status];
  return (
    <span
      className="rounded-pill px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: c.bg, color: c.fg }}
    >
      {status}
    </span>
  );
}
