import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { AdminRequestError, adminWrite, errorMessage } from '@/lib/admin-api';
import { archiveRequest } from '@/lib/archive-admin';
import type { ArchivePublicationConfirmation, ArchivePublicationPreview } from '@/types/archive';

interface ConfirmRequest {
  operationId: string; previewToken: string; reviewedContent: true; reviewedReferences: true;
}
function ArchivePublicationReview({ archiveId, publicationId, token, disabled, onDirtyChange, onConfirmed, onClose }: {
  archiveId: string; publicationId: string; token: string; disabled: boolean;
  onDirtyChange: (dirty: boolean) => void; onConfirmed: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ArchivePublicationPreview | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const [reviewedContent, setReviewedContent] = useState(false);
  const [reviewedReferences, setReviewedReferences] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  const alive = useRef(true);
  const baseUrl = '/api/admin/archives/' + encodeURIComponent(archiveId) + '/publications/' + encodeURIComponent(publicationId);
  const dirty = busy || Boolean(pending);
  const expired = !preview?.expiresAt || Date.parse(preview.expiresAt) <= now;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (!preview?.previewToken) { return; }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview?.previewToken]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setPreview(null);
    setError('');
    setReviewedContent(false);
    setReviewedReferences(false);
    archiveRequest<ArchivePublicationPreview>(baseUrl + '/preview', { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setPreview(result); setNow(Date.now()); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) { setError(errorMessage(reason)); } })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); } });
    return () => controller.abort();
  }, [baseUrl, refresh]);
  async function commit(request: ConfirmRequest) {
    if (lock.current || disabled) { return; }
    lock.current = true;
    setPending(request);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await archiveRequest<ArchivePublicationConfirmation>(baseUrl + '/confirm', adminWrite(token, 'POST', request));
      if (!result || !result.confirmationId || result.publicationId !== publicationId || typeof result.postId !== 'string' ||
          !Number.isSafeInteger(result.confirmedPostVersion) || typeof result.confirmedAt !== 'string' ||
          typeof result.postDeleted !== 'boolean' || !['draft', 'published'].includes(result.postStatus)) {
        throw new Error('确认响应不完整，请重试原请求核对结果');
      }
      if (!alive.current) { return; }
      setPending(null);
      setPreview(null);
      setMessage(t('已记录发布确认 v{0}。{1}', result.confirmedPostVersion,
        t(result.postDeleted ? '文章当前已删除，未重新发布。' : result.postStatus === 'draft' ? '文章当前已撤回草稿，未重新发布。' : '文章当前已发布。')));
      onConfirmed();
    } catch (reason) {
      if (!alive.current) { return; }
      if (reason instanceof AdminRequestError && reason.status >= 400 && reason.status < 500) {
        setPending(null);
        setPreview(null);
      }
      setError(errorMessage(reason));
    } finally {
      lock.current = false;
      if (alive.current) { setBusy(false); }
    }
  }
  function confirm() {
    if (disabled || dirty || !preview?.previewToken || expired || !reviewedContent || !reviewedReferences) { return; }
    if (!window.confirm(t('确认将上述博客正文、作者及分类标签公开，并接受清单中的资源引用？这不会自动清理私人信息。'))) { return; }
    void commit({ operationId: crypto.randomUUID(), previewToken: preview.previewToken, reviewedContent: true, reviewedReferences: true });
  }
  return <section className="archive-section" aria-label={t("关联稿审阅确认发布")}>
    <div className="archive-actions"><h3>{t("关联稿审阅确认发布")}</h3>
      <button type="button" className="btn" disabled={loading || dirty || disabled} onClick={() => { setMessage(''); setRefresh((value) => value + 1); }}>{t("重新读取")}</button>
      <button type="button" className="btn" disabled={dirty} onClick={onClose}>{t("关闭审阅")}</button>
    </div>
    <p className="archive-note">{t("不渲染 Markdown、不请求图片或外链。只接受当前完整快照的短时签名；核查不等于自动脱敏、资源可用或公开授权。")}</p>
    {error && <p role="alert">{t(error)}</p>}{message && <p role="status">{t(message)}</p>}
    {pending && <div role="status" className="admin-notice"><p>{t("结果待确认，已锁定原操作与令牌；即使预览过期也请重试原请求。不要新建操作或重复发布。")}</p>
      <button type="button" className="btn" disabled={busy || disabled} onClick={() => void commit(pending)}>{busy ? t('确认中…') : t('重试原确认请求')}</button></div>}
    {loading ? <p role="status">{t("正在读取审阅快照…")}</p> : preview && <>
      <p className="archive-note">{t("文章版本")}{preview.snapshot.postVersion}{t("· 状态")}{preview.snapshot.status}{t("· 规则")}{preview.policyVersion}</p>
      <label className="archive-label">{t("快照 SHA-256")}<input className="field" readOnly value={preview.snapshotHash} /></label>
      <h4>{t("拟公开字段（含作者、分类、标签）")}</h4><pre className="archive-plain">{JSON.stringify({ ...preview.snapshot, content: undefined }, null, 2)}</pre>
      <h4>{t("Markdown 原文")}</h4><pre className="archive-plain">{preview.snapshot.content || t('（空正文）')}</pre>
      <h4>{t("资源引用清单")}</h4>
      {preview.blockers.length > 0 && <ul role="alert">{preview.blockers.map((item) => <li key={item}>{item}</li>)}</ul>}
      {preview.references.length ? <ol>{preview.references.map((item, index) => <li key={index}>
        <p>{item.kind} · {item.verdict === 'blocked' ? t('阻断项') : t('待人工核对')}：{t(item.reason)}</p><pre className="archive-plain">{item.value}</pre>
      </li>)}</ol> : <p>{t("未识别到 Markdown 链接/图片、封面或作者头像；这不保证文本没有私人信息。")}</p>}
      {preview.publishingEnabled && <fieldset disabled={dirty || disabled || expired}>
        <legend>{t("明确确认公开")}</legend>
        <label className="archive-check"><input type="checkbox" checked={reviewedContent} onChange={(event) => setReviewedContent(event.target.checked)} />{t("已完整审阅正文、作者与分类标签，确认可以公开")}</label>
        <label className="archive-check"><input type="checkbox" checked={reviewedReferences} onChange={(event) => setReviewedReferences(event.target.checked)} />{t("已核对资源清单，接受公开引用及其访问/授权风险")}</label>
        <button type="button" className="btn btn-primary" disabled={!reviewedContent || !reviewedReferences} onClick={confirm}>{t("确认发布此快照")}</button>
      </fieldset>}
      {preview.expiresAt && <p className="archive-note">{expired ? t('预览已过期，请重新读取并审阅。') : t('预览有效期至 ') + preview.expiresAt}</p>}
    </>}
  </section>;
}

export default withLocale(ArchivePublicationReview);
