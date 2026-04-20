'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';

// Create-course form. Backend auto-assigns status=draft; teacher publishes
// later from the edit page once curriculum is in place.

export default function NewCoursePage() {
  const t = useTranslations('studio.new_course');
  const tCommon = useTranslations('studio');
  const router = useRouter();

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locale, setLocale] = useState<'vi' | 'en'>('vi');
  const [pricingModel, setPricingModel] = useState<'free' | 'paid'>('free');
  const [priceCents, setPriceCents] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = sessionStorage.getItem('lms-access');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await api.teacher.create(token, {
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        locale,
        pricing_model: pricingModel,
        price_cents: pricingModel === 'paid' && priceCents ? Number(priceCents) : undefined,
        currency: pricingModel === 'paid' ? 'VND' : undefined,
      });
      router.push(`/studio/courses/${res.id}` as never);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-text">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <form onSubmit={onSubmit} className="card flex flex-col gap-5">
        <div>
          <label htmlFor="c-title" className="mb-1 block text-sm font-medium text-text">
            {t('title_label')}
          </label>
          <input
            id="c-title"
            required
            maxLength={140}
            minLength={3}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label htmlFor="c-slug" className="mb-1 block text-sm font-medium text-text">
            {t('slug_label')}
          </label>
          <input
            id="c-slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
            minLength={3}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="cpp-advanced"
            className="input font-mono"
          />
          <p className="mt-1 text-xs text-text-muted">{t('slug_hint')}</p>
        </div>

        <div>
          <label htmlFor="c-desc" className="mb-1 block text-sm font-medium text-text">
            {t('description_label')}
          </label>
          <textarea
            id="c-desc"
            rows={4}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input !rounded-box"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-text">{tCommon('col_status')}</label>
          <p className="text-xs text-text-muted">{t('status_hint')}</p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-text">{t('locale_label')}</label>
          <div className="flex gap-2">
            {(['vi', 'en'] as const).map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setLocale(l)}
                aria-pressed={locale === l}
                className={`rounded-pill border px-4 py-2 text-sm transition-all ${
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

        <div>
          <label className="mb-2 block text-sm font-medium text-text">{t('pricing_label')}</label>
          <div className="flex gap-2">
            {(['free', 'paid'] as const).map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setPricingModel(p)}
                aria-pressed={pricingModel === p}
                className={`rounded-pill border px-4 py-2 text-sm transition-all ${
                  pricingModel === p
                    ? 'border-accent bg-accent text-panel'
                    : 'border-border bg-code text-text-muted hover:text-text'
                }`}
              >
                {p === 'free' ? tCommon('free') : tCommon('paid')}
              </button>
            ))}
          </div>
        </div>

        {pricingModel === 'paid' ? (
          <div>
            <label htmlFor="c-price" className="mb-1 block text-sm font-medium text-text">
              {t('price_label')}
            </label>
            <input
              id="c-price"
              type="number"
              min="0"
              value={priceCents}
              onChange={(e) => setPriceCents(e.target.value)}
              placeholder="49000"
              className="input"
            />
            <p className="mt-1 text-xs text-text-muted">{t('price_hint')}</p>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm" style={{ color: '#ff6b6b' }}>
            {error}
          </p>
        ) : null}

        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="btn">
            {saving ? '…' : t('create')}
          </button>
          <button
            type="button"
            onClick={() => router.push('/studio')}
            className="btn btn-secondary"
          >
            {tCommon('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
