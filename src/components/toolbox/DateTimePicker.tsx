import { useRef, useState } from 'react';
import { formatZonedDate } from '@/lib/toolbox';

interface Props { value: string; zone: string; onChange: (value: string) => void }
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const pad = (value: number) => String(value).padStart(2, '0');
function monthStart(year: number, month: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  return date;
}

export default function DateTimePicker({ value, zone, onChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState('');
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(1);
  const [time, setTime] = useState('00:00:00.000');
  const [error, setError] = useState('');
  function open() {
    const parsed = new Date(value + 'Z');
    const valid = /^\d{4}-\d{2}-\d{2}T/.test(value) && Number(value.slice(0, 4)) >= 1 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10);
    const initial = valid ? value : formatZonedDate(Date.now(), zone).replace(' ', 'T');
    setSelected(initial.slice(0, 10));
    setYear(Number(initial.slice(0, 4))); setMonth(Number(initial.slice(5, 7)));
    setTime(initial.slice(11)); setError('');
    dialog.current?.showModal();
  }
  function moveMonth(offset: number) {
    const next = monthStart(year, month + offset);
    const nextYear = next.getUTCFullYear();
    if (nextYear < 1 || nextYear > 9999) return;
    setYear(nextYear); setMonth(next.getUTCMonth() + 1);
  }
  function confirm() {
    if (!selected || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(time)) {
      setError('请选择日期，时间格式为 HH:mm:ss.SSS。'); return;
    }
    onChange(`${selected}T${time}`);
    dialog.current?.close();
  }
  const start = monthStart(year, month);
  const offset = (start.getUTCDay() + 6) % 7;
  const days = (monthStart(year, month + 1).getTime() - start.getTime()) / 86_400_000;
  return <div className="tool-field">
    <label htmlFor="datetime">所选时区的日期与时间</label>
    <div className="tool-datetime-input"><input id="datetime" type="text" value={value} placeholder="YYYY-MM-DDTHH:mm:ss.SSS" spellCheck={false} onChange={(event) => onChange(event.target.value)} /><button type="button" className="btn btn-ghost" aria-haspopup="dialog" onClick={open}>选择日期</button></div>
    <dialog ref={dialog} className="tool-calendar" aria-labelledby="calendar-title" aria-describedby="calendar-zone" onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close(); } }}>
      <div className="tool-calendar-heading"><h3 id="calendar-title">选择日期与时间</h3><button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()} aria-label="关闭日期选择">关闭</button></div>
      <p id="calendar-zone" className="tool-note">时区：{zone}</p>
      <div className="tool-calendar-nav"><button type="button" className="btn btn-ghost" aria-label="上个月" disabled={year === 1 && month === 1} onClick={() => moveMonth(-1)}>‹</button><label htmlFor="calendar-year"><span className="sr-only">年份</span><input id="calendar-year" type="number" min="1" max="9999" value={year} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1 && next <= 9999) setYear(next); }} /></label><label htmlFor="calendar-month"><span className="sr-only">月份</span><select id="calendar-month" aria-label="月份" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1} 月</option>)}</select></label><button type="button" className="btn btn-ghost" aria-label="下个月" disabled={year === 9999 && month === 12} onClick={() => moveMonth(1)}>›</button></div>
      <div className="tool-calendar-grid">{weekdays.map((day) => <span key={day} className="tool-calendar-weekday" aria-hidden="true">{day}</span>)}{Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: days }, (_, index) => {
        const day = index + 1;
        const date = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
        return <button key={date} type="button" className="tool-calendar-day" aria-label={date} aria-pressed={selected === date} onClick={() => { setSelected(date); setError(''); }}>{day}</button>;
      })}</div>
      <p className="tool-note" aria-live="polite">已选：{selected}</p>
      <label className="tool-field" htmlFor="calendar-time"><span>时间（时:分:秒.毫秒）</span><input id="calendar-time" type="text" value={time} placeholder="00:00:00.000" onChange={(event) => { setTime(event.target.value); setError(''); }} /></label>
      {error && <p className="tool-error" role="alert">{error}</p>}
      <div className="tool-calendar-footer"><button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()}>取消</button><button type="button" className="btn btn-primary" onClick={confirm}>确定日期</button></div>
    </dialog>
  </div>;
}
