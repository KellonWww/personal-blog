import { useEffect, useRef, useState } from 'react';
import { AdminRequestError, adminWrite, errorMessage } from '@/lib/admin-api';
import { archiveRequest, downloadArchiveVersion } from '@/lib/archive-admin';
import type { ArchiveDetail, ArchivePublication, ArchiveVersion } from '@/types/archive';
import ArchiveHistory from './ArchiveHistory';
import ArchiveDrafts from './ArchiveDrafts';

type Draft = { title: string; content: string; categories: string; tags: string; reason: string };
type Operation = { kind?: 'blog-draft'; url: string; method: string; body: Record<string, unknown> };
const TEXT_LIMIT = 100000;
function makeDraft(version: ArchiveVersion): Draft {
  return { title: version.title, content: version.content, categories: version.metadata.categories.join('\n'), tags: version.metadata.tags.join('\n'), reason: '' };
}
function editable(draft: Draft) {
  const labels = (value: string, limit: number) => {
    const items = [...new Set(value.split('\n').map((item) => item.trim()).filter(Boolean))];
    if (items.length > limit || items.some((item) => item.length > 100 || /[\p{Cc}]/u.test(item))) { throw new Error('分类最多 10 项、标签最多 20 项，每行一项且最多 100 字'); }
    return items;
  };
  if (!draft.title.trim() || draft.title.trim().length > 200 || draft.content.length > TEXT_LIMIT || draft.content.includes('\0')) { throw new Error('标题必填且最多 200 字，正文最多 100000 字且不能包含空字节'); }
  return { title: draft.title, content: draft.content, metadata: { categories: labels(draft.categories, 10), tags: labels(draft.tags, 20) } };
}

