import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/react';
import { adminRequest, adminWrite, errorMessage } from '@/lib/admin-api';
import type { TaxonomyInput, TaxonomyKind, TaxonomyTerm } from '@/types/taxonomy';

const EMPTY: TaxonomyInput = { name: '', slug: '', description: '', sortOrder: 0 };
interface Editor { id?: string; version?: number; value: TaxonomyInput }

export default function TaxonomyManager({ token, onDirtyChange }: { token: string; onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<TaxonomyKind>('categories');
  const [items, setItems] = useState<TaxonomyTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [initial, setInitial] = useState('');
  const lock = useRef(false);
  const editorName = useRef<HTMLInputElement>(null);
  const editorKey = editor ? editor.id ?? 'new' : '';
  useEffect(() => { if (editorKey) editorName.current?.focus(); }, [editorKey]);
  const dirty = editor !== null && JSON.stringify(editor.value) !== initial;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadFailed(false); setError('');
    adminRequest<{ items: TaxonomyTerm[] }>(`/api/admin/taxonomy/${kind}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setItems(data.items); })
      .catch((reason) => { if (!controller.signal.aborted) { setItems([]); setLoadFailed(true); setError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, refresh]);

  function canLeave() { return !dirty || window.confirm(t('当前页面有未保存修改，确认离开？')); }
  function openEditor(term?: TaxonomyTerm) {
    if (lock.current || !canLeave()) return;
    const value = term ? { name: term.name, slug: term.slug, description: term.description, sortOrder: term.sortOrder } : { ...EMPTY };
    setEditor({ id: term?.id, version: term?.version, value }); setInitial(JSON.stringify(value)); setMessage(''); setError('');
  }
  function change(patch: Partial<TaxonomyInput>) {
    setEditor((current) => current ? { ...current, value: { ...current.value, ...patch } } : null);
    setMessage('');
  }
  async function save() {
    if (!editor || lock.current) return;
    if (!editor.value.name.trim()) { setError('名称不能为空'); return; }
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const path = `/api/admin/taxonomy/${kind}${editor.id ? '/' + encodeURIComponent(editor.id) : ''}`;
      const body = editor.id ? { version: editor.version, value: editor.value } : editor.value;
      await adminRequest(path, adminWrite(token, editor.id ? 'PUT' : 'POST', body));
      setEditor(null); setInitial(''); setMessage('已保存分类或标签，前台刷新后生效'); setRefresh((value) => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function remove(term: TaxonomyTerm) {
    if (lock.current || !canLeave() || !window.confirm(t('确定删除「{0}」？将解除与 {1} 篇文章的关联，不会删除文章。', term.name, term.postCount))) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await adminRequest(`/api/admin/taxonomy/${kind}/${encodeURIComponent(term.id)}`, adminWrite(token, 'DELETE', { version: term.version }));
      setEditor(null); setInitial(''); setMessage('已删除分类或标签，文章保留'); setRefresh((value) => value + 1);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  const filtered = items.filter((item) => `${item.name} ${item.slug}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  return <>
    {message && <p role="status" className="admin-notice">{t(message)}</p>}
    {error && <div role="alert" className="admin-notice"><span>{t(error)}</span><button type="button" className="btn" disabled={busy} onClick={() => { if (canLeave()) { setEditor(null); setRefresh((value) => value + 1); } }}>{t('刷新列表')}</button></div>}
    <section className="admin-panel">
      <div className="admin-toolbar">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('管理类型')}>
          {(['categories', 'tags'] as const).map((value) => <button key={value} type="button" className="btn" aria-pressed={kind === value} disabled={busy} onClick={() => {
            if (value === kind || !canLeave()) return;
            setEditor(null); setInitial(''); setKind(value); setSearch(''); setPage(1); setItems([]); setLoading(true); setMessage('');
          }}>{t(value === 'categories' ? '分类' : '标签')}</button>)}
        </div>
        <input className="field" type="search" aria-label={t('搜索名称或路径')} placeholder={t('搜索名称或路径')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <button type="button" className="btn btn-primary" disabled={busy || loading || loadFailed} onClick={() => openEditor()}>{t(kind === 'categories' ? '新增分类' : '新增标签')}</button>
      </div>
      <p className="admin-taxonomy-hint">{t('分类用于组织文章，标签用于标记主题；删除只解除关联，不删除文章。')}</p>
      {loading ? <div role="status" className="admin-empty">{t('正在加载分类与标签…')}</div> : visible.length ? <ul className="admin-taxonomy-list">
        {visible.map((term) => <li key={term.id}>
          <div className="admin-taxonomy-detail"><strong>{term.name}</strong><code>{term.slug}</code>{term.description && <p>{term.description}</p>}<span>{t('关联 {0} 篇文章（含草稿）', term.postCount)}{kind === 'categories' && <> · {t('排序 {0}', term.sortOrder)}</>}</span></div>
          <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={busy} aria-label={t('编辑 {0}', term.name)} onClick={() => openEditor(term)}>{t('编辑')}</button><button type="button" className="btn btn-ghost" disabled={busy} aria-label={t('删除 {0}', term.name)} onClick={() => { void remove(term); }}>{t('删除')}</button></div>
        </li>)}
      </ul> : <div className="admin-empty">{t(error ? '加载失败，请重试。' : search ? '没有匹配的分类或标签' : '还没有内容，点击右上角新增')}</div>}
      <div className="admin-pagination"><span>{t('共 {0} 项', filtered.length)}</span><div><button type="button" className="btn" disabled={busy || loading || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{t('上一页')}</button><span>{currentPage} / {totalPages}</span><button type="button" className="btn" disabled={busy || loading || currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>{t('下一页')}</button></div></div>
    </section>
    {editor && <form className="admin-panel admin-taxonomy-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="admin-panel-heading"><h2>{t(editor.id ? '编辑分类或标签' : kind === 'categories' ? '新增分类' : '新增标签')}</h2><span className="text-xs text-muted">{dirty ? t('有未保存的修改') : t('填写后保存')}</span></div>
      <fieldset className="admin-settings-grid" disabled={busy}>
        <div><label className="admin-field-label" htmlFor="taxonomy-name">{t('名称')}</label><input ref={editorName} id="taxonomy-name" className="field" required maxLength={100} value={editor.value.name} onChange={(event) => change({ name: event.target.value })} /></div>
        <div><label className="admin-field-label" htmlFor="taxonomy-slug">{t('路径（slug）')}</label><input id="taxonomy-slug" className="field" maxLength={80} placeholder={t('留空自动生成')} value={editor.value.slug} onChange={(event) => change({ slug: event.target.value })} /><p className="admin-field-help">{t('路径需唯一；修改后旧筛选链接将不再匹配。')}</p></div>
        {kind === 'categories' && <><div><label className="admin-field-label" htmlFor="taxonomy-order">{t('排序（小的在前）')}</label><input id="taxonomy-order" className="field" type="number" required min={-999999} max={999999} step={1} value={editor.value.sortOrder} onChange={(event) => change({ sortOrder: event.target.valueAsNumber })} /></div><div className="admin-span-full"><label className="admin-field-label" htmlFor="taxonomy-description">{t('分类简介（选填）')}</label><textarea id="taxonomy-description" className="field" maxLength={500} value={editor.value.description} onChange={(event) => change({ description: event.target.value })} /></div></>}
      </fieldset>
      <div className="admin-pagination"><button type="button" className="btn" disabled={busy} onClick={() => { if (canLeave()) setEditor(null); }}>{t('取消')}</button><button type="submit" className="btn btn-primary" disabled={busy || !dirty}>{busy ? t('保存中…') : t('保存分类或标签')}</button></div>
    </form>}
  </>;
}
