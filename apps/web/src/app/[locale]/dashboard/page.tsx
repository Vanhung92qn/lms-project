import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/lib/i18n/routing';

/**
 * Placeholder dashboard that only verifies the i18n + routing wiring.
 * Real content lands in P5 (progress, KG, recommendations).
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('dashboard');

  return (
    <main className="mx-auto max-w-4xl px-8 py-10">
      <div className="card">
        <h1 className="mb-2 text-3xl font-bold">{t('welcome', { name: 'student' })}</h1>
        <p className="mb-6 text-text-muted">
          This is a placeholder dashboard. Progress, recommendations, and the
          interactive workspace land in P3 and P5.
        </p>
        <Link href="/" className="btn">
          {t('continue')}
        </Link>
      </div>
    </main>
  );
}
