import { useI18n, withLocale } from '@/lib/i18n/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PostDetail, PostStatus, SessionUser } from '@/types/domain';
import { defaultCoverSvg } from '@/lib/default-cover';
import { enhanceMermaid, observeThemeChanges } from '@/lib/mermaid-client';
import { renderMarkdown } from '@/lib/markdown';
import { countWords } from '@/lib/format';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from '@/lib/constants';
import { adminRequest, adminWrite, errorMessage } from '@/lib/admin-api';
import AdminShell from './AdminShell';

interface Props { postId: string | null }
interface TaxonomyOption { id: string; name: string }
interface Draft { title: string; slug: string; summary: string; content: string; coverImage: string; status: PostStatus; categoryIds: string[]; tagIds: string[] }
interface Backup { draft: Draft; savedAt: string }
const EMPTY: Draft = { title: '', slug: '', summary: '', content: '', coverImage: '', status: 'draft', categoryIds: [], tagIds: [] };

function validBackup(value: unknown): value is Backup {
  if (!value || typeof value !== 'object') return false;
  const backup = value as Partial<Backup>;
  const draft = backup.draft;
  return typeof backup.savedAt === 'string' && !!draft &&
    ['title', 'slug', 'summary', 'content', 'coverImage'].every((key) => typeof draft[key as keyof Draft] === 'string') &&
    ['draft', 'published'].includes(draft.status) &&
    [draft.categoryIds, draft.tagIds].every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'));
}

