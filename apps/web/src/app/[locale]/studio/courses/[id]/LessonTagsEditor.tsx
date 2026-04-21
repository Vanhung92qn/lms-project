'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

/**
 * Compact knowledge-node tag editor rendered inline in the Studio
 * curriculum tree. Teachers pick up to 3 concepts per lesson; the tags
 * drive the student-side prereq gating (P5c suggestion) + mastery
 * tracking (P5b BKT pipeline).
 *
 * The vocabulary list is deliberately fetched once per mount — it's
 * small (~15 rows) and static between deployments. We don't cache
 * across unmounts; the price of an extra request is <1 KB.
 */
export function LessonTagsEditor({
  lessonId,
  onDirty,
}: {
  lessonId: string;
  onDirty?: () => void;
}) {
  const t = useTranslations('studio.edit.tags');

  const [nodes, setNodes] = useState<Array<{ slug: string; title: string; domain: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.knowledge.listNodes(), api.knowledge.lessonTags(lessonId)])
      .then(([allNodes, current]) => {
        if (cancelled) return;
        setNodes(allNodes);
        setSelected(new Set(current.tags));
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const toggle = (slug: string) => {
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else if (next.size >= 3) {
        // Cap matches the server-side ArrayMaxSize(3) — silently
        // swallow extra clicks rather than showing a modal.
        return prev;
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const save = async () => {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem('lms-access');
    } catch {
      /* */
    }
    if (!token) {
      setError(t('sign_in_required'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.knowledge.tagLesson(token, lessonId, Array.from(selected));
      setSaved(true);
      onDirty?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="mt-2 text-[11px] text-text-muted">…</p>;
  }

  // Group by domain so the list reads naturally.
  const byDomain = new Map<string, typeof nodes>();
  for (const n of nodes) {
    const bucket = byDomain.get(n.domain) ?? [];
    bucket.push(n);
    byDomain.set(n.domain, bucket);
  }

  return (
    <div className="mt-2 rounded-box border border-border bg-panel p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {t('label')} ({selected.size}/3)
      </p>
      <div className="flex flex-col gap-3">
        {Array.from(byDomain.entries()).map(([domain, ns]) => (
          <div key={domain}>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">{domain}</p>
            <div className="flex flex-wrap gap-1.5">
              {ns.map((n) => {
                const on = selected.has(n.slug);
                return (
                  <button
                    key={n.slug}
                    type="button"
                    onClick={() => toggle(n.slug)}
                    className={`rounded-pill border px-2.5 py-1 text-[11px] transition-colors ${
                      on
                        ? 'border-accent bg-accent text-panel'
                        : 'border-border text-text-muted hover:border-text hover:text-text'
                    }`}
                  >
                    {n.title}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-pill bg-accent px-3 py-1 text-[11px] font-semibold text-panel transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? '…' : t('save')}
        </button>
        {saved ? <span className="text-[11px] text-accent">✓ {t('saved')}</span> : null}
        {error ? (
          <span className="text-[11px]" style={{ color: '#ff6b6b' }}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
