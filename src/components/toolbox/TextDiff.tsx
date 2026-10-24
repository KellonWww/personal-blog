import { useI18n, withLocale } from '@/lib/i18n/react';
import { useMemo, useState } from 'react';
import { diffLines, type DiffRow } from '@/lib/toolbox';
import CopyButton from './CopyButton';
import DiffTextArea from './DiffTextArea';
import { diffHighlights } from '@/lib/diff-highlights';

function TextDiff() {
  const { t } = useI18n();
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [error, setError] = useState('');
  function invalidate() { setRows(null); setError(''); }
  function compare() {
    try { setRows(diffLines(before, after, ignoreWhitespace)); setError(''); }
    catch (cause) { setRows(null); setError(cause instanceof Error ? cause.message : '对比失败，请缩小输入内容。'); }
  }
  const highlights = useMemo(() => rows === null ? null : diffHighlights(rows, ignoreWhitespace), [rows, ignoreWhitespace]);
  const added = rows?.filter((row) => row.kind === 'add').length ?? 0;
  const removed = rows?.filter((row) => row.kind === 'remove').length ?? 0;
  const exported = rows?.map((row) => `${row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' '} ${row.text}`).join('\n') ?? '';
  return <div className="tool-workspace">
    <div className="tool-toolbar"><label className="tool-checkbox"><input type="checkbox" checked={ignoreWhitespace} onChange={(event) => { setIgnoreWhitespace(event.target.checked); invalidate(); }} />{t("忽略所有空白字符")}</label></div>
    <p className="tool-note" id="diff-help">{t("逐行对比，每侧最多 1,000 行 / 100,000 字符。对比后，左框标记删除，右框标记新增，修改片段加深显示；编辑后需重新对比。")}</p>
    <div className="tool-columns tool-diff-columns" aria-describedby="diff-help">
      <DiffTextArea side="before" value={before} highlights={highlights?.before} onChange={(value) => { setBefore(value); invalidate(); }} />
      <div className="tool-diff-actions" role="group" aria-label={t("文本对比操作")}><button type="button" className="btn btn-primary" onClick={compare}>{t("开始对比")}</button><button type="button" className="btn btn-ghost" onClick={() => { setBefore(after); setAfter(before); invalidate(); }}>{t("交换左右")}</button><button type="button" className="btn btn-ghost" onClick={() => { setBefore(''); setAfter(''); invalidate(); }}>{t("清空")}</button></div>
      <DiffTextArea side="after" value={after} highlights={highlights?.after} onChange={(value) => { setAfter(value); invalidate(); }} />
    </div>
    {error && <p className="tool-error" role="alert">{t(error)}</p>}
    <p className="tool-status" role="status">{rows !== null ? added === 0 && removed === 0 ? t("两侧文本{0}一致。", ignoreWhitespace ? '在忽略空白后' : '') : t("新增 {0} 行，删除 {1} 行。", added, removed) : ''}</p>
    {rows !== null && <section aria-labelledby="diff-result-title"><div className="tool-section-heading"><h2 id="diff-result-title">{t("逐行差异")}</h2><CopyButton text={exported} label={t("复制对比结果")} disabled={rows.length === 0} /></div><p className="tool-note">{t("左侧为原始行号，右侧为修改后行号。+ 表示新增，− 表示删除；这不是补丁文件。")}</p><div className="tool-diff-result" role="region" aria-label={t("文本差异结果")} tabIndex={0}>{rows.length ? rows.map((row, index) => <div className={`tool-diff-line tool-diff-${row.kind}`} key={index}><span className="tool-line-number">{row.left ?? ''}</span><span className="tool-line-number">{row.right ?? ''}</span><span aria-label={row.kind === 'add' ? t('新增') : row.kind === 'remove' ? t('删除') : t('未变')}>{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span><code>{row.text || '\u00a0'}</code></div>) : <p className="tool-note">{t("两侧都没有内容。")}</p>}</div></section>}
  </div>;
}

export default withLocale(TextDiff);
