'use client';

// Minimalist, bento-aligned hero. Flipped CloudFront background video fades
// to white via a two-stop gradient, leaving generous white space for a
// typographic headline (Geist medium 80 px with an Instrument Serif italic
// emphasis word at 100 px), a calm description, an email → CTA capture,
// and a lightweight social-proof bar. Motion staggers the entrance so the
// page feels intentional.

import { motion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import type { FormEvent } from 'react';
import { useRouter } from '@/lib/i18n/routing';
import { TopHeader } from '@/components/header/TopHeader';

const VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260302_085640_276ea93b-d7da-4418-a09b-2aa5b490e838.mp4';

// Framer-motion v12 tightened the Variants type: `ease` wants a readonly
// tuple (or a string keyword), not a plain number[]. `as const` does it.
const EASE = [0.22, 1, 0.36, 1] as const;

const fadeSlideUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

export default function HomePage() {
  const locale = useLocale();
  const t = useTranslations('hero');
  const router = useRouter();

  const submitEmail = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Forward the captured email to /register so the user doesn't have to
    // retype it. Local-storage handoff stays client-only — no server writes.
    const data = new FormData(e.currentTarget);
    const email = (data.get('email') as string | null) ?? '';
    if (email) {
      try {
        sessionStorage.setItem('lms-prefill-email', email);
      } catch {
        /* ignore */
      }
    }
    router.push('/register');
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-white">
      {/* Flipped background video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        className="absolute inset-0 z-0 h-full w-full object-cover [transform:scaleY(-1)]"
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>

      {/* White fade overlay — video bleeds through the top 26% of the viewport */}
      <div
        className="absolute inset-0 z-[1] bg-gradient-to-b from-[26.416%] from-[rgba(255,255,255,0)] to-[66.943%] to-white"
        aria-hidden="true"
      />

      {/* Glass header */}
      <TopHeader variant="glass" />

      <motion.main
        initial="hidden"
        animate="show"
        variants={stagger}
        className="relative z-10 mx-auto flex min-h-screen max-w-[1200px] flex-col items-center px-6 pb-24 text-center"
        style={{ paddingTop: 290, gap: 32, fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif" }}
      >
        {/* Headline */}
        <motion.h1
          variants={fadeSlideUp}
          className="font-medium tracking-[-0.04em] text-[#0a0a0a]"
          style={{
            fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
            fontSize: 'clamp(48px, 8vw, 80px)',
            lineHeight: 1.05,
          }}
        >
          {t('h1_before')}{' '}
          <span
            className="italic font-normal"
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 'clamp(60px, 10vw, 100px)',
              lineHeight: 0.95,
              letterSpacing: '-0.02em',
            }}
          >
            {t('h1_mid')}
          </span>{' '}
          {t('h1_after')}
        </motion.h1>

        {/* Description */}
        <motion.p
          variants={fadeSlideUp}
          className="max-w-[554px] text-[18px] leading-[1.55]"
          style={{
            color: '#373a46',
            opacity: 0.8,
            fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
          }}
        >
          {t('subtitle')}
        </motion.p>

        {/* Email capture → CTA */}
        <motion.form
          variants={fadeSlideUp}
          onSubmit={submitEmail}
          className="flex w-full max-w-[520px] items-center gap-2 p-2"
          style={{
            background: '#fcfcfc',
            border: '1px solid rgba(0,0,0,0.06)',
            borderRadius: 40,
            boxShadow: '0px 10px 40px 5px rgba(194,194,194,0.25)',
          }}
        >
          <label htmlFor="hero-email" className="sr-only">
            {t('email_placeholder')}
          </label>
          <input
            id="hero-email"
            name="email"
            type="email"
            required
            placeholder={t('email_placeholder')}
            className="flex-1 rounded-full border-0 bg-transparent px-5 py-3 text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
            style={{ fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif" }}
            autoComplete="email"
          />
          <button
            type="submit"
            className="rounded-full bg-gradient-to-b from-[#2e2e2e] to-[#121212] px-6 py-3 text-[14px] font-semibold text-white shadow-[inset_-4px_-6px_25px_0px_rgba(201,201,201,0.08),inset_4px_4px_10px_0px_rgba(29,29,29,0.24)] transition-transform hover:scale-[1.02]"
            style={{ fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif" }}
          >
            {t('cta_primary')}
          </button>
        </motion.form>

        {/* Social proof */}
        <motion.div
          variants={fadeSlideUp}
          className="flex flex-wrap items-center justify-center gap-3 text-[14px] text-slate-700"
          style={{ fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif" }}
        >
          <div className="flex -space-x-2" aria-hidden="true">
            <span className="h-7 w-7 rounded-full border-2 border-white bg-gradient-to-br from-amber-300 to-amber-500" />
            <span className="h-7 w-7 rounded-full border-2 border-white bg-gradient-to-br from-rose-300 to-rose-500" />
            <span className="h-7 w-7 rounded-full border-2 border-white bg-gradient-to-br from-violet-300 to-violet-500" />
            <span className="h-7 w-7 rounded-full border-2 border-white bg-gradient-to-br from-emerald-300 to-emerald-500" />
            <span className="h-7 w-7 rounded-full border-2 border-white bg-gradient-to-br from-sky-300 to-sky-500" />
          </div>
          <StarRow />
          <span>
            <strong className="text-slate-900">1,020+</strong>{' '}
            <span className="text-slate-500">{t('reviews')}</span>
          </span>
          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>
          <a
            href={`/bento.html`}
            hrefLang={locale}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 transition-colors hover:text-slate-900"
          >
            {t('cta_secondary')}
          </a>
        </motion.div>
      </motion.main>
    </div>
  );
}

function StarRow() {
  return (
    <div className="flex items-center gap-0.5" aria-label="5 stars">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="#f5a524"
          stroke="#f5a524"
          strokeWidth="1"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z" />
        </svg>
      ))}
    </div>
  );
}
