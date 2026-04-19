import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/lib/i18n/routing';
import { ThemePicker } from '@/components/ThemePicker';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tHome = await getTranslations('home');
  const tBrand = await getTranslations('brand');
  const tNav = await getTranslations('nav');

  return (
    <main className="mx-auto max-w-6xl px-8 py-10">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-box bg-accent font-bold text-panel shadow-soft">
            K
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">{tBrand('name')}</div>
            <div className="-mt-0.5 text-xs text-text-muted">{tBrand('tagline')}</div>
          </div>
        </div>

        <nav className="flex items-center gap-3">
          <ThemePicker />
          <Link href="/login" className="btn btn-secondary">
            {tNav('login')}
          </Link>
          <Link href="/register" className="btn">
            {tNav('register')}
          </Link>
        </nav>
      </header>

      <section className="card mx-auto max-w-3xl text-center">
        <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">{tHome('title')}</h1>
        <p className="mx-auto mb-8 max-w-xl text-base text-text-muted md:text-lg">
          {tHome('subtitle')}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/register" className="btn">
            {tHome('cta_primary')}
          </Link>
          <a
            href="/bento.html"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            {tHome('cta_secondary')}
          </a>
        </div>
      </section>
    </main>
  );
}
