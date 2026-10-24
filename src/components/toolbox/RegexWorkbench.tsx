import { useI18n, withLocale } from '@/lib/i18n/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import CopyButton from './CopyButton';
import { REGEX_INPUT_LIMIT, REGEX_PATTERN_LIMIT, type RegexResult } from '../../lib/regex-tools';

function RegexWorkbench() {
  const { t } = useI18n();
  const [pattern, setPattern] = useState('(?<name>[A-Za-z]+)=(\\d+)');
  const [flags, setFlags] = useState('g');
  const [source, setSource] = useState('');
  const [replacement, setReplacement] = useState('$<name>: $2');
  const [result, setResult] = useState<RegexResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stop() {
    worker.current?.terminate(); worker.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  function invalidate() { stop(); setBusy(false); setResult(null); setError(''); }
  useEffect(() => () => {
    worker.current?.terminate();
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  function test() {
    invalidate();
    if (source.length > REGEX_INPUT_LIMIT || pattern.length > REGEX_PATTERN_LIMIT || replacement.length > 2_000) {
      setError('测试文本最多 20,000 字符；表达式和替换模板分别最多 2,000 字符。'); return;
    }
    try {
      const active = new Worker(new URL('../../workers/regex.worker.ts', import.meta.url), { type: 'module' });
      worker.current = active; setBusy(true);
      active.onmessage = ({ data }: MessageEvent<{ result?: RegexResult; error?: string }>) => {
        if (worker.current !== active) return;
        stop(); setBusy(false);
        if (data.error) setError(data.error); else setResult(data.result ?? null);
      };
      active.onerror = () => { if (worker.current !== active) return; stop(); setBusy(false); setError('正则线程启动或执行失败，请重试。'); };
      timer.current = setTimeout(() => { stop(); setBusy(false); setError('执行超过 2 秒，已终止。请简化表达式或缩小文本后重试。'); }, 2_000);
      active.postMessage({ pattern, flags, source, replacement });
    } catch { stop(); setBusy(false); setError('当前浏览器无法启动正则线程，请换用支持 Web Worker 的浏览器。'); }
  }
  let cursor = 0;
  const highlights = result?.matches.map((match, index) => {
    const preceding = source.slice(cursor, match.index); cursor = match.index + match.text.length;
    return <Fragment key={index}>{preceding}<mark title={t("第 {0} 处 · 位置 {1}", index + 1, match.index)}>{match.text || <span aria-label={t("零长度匹配")}>│</span>}</mark></Fragment>;
  });
  return <section className="tool-workspace">
    <div className="tool-toolbar">
      <button className="btn" onClick={() => { invalidate(); setPattern('(?<name>[A-Za-z]+)=(\\d+)'); setFlags('g'); setSource('name=42\nprice=100\n中文与 emoji 😀'); setReplacement('$<name>: $2'); }}>{t("填入示例")}</button>
      <button className="btn" onClick={() => { invalidate(); setSource(''); }}>{t("清空文本")}</button>
    </div>
    <div className="tool-columns">
      <label className="tool-field">{t("正则表达式（不带 / 分隔符）")}<input className="tool-regex-input" value={pattern} onChange={(event) => { invalidate(); setPattern(event.target.value); }} spellCheck={false} /></label>
      <label className="tool-field">{t("标志（g i m s u y）")}<input className="tool-regex-input" value={flags} onChange={(event) => { invalidate(); setFlags(event.target.value); }} spellCheck={false} /></label>
    </div>
    <label className="tool-field">{t("替换模板")}<input className="tool-regex-input" value={replacement} onChange={(event) => { invalidate(); setReplacement(event.target.value); }} spellCheck={false} /></label>
    <p className="tool-note">{t("使用 JavaScript 正则语法；支持 $&、$1、$<名称> 等替换引用。位置从 0 开始；空表达式匹配字符间隙。")}</p>
    <div className="tool-columns tool-transform-columns">
      <div className="tool-field"><div className="tool-field-heading"><label htmlFor="regex-source">{t("测试文本")}</label></div><textarea id="regex-source" className="tool-code" value={source} onChange={(event) => { invalidate(); setSource(event.target.value); }} spellCheck={false} /></div>
      <div className="tool-transform-actions" role="group" aria-label={t("正则操作")}>
        <button className="btn btn-primary" onClick={test} disabled={busy}>{busy ? t('测试中…') : t('测试正则')}</button>
        {busy && <button className="btn" onClick={() => { invalidate(); setError('已取消执行。'); }}>{t("取消")}</button>}
      </div>
      <div className="tool-field"><span>{t("匹配高亮")}</span><pre className="tool-code tool-regex-preview" aria-label={t("匹配高亮")}>{result ? <>{highlights}{source.slice(cursor)}</> : t('测试后显示匹配位置')}</pre></div>
    </div>
    {error && <p className="tool-error" role="alert">{t(error)}</p>}
    {result && <>
      <p className="tool-status" role="status">{result.truncated ? t('匹配超过 500 处，仅展示前 500 处；未生成替换结果。') : t("找到 {0} 处匹配。", result.matches.length)}</p>
      <details className="tool-regex-details"><summary>{t("匹配与捕获组（每处最多展示 50 个组）")}</summary><ol>{result.matches.map((match, index) => <li key={index}>
        <strong>{t("位置")}{match.index} · {match.text === '' ? t('零长度匹配') : t('匹配')}</strong><code>{JSON.stringify(match.text)}</code>
        {match.captures.map((capture, group) => <code key={group}>${group + 1}: {capture === null ? t('未参与匹配') : JSON.stringify(capture)}</code>)}
        {Object.entries(match.groups).map(([name, value]) => <code key={name}>{name}: {value === null ? t('未参与匹配') : JSON.stringify(value)}</code>)}
      </li>)}</ol></details>
      <div className="tool-field"><label htmlFor="regex-output">{t("替换预览")}</label><textarea id="regex-output" className="tool-code" readOnly value={result.replacement ?? ''} /></div>
      <CopyButton text={result.replacement ?? ''} disabled={result.replacement === null} label={t("复制替换结果")} />
    </>}
    <p className="tool-note">{t("仅在浏览器独立线程运行，不上传、不保存输入。文本上限 20,000 字符，2 秒超时自动终止。")}</p>
  </section>;
}

export default withLocale(RegexWorkbench);
