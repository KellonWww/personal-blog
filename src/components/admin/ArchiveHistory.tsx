import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { archiveRequest, downloadArchiveVersion } from '@/lib/archive-admin';
import { errorMessage } from '@/lib/admin-api';
import { formatDate } from '@/lib/format';
import type { ArchiveDiff, ArchiveVersion } from '@/types/archive';

type VersionSummary = Omit<ArchiveVersion, 'content' | 'metadata'>;
const PAGE_SIZE = 20;
const KINDS = { import: '来源导入', edit: '本地编辑', restore: '历史恢复', resolution: '冲突解决' };

function ArchiveHistory({ archiveId, currentVersion, disabled, onRestore }: {
  archiveId: string; currentVersion: ArchiveVersion; disabled: boolean; onRestore: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<VersionSummary[]>([]);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(currentVersion.parentId || currentVersion.id);
  const [to, setTo] = useState(currentVersion.id);
  const [diff, setDiff] = useState<ArchiveDiff | null>(null);
  const [diffError, setDiffError] = useState('');
  const [diffLoading, setDiffLoading] = useState(true);
  const [inspected, setInspected] = useState('');
  const [snapshot, setSnapshot] = useState<ArchiveVersion | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const alive = useRef(true);
  const baseUrl = '/api/admin/archives/' + encodeURIComponent(archiveId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setItems([]);
    archiveRequest<{ items: VersionSummary[] }>(baseUrl + '/versions?page=' + page + '&pageSize=' + PAGE_SIZE, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setItems(data.items); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); } });
    return () => controller.abort();
  }, [baseUrl, page, retry]);
  useEffect(() => {
    const controller = new AbortController();
    setDiff(null);
    setDiffError('');
    setDiffLoading(true);
    const query = new URLSearchParams({ from, to });
    archiveRequest<ArchiveDiff>(baseUrl + '/diff?' + query, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setDiff(data); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setDiffError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) { setDiffLoading(false); } });
    return () => controller.abort();
  }, [baseUrl, from, to, retry]);
  useEffect(() => {
    if (!inspected) { return; }
    const controller = new AbortController();
    setSnapshot(null);
    setSnapshotError('');
    archiveRequest<{ version: ArchiveVersion }>(baseUrl + '/versions/' + inspected, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setSnapshot(data.version); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setSnapshotError(errorMessage(reason)); } });
    return () => controller.abort();
  }, [baseUrl, inspected, retry]);
  async function download(versionId: string) {
    if (downloading) { return; }
    setDownloading(true);
    setError('');
    try { await downloadArchiveVersion(archiveId, versionId); }
    catch (reason) { if (alive.current) { setError(errorMessage(reason)); } }
    finally { if (alive.current) { setDownloading(false); } }
  }
  return <section className="admin-panel archive-history">
    <div className="admin-panel-heading"><h2>{t("版本与差异")}</h2><button type="button" className="btn" onClick={() => setRetry((value) => value + 1)}>{t("重读历史")}</button></div>
    <p className="archive-note">{t("历史不可覆盖或删除。来源候选也是版本事件，未必是工作快照；可跨页选择比较起点和终点。")}</p>
    {error && <p className="archive-note" role="alert">{t(error)}</p>}
    {loading ? <p role="status" className="admin-empty">{t("正在读取版本…")}</p> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th scope="col">{t("起点")}</th><th scope="col">{t("终点")}</th><th scope="col">{t("事件")}</th><th scope="col">{t("时间 / 原因")}</th><th scope="col">{t("操作")}</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
      <td><input type="radio" name="archive-diff-from" aria-label={t('从 v') + item.sequence + t(' 比较')} checked={from === item.id} onChange={() => setFrom(item.id)} /></td>
      <td><input type="radio" name="archive-diff-to" aria-label={t('比较至 v') + item.sequence} checked={to === item.id} onChange={() => setTo(item.id)} /></td>
      <td><span className="admin-status">v{item.sequence} · {t(KINDS[item.kind])}</span><p className="admin-table-subtitle">{item.title}</p>{item.id === currentVersion.id && <span className="admin-table-subtitle">{t("当前工作快照")}</span>}</td>
      <td>{formatDate(item.createdAt, locale)}<p className="admin-table-subtitle">{item.reason || t('未记录原因')}</p></td>
      <td><div className="admin-row-actions"><button type="button" onClick={() => setInspected(item.id)}>{t("查看")}</button><button type="button" disabled={disabled} onClick={() => onRestore(item.id)}>{t("恢复")}</button><button type="button" disabled={downloading} onClick={() => void download(item.id)}>{t("导出")}</button></div></td>
    </tr>)}</tbody></table>{!items.length && !error && <p className="admin-empty">{t("本页没有历史版本。")}</p>}</div>}
    <div className="admin-pagination"><span>{t("第 {0} 页", page)}</span><div><button type="button" className="btn" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>{t("上一页")}</button><button type="button" className="btn" disabled={loading || items.length < PAGE_SIZE || page >= 10000} onClick={() => setPage((value) => value + 1)}>{t("下一页")}</button></div></div>
    {inspected && <div className="archive-section"><div className="archive-actions"><h3>{t("历史快照")}</h3><button type="button" className="btn" onClick={() => { setInspected(''); setSnapshot(null); }}>{t("关闭快照")}</button></div>{snapshotError ? <p role="alert">{t(snapshotError)}</p> : snapshot ? <><p className="archive-note">v{snapshot.sequence} · {snapshot.title}{t("· 分类：")}{snapshot.metadata.categories.join('、') || t('无')}{t("· 标签：")}{snapshot.metadata.tags.join('、') || t('无')}</p><pre className="archive-plain">{snapshot.content}</pre></> : <p role="status">{t("正在读取快照…")}</p>}</div>}
    <div className="archive-section"><h3>{t("逐行比较")}</h3>
      {diffLoading ? <p role="status" className="archive-note">{t("正在计算差异…")}</p> : diffError ? <div role="alert" className="archive-note"><p>{t(diffError)}</p><button type="button" className="btn" disabled={downloading} onClick={() => void download(from)}>{t("导出比较起点")}</button><button type="button" className="btn" disabled={downloading} onClick={() => void download(to)}>{t("导出比较终点")}</button></div> : diff && <>
        <p className="archive-note">v{diff.from.sequence} → v{diff.to.sequence}{t("· 新增")}{diff.added}{t("行 / 删除")}{diff.removed}{t("行 · 标题")}{diff.titleChanged ? t('有变化') : t('无变化')}{t("· 分类标签")}{diff.metadataChanged ? t('有变化') : t('无变化')}</p>
        {(diff.titleChanged || diff.metadataChanged) && <div className="archive-compare"><div><h4>{t("比较起点")}</h4><p>{diff.from.title}</p><pre className="archive-plain">{JSON.stringify(diff.from.metadata, null, 2)}</pre></div><div><h4>{t("比较终点")}</h4><p>{diff.to.title}</p><pre className="archive-plain">{JSON.stringify(diff.to.metadata, null, 2)}</pre></div></div>}
        <div className="archive-diff" role="region" aria-label={t("正文纯文本差异")} tabIndex={0}>{diff.lines.length ? diff.lines.map((line, index) => <div key={index} className="archive-diff-line" data-kind={line.kind}><span className="archive-line-number">{line.oldLine ?? ''}</span><span className="archive-line-number">{line.newLine ?? ''}</span><span aria-label={line.kind === 'add' ? t('新增') : line.kind === 'remove' ? t('删除') : t('不变')}>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>) : <p className="archive-note">{t("两端正文均为空。")}</p>}</div>
      </>}
    </div>
  </section>;
}

export default withLocale(ArchiveHistory);
