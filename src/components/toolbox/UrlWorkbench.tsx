import { useRef, useState } from 'react';
import { buildToolUrl, isTrackingParameter, parseToolUrl, type ParsedUrl, type UrlParameter } from '@/lib/url-tools';
import CopyButton from './CopyButton';
interface Row extends UrlParameter { id: number }
export default function UrlWorkbench() {
  const [source, setSource] = useState('');
  const [parsed, setParsed] = useState<ParsedUrl | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const nextId = useRef(0);
  const addButton = useRef<HTMLButtonElement>(null);
  function change(value: string) { setSource(value); setParsed(null); setRows([]); setError(''); }
  function analyze() {
    try { const result = parseToolUrl(source); setParsed(result); setRows(result.rows.map((row) => ({ ...row, id: nextId.current++ }))); setError(''); }
    catch (cause) { setParsed(null); setError(cause instanceof Error ? cause.message : '解析失败。'); }
  }
  let output = '';
  let outputError = '';
  if (parsed) {
    try { output = buildToolUrl(parsed.href, rows); }
    catch (cause) { outputError = cause instanceof Error ? cause.message : '参数过长。'; }
  }
  function update(id: number, key: 'key' | 'value', value: string) { setRows((items) => items.map((row) => row.id === id ? { ...row, [key]: value } : row)); }
  return <div className="tool-workspace">
    <div className="tool-toolbar"><button type="button" className="btn btn-ghost" onClick={() => change('https://example.com/search?q=你好&tag=web&tag=design&utm_source=newsletter#results')}>填入示例</button><button type="button" className="btn btn-ghost" onClick={() => change('')}>清空</button><span className="tool-note">只拆解文本，不访问目标网站</span></div>
    <div className="tool-columns tool-transform-columns">
      <label className="tool-field" htmlFor="url-source"><span>原始 URL <small>最多 20,000 字符</small></span><textarea id="url-source" className="tool-code tool-code-medium" spellCheck={false} autoComplete="off" value={source} maxLength={20000} onChange={(e) => change(e.target.value)} placeholder="https://example.com/path?key=value#section" /></label>
      <div className="tool-transform-actions"><button type="button" className="btn btn-primary" disabled={!source.trim()} onClick={analyze}>拆解 URL</button></div>
      <div className="tool-field"><div className="tool-field-heading"><label htmlFor="url-output">重组结果</label><CopyButton label="复制 URL" text={output} disabled={!output} /></div><textarea id="url-output" className="tool-code tool-code-medium" readOnly value={output} placeholder="拆解后可在下方编辑参数，结果即时更新。" /></div>
    </div>
    {(error || outputError) && <p className="tool-error" role="alert">{error || outputError}</p>}
    {parsed && <section className="tool-detail-section tool-reveal" aria-label="URL 参数编辑器">
      <dl className="tool-url-parts">{[['协议', parsed.protocol], ['主机', parsed.host], ['路径', parsed.pathname], ['锚点', parsed.hash || '无']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="tool-section-heading"><h2>查询参数 <small className="tool-note">{rows.length} / 200 组</small></h2><div className="tool-toolbar"><button type="button" className="btn btn-ghost" disabled={!rows.some((row) => isTrackingParameter(row.key))} onClick={() => setRows((items) => items.filter((row) => !isTrackingParameter(row.key)))}>移除追踪参数</button><button type="button" className="btn btn-ghost" disabled={rows.length < 2} onClick={() => setRows((items) => [...items].sort((a, b) => a.key.localeCompare(b.key)))}>按名称排序</button></div></div>
      <p className="tool-note">保留重复参数与空值；空格按 + 编码，修改后会规范化编码。带签名的 URL 修改后可能失效。</p>
      <div className="tool-param-list">{rows.map((row, index) => <div className="tool-param-row" key={row.id}><label className="tool-field"><span className="sr-only">参数名 {index + 1}</span><input aria-label={`参数名 ${index + 1}`} value={row.key} maxLength={20000} autoComplete="off" placeholder="参数名" onChange={(e) => update(row.id, 'key', e.target.value)} /></label><span className="tool-param-equals" aria-hidden="true">=</span><label className="tool-field"><span className="sr-only">参数值 {index + 1}</span><input aria-label={`参数值 ${index + 1}`} value={row.value} maxLength={20000} autoComplete="off" placeholder="参数值（可为空）" onChange={(e) => update(row.id, 'value', e.target.value)} /></label><button type="button" className="btn btn-ghost" aria-label={`删除参数 ${index + 1}`} onClick={() => { setRows((items) => items.filter((item) => item.id !== row.id)); addButton.current?.focus(); }}>删除</button></div>)}</div>
      {!rows.length && <p className="tool-note">还没有查询参数，可添加一组。</p>}
      <button type="button" className="btn btn-ghost tool-add-row" ref={addButton} disabled={rows.length >= 200} onClick={() => setRows((items) => [...items, { id: nextId.current++, key: '', value: '' }])}>＋ 添加参数</button>
    </section>}
  </div>;
}
