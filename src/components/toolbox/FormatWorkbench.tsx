import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { FORMAT_INPUT_LIMIT, FORMAT_LANGUAGES, type FormatLanguage, type FormatMode, type FormatResult, type SqlDialect } from '@/lib/format-config';
import type { JsonResult } from '@/lib/toolbox';
import CopyButton from './CopyButton';

function FormatWorkbench() {
  const { t, locale } = useI18n();
  const [language, setLanguage] = useState<FormatLanguage>('json');
  const [dialect, setDialect] = useState<SqlDialect>('sql');
  const [indent, setIndent] = useState<2 | 4>(2);
  const [source, setSource] = useState('');
  const [result, setResult] = useState<JsonResult | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stop() {
    worker.current?.terminate(); worker.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function invalidate() {
    stop(); setBusy(false); setResult(null); setOutput(null); setNotice(''); setError(''); setQuery('');
  }
  function edit(value: string) { invalidate(); setSource(value); }
  useEffect(() => () => {
    worker.current?.terminate();
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  function process(mode: FormatMode) {
    invalidate();
    if (!source.trim()) { setError('请先输入需要处理的文本。'); return; }
    if (source.length > FORMAT_INPUT_LIMIT) { setError('输入超过 200,000 字符，请缩小内容后重试。'); return; }
    try {
      const active = new Worker(new URL('../../workers/format.worker.ts', import.meta.url), { type: 'module' });
      worker.current = active; setBusy(true); setNotice('正在本地加载格式化器并处理…');
      active.onmessage = ({ data }: MessageEvent<{ result?: FormatResult; error?: string }>) => {
        if (worker.current !== active) return;
        stop(); setBusy(false); setNotice('');
        if (data.error) { setError(data.error); return; }
        if (!data.result) { setError('未收到格式化结果，请重试。'); return; }
        setResult(data.result.json); setOutput(data.result.output);
        setNotice(mode === 'validate' ? '校验通过，JSON 语法有效。' : mode === 'compact' ? '已压缩，字段顺序保持不变。' : `已格式化，使用 ${indent} 个空格缩进。`);
      };
      active.onerror = () => {
        if (worker.current !== active) return;
        stop(); setBusy(false); setNotice(''); setError('格式化器加载或执行失败，请重试。');
      };
      timer.current = setTimeout(() => { stop(); setBusy(false); setNotice(''); setError('处理超过 15 秒，已终止。请缩小输入后重试。'); }, 15_000);
      active.postMessage({ source, language, dialect, indent, mode });
    } catch { stop(); setBusy(false); setNotice(''); setError('无法启动本地格式化线程，请使用支持 Web Worker 的浏览器。'); }
  }
  const selected = FORMAT_LANGUAGES.find((item) => item.value === language)!;
  const entries = result?.entries.filter((entry) => entry.path.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <div className="tool-workspace" aria-busy={busy}>
    <div className="tool-toolbar">
      <div className="tool-inline-field"><label htmlFor="format-language">{t("文本类型")}</label><select id="format-language" value={language} onChange={(event) => { invalidate(); setLanguage(event.target.value as FormatLanguage); }}>{FORMAT_LANGUAGES.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}</select></div>
      {language === 'sql' && <div className="tool-inline-field"><label htmlFor="format-dialect">{t("SQL 方言")}</label><select id="format-dialect" value={dialect} onChange={(event) => { invalidate(); setDialect(event.target.value as SqlDialect); }}><option value="sql">{t("标准 SQL")}</option><option value="mysql">MySQL / MariaDB</option><option value="postgresql">PostgreSQL</option><option value="sqlite">SQLite</option><option value="transactsql">SQL Server</option></select></div>}
      <div className="tool-inline-field"><label htmlFor="format-indent">{t("缩进")}</label><select id="format-indent" value={indent} onChange={(event) => { invalidate(); setIndent(Number(event.target.value) as 2 | 4); }}><option value="2">{t("2 个空格")}</option><option value="4">{t("4 个空格")}</option></select></div>
      <button type="button" className="btn btn-ghost" onClick={() => edit(selected.example)}>{t("填入示例")}</button>
      <button type="button" className="btn btn-ghost" onClick={() => edit('')}>{t("清空")}</button>
      <button type="button" className="btn btn-ghost" disabled={output === null} onClick={() => edit(output ?? '')}>{t("结果作为输入")}</button>
    </div>
    <p className="tool-note">{t("支持 JSON、SQL、HTML、CSS、JavaScript、TypeScript、Markdown、YAML。输入最多 200,000 字符；按需加载本地格式化器，不上传、不执行输入。不要粘贴真实凭据。")}</p>
    {language === 'json' && <p className="tool-note">{t("JSON 支持格式化、压缩、严格语法校验与字段路径。大整数请使用字符串，避免精度丢失。")}</p>}
    {language === 'sql' && <p className="tool-note">{t("请按数据库选择方言；仅调整排版和关键字大小写，不连接数据库、不执行 SQL，也不验证语句能否运行。不支持存储过程或自定义 DELIMITER。")}</p>}
    {(language === 'html' || language === 'markdown') && <p className="tool-note">{t("仅格式化当前文本，内嵌脚本、样式与代码块保持原样；HTML 只作为文本显示，不渲染执行。")}</p>}
    <div className="tool-columns tool-transform-columns">
      <label className="tool-field" htmlFor="format-source"><span>{t("{0} 输入", t(selected.label))}<small>{t("{0} 字符", source.length.toLocaleString(locale))}</small></span><textarea id="format-source" className="tool-code" spellCheck={false} value={source} placeholder={selected.example} onChange={(event) => edit(event.target.value)} /></label>
      <div className="tool-transform-actions" role="group" aria-label={t("文本格式化操作")}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => process('pretty')}>{t("格式化")}</button>
        {language === 'json' && <><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => process('compact')}>{t("压缩")}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => process('validate')}>{t("校验")}</button></>}
        {busy && <button type="button" className="btn btn-ghost" onClick={() => { invalidate(); setNotice('已取消处理。'); }}>{t("取消")}</button>}
      </div>
      <div className="tool-field"><div className="tool-field-heading"><label htmlFor="format-output">{t("处理结果")}</label><CopyButton text={output ?? ''} label={t("复制结果")} disabled={output === null} /></div><textarea id="format-output" className="tool-code" spellCheck={false} value={output ?? ''} readOnly placeholder={t("处理结果会显示在这里。")} /></div>
    </div>
    <p className="tool-status" role="status">{t(notice)}</p>{error && <p className="tool-error" role="alert">{t(error)}</p>}
    {result && <section className="tool-paths" aria-labelledby="json-path-title"><div className="tool-section-heading"><h2 id="json-path-title">{t("字段路径")}</h2><label className="tool-field" htmlFor="json-path-query"><span className="sr-only">{t("筛选字段路径")}</span><input id="json-path-query" type="search" placeholder={t("筛选路径，如 $.settings")} value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      <p className="tool-note">{t("点复制取得 JSONPath 风格路径，特殊字段名使用方括号。")}{result.truncated ? t('仅索引前 300 项，完整内容见上方结果。') : ''}</p>
      <ul className="tool-path-list">{entries.map((entry) => <li key={entry.path}><div><code>{entry.path}</code><span>{entry.structured ? t(entry.preview) : entry.preview}</span></div><CopyButton text={entry.path} label={t("复制路径")} /></li>)}</ul>{!entries.length && <p className="tool-note">{t("没有匹配的路径。")}</p>}
    </section>}
  </div>;
}

export default withLocale(FormatWorkbench);
