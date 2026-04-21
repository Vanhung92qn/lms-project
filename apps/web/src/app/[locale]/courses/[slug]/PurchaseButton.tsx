'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';

/**
 * Paid-course CTA — wallet-backed. Four states:
 *   - not logged in    → "Đăng nhập để mua"
 *   - already entitled → "Bắt đầu học"
 *   - balance ≥ price  → "Mua ngay · 50,000 đ" (one-click deduct)
 *   - balance < price  → "Nạp {X} đ để mua" → goes to /wallet
 *
 * No modal, no admin round-trip — the admin only sees money movement
 * (top-ups) and never gets pinged per course purchase.
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
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      /* */
    }
    setHasToken(Boolean(token));
    if (!token || enrolled) return;
    let cancelled = false;
    api.wallet
      .balance(token)
      .then((b) => {
        if (!cancelled) setBalanceCents(b.balanceCents);
      })
      .catch(() => {
        if (!cancelled) setBalanceCents(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enrolled]);

  const startLearning = () => {
    if (firstLessonId) {
      router.push(`/courses/${slug}/learn/${firstLessonId}` as never);
    } else {
      router.push('/dashboard');
    }
  };

  const buy = async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setBuying(true);
    setError(null);
    try {
      const res = await api.wallet.purchase(token, slug);
      setBalanceCents(res.remainingBalanceCents);
      onEnrolled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBuying(false);
    }
  };

  // 1. Already entitled.
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

  // 2. Not logged in.
  if (!hasToken) {
    return (
      <button
        type="button"
        onClick={() => router.push('/login')}
        className="btn w-full justify-center"
      >
        {t('login_to_purchase')}
      </button>
    );
  }

  // 3. Balance enough → one-click deduct.
  const enough = balanceCents !== null && balanceCents >= priceCents;
  const missing = balanceCents === null ? null : Math.max(0, priceCents - balanceCents);

  if (enough) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={buy}
          disabled={buying}
          className="btn w-full justify-center"
        >
          {buying ? '…' : t('buy_cta', { price: formatPrice(priceCents, currency) })}
        </button>
        <p className="text-center text-xs text-text-muted">
          {t('balance_hint', { balance: formatPrice(balanceCents ?? 0, currency) })}
        </p>
        {error ? (
          <p className="text-xs text-center" style={{ color: '#ff6b6b' }}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  // 4. Balance insufficient → link to /wallet.
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => router.push('/wallet')}
        className="btn w-full justify-center"
        style={{ background: '#f59e0b' }}
      >
        {missing !== null
          ? t('topup_cta', { missing: formatPrice(missing, currency) })
          : t('topup_cta_generic')}
      </button>
      {balanceCents !== null ? (
        <p className="text-center text-xs text-text-muted">
          {t('balance_hint', { balance: formatPrice(balanceCents, currency) })}
        </p>
      ) : null}
    </div>
  );
}

function formatPrice(cents: number, currency: string): string {
  return `${new Intl.NumberFormat('vi-VN').format(Math.round(cents / 100))} ${currency}`;
}
