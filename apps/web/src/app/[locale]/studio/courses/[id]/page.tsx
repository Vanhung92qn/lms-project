'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { api, ApiError } from '@/lib/api';
import type { CourseDetail } from '@lms/shared-types';
import { LessonTagsEditor } from './LessonTagsEditor';

// Edit-course screen. Covers the four authoring motions: (1) rename/edit
// basic fields, (2) add a module, (3) add a lesson to a module, (4) publish
// / unpublish. Drag-drop reorder + rich markdown editor ship in P2.3.

export default function EditCoursePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('studio.edit');
  const tCommon = useTranslations('studio');
  const router = useRouter();

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setLoading(true);
    try {
      setCourse(await api.teacher.detail(token, id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return <div className="px-8 py-8 text-text-muted">…</div>;
  }
  if (error || !course) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm" style={{ color: '#ff6b6b' }}>
          {error ?? t('load_failed')}
        </p>
      </div>
    );
  }

  return (
    <div className="px-8 py-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-muted">
            /{course.slug}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-text">{course.title}</h1>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <StatusBadge status={course.status} />
            <span className="text-text-muted">
              {course.modules.length} {tCommon('col_modules')} ·{' '}
              {course.modules.reduce((n, m) => n + m.lessons.length, 0)}{' '}
              {tCommon('col_lessons')}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`analytics`}
            className="rounded-pill border border-border px-4 py-2 text-xs text-text-muted transition-colors hover:border-text hover:text-text"
          >
            {t('view_analytics')} →
          </a>
          <PublishButton
            status={course.status}
            courseId={course.id}
            onChanged={load}
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex flex-col gap-6">
          <CurriculumSection course={course} onChanged={load} />
        </section>

        <aside className="flex flex-col gap-6">
          <BasicInfoForm course={course} onSaved={load} />
          <DangerZone courseId={course.id} onDeleted={() => router.push('/studio')} />
        </aside>
      </div>
    </div>
  );
}

// --- basic info form ---------------------------------------------------------

function BasicInfoForm({ course, onSaved }: { course: CourseDetail; onSaved: () => void }) {
  const t = useTranslations('studio.edit');
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? '');
  const [pricingModel, setPricingModel] = useState<'free' | 'paid'>(course.pricing_model);
  // Store as VND (not cents) — the wire format uses cents but humans think VND.
  const [priceVnd, setPriceVnd] = useState<string>(
    course.price_cents != null ? String(Math.round(course.price_cents / 100)) : '',
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setSaving(true);
    setMsg(null);
    try {
      const priceCents =
        pricingModel === 'paid' && priceVnd.trim() !== ''
          ? Math.max(0, Math.round(Number(priceVnd) * 100))
          : 0;
      await api.teacher.update(token, course.id, {
        title,
        description,
        pricing_model: pricingModel,
        price_cents: priceCents,
        currency: pricingModel === 'paid' ? 'VND' : undefined,
      });
      setMsg(t('saved'));
      onSaved();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
        {t('basic_info')}
      </h2>
      <div>
        <label htmlFor="e-title" className="mb-1 block text-xs font-medium text-text">
          {t('title_label')}
        </label>
        <input
          id="e-title"
          required
          maxLength={140}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input"
        />
      </div>
      <div>
        <label htmlFor="e-desc" className="mb-1 block text-xs font-medium text-text">
          {t('description_label')}
        </label>
        <textarea
          id="e-desc"
          rows={4}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input !rounded-box"
        />
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <div>
          <label htmlFor="e-pricing" className="mb-1 block text-xs font-medium text-text">
            {t('pricing_model_label')}
          </label>
          <select
            id="e-pricing"
            value={pricingModel}
            onChange={(e) => setPricingModel(e.target.value as 'free' | 'paid')}
            className="input"
          >
            <option value="free">{t('pricing_free')}</option>
            <option value="paid">{t('pricing_paid')}</option>
          </select>
        </div>
        <div>
          <label htmlFor="e-price" className="mb-1 block text-xs font-medium text-text">
            {t('price_label')}
          </label>
          <input
            id="e-price"
            type="number"
            min={0}
            step={1000}
            placeholder="199000"
            disabled={pricingModel === 'free'}
            value={priceVnd}
            onChange={(e) => setPriceVnd(e.target.value)}
            className="input"
          />
        </div>
      </div>
      {msg ? <p className="text-xs text-text-muted">{msg}</p> : null}
      <button type="submit" disabled={saving} className="btn btn-secondary w-fit">
        {saving ? '…' : t('save')}
      </button>
    </form>
  );
}

