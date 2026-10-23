import { useState } from 'react';
import { formatZonedDate, parseTimestamp, parseZonedDate, type TimestampUnit } from '@/lib/toolbox';
import CopyButton from './CopyButton';
import DateTimePicker from './DateTimePicker';

const zones = [['Asia/Shanghai', '上海 · UTC+8'], ['UTC', 'UTC'], ['Asia/Tokyo', '东京'], ['America/New_York', '纽约（含夏令时）'], ['Europe/London', '伦敦（含夏令时）']];
export default function TimeConverter() {
  const [timestamp, setTimestamp] = useState('');
  const [unit, setUnit] = useState<TimestampUnit>('auto');
  const [zone, setZone] = useState('Asia/Shanghai');
  const [date, setDate] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  function invalidate() { setResult(null); setNotice(''); setError(''); }
  function convert(action: () => { milliseconds: number; notice: string }) {
    try {
      const next = action(); setResult(next.milliseconds); setNotice(next.notice); setError('');
    } catch (cause) {
      setResult(null); setNotice(''); setError(cause instanceof Error ? cause.message : '转换失败，请检查输入。');
    }
  }
  function now() {
    const value = Date.now(); setTimestamp(String(value)); setUnit('milliseconds'); setResult(value); setNotice('已填入当前时间。'); setError('');
  }
  const rows = result === null ? [] : [
    ['所选时区 · ' + zone, formatZonedDate(result, zone)],
    ['UTC · ISO 8601', new Date(result).toISOString()],
    ['Unix 秒', String(result / 1_000)],
    ['Unix 毫秒', String(result)]
  ];
  return <div className="tool-workspace">
    <div className="tool-toolbar"><div className="tool-inline-field"><label htmlFor="time-zone">时区</label><select id="time-zone" value={zone} onChange={(event) => { setZone(event.target.value); }}>{zones.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><button type="button" className="btn btn-ghost" onClick={now}>填入当前时间</button><button type="button" className="btn btn-ghost" onClick={() => { setTimestamp(''); setDate(''); invalidate(); }}>清空</button></div>
    <div className="tool-columns tool-time-inputs">
      <section aria-labelledby="timestamp-title"><h2 id="timestamp-title">时间戳 → 日期</h2><label className="tool-field" htmlFor="timestamp"><span>Unix 时间戳</span><input id="timestamp" type="text" inputMode="decimal" placeholder="例如 1792627200" value={timestamp} onChange={(event) => { setTimestamp(event.target.value); invalidate(); }} /></label><label className="tool-field" htmlFor="timestamp-unit"><span>输入单位</span><select id="timestamp-unit" value={unit} onChange={(event) => { setUnit(event.target.value as TimestampUnit); invalidate(); }}><option value="auto">自动识别</option><option value="seconds">秒</option><option value="milliseconds">毫秒</option></select></label><p className="tool-note">自动：绝对值小于 10¹¹ 按秒，否则按毫秒。较早或较远日期请手动选单位。</p><button type="button" className="btn btn-primary" onClick={() => convert(() => { const parsed = parseTimestamp(timestamp, unit); return { milliseconds: parsed.milliseconds, notice: `按${parsed.detected}转换完成。` }; })}>转换为日期</button></section>
      <section aria-labelledby="date-title"><h2 id="date-title">日期 → 时间戳</h2><DateTimePicker value={date} zone={zone} onChange={(value) => { setDate(value); invalidate(); }} /><p className="tool-note">以顶部选择的时区解析，不使用浏览器的默认时区。夏令时不存在或重复的时间会提示纠正。</p><button type="button" className="btn btn-primary" onClick={() => convert(() => ({ milliseconds: parseZonedDate(date, zone), notice: `已按 ${zone} 解析日期。` }))}>转换为时间戳</button></section>
    </div>
    <p className="tool-status" role="status">{notice}</p>{error && <p className="tool-error" role="alert">{error}</p>}
    {result !== null && <section aria-labelledby="time-result-title"><h2 id="time-result-title">转换结果</h2><dl className="tool-result-list">{rows.map(([label, value]) => <div key={label}><div><dt>{label}</dt><dd><code>{value}</code></dd></div><CopyButton text={value!} label={`复制${label}`} /></div>)}</dl></section>}
  </div>;
}
