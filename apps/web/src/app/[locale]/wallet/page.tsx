'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { useSession } from '@/lib/session';
import {
  api,
  ApiError,
  type WalletBalanceDto,
  type WalletTopupDto,
  type WalletInstructionsDto,
  type TopupMethod,
  type TopupStatus,
} from '@/lib/api';

/**
 * Student wallet page. Three responsibilities:
 *   1. Show current balance.
 *   2. Host the top-up form (amount + method + optional note).
 *   3. Show pending / historical top-ups with their reference codes
 *      and QR images so the student can come back later to transfer.
 *
 * The page is client-only because balance + topup state change
 * on user action and don't need to be indexed by search engines.
 */
export default function WalletPage() {
  const { user, isLoading } = useSession();
  const router = useRouter();
  const t = useTranslations('wallet');

  const [balance, setBalance] = useState<WalletBalanceDto | null>(null);
  const [topups, setTopups] = useState<WalletTopupDto[]>([]);
  const [instructions, setInstructions] = useState<WalletInstructionsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const refresh = useCallback(async () => {
    const token = (() => {
      try {
        return sessionStorage.getItem('lms-access');
      } catch {
        return null;
      }
    })();
    if (!token) return;
    try {
      const [b, list] = await Promise.all([
        api.wallet.balance(token),
        api.wallet.myTopups(token),
      ]);
      setBalance(b);
      setTopups(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    void refresh();
    void api.wallet.instructions().then(setInstructions).catch(() => {
      /* non-critical */
    });
  }, [isLoading, user, router, refresh]);

  if (isLoading || !user) {
    return (
      <main className="grid min-h-[50vh] place-items-center text-text-muted">…</main>
    );
  }

  return (
    <main className="mx-auto max-w-[900px] px-6 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-text">{t('title')}</h1>
        <p className="mt-2 text-text-muted">{t('subtitle')}</p>
      </header>

      {/* Balance card */}
      <section className="card mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-muted">{t('balance_label')}</p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-text">
            {balance ? formatVnd(balance.balanceCents) : '…'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="btn"
        >
          {formOpen ? t('hide_form') : `+ ${t('topup_cta')}`}
        </button>
      </section>

      {error ? (
        <div className="card mb-6 text-center" style={{ color: '#ff6b6b' }}>
          {error}
        </div>
      ) : null}

      {formOpen ? (
        <TopupForm
          instructions={instructions}
          onCreated={(t) => {
            setTopups((prev) => [t, ...prev]);
            setFormOpen(false);
          }}
        />
      ) : null}

      {/* Topup history */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-text">{t('history_title')}</h2>
        {topups.length === 0 ? (
          <div className="card text-center text-text-muted">{t('history_empty')}</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {topups.map((t) => (
              <TopupCard key={t.id} topup={t} onCancelled={refresh} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function TopupForm({
  instructions,
  onCreated,
}: {
  instructions: WalletInstructionsDto | null;
  onCreated: (t: WalletTopupDto) => void;
}) {
  const t = useTranslations('wallet.form');
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<TopupMethod>('bank');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = [50_000, 100_000, 200_000, 500_000]; // VND

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!amount || amount < 10_000) {
      setError(t('amount_too_small'));
      return;
    }
    const token = (() => {
      try {
        return sessionStorage.getItem('lms-access');
      } catch {
        return null;
      }
    })();
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.wallet.createTopup(token, {
        amount_cents: amount * 100,
        method,
        user_note: note.trim() || undefined,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('submit_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="card mb-6 flex flex-col gap-4">
      <h3 className="text-base font-semibold text-text">{t('title')}</h3>

      {/* Quick amount presets */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text">{t('amount_label')}</label>
        <div className="mb-2 flex flex-wrap gap-2">
          {presets.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(v)}
              className={`rounded-pill border px-3 py-1 text-xs transition-colors ${
                amount === v
                  ? 'border-accent bg-accent text-panel'
                  : 'border-border text-text-muted hover:border-text hover:text-text'
              }`}
            >
              {new Intl.NumberFormat('vi-VN').format(v)} đ
            </button>
          ))}
        </div>
        <input
          type="number"
          min={10_000}
          step={1_000}
          value={amount}
          onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
          placeholder={t('amount_placeholder')}
          className="input w-full"
          required
        />
      </div>

      {/* Method */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text">{t('method_label')}</label>
        <div className="flex gap-2">
          <MethodButton
            active={method === 'bank'}
            onClick={() => setMethod('bank')}
            label={t('method_bank')}
          />
          <MethodButton
            active={method === 'momo'}
            onClick={() => setMethod('momo')}
            label="MoMo"
          />
        </div>
      </div>

      {/* Hint */}
      <p className="text-xs text-text-muted">{t('hint')}</p>

      {/* Note */}
      <div>
        <label className="mb-1 block text-xs font-medium text-text">{t('note_label')}</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('note_placeholder')}
          className="input w-full text-sm"
          maxLength={500}
        />
      </div>

      {error ? (
        <p className="text-xs" style={{ color: '#ff6b6b' }}>
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || !amount || (typeof amount === 'number' && amount < 10_000)}
          className="rounded-pill bg-accent px-5 py-2 text-sm font-semibold text-panel transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? '…' : t('submit_cta')}
        </button>
      </div>

      {/* Instructions preview */}
      {instructions ? <InstructionsPreview instructions={instructions} method={method} /> : null}
    </form>
  );
}

function InstructionsPreview({
  instructions,
  method,
}: {
  instructions: WalletInstructionsDto;
  method: TopupMethod;
}) {
  const t = useTranslations('wallet.instructions');
  return (
    <div className="mt-2 rounded-box bg-code p-3 text-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {t('destination')}
      </p>
      {method === 'momo' ? (
        <>
          <InfoRow label={t('momo_phone')} value={instructions.momo.phone || '—'} />
          <InfoRow label={t('holder')} value={instructions.momo.holder || '—'} />
        </>
      ) : (
        <>
          <InfoRow label={t('bank_name')} value={instructions.bank.name || '—'} />
          <InfoRow label={t('bank_account')} value={instructions.bank.account || '—'} />
          <InfoRow label={t('holder')} value={instructions.bank.holder || '—'} />
        </>
      )}
    </div>
  );
}

function TopupCard({
  topup,
  onCancelled,
}: {
  topup: WalletTopupDto;
  onCancelled: () => void;
}) {
  const t = useTranslations('wallet');
  const tStatus = useTranslations('wallet.status');

  const [cancelling, setCancelling] = useState(false);

  const onCancel = async () => {
    if (!window.confirm(t('confirm_cancel'))) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setCancelling(true);
    try {
      await api.wallet.cancelTopup(token, topup.id);
      onCancelled();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <li className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-text-muted">
            {new Date(topup.createdAt).toLocaleString('vi-VN')}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-text">
            {formatVnd(topup.amountCents)}
          </p>
          <p className="mt-1 font-mono text-xs text-text-muted">
            {t('ref_label')}: <span className="text-accent">{topup.referenceCode}</span>
          </p>
        </div>
        <StatusBadge status={topup.status} label={tStatus(topup.status)} />
      </div>

      {topup.status === 'pending' && topup.method === 'bank' && topup.qrImageUrl ? (
        <div className="rounded-box border border-border bg-code p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t('scan_to_pay')}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={topup.qrImageUrl}
            alt="VietQR"
            className="mx-auto h-64 w-64 rounded-box object-contain"
          />
          <p className="mt-2 text-center text-xs text-text-muted">{t('auto_fill_hint')}</p>
        </div>
      ) : null}

      {topup.status === 'pending' && topup.method === 'momo' ? (
        <p className="text-xs text-text-muted">{t('momo_manual_hint', { ref: topup.referenceCode })}</p>
      ) : null}

      {topup.adminNote ? (
        <div className="rounded-box bg-code p-3 text-xs">
          <p className="font-semibold text-text-muted">{t('admin_note')}</p>
          <p className="mt-1 text-text">{topup.adminNote}</p>
        </div>
      ) : null}

      {topup.status === 'pending' ? (
        <div>
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="rounded-pill border border-border px-3 py-1 text-xs text-text-muted hover:text-text"
          >
            {cancelling ? '…' : t('cancel')}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function MethodButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-pill border px-4 py-2 text-sm font-semibold transition-colors ${
        active ? 'border-accent bg-accent text-panel' : 'border-border text-text-muted hover:border-text hover:text-text'
      }`}
    >
      {label}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="font-mono text-sm text-text">{value}</span>
    </div>
  );
}

function StatusBadge({ status, label }: { status: TopupStatus; label: string }) {
  const palette: Record<TopupStatus, { bg: string; fg: string }> = {
    pending: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
    approved: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e' },
    rejected: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444' },
    cancelled: { bg: 'rgba(148,163,184,0.15)', fg: '#94a3b8' },
  };
  const c = palette[status];
  return (
    <span
      className="shrink-0 rounded-pill px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: c.bg, color: c.fg }}
    >
      {label}
    </span>
  );
}

function formatVnd(cents: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(Math.round(cents / 100))} đ`;
}
