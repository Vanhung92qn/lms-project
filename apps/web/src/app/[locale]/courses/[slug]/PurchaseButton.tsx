'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { api, ApiError, type PaymentDto } from '@/lib/api';

/**
 * Paid-course CTA. Four user states:
 *   - not logged in       → "Đăng nhập để mua"
 *   - already entitled    → "Bắt đầu học" (parent shows EnrollButton flow)
 *   - pending payment     → "Đang chờ duyệt" + cancel option
 *   - fresh               → "Mua khoá học" → opens modal
 *
 * The modal pulls instructions (MoMo / bank) from api-core so admin can
 * change account numbers without a redeploy.
 */
export function PurchaseButton({
  slug,
  priceCents,
  currency,
  enrolled,
  firstLessonId,
  onEnrolled,
}: {
  slug: string;
  priceCents: number;
  currency: string;
  enrolled: boolean;
  firstLessonId: string | null;
  onEnrolled: () => void;
}) {
  const t = useTranslations('catalog.purchase');
  const router = useRouter();

  const [hasToken, setHasToken] = useState(false);
  const [pending, setPending] = useState<PaymentDto | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setHasToken(Boolean(sessionStorage.getItem('lms-access')));
    } catch {
      setHasToken(false);
    }
  }, []);

  // Check for any in-flight payment on this course (pending approval).
  useEffect(() => {
    if (enrolled) return;
    const token = (() => {
      try {
        return sessionStorage.getItem('lms-access');
      } catch {
        return null;
      }
    })();
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await api.billing.myPayments(token);
        if (cancelled) return;
        const p = list.find((x) => x.courseSlug === slug && x.status === 'pending');
        setPending(p ?? null);
      } catch {
        /* non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, enrolled]);

  const startLearning = () => {
    if (firstLessonId) {
      router.push(`/courses/${slug}/learn/${firstLessonId}` as never);
    } else {
      router.push('/dashboard');
    }
  };

  // 1. Already entitled → same CTA as free-flow enroll-success state.
  if (enrolled) {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-pill border border-accent bg-accent/10 px-5 py-3 text-center text-sm font-semibold text-accent">
          ✓ {t('already_purchased')}
        </div>
        <button type="button" onClick={startLearning} className="btn w-full justify-center">
          {firstLessonId ? t('start_learning') : t('go_dashboard')}
        </button>
      </div>
    );
  }

  // 2. Pending payment → status pill + cancel.
  if (pending) {
    return (
      <PendingBadge
        payment={pending}
        onCancelled={() => setPending(null)}
      />
    );
  }

  // 3. Not logged in.
  if (!hasToken) {
    return (
      <button type="button" onClick={() => router.push('/login')} className="btn w-full justify-center">
        {t('login_to_purchase')}
      </button>
    );
  }

  // 4. Fresh state — open modal.
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn w-full justify-center">
        {t('buy_cta', { price: formatPrice(priceCents, currency) })}
      </button>
      {open ? (
        <PurchaseModal
          slug={slug}
          priceCents={priceCents}
          currency={currency}
          onClose={() => setOpen(false)}
          onCreated={(p) => {
            setPending(p);
            setOpen(false);
            onEnrolled(); // signal parent to refresh enrollment state (noop if pending)
          }}
        />
      ) : null}
    </>
  );
}

function PendingBadge({
  payment,
  onCancelled,
}: {
  payment: PaymentDto;
  onCancelled: () => void;
}) {
  const t = useTranslations('catalog.purchase');
  const [loading, setLoading] = useState(false);

  const onCancel = async () => {
    if (!window.confirm(t('confirm_cancel'))) return;
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      /* */
    }
    if (!token) return;
    setLoading(true);
    try {
      await api.billing.cancelPayment(token, payment.id);
      onCancelled();
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className="rounded-box border px-4 py-3 text-center text-sm"
        style={{ borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)' }}
      >
        <p className="font-semibold" style={{ color: '#f59e0b' }}>
          ⏳ {t('pending_title')}
        </p>
        <p className="mt-1 text-xs text-text-muted">{t('pending_body')}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        className="rounded-pill border border-border px-4 py-2 text-xs text-text-muted transition-colors hover:text-text"
      >
        {loading ? '…' : t('cancel_payment')}
      </button>
    </div>
  );
}

function PurchaseModal({
  slug,
  priceCents,
  currency,
  onClose,
  onCreated,
}: {
  slug: string;
  priceCents: number;
  currency: string;
  onClose: () => void;
  onCreated: (p: PaymentDto) => void;
}) {
  const t = useTranslations('catalog.purchase');
  const [instructions, setInstructions] = useState<{
    momo: { phone: string; holder: string; qrUrl: string };
    bank: { name: string; account: string; holder: string };
  } | null>(null);
  const [method, setMethod] = useState<'momo' | 'bank'>('momo');
  const [userNote, setUserNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.billing
      .instructions()
      .then((data) => {
        if (!cancelled) setInstructions(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load payment instructions.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!userNote.trim()) {
      setError(t('note_required'));
      return;
    }
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      /* */
    }
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const payment = await api.billing.createPayment(token, {
        course_slug: slug,
        method,
        user_note: userNote.trim(),
      });
      onCreated(payment);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('submit_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold text-text">{t('modal_title')}</h3>
        <p className="mb-4 text-sm text-text-muted">{t('modal_subtitle')}</p>

        <div className="mb-4 rounded-box bg-code p-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-text-muted">{t('amount_due')}</span>
            <span className="text-lg font-bold text-text">
              {formatPrice(priceCents, currency)}
            </span>
          </div>
        </div>

        {/* Method tabs */}
        <div role="tablist" className="mb-3 flex gap-1 rounded-pill bg-code p-1">
          <MethodTab active={method === 'momo'} onClick={() => setMethod('momo')} label="MoMo" />
          <MethodTab active={method === 'bank'} onClick={() => setMethod('bank')} label={t('bank_transfer')} />
        </div>

        {/* Instructions panel */}
        {instructions ? (
          <div className="mb-4 rounded-box bg-code p-3 text-sm">
            {method === 'momo' ? (
              <>
                {instructions.momo.qrUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={instructions.momo.qrUrl}
                    alt="MoMo QR"
                    className="mx-auto mb-3 h-40 w-40 rounded-box bg-panel p-2 object-contain"
                  />
                ) : null}
                <InfoRow label={t('momo_phone')} value={instructions.momo.phone} />
                <InfoRow label={t('holder')} value={instructions.momo.holder} />
              </>
            ) : (
              <>
                <InfoRow label={t('bank_name')} value={instructions.bank.name} />
                <InfoRow label={t('bank_account')} value={instructions.bank.account} />
                <InfoRow label={t('holder')} value={instructions.bank.holder} />
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-muted">…</p>
        )}

        <p className="mb-2 text-xs text-text-muted">{t('transfer_note_hint')}</p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text">
              {t('note_label')}
            </label>
            <textarea
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder={t('note_placeholder')}
              required
              rows={3}
              className="input w-full resize-none text-sm"
            />
          </div>
          {error ? (
            <p className="text-xs" style={{ color: '#ff6b6b' }}>
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill border border-border px-4 py-2 text-xs text-text-muted hover:text-text"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !userNote.trim()}
              className="rounded-pill bg-accent px-4 py-2 text-xs font-semibold text-panel transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {submitting ? '…' : t('submit_cta')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MethodTab({
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-panel text-text shadow-soft' : 'text-text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="font-mono text-sm text-text">{value || '—'}</span>
    </div>
  );
}

function formatPrice(cents: number, currency: string): string {
  return `${new Intl.NumberFormat('vi-VN').format(cents / 100)} ${currency}`;
}
