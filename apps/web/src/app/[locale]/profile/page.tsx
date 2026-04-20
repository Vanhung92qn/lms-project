'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/Avatar';

// Self-service profile editor. Reads from SessionProvider, writes via
// PATCH /api/v1/me (wrapped by session.updateProfile). On success the
// SessionProvider updates in place, so the UserMenu avatar refreshes
// instantly.
export default function ProfilePage() {
  const t = useTranslations('profile');
  const router = useRouter();
  const { user, isLoading, updateProfile, logout } = useSession();

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [locale, setLocale] = useState<'vi' | 'en'>('vi');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name);
    setAvatarUrl(user.avatar_url ?? '');
    setLocale(user.locale);
  }, [user]);

  if (isLoading || !user) {
    return (
      <main className="mx-auto max-w-[720px] px-6 py-10">
        <div className="card text-center text-text-muted">…</div>
      </main>
    );
  }

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({
        display_name: displayName,
        locale,
        avatar_url: avatarUrl, // '' → clears
      });
      setMessage({ kind: 'ok', text: t('save_success') });
    } catch (err) {
      setMessage({ kind: 'err', text: (err as Error).message || t('save_failed') });
    } finally {
      setSaving(false);
    }
  };

  const onLogout = async () => {
    await logout();
    router.push('/');
  };

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text">{t('title')}</h1>
          <p className="mt-1 text-text-muted">{t('subtitle')}</p>
        </div>
        <button type="button" onClick={onLogout} className="btn btn-secondary">
          {t('logout')}
        </button>
      </header>

      <form onSubmit={onSubmit} className="card flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar user={{ ...user, display_name: displayName || user.display_name, avatar_url: avatarUrl }} size={72} />
          <div className="min-w-0">
            <p className="truncate text-sm text-text-muted">{t('email_label')}</p>
            <p className="truncate text-base font-semibold text-text">{user.email}</p>
            <p className="mt-1 text-xs text-text-muted">
              {t('roles')}: {user.roles.join(', ')}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="p-display-name" className="mb-1 block text-sm font-medium text-text">
            {t('display_name')}
          </label>
          <input
            id="p-display-name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
            minLength={2}
            className="input"
          />
        </div>

        <div>
          <label htmlFor="p-avatar" className="mb-1 block text-sm font-medium text-text">
            {t('avatar_url')}
          </label>
          <input
            id="p-avatar"
            type="url"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            maxLength={500}
            className="input"
          />
          <p className="mt-1 text-xs text-text-muted">{t('avatar_hint')}</p>
        </div>

        <div>
          <label htmlFor="p-locale" className="mb-1 block text-sm font-medium text-text">
            {t('locale')}
          </label>
          <div className="flex gap-2">
            {(['vi', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={locale === l}
                className={`rounded-pill border px-4 py-2 text-sm font-medium transition-all ${
                  locale === l
                    ? 'border-accent bg-accent text-panel'
                    : 'border-border bg-code text-text-muted hover:text-text'
                }`}
              >
                {l === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
              </button>
            ))}
          </div>
        </div>

        {message ? (
          <p
            className="text-sm"
            style={{ color: message.kind === 'ok' ? 'var(--accent)' : '#ff6b6b' }}
          >
            {message.text}
          </p>
        ) : null}

        <button type="submit" disabled={saving} className="btn w-fit justify-center">
          {saving ? '…' : t('save')}
        </button>
      </form>
    </main>
  );
}
