'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { Link, useRouter } from '@/lib/i18n/routing';
import { OAuthButtons } from '@/components/auth/OAuthButtons';

export default function LoginPage() {
  const t = useTranslations('auth.login');
  const tErr = useTranslations('auth.errors');
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.login({ email, password });
      // TODO P1.1: move tokens to HttpOnly cookie via a Next Route Handler.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('lms-access', res.tokens.access_token);
        sessionStorage.setItem('lms-refresh', res.tokens.refresh_token);
      }
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        const code = err.code as Parameters<typeof tErr>[0];
        setError(tErr.has(code) ? tErr(code) : err.message);
      } else {
        setError(tErr('network'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6 py-10">
      <form onSubmit={onSubmit} className="card w-full">
        <h1 className="mb-6 text-2xl font-bold">{t('title')}</h1>

        <label className="mb-2 block text-sm font-medium">{t('email')}</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mb-4"
        />

        <label className="mb-2 block text-sm font-medium">{t('password')}</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mb-6"
        />

        {error ? (
          <p className="mb-4 text-sm" style={{ color: '#ff6b6b' }}>
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn w-full justify-center" disabled={loading}>
          {loading ? '…' : t('submit')}
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-text-muted">
          <div className="h-px flex-1 bg-border" />
          <span>{t('or')}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <OAuthButtons intent="login" />

        <p className="mt-6 text-center text-sm text-text-muted">
          {t('no_account')}{' '}
          <Link href="/register" className="text-accent hover:text-accent-hover">
            {t('register_here')}
          </Link>
        </p>
      </form>
    </main>
  );
}