// --- publish / unpublish -----------------------------------------------------

function PublishButton({
  status,
  courseId,
  onChanged,
}: {
  status: CourseDetail['status'];
  courseId: string;
  onChanged: () => void;
}) {
  const t = useTranslations('studio.edit');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      if (status === 'published') {
        await api.teacher.unpublish(token, courseId);
      } else {
        await api.teacher.publish(token, courseId);
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('publish_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={toggle} disabled={busy} className="btn">
        {busy ? '…' : status === 'published' ? t('unpublish') : t('publish')}
      </button>
      {err ? (
        <p className="text-xs" style={{ color: '#ff6b6b' }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}

// --- curriculum (modules + lessons) ------------------------------------------

function CurriculumSection({ course, onChanged }: { course: CourseDetail; onChanged: () => void }) {
  const t = useTranslations('studio.edit');
  return (
    <section className="card">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
          {t('curriculum')}
        </h2>
      </header>

      {course.modules.length === 0 ? (
        <p className="text-sm text-text-muted">{t('no_modules')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {course.modules.map((m) => (
            <ModuleCard
              key={m.id}
              courseId={course.id}
              moduleId={m.id}
              title={m.title}
              sortOrder={m.sort_order}
              lessons={m.lessons}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}

      <AddModuleForm
        courseId={course.id}
        nextOrder={(course.modules[course.modules.length - 1]?.sort_order ?? 0) + 1}
        onAdded={onChanged}
      />
    </section>
  );
}

function ModuleCard({
  courseId,
  moduleId,
  title,
  sortOrder,
  lessons,
  onChanged,
}: {
  courseId: string;
  moduleId: string;
  title: string;
  sortOrder: number;
  lessons: CourseDetail['modules'][number]['lessons'];
  onChanged: () => void;
}) {
  const t = useTranslations('studio.edit');
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSaveModule = async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setSaving(true);
    setErr(null);
    try {
      await api.teacher.updateModule(token, courseId, moduleId, { title: titleDraft });
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const onDeleteModule = async () => {
    if (!window.confirm(t('confirm_delete_module', { title }))) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    try {
      await api.teacher.removeModule(token, courseId, moduleId);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('delete_failed'));
    }
  };

  return (
    <div className="rounded-box border border-border bg-code p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-pill bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
          {sortOrder}
        </span>
        {editing ? (
          <>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="input flex-1 text-sm"
              maxLength={120}
            />
            <button
              type="button"
              onClick={onSaveModule}
              disabled={saving}
              className="rounded-pill bg-accent px-3 py-1 text-xs font-semibold text-panel hover:bg-accent-hover"
            >
              {saving ? '…' : t('save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setTitleDraft(title);
                setErr(null);
              }}
              className="rounded-pill border border-border px-2.5 py-1 text-xs text-text-muted hover:text-text"
            >
              {t('cancel')}
            </button>
          </>
        ) : (
          <>
            <h3 className="flex-1 font-semibold text-text">{title}</h3>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-pill border border-border px-2.5 py-0.5 text-[11px] text-text-muted transition-colors hover:border-text hover:text-text"
            >
              {t('action_edit')}
            </button>
            <button
              type="button"
              onClick={onDeleteModule}
              className="rounded-pill border px-2.5 py-0.5 text-[11px] transition-colors"
              style={{ borderColor: 'rgba(220, 53, 69, 0.4)', color: '#dc3545' }}
            >
              {t('action_delete')}
            </button>
          </>
        )}
      </div>
      {err ? (
        <p className="mb-2 text-xs" style={{ color: '#ff6b6b' }}>
          {err}
        </p>
      ) : null}
      {lessons.length === 0 ? (
        <p className="text-xs text-text-muted">{t('no_lessons')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lessons.map((l) => (
            <LessonRow
              key={l.id}
              lesson={l}
              courseId={courseId}
              moduleId={moduleId}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
      <AddLessonForm
        courseId={courseId}
        moduleId={moduleId}
        nextOrder={(lessons[lessons.length - 1]?.sort_order ?? 0) + 1}
        onAdded={onChanged}
      />
    </div>
  );
}

function LessonRow({
  lesson,
  courseId,
  moduleId,
  onChanged,
}: {
  lesson: CourseDetail['modules'][number]['lessons'][number];
  courseId: string;
  moduleId: string;
  onChanged: () => void;
}) {
  const t = useTranslations('studio.edit');
  const tTags = useTranslations('studio.edit.tags');
  const [showTags, setShowTags] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDelete = async () => {
    if (!window.confirm(t('confirm_delete_lesson', { title: lesson.title }))) return;
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setDeleting(true);
    setErr(null);
    try {
      await api.teacher.removeLesson(token, courseId, moduleId, lesson.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('delete_failed'));
      setDeleting(false);
    }
  };

  return (
    <li className="rounded-box bg-panel px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
            {lesson.type === 'markdown' ? 'M' : lesson.type === 'exercise' ? 'C' : 'Q'}
          </span>
          <span className="truncate font-medium text-text">
            {lesson.sort_order}. {lesson.title}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {lesson.est_minutes ? (
            <span className="text-xs text-text-muted">{lesson.est_minutes}′</span>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-pill border border-border px-2.5 py-0.5 text-[11px] text-text-muted transition-colors hover:border-text hover:text-text"
          >
            {t('action_edit')}
          </button>
          <button
            type="button"
            onClick={() => setShowTags((v) => !v)}
            className="rounded-pill border border-border px-2.5 py-0.5 text-[11px] text-text-muted transition-colors hover:border-text hover:text-text"
          >
            {showTags ? tTags('hide') : tTags('toggle')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="rounded-pill border px-2.5 py-0.5 text-[11px] transition-colors"
            style={{ borderColor: 'rgba(220, 53, 69, 0.4)', color: '#dc3545' }}
          >
            {deleting ? '…' : t('action_delete')}
          </button>
        </span>
      </div>
      {err ? (
        <p className="mt-2 text-xs" style={{ color: '#ff6b6b' }}>
          {err}
        </p>
      ) : null}
      {showTags ? <LessonTagsEditor lessonId={lesson.id} /> : null}
      {editing ? (
        <LessonEditModal
          courseId={courseId}
          moduleId={moduleId}
          lessonId={lesson.id}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : null}
    </li>
  );
}

// --- lesson editor modal ------------------------------------------------------

function LessonEditModal({
  courseId,
  moduleId,
  lessonId,
  onClose,
  onSaved,
}: {
  courseId: string;
  moduleId: string;
  lessonId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('studio.edit');
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [estMinutes, setEstMinutes] = useState<string>('');
  const [type, setType] = useState<'markdown' | 'exercise' | 'quiz'>('markdown');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    (async () => {
      try {
        const lesson = await api.teacher.getLesson(token, courseId, moduleId, lessonId);
        setTitle(lesson.title);
        setContent(lesson.content_markdown ?? '');
        setEstMinutes(lesson.est_minutes != null ? String(lesson.est_minutes) : '');
        setType(lesson.type);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : t('load_failed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [courseId, moduleId, lessonId, t]);

  const onSave = async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setSaving(true);
    setErr(null);
    try {
      await api.teacher.updateLesson(token, courseId, moduleId, lessonId, {
        title,
        type,
        content_markdown: content,
        est_minutes: estMinutes.trim() === '' ? undefined : Math.max(1, Number(estMinutes)),
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div
        className="flex max-h-[85vh] w-full max-w-[720px] flex-col rounded-box shadow-2xl"
        style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)' }}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-base font-semibold text-text">{t('lesson_editor')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-border px-2.5 py-0.5 text-xs text-text-muted hover:text-text"
          >
            Esc
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-sm text-text-muted">…</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-text">
                  {t('title_label')}
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={160}
                  className="input"
                />
              </div>
              <div className="grid grid-cols-[1fr_160px] gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text">
                    {t('type_label')}
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as typeof type)}
                    className="input"
                  >
                    <option value="markdown">Markdown</option>
                    <option value="exercise">Exercise</option>
                    <option value="quiz">Quiz</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text">
                    {t('est_minutes_label')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={estMinutes}
                    onChange={(e) => setEstMinutes(e.target.value)}
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text">
                  {t('content_label')}
                </label>
                <textarea
                  rows={16}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="input !rounded-box"
                  style={{ fontFamily: "'Fira Code', monospace", fontSize: '13px' }}
                  placeholder="## Tiêu đề phụ\n\nNội dung markdown ở đây..."
                />
                <p className="mt-1 text-[10px] text-text-muted">
                  {t('content_hint')}
                </p>
              </div>
              {err ? (
                <p className="text-xs" style={{ color: '#ff6b6b' }}>
                  {err}
                </p>
              ) : null}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-border px-4 py-1.5 text-xs text-text-muted hover:text-text"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || loading}
            className="btn"
          >
            {saving ? '…' : t('save')}
          </button>
        </footer>
      </div>
    </div>
  );
}

function AddModuleForm({
  courseId,
  nextOrder,
  onAdded,
}: {
  courseId: string;
  nextOrder: number;
  onAdded: () => void;
}) {
  const t = useTranslations('studio.edit');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      await api.teacher.addModule(token, courseId, { title, sort_order: nextOrder });
      setTitle('');
      onAdded();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : t('save_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 flex items-end gap-2">
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-text-muted">
          {t('add_module')}
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={120}
          minLength={2}
          placeholder={t('module_title_placeholder')}
          className="input"
        />
        {err ? (
          <p className="mt-1 text-xs" style={{ color: '#ff6b6b' }}>
            {err}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={busy || !title.trim()} className="btn btn-secondary">
        {busy ? '…' : '+'}
      </button>
    </form>
  );
}

function AddLessonForm({
  courseId,
  moduleId,
  nextOrder,
  onAdded,
}: {
  courseId: string;
  moduleId: string;
  nextOrder: number;
  onAdded: () => void;
}) {
  const t = useTranslations('studio.edit');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'markdown' | 'exercise' | 'quiz'>('markdown');
  const [estMinutes, setEstMinutes] = useState('');
  const [content, setContent] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      await api.teacher.addLesson(token, courseId, moduleId, {
        title,
        sort_order: nextOrder,
        type,
        content_markdown: content || undefined,
        est_minutes: estMinutes ? Number(estMinutes) : undefined,
      });
      setTitle('');
      setContent('');
      setEstMinutes('');
      setOpen(false);
      onAdded();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : t('save_failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-box border border-dashed border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
      >
        + {t('add_lesson')}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 rounded-box border border-border bg-panel p-3">
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text">{t('lesson_title')}</label>
          <input
            required
            maxLength={160}
            minLength={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-text">{t('lesson_type')}</label>
            <div className="flex gap-1">
              {(['markdown', 'exercise', 'quiz'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setType(v)}
                  aria-pressed={type === v}
                  className={`flex-1 rounded-pill border px-2 py-1 text-xs font-medium transition-all ${
                    type === v
                      ? 'border-accent bg-accent text-panel'
                      : 'border-border bg-code text-text-muted hover:text-text'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="w-24">
            <label className="mb-1 block text-xs font-medium text-text">
              {t('est_minutes')}
            </label>
            <input
              type="number"
              min="1"
              value={estMinutes}
              onChange={(e) => setEstMinutes(e.target.value)}
              className="input"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text">
            {t('content_markdown')}
          </label>
          <textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="# Heading\n\nMarkdown-supported lesson body…"
            className="input !rounded-box font-mono text-xs"
          />
        </div>
        {err ? (
          <p className="text-xs" style={{ color: '#ff6b6b' }}>
            {err}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !title.trim()} className="btn">
            {busy ? '…' : t('save')}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">
            {t('cancel')}
          </button>
        </div>
      </div>
    </form>
  );
}

// --- danger zone -------------------------------------------------------------

function DangerZone({ courseId, onDeleted }: { courseId: string; onDeleted: () => void }) {
  const t = useTranslations('studio.edit');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const remove = async () => {
    const token = sessionStorage.getItem('lms-access');
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      await api.teacher.remove(token, courseId);
      onDeleted();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('delete_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card flex flex-col gap-3" style={{ borderColor: '#ff6b6b40' }}>
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#ff6b6b' }}>
        {t('danger_zone')}
      </h2>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn btn-secondary w-fit"
          style={{ borderColor: '#ff6b6b40', color: '#ff6b6b' }}
        >
          {t('delete')}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-muted">{t('delete_confirm')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="btn"
              style={{ background: '#ff6b6b', color: 'white' }}
            >
              {busy ? '…' : t('delete_confirm_yes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="btn btn-secondary"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
      {err ? (
        <p className="text-xs" style={{ color: '#ff6b6b' }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: CourseDetail['status'] }) {
  const bg = status === 'published' ? 'bg-accent/15 text-accent' : 'bg-code text-text-muted';
  const label = status === 'published' ? 'Đã xuất bản' : status === 'archived' ? 'Lưu trữ' : 'Bản nháp';
  return (
    <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${bg}`}>{label}</span>
  );
}
