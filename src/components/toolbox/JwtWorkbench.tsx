import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useState } from 'react';
import { claimDate, decodeJwt, JWT_SAMPLE, type JwtResult } from '@/lib/jwt-tools';
import CopyButton from './CopyButton';

function JwtWorkbench() {
  const { t } = useI18n();
  const [source, setSource] = useState('');
  const [result, setResult] = useState<JwtResult | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!result) return;
    setNow(Date.now() / 1000);
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [result]);
  function change(value: string) { setSource(value); setResult(null); setError(''); }
  function analyze() {
    try { setResult(decodeJwt(source)); setNow(Date.now() / 1000); setError(''); }
    catch (cause) { setResult(null); setError(cause instanceof Error ? cause.message : '解析失败，请检查输入。'); }
  }
  const payload = result?.payload;
  const expiry = payload?.exp;
  const notBefore = payload?.nbf;
  const timeStatus = typeof expiry === 'number' && expiry <= now ? '按 exp 声明已过期' : typeof notBefore === 'number' && notBefore > now ? '按 nbf 声明尚未生效' : '仅解析声明，不代表令牌有效';
  return <div className="tool-workspace">
    <p className="tool-safety-note"><strong>{t("只解析，不验签。")}</strong>{t("内容可被伪造，不可用于确认身份或授权；请勿分享真实令牌。")}</p>
    <div className="tool-toolbar"><button type="button" className="btn btn-ghost" onClick={() => change(JWT_SAMPLE)}>{t("填入示例")}</button><button type="button" className="btn btn-ghost" onClick={() => change('')}>{t("清空")}</button><span className="tool-note">{t("支持 Bearer 前缀")}</span></div>
    <div className="tool-columns tool-transform-columns">
      <label className="tool-field" htmlFor="jwt-source"><span>{t("JWT 令牌")}<small>{source.length.toLocaleString()} / 32,768</small></span><textarea id="jwt-source" className="tool-code" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={32768} value={source} placeholder="eyJhbGciOi… . eyJzdWIiOi… . signature" onChange={(e) => change(e.target.value)} /></label>
      <div className="tool-transform-actions"><button type="button" className="btn btn-primary" disabled={!source.trim()} onClick={analyze}>{t("解析令牌")}</button></div>
      <div className="tool-field"><div className="tool-field-heading"><span>{t("解析结果")}</span>{result && <CopyButton text={JSON.stringify({ header: result.header, payload: result.payload }, null, 2)} label={t("复制 JSON")} />}</div>
        {result ? <div className="tool-jwt-result tool-reveal"><p className="tool-result-caption">Header</p><pre>{JSON.stringify(result.header, null, 2)}</pre><p className="tool-result-caption">Payload</p><pre>{JSON.stringify(result.payload, null, 2)}</pre></div> : <div className="tool-empty-state"><span className="tool-empty-symbol" aria-hidden="true">{'{ }'}</span><p>{t("看看令牌里写了什么")}</p><small>{t("Header、Payload 和时间声明会显示在这里")}</small></div>}
      </div>
    </div>
    {error && <p className="tool-error" role="alert">{t(error)}</p>}
    {result && <section className="tool-detail-section tool-reveal" aria-label={t("时间声明")}><div className="tool-section-heading"><h2>{t("时间声明")}</h2><span className="tool-note" role="status">{t(timeStatus)}</span></div><dl className="tool-result-list">{(['iat', 'nbf', 'exp'] as const).map((key) => <div key={key}><div><dt>{key} · {key === 'iat' ? t('签发时间') : key === 'nbf' ? t('生效时间') : t('过期时间')}</dt><dd>{Object.hasOwn(result.payload, key) ? t(claimDate(result.payload[key])) : t('未提供')}</dd></div><code>{Object.hasOwn(result.payload, key) ? JSON.stringify(result.payload[key]) : '—'}</code></div>)}</dl><p className="tool-note">{t("签名：")}{result.signaturePresent ? t('存在，但未验证') : t('为空，未签名')}{t("。时间状态仅参考本机时钟与未验证的声明。")}</p></section>}
  </div>;
}

export default withLocale(JwtWorkbench);