export default function ArchiveWorkspace({ archiveId, token, onDirtyChange, onBack }: {
  archiveId: string; token: string; onDirtyChange: (dirty: boolean) => void; onBack: () => void;
}) {
  const [archive, setArchive] = useState<ArchiveDetail | null>(null);
  const [source, setSource] = useState<ArchiveVersion | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [merged, setMerged] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [publicationDirty, setPublicationDirty] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const editorDirty = Boolean(draft && JSON.stringify(draft) !== baseline) || Boolean(pending) || busy;
  const dirty = editorDirty || publicationDirty;
  const baseUrl = '/api/admin/archives/' + encodeURIComponent(archiveId);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) { if (dirty) { event.preventDefault(); } }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setArchive(null);
    setSource(null);
    setMerged(false);
    archiveRequest<{ archive: ArchiveDetail }>(baseUrl, { signal: controller.signal }).then(async ({ archive: detail }) => {
      if (controller.signal.aborted) { return; }
      const next = makeDraft(detail.currentVersion);
      setArchive(detail);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      if (detail.conflictState === 'pending' && detail.latestSourceVersionId) {
        const candidate = await archiveRequest<{ version: ArchiveVersion }>(baseUrl + '/versions/' + detail.latestSourceVersionId, { signal: controller.signal });
        if (!controller.signal.aborted) { setSource(candidate.version); }
      }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) { setError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); } });
    return () => controller.abort();
  }, [baseUrl, refresh]);

  function reload() {
    if (publicationDirty) { window.alert('请先重试原发布确认请求，核对结果后再重新读取'); return; }
    if (dirty && !window.confirm('重新加载会放弃未保存编辑。若上次请求结果不明，将以服务端现有版本为准，继续？')) { return; }
    setPending(null);
    setDraft(null);
    setRefresh((value) => value + 1);
  }
  async function commit(operation: Operation) {
    if (lock.current) { return; }
    lock.current = true;
    setPending(operation);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await archiveRequest<{ publication?: ArchivePublication }>(operation.url, adminWrite(token, operation.method, operation.body));
      if (operation.kind === 'blog-draft' && !result.publication) { throw new Error('转稿响应不完整，请重试原请求确认结果'); }
      if (!alive.current) { return; }
      setPending(null);
      setDraft(null);
      setMessage(operation.kind === 'blog-draft'
        ? result.publication!.postDeleted ? '该操作对应的博客稿已删除，不会重新创建。' : '已转为私有博客草稿：' + result.publication!.postId + '。请先在博客草稿整理正文，再从关联记录审阅确认发布。'
        : '已追加新版本，正在读取最新档案。');
      setRefresh((value) => value + 1);
    } catch (reason) {
      if (!alive.current) { return; }
      // Definitive client rejection did not commit; unknown/network errors keep the exact request for replay.
      if (reason instanceof AdminRequestError && reason.status >= 400 && reason.status < 500) { setPending(null); }
      setError(errorMessage(reason));
    } finally {
      lock.current = false;
      if (alive.current) { setBusy(false); }
    }
  }
  function mutate(kind: 'edit' | 'keep-local' | 'accept-source' | 'merge' | 'restore', targetVersionId?: string) {
    if (!archive || !draft || publicationDirty || busy || pending) { return; }
    if (kind === 'merge' && !merged) { setError('请先对照最新来源，并确认合并完成'); return; }
    if (kind !== 'edit' && !window.confirm(kind === 'restore' ? '恢复会以所选历史快照追加新版本，当前未保存编辑将被放弃，来源冲突不会自动解决。继续？' : '确认解决冲突并接受当前最新来源作为新基线？未保存编辑仅在“提交合并”中生效。')) { return; }
    try {
      const body: Record<string, unknown> = { operationId: crypto.randomUUID(), expectedVersion: archive.version, expectedHead: archive.currentVersion.id, reason: draft.reason };
      if (kind === 'restore') { body.targetVersionId = targetVersionId; }
      else if (kind !== 'edit') { body.mode = kind; body.expectedSource = archive.latestSourceVersionId; }
      if (kind === 'edit' || kind === 'merge') { Object.assign(body, editable(draft)); }
      const suffix = kind === 'edit' ? '' : kind === 'restore' ? '/restore' : '/resolve';
      void commit({ url: baseUrl + suffix, method: kind === 'edit' ? 'PATCH' : 'POST', body });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function createBlogDraft() {
    if (!archive || dirty || loading || lock.current) { return; }
    if (!window.confirm('将已保存工作快照的标题与正文复制为私有博客草稿；不复制来源信息及私有分类标签。正文仍可能含私人信息或本地资源引用，后续必须从关联记录审阅确认，不会自动发布。确认转稿？')) { return; }
    void commit({ kind: 'blog-draft', url: baseUrl + '/blog-draft', method: 'POST', body: {
      operationId: crypto.randomUUID(), expectedVersion: archive.version, expectedHead: archive.currentVersion.id
    } });
  }
  async function download() {
    if (!archive) { return; }
    setDownloading(true);
    try { await downloadArchiveVersion(archiveId, archive.currentVersion.id); }
    catch (reason) { if (alive.current) { setError(errorMessage(reason)); } }
    finally { if (alive.current) { setDownloading(false); } }
  }
  function leave() {
    if (publicationDirty) { window.alert('发布确认结果待核对，请先重试原请求'); return; }
    if (dirty && !window.confirm('当前有未保存修改或结果不明的请求，确认离开？')) { return; }
    onDirtyChange(false);
    onBack();
  }
  return <>
    <div className="archive-actions"><button type="button" className="btn" disabled={busy || publicationDirty} onClick={leave}>← 返回档案</button><button type="button" className="btn" disabled={busy || publicationDirty || loading} onClick={reload}>重新读取</button><span>档案私有 · 编辑/导入不发布 · 博客稿须单独确认</span></div>
    {error && <div role="alert" className="admin-notice">{error}</div>}
    {message && <p role="status" className="admin-notice">{message}</p>}
    {pending && <div className="admin-notice" role="status"><span>请求结果待确认。已锁定原请求；重试不会重复执行同一操作。也可重新读取核对服务端版本与转稿记录。</span><button type="button" className="btn" disabled={busy} onClick={() => void commit(pending)}>{busy ? '提交中…' : '重试原请求'}</button></div>}
    {loading ? <div role="status" className="admin-empty">正在读取档案与来源候选…</div> : archive && draft && <>
      <div className="archive-note"><span>来源：{archive.sourceName}</span><span>工作快照 v{archive.currentVersion.sequence} · 事件序号 {archive.version}</span><span>{archive.conflictState === 'pending' ? '存在未解决来源冲突' : '无来源冲突'}</span></div>
      <p className="archive-note">正文与来源候选均按纯文本显示，不渲染图片、HTML 或外部资源；编辑、恢复均不会自动解决冲突。</p>
      <form onSubmit={(event) => { event.preventDefault(); mutate('edit'); }}>
        <fieldset disabled={busy || publicationDirty || Boolean(pending)} className="archive-editor-grid">
          <section className="admin-panel archive-editor">
            <label className="archive-label">标题<input className="field" required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
            <label className="archive-label">Markdown 正文<textarea className="field archive-text" maxLength={TEXT_LIMIT} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} spellCheck={false} /></label>
            <p className="archive-note">{draft.content.length} / {TEXT_LIMIT} 字符 · {dirty ? '有未保存修改' : '已保存'}</p>
          </section>
          <aside className="admin-panel archive-editor">
            <label className="archive-label">私有分类（一行一项，最多 10 项）<textarea className="field" rows={4} value={draft.categories} onChange={(event) => setDraft({ ...draft, categories: event.target.value })} /></label>
            <label className="archive-label">私有标签（一行一项，最多 20 项）<textarea className="field" rows={5} value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
            <label className="archive-label">本次变更原因<input className="field" maxLength={500} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder="可选，写入不可变历史" /></label>
            <button type="submit" className="btn btn-primary">{busy ? '提交中…' : '保存编辑 · 追加版本'}</button>
          </aside>
        </fieldset>
      </form>
      {archive.conflictState === 'pending' && <section className="admin-panel archive-section">
        <h2>处理来源冲突</h2><p className="archive-note">保留本地：保留已保存工作快照；接受来源：采用下方来源快照；手工合并：采用编辑区内容。三种操作都会接受最新来源基线。</p>
        {source ? <details><summary>查看最新来源候选 · v{source.sequence} · {source.title}</summary><p className="archive-note">分类：{source.metadata.categories.join('、') || '无'} · 标签：{source.metadata.tags.join('、') || '无'}</p><pre className="archive-plain">{source.content}</pre></details> : <p role="status">来源候选未读取成功，请重新读取后再处理。</p>}
        <label className="archive-check"><input type="checkbox" checked={merged} disabled={busy || publicationDirty || Boolean(pending)} onChange={(event) => setMerged(event.target.checked)} />已对照最新来源，并在编辑区完成合并</label>
        <div className="archive-actions"><button type="button" className="btn" disabled={busy || publicationDirty || Boolean(pending) || !source} onClick={() => mutate('keep-local')}>保留已保存本地</button><button type="button" className="btn" disabled={busy || publicationDirty || Boolean(pending) || !source} onClick={() => mutate('accept-source')}>接受来源</button><button type="button" className="btn btn-primary" disabled={busy || publicationDirty || Boolean(pending) || !source || !merged} onClick={() => mutate('merge')}>提交编辑区合并</button></div>
      </section>}
      <div className="archive-actions"><button type="button" className="btn" disabled={downloading} onClick={() => void download()}>{downloading ? '导出中…' : '导出已保存工作快照'}</button><span>仅 Markdown 与元数据，不含附件，不是完整灾备。</span></div>
      <section className="admin-panel archive-section">
        <h2>主动转为博客草稿</h2>
        <p className="archive-note">仅复制已保存标题与正文，不带来源、私有分类或标签。正文中的私人信息与资源链接不会自动清理；关联稿只能从下方记录审阅确认发布，普通文章入口禁止直接发布。</p>
        <button type="button" className="btn" disabled={dirty || loading || archive.conflictState === 'pending'} onClick={createBlogDraft}>转为私有博客草稿</button>
        {(dirty || archive.conflictState === 'pending') && <p className="archive-note">请先保存编辑、确认未知请求结果并解决来源冲突，再转稿。</p>}
      </section>
      <ArchiveDrafts key={refresh} archiveId={archiveId} token={token} disabled={editorDirty} onDirtyChange={setPublicationDirty} />
      <ArchiveHistory key={archive.version} archiveId={archiveId} currentVersion={archive.currentVersion} disabled={busy || publicationDirty || Boolean(pending)} onRestore={(id) => mutate('restore', id)} />
    </>}
  </>;
}
