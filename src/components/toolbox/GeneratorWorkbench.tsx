import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { generatePasswords, generateUuids, sha256, type PasswordOptions } from '@/lib/generator-tools';
import CopyButton from './CopyButton';
type Mode = 'uuid' | 'password' | 'hash';
const modes: [Mode, string][] = [['uuid', 'UUID'], ['password', '随机密码'], ['hash', 'SHA-256']];
const characterOptions: [keyof PasswordOptions, string][] = [['upper', '大写字母'], ['lower', '小写字母'], ['digits', '数字'], ['symbols', '符号'], ['excludeAmbiguous', '排除易混字符（0 O 1 I l）']];
const FILE_LIMIT = 20 * 1024 * 1024;
function GeneratorWorkbench() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('uuid');
  const [count, setCount] = useState(5);
  const [length, setLength] = useState(20);
  const [options, setOptions] = useState<PasswordOptions>({ upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: true });
  const [hashInput, setHashInput] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  function invalidate() { revision.current++; setOutput(''); setError(''); setBusy(false); }
  function switchMode(value: Mode) { invalidate(); setMode(value); setCount(5); }
  async function generate() {
    const request = ++revision.current;
    setError(''); setOutput('');
    try {
      if (mode === 'uuid') { setOutput(generateUuids(count)); return; }
      if (mode === 'password') { setOutput(generatePasswords(length, count, options)); return; }
      if (hashInput === 'text' && text.length > 1000000) throw new Error('文本不能超过 1,000,000 字符。');
      if (hashInput === 'file' && !file) throw new Error('请先选择文件。');
      if (file && hashInput === 'file' && file.size > FILE_LIMIT) throw new Error('文件不能超过 20 MiB。');
      setBusy(true);
      const bytes = hashInput === 'file' && file ? await file.arrayBuffer() : new TextEncoder().encode(text).buffer;
      if (request !== revision.current) return;
      const result = await sha256(bytes);
      if (request === revision.current) setOutput(result);
    } catch (cause) { if (request === revision.current) setError(cause instanceof Error ? cause.message : '生成失败，请重试。'); }
    finally { if (request === revision.current) setBusy(false); }
  }
  return <div className="tool-workspace">
    <div className="tool-mode-switch" role="group" aria-label={t("选择生成工具")}>{modes.map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => switchMode(value)}>{t(label)}</button>)}</div>
    <div className="tool-columns tool-transform-columns">
      <section className="tool-generator-settings" aria-label={t("生成设置")}>
        <div className="tool-field-heading"><h2>{mode === 'uuid' ? t('批量生成 UUID v4') : mode === 'password' ? t('密码规则') : t('待校验的内容')}</h2></div>
        {mode !== 'hash' ? <>
          <label className="tool-field"><span>{t("生成数量")}<small>{mode === 'uuid' ? t('1–50 条') : t('1–20 条')}</small></span><input type="number" min="1" max={mode === 'uuid' ? 50 : 20} value={Number.isNaN(count) ? '' : count} onChange={(e) => { invalidate(); setCount(e.target.valueAsNumber); }} /></label>
          {mode === 'password' && <><label className="tool-field"><span>{t("密码长度")}<strong className="tool-setting-value">{t("{0} 位", length)}</strong></span><input className="tool-range" aria-label={t("密码长度")} type="range" min="8" max="128" value={length} onChange={(e) => { invalidate(); setLength(Number(e.target.value)); }} /></label><div className="tool-character-options">{characterOptions.map(([key, label]) => <label className="tool-checkbox" key={key}><input type="checkbox" checked={options[key]} onChange={(e) => { invalidate(); setOptions({ ...options, [key]: e.target.checked }); }} />{t(label)}</label>)}</div></>}
          <p className="tool-note">{mode === 'uuid' ? t('使用浏览器安全随机源，不生成有序 ID；每行一个，方便批量粘贴。') : t('保证包含每类已选字符，使用安全随机源。生成后请妥善保存，不会自动记住。')}</p>
        </> : <>
          <div className="tool-mode-switch tool-mode-switch-small" role="group" aria-label={t("哈希输入类型")}><button type="button" aria-pressed={hashInput === 'text'} onClick={() => { invalidate(); setFile(null); setHashInput('text'); }}>{t("文本")}</button><button type="button" aria-pressed={hashInput === 'file'} onClick={() => { invalidate(); setHashInput('file'); }}>{t("文件")}</button></div>
          {hashInput === 'text' ? <label className="tool-field"><span className="sr-only">{t("哈希文本")}</span><textarea aria-label={t("哈希文本")} className="tool-code tool-code-medium" autoComplete="off" maxLength={1000000} value={text} placeholder={t("输入文本，按 UTF-8 计算；空文本也可以计算。")} onChange={(e) => { invalidate(); setText(e.target.value); }} /></label> : <div className="tool-file-picker"><label className="tool-field"><span>{t("选择本地文件")}<small>{t("最大 20 MiB")}</small></span><input type="file" onChange={(e) => { invalidate(); setFile(e.target.files?.[0] ?? null); }} /></label><p className="tool-note">{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KiB` : t('文件仅在浏览器中读取，不上传。')}</p></div>}
          <p className="tool-note">{t("SHA-256 用于核对内容是否一致，不是加密，也不适合直接存储密码。换行、空格都会影响结果。")}</p>
        </>}
      </section>
      <div className="tool-transform-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void generate()}>{busy ? t('计算中…') : mode === 'hash' ? t('计算哈希') : output ? t('重新生成') : t('立即生成')}</button>{busy && <button type="button" className="btn btn-ghost" onClick={invalidate}>{t("取消")}</button>}</div>
      <section className="tool-field" aria-label={t("生成结果")}><div className="tool-field-heading"><label htmlFor="generator-output">{mode === 'hash' ? t('SHA-256 · 十六进制') : t('生成结果')}</label><CopyButton text={output} label={t("复制结果")} disabled={!output || busy} /></div><textarea id="generator-output" className="tool-code tool-generator-output" spellCheck={false} readOnly value={output} placeholder={mode === 'hash' ? t('64 位十六进制摘要会显示在这里。') : t('生成的内容仅在当前页面显示。')} /><p className="tool-note" role="status">{busy ? t('正在本地计算…') : output ? mode === 'hash' ? t('计算完成，内容未上传。') : t("已生成 {0} 条，可直接复制。", output.split('\n').length) : t('修改设置后会清除旧结果。')}</p></section>
    </div>
    {error && <p className="tool-error" role="alert">{t(error)}</p>}
  </div>;
}

export default withLocale(GeneratorWorkbench);
