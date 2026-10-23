import { useMemo, useState } from 'react';
import { diffLines, type DiffRow } from '@/lib/toolbox';
import CopyButton from './CopyButton';
import DiffTextArea from './DiffTextArea';
import { diffHighlights } from '@/lib/diff-highlights';

export default function TextDiff() {
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
    <div className="tool-toolbar"><label className="tool-checkbox"><input type="checkbox" checked={ignoreWhitespace} onChange={(event) => { setIgnoreWhitespace(event.target.checked); invalidate(); }} />忽略所有空白字符</label></div>
    <p className="tool-note" id="diff-help">逐行对比，每侧最多 1,000 行 / 100,000 字符。对比后，左框标记删除，右框标记新增，修改片段加深显示；编辑后需重新对比。</p>
    <div className="tool-columns tool-diff-columns" aria-describedby="diff-help">
      <DiffTextArea side="before" value={before} highlights={highlights?.before} onChange={(value) => { setBefore(value); invalidate(); }} />
      <div className="tool-diff-actions" role="group" aria-label="文本对比操作"><button type="button" className="btn btn-primary" onClick={compare}>开始对比</button><button type="button" className="btn btn-ghost" onClick={() => { setBefore(after); setAfter(before); invalidate(); }}>交换左右</button><button type="button" className="btn btn-ghost" onClick={() => { setBefore(''); setAfter(''); invalidate(); }}>清空</button></div>
      <DiffTextArea side="after" value={after} highlights={highlights?.after} onChange={(value) => { setAfter(value); invalidate(); }} />
    </div>
    {error && <p className="tool-error" role="alert">{error}</p>}
    <p className="tool-status" role="status">{rows !== null ? added === 0 && removed === 0 ? `两侧文本${ignoreWhitespace ? '在忽略空白后' : ''}一致。` : `新增 ${added} 行，删除 ${removed} 行。` : ''}</p>
    {rows !== null && <section aria-labelledby="diff-result-title"><div className="tool-section-heading"><h2 id="diff-result-title">逐行差异</h2><CopyButton text={exported} label="复制对比结果" disabled={rows.length === 0} /></div><p className="tool-note">左侧为原始行号，右侧为修改后行号。+ 表示新增，− 表示删除；这不是补丁文件。</p><div className="tool-diff-result" role="region" aria-label="文本差异结果" tabIndex={0}>{rows.length ? rows.map((row, index) => <div className={`tool-diff-line tool-diff-${row.kind}`} key={index}><span className="tool-line-number">{row.left ?? ''}</span><span className="tool-line-number">{row.right ?? ''}</span><span aria-label={row.kind === 'add' ? '新增' : row.kind === 'remove' ? '删除' : '未变'}>{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span><code>{row.text || '\u00a0'}</code></div>) : <p className="tool-note">两侧都没有内容。</p>}</div></section>}
  </div>;
}
