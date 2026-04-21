'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { useSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';

// 3-step onboarding wizard (P9.0 PR D). Collects goals + level + weekly-
// hours so the recommendation engine can serve something personalised on
// day 0, before the student has submitted any code. The questionnaire is
// idempotent — if the student re-visits after saving, the form pre-fills
// from the stored profile and acts as an "edit preferences" screen.

type Level = 'novice' | 'learning-basics' | 'intermediate';
type Hours = '<2' | '2-5' | '5-10' | '10+';

const GOAL_KEYS = [
  'cpp-foundation',
  'python-basics',
  'web-dev',
  'data-analysis',
  'algorithms',
  'theory-foundation',
] as const;

const LEVELS: Level[] = ['novice', 'learning-basics', 'intermediate'];
const HOURS: Hours[] = ['<2', '2-5', '5-10', '10+'];

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const { user, isLoading: sessionLoading } = useSession();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [goals, setGoals] = useState<string[]>([]);
  const [level, setLevel] = useState<Level>('novice');
  const [hours, setHours] = useState<Hours>('2-5');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Redirect unauth users to /login; they can come back via the dashboard
  // banner.
  useEffect(() => {
    if (!sessionLoading && !user) router.replace('/login');
  }, [sessionLoading, user, router]);

  // Pre-fill on load if the student already has a profile.
  useEffect(() => {
    if (!user) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    (async () => {
      try {
        const { profile } = await api.onboarding.get(token);
        if (profile) {
          setGoals(profile.goals);
          if (LEVELS.includes(profile.level as Level)) setLevel(profile.level as Level);
          if (HOURS.includes(profile.weekly_hours as Hours)) setHours(profile.weekly_hours as Hours);
        }
      } catch {
        /* silent — first-time users have no profile yet */
      } finally {
        setLoaded(true);
      }
    })();
  }, [user]);

  const toggleGoal = (g: string) => {
    setGoals((prev) => {
      if (prev.includes(g)) return prev.filter((x) => x !== g);
      if (prev.length >= 3) return prev; // hard cap 3 — matches backend DTO
      return [...prev, g];
    });
  };

  const canAdvance1 = goals.length >= 1;

  const onFinish = async () => {
    if (!canAdvance1) {
      setError(t('select_min'));
      setStep(1);
      return;
    }
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      await api.onboarding.upsert(token, {
        goals,
        level,
        weekly_hours: hours,
        known_languages: [],
      });
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  if (sessionLoading || !user || !loaded) {
    return (
      <main className="mx-auto max-w-[760px] px-6 py-14">
        <div className="card text-center text-text-muted">…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {t('step', { n: step, total: 3 })}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-text md:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      <div className="card">
        {step === 1 ? (
          <>
            <h2 className="text-lg font-semibold text-text">{t('step1_title')}</h2>
            <p className="mt-1 text-sm text-text-muted">{t('step1_hint')}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {GOAL_KEYS.map((g) => {
                const active = goals.includes(g);
                const full = !active && goals.length >= 3;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGoal(g)}
                    disabled={full}
                    className="rounded-box border px-4 py-3 text-left transition-colors"
                    style={{
                      background: active ? 'rgba(247, 189, 77, 0.12)' : 'var(--bg-panel)',
                      borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                      opacity: full ? 0.5 : 1,
                      cursor: full ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="grid h-4 w-4 place-items-center rounded-full border text-[10px]"
                        style={{
                          borderColor: active ? 'var(--accent)' : 'var(--text-muted)',
                          background: active ? 'var(--accent)' : 'transparent',
                          color: active ? 'var(--panel-bg)' : 'transparent',
                        }}
                      >
                        ✓
                      </span>
                      <span
                        className="text-sm font-semibold"
                        style={{ color: active ? 'var(--accent)' : 'var(--text-main)' }}
                      >
                        {t(`goals.${g}` as const)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {t(`goals.${g}_desc` as const)}
                    </p>
                  </button>
                );
              })}
            </div>
          </>
        ) : step === 2 ? (
          <>
            <h2 className="text-lg font-semibold text-text">{t('step2_title')}</h2>
            <div className="mt-4 flex flex-col gap-2">
              {LEVELS.map((l) => (
                <label
                  key={l}
                  className="flex cursor-pointer items-start gap-3 rounded-box border px-4 py-3 transition-colors"
                  style={{
                    background: level === l ? 'rgba(247, 189, 77, 0.12)' : 'var(--bg-panel)',
                    borderColor: level === l ? 'var(--accent)' : 'var(--border-color)',
                  }}
                >
                  <input
                    type="radio"
                    name="level"
                    value={l}
                    checked={level === l}
                    onChange={() => setLevel(l)}
                    className="mt-1"
                  />
                  <span className="text-sm text-text">{t(`levels.${l}` as const)}</span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-text">{t('step3_title')}</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHours(h)}
                  className="rounded-box border px-3 py-4 text-sm transition-colors"
                  style={{
                    background: hours === h ? 'rgba(247, 189, 77, 0.12)' : 'var(--bg-panel)',
                    borderColor: hours === h ? 'var(--accent)' : 'var(--border-color)',
                    color: hours === h ? 'var(--accent)' : 'var(--text-main)',
                    fontWeight: hours === h ? 600 : 400,
                  }}
                >
                  {t(`hours.${h}` as const)}
                </button>
              ))}
            </div>
          </>
        )}

        {error ? (
          <p className="mt-4 text-sm" style={{ color: '#ff6b6b' }}>
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="text-xs text-text-muted underline-offset-2 hover:underline"
          >
            {t('skip')}
          </button>
          <div className="flex gap-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
                className="btn btn-secondary"
              >
                {t('back')}
              </button>
            ) : null}
            {step < 3 ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 1 && !canAdvance1) {
                    setError(t('select_min'));
                    return;
                  }
                  setError(null);
                  setStep((s) => (s + 1) as 1 | 2 | 3);
                }}
                className="btn"
              >
                {t('next')}
              </button>
            ) : (
              <button
                type="button"
                onClick={onFinish}
                disabled={saving || !canAdvance1}
                className="btn"
              >
                {saving ? t('saving') : t('finish')}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
