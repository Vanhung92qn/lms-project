import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TopHeader } from '@/components/header/TopHeader';
import { Link } from '@/lib/i18n/routing';

// Cinematic home: the only surface that bypasses ClientLayout. Fullscreen
// looping video backs the hero; <TopHeader variant="glass"/> overlays; text
// uses Instrument Serif for the display treatment. No decorative blobs,
// radial gradients or overlays — the video carries the visual depth.

const VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('hero');

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden bg-[hsl(201,100%,13%)]"
      style={{ fontFamily: "var(--font-body, 'Inter', sans-serif)" }}
    >
      {/* Fullscreen looping background */}
      <video
        className="absolute inset-0 z-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>

      {/* Slight dim for text contrast */}
      <div className="absolute inset-0 z-[1] bg-black/25" aria-hidden="true" />

      {/* Glass nav */}
      <TopHeader variant="glass" />

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center px-6 py-[90px] pb-40 pt-32 text-center">
        <h1
          className="animate-fade-rise max-w-7xl text-5xl font-normal leading-[0.95] tracking-[-2.46px] text-white sm:text-7xl md:text-8xl"
          style={{ fontFamily: "'Instrument Serif', serif" }}
        >
          {t('h1_before')}{' '}
          <em className="not-italic text-white/60">{t('h1_mid')}</em>{' '}
          <em className="not-italic text-white/60">{t('h1_after')}</em>
        </h1>

        <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
          {t('subtitle')}
        </p>

        <div className="animate-fade-rise-delay-2 mt-12 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/register"
            className="liquid-glass cursor-pointer rounded-full px-14 py-5 text-base font-medium text-white transition-transform hover:scale-[1.03]"
          >
            {t('cta_primary')}
          </Link>
          <a
            href="/bento.html"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-white/20 px-14 py-5 text-base font-medium text-white/80 transition-all hover:border-white/40 hover:text-white"
          >
            {t('cta_secondary')}
          </a>
        </div>
      </section>
    </div>
  );
}
