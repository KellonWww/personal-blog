import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useState } from 'react';
type Correction = 'L' | 'M' | 'Q' | 'H';
interface QrResult { key: string; png: string; svg: string }
function QrWorkbench() {
  const { t } = useI18n();
  const [source, setSource] = useState('');
  const [level, setLevel] = useState<Correction>('M');
  const [size, setSize] = useState(1024);
  const [result, setResult] = useState<QrResult | null>(null);
  const [status, setStatus] = useState<{ key: string; error: string } | null>(null);
  const key = JSON.stringify([source, level, size]);
  const bytes = new TextEncoder().encode(source).length;
  const valid = source.trim().length > 0 && bytes <= 1200;
  const current = result?.key === key ? result : null;
  const error = bytes > 1200 ? '内容超过 1,200 UTF-8 字节，请缩短文本。' : status?.key === key ? status.error : '';
  useEffect(() => {
    if (!source.trim() || bytes > 1200) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { default: QRCode } = await import('qrcode');
        const options = { errorCorrectionLevel: level, margin: 4, width: size, color: { dark: '#000000', light: '#ffffff' } };
        const [png, svg] = await Promise.all([QRCode.toDataURL(source, options), QRCode.toString(source, { ...options, type: 'svg' })]);
        if (!cancelled) { setResult({ key, png, svg }); setStatus({ key, error: '' }); }
      } catch {
        if (!cancelled) { setResult(null); setStatus({ key, error: '二维码生成失败，请缩短内容或稍后重试。' }); }
      }
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [source, level, size, bytes, key]);
  return <div className="tool-workspace">
    <div className="tool-toolbar"><button type="button" className="btn btn-ghost" onClick={() => setSource('https://example.com')}>{t("填入示例")}</button><button type="button" className="btn btn-ghost" onClick={() => { setSource(''); setResult(null); setStatus(null); }}>{t("清空")}</button><span className="tool-note">{t("输入后自动生成，无需上传")}</span></div>
    <div className="tool-columns tool-qr-columns">
      <section className="tool-qr-settings" aria-label={t("二维码内容和设置")}>
        <label className="tool-field" htmlFor="qr-source"><span>{t("文本或网址")}<small>{bytes.toLocaleString()}{t("/ 1,200 字节")}</small></span><textarea id="qr-source" className="tool-code tool-code-medium" value={source} spellCheck={false} maxLength={1200} autoComplete="off" placeholder={t("写一段文字，或粘贴想分享的网址…")} onChange={(e) => setSource(e.target.value)} /></label>
        <div className="tool-settings-row"><label className="tool-field"><span>{t("纠错等级")}</span><select value={level} onChange={(e) => setLevel(e.target.value as Correction)}><option value="L">{t("L · 约 7%")}</option><option value="M">{t("M · 约 15%（推荐）")}</option><option value="Q">{t("Q · 约 25%")}</option><option value="H">{t("H · 约 30%")}</option></select></label><label className="tool-field"><span>{t("PNG 尺寸")}</span><select value={size} onChange={(e) => setSize(Number(e.target.value))}>{[512, 1024, 2048].map((value) => <option key={value} value={value}>{value} × {value}</option>)}</select></label></div>
        <p className="tool-note">{t("保持黑白与四周留白，方便扫码。纠错越高图案越密；下载 SVG 可无损放大。")}</p>
      </section>
      <section className="tool-qr-preview" aria-label={t("二维码预览")} aria-busy={valid && !current && !t(error)}>
        <div className="tool-field-heading"><h2>{t("扫码预览")}</h2><span className="tool-note">{current ? t('可下载') : t('实时生成')}</span></div>
        <div className="tool-qr-stage">{current ? <img className="tool-reveal" src={current.png} alt={t("当前输入内容生成的二维码")} width={size} height={size} /> : <div className="tool-empty-state"><svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM20 14v4h-3v3M12 3v9H3M12 16v5M21 21h-1" /></svg><p>{valid && !t(error) ? t('正在生成…') : t('让文字变成一次扫码')}</p><small>{t("支持中文、网址与 emoji")}</small></div>}</div>
        <div className="tool-qr-downloads">{current ? <><a className="btn btn-primary" href={current.png} download="qrcode.png">{t("下载 PNG")}</a><a className="btn btn-ghost" href={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(current.svg)} download="qrcode.svg">{t("下载 SVG")}</a></> : <><button type="button" className="btn btn-primary" disabled>{t("下载 PNG")}</button><button type="button" className="btn btn-ghost" disabled>{t("下载 SVG")}</button></>}</div>
        <p className="tool-note" role="status">{t(error) || (current ? t('已更新，可用手机相机扫描。') : valid ? t('正在本地生成二维码…') : t('输入内容后，预览会自动出现。'))}</p>
      </section>
    </div>
  </div>;
}

export default withLocale(QrWorkbench);