function PostEditor({ postId }: Props) {
  const { t } = useI18n();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [categories, setCategories] = useState<TaxonomyOption[]>([]);
  const [tags, setTags] = useState<TaxonomyOption[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saved, setSaved] = useState('');
  const [backup, setBackup] = useState<Backup | null>(null);
  const [backupStatus, setBackupStatus] = useState('');
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('split');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<'body' | 'cover'>('body');
  const allowNavigation = useRef(false);
  const lock = useRef(false);
  const uploadLock = useRef(false);
  const storageKey = user ? `admin-draft:${user.id}:${postId ?? 'new'}` : '';
  const snapshot = JSON.stringify(draft);
  const dirty = ready && snapshot !== saved;

  useEffect(() => {
    const controller = new AbortController();
    setReady(false); setError('');
    (async () => {
      const me = await adminRequest<{ user: SessionUser | null }>('/api/auth/me', { signal: controller.signal });
      if (!me.user) { window.location.assign('/admin/login'); return; }
      if (me.user.role !== 'admin') throw new Error('当前账号没有管理员权限');
      const taxonomy = await adminRequest<{ categories: TaxonomyOption[]; tags: TaxonomyOption[] }>('/api/admin/taxonomy', { signal: controller.signal });
      const detail = postId ? await adminRequest<PostDetail>(`/api/admin/posts/${postId}`, { signal: controller.signal }) : null;
      if (controller.signal.aborted) return;
      const initial: Draft = detail ? { title: detail.title, slug: detail.slug, summary: detail.summary, content: detail.content, coverImage: detail.coverImage, status: detail.status, categoryIds: detail.categories.map((item) => item.id), tagIds: detail.tags.map((item) => item.id) } : { ...EMPTY };
      setUser(me.user); setCategories(taxonomy.categories); setTags(taxonomy.tags);
      setDraft(initial); setSaved(JSON.stringify(initial));
      try {
        const cached: unknown = JSON.parse(localStorage.getItem(`admin-draft:${me.user.id}:${postId ?? 'new'}`) || 'null');
        if (validBackup(cached) && JSON.stringify(cached.draft) !== JSON.stringify(initial)) setBackup(cached);
      } catch { setBackupStatus('本地备份不可用，请及时保存到服务端'); }
      setReady(true);
    })().catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [postId, retry]);

  useEffect(() => {
    if (!ready || !storageKey || backup) return;
    if (!dirty) {
      try { localStorage.removeItem(storageKey); }
      catch { setBackupStatus('旧备份未能清除'); }
      return;
    }
    setBackupStatus('正在备份到本机…');
    const timer = window.setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(storageKey, JSON.stringify({ draft: JSON.parse(snapshot) as Draft, savedAt }));
        setBackupStatus(`本机备份 ${new Date(savedAt).toLocaleTimeString('zh-CN')} · 尚未保存到服务端`);
      } catch { setBackupStatus('本地备份失败，请立即保存到服务端'); }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [ready, dirty, storageKey, snapshot, backup]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty || allowNavigation.current) return;
      if (storageKey && !backup) {
        try { localStorage.setItem(storageKey, JSON.stringify({ draft: JSON.parse(snapshot) as Draft, savedAt: new Date().toISOString() })); } catch { /* Leave warning remains active if storage is full. */ }
      }
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, storageKey, snapshot, backup]);

  const rendered = useMemo(() => {
    if (typeof window === 'undefined') return '';
    // Use the site's Markdown renderer and reject unsafe link/image protocols in preview.
    const doc = new DOMParser().parseFromString(renderMarkdown(draft.content), 'text/html');
    doc.querySelectorAll('a[href], img[src]').forEach((node) => {
      const attribute = node.tagName === 'A' ? 'href' : 'src';
      try {
        if (!['http:', 'https:'].includes(new URL(node.getAttribute(attribute) ?? '', window.location.origin).protocol)) node.removeAttribute(attribute);
      } catch { node.removeAttribute(attribute); }
      if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    });
    return doc.body.innerHTML;
  }, [draft.content]);

  useEffect(() => {
    if (mode === 'edit' || !previewRef.current) return;
    void enhanceMermaid(previewRef.current);
    observeThemeChanges();
  }, [mode, rendered, ready]);

  const save = useCallback(async (nextStatus: PostStatus) => {
    if (!user || !ready || lock.current || uploadLock.current) return;
    if (backup) { setError('请先恢复或丢弃本地备份，再保存文章'); return; }
    if (!draft.title.trim() || !draft.content.trim()) { setError('标题和正文不能为空'); return; }
    if (draft.status === 'published' && nextStatus === 'draft' && !window.confirm(t('保存为草稿会下线当前已发布文章，确认继续？'))) return;
    lock.current = true; setSaving(true); setMessage(''); setError('');
    try {
      const submitted = { ...draft, status: nextStatus };
      const detail = await adminRequest<PostDetail>(postId ? `/api/admin/posts/${postId}` : '/api/admin/posts', adminWrite(user.csrfToken, postId ? 'PUT' : 'POST', submitted));
      const normalized: Draft = { ...submitted, title: detail.title, slug: detail.slug, summary: detail.summary, content: detail.content, coverImage: detail.coverImage };
      setDraft(normalized); setSaved(JSON.stringify(normalized));
      setMessage(nextStatus === 'published' ? '文章已保存并发布' : '草稿已保存到服务端');
      try { localStorage.removeItem(storageKey); setBackupStatus('已保存到服务端'); }
      catch { setBackupStatus('已保存到服务端，本机旧备份未能清除'); }
      if (!postId) { allowNavigation.current = true; window.location.replace(`/admin/editor?id=${detail.id}`); }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { lock.current = false; setSaving(false); }
  }, [user, ready, backup, draft, postId, storageKey]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(draft.status); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [save, draft.status]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function insert(before: string, after = '', placeholder = '文字') {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.content.length;
    const end = textarea?.selectionEnd ?? start;
    const selection = draft.content.slice(start, end) || placeholder;
    update('content', draft.content.slice(0, start) + before + selection + after + draft.content.slice(end));
    window.requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(start + before.length, start + before.length + selection.length); });
  }
  async function upload(file: File, target: 'body' | 'cover') {
    if (!user || lock.current || uploadLock.current) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_UPLOAD_BYTES) { setError('仅支持 JPG、PNG、WebP、GIF，单张图片不超过 5MB'); return; }
    uploadLock.current = true; setUploading(true); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const result = await adminRequest<{ url: string }>('/api/admin/uploads', { method: 'POST', headers: { 'X-CSRF-Token': user.csrfToken }, body: form });
      if (target === 'cover') update('coverImage', result.url);
      else {
        const start = textareaRef.current?.selectionStart;
        setDraft((current) => {
          const position = start ?? current.content.length;
          return { ...current, content: current.content.slice(0, position) + `\n![图片](${result.url})\n` + current.content.slice(position) };
        });
      }
      setMessage(target === 'cover' ? '封面已上传，保存文章后生效' : '图片已插入正文');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { uploadLock.current = false; setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  function resolveBackup(restore: boolean) {
    if (!backup) return;
    if (!restore && !window.confirm(t('确认丢弃本机未保存的备份？'))) return;
    if (restore) { setDraft(backup.draft); setMessage('已恢复到编辑器，请核对后手动保存；线上文章未被修改'); }
    else { try { localStorage.removeItem(storageKey); } catch { setBackupStatus('旧备份未能清除'); } }
    setBackup(null);
  }

  return <AdminShell active="posts" title={postId ? t('编辑文章') : t('新的记录')} description={t("专心写作。修改自动备份到本机，发布始终由你决定。")} userName={user?.displayName || user?.username} actions={ready && <><button type="button" className="btn" disabled={saving || uploading || !!backup} onClick={() => save('draft')}>{t("保存草稿")}</button><button type="button" className="btn btn-primary" disabled={saving || uploading || !!backup} onClick={() => save('published')}>{saving ? t('保存中…') : draft.status === 'published' ? t('更新文章') : t('发布文章')}</button></>}>
    {error && <div role="alert" className="admin-notice"><span>{t(error)}</span>{!ready && <button type="button" className="btn" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</button>}</div>}
    {message && <p role="status" className="admin-notice">{t(message)}</p>}
    {!ready ? <div role="status" className="admin-empty">{t(error) ? t('编辑器未就绪，请重试。') : t('正在准备编辑器…')}</div> : <>
      {backup && <div className="admin-notice"><div>{t("发现本机未保存备份（")}{new Date(backup.savedAt).toLocaleString('zh-CN')}）。<p className="text-xs text-muted">{t("可能早于线上版本，恢复仅替换编辑内容，不会自动发布。")}</p></div><div className="flex shrink-0 gap-2"><button type="button" className="btn" onClick={() => resolveBackup(true)}>{t("恢复备份")}</button><button type="button" className="btn btn-ghost" onClick={() => resolveBackup(false)}>{t("丢弃")}</button></div></div>}
      <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file, uploadTarget.current); }} />
      <fieldset disabled={saving || uploading || !!backup} className="admin-editor-layout">
        <section className="admin-panel">
          <input className="admin-editor-title" aria-label={t("文章标题")} value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder={t("给这篇记录起个名字…")} maxLength={200} />
          <div className="admin-editor-toolbar"><button type="button" onClick={() => { setMode('edit'); insert('**', '**'); }} aria-label={t("插入粗体")}><strong>B</strong></button><button type="button" onClick={() => { setMode('edit'); insert('## ', '', '标题'); }}>H2</button><button type="button" onClick={() => { setMode('edit'); insert('- ', '', '列表项'); }}>{t("列表")}</button><button type="button" onClick={() => { setMode('edit'); insert('```\n', '\n```', '代码'); }}>{t("代码")}</button><button type="button" onClick={() => { setMode('edit'); insert('[', '](https://)', '链接文字'); }}>{t("链接")}</button><button type="button" disabled={uploading} onClick={() => { uploadTarget.current = 'body'; fileRef.current?.click(); }}>{uploading ? t('上传中…') : t('图片')}</button><div className="ml-auto flex gap-1">{(['edit', 'split', 'preview'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{({ edit: t('编辑'), split: t('分栏'), preview: t('预览') })[value]}</button>)}</div></div>
          <div className="admin-editor-content" data-mode={mode}>
            {mode !== 'preview' && <textarea ref={textareaRef} className="admin-editor-textarea" aria-label={t("Markdown 正文")} value={draft.content} onChange={(event) => update('content', event.target.value)} onPaste={(event) => { const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/')); if (image) { event.preventDefault(); void upload(image, 'body'); } }} placeholder={t("用 Markdown 写下你的记录，支持粘贴图片…")} />}
            {mode !== 'edit' && <div ref={previewRef} className="admin-editor-preview prose-editorial" dangerouslySetInnerHTML={{ __html: rendered || t('<p>正文预览将在这里呈现。</p>') }} />}
          </div>
          <div className="admin-editor-bottom"><span>{t("{0} 字 · Ctrl / ⌘ + S 保存当前状态", countWords(draft.content))}</span><span role="status">{dirty ? backupStatus || t('有未保存修改') : t('与服务端同步')}</span></div>
        </section>
        <aside className="admin-editor-aside">
          <section className="admin-panel"><h2>{t("发布信息")}<span className="admin-status ml-2" data-status={draft.status}>{draft.status === 'published' ? t('已发布') : t('草稿')}</span></h2><label htmlFor="post-slug" className="admin-field-label">{t("文章路径")}</label><input id="post-slug" className="field" value={draft.slug} onChange={(event) => update('slug', event.target.value)} placeholder={t("留空自动生成")} maxLength={80} /><label htmlFor="post-summary" className="admin-field-label mt-4">{t("摘要")}</label><textarea id="post-summary" className="field min-h-28" value={draft.summary} onChange={(event) => update('summary', event.target.value)} maxLength={500} placeholder={t("一句话介绍这篇文章…")} /><span className="admin-field-help">{t("用于文章列表与 SEO ·")}{draft.summary.length}/500</span></section>
          <section className="admin-panel"><h2>{t("文章封面")}</h2><div className="overflow-hidden rounded-[var(--radius-control)] border border-line mb-3">{draft.coverImage.trim() ? <img src={draft.coverImage} alt={t("封面预览")} className="aspect-[16/9] w-full object-cover" /> : <span className="block aspect-[16/9] w-full" aria-hidden="true" dangerouslySetInnerHTML={{ __html: defaultCoverSvg(draft.title) }} />}</div><input className="field" aria-label={t("封面图片地址")} value={draft.coverImage} onChange={(event) => update('coverImage', event.target.value)} placeholder={t("图片地址，留空用默认封面")} maxLength={500} /><button type="button" className="btn mt-3 w-full" disabled={uploading} onClick={() => { uploadTarget.current = 'cover'; fileRef.current?.click(); }}>{t("上传封面")}</button><span className="admin-field-help">{t("JPG / PNG / WebP / GIF · 最大 5MB")}</span></section>
          {([{ key: 'categoryIds', label: t('分类'), items: categories }, { key: 'tagIds', label: t('标签'), items: tags }] as const).map(({ key, label, items }) => <section className="admin-panel" key={key}><h2>{t(label)}</h2><div className="admin-chip-list">{items.map((item) => <button type="button" className={`chip ${draft[key].includes(item.id) ? 'border-accent text-accent bg-accent-soft' : ''}`} aria-pressed={draft[key].includes(item.id)} key={item.id} onClick={() => update(key, draft[key].includes(item.id) ? draft[key].filter((id) => id !== item.id) : [...draft[key], item.id])}>{item.name}</button>)}{!items.length && <span className="text-xs text-muted">{t("暂无")}{t(label)}</span>}</div></section>)}
        </aside>
      </fieldset>
    </>}
  </AdminShell>;
}

export default withLocale(PostEditor);
