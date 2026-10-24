import { useI18n, withLocale } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { adminRequest, adminWrite, errorMessage } from '@/lib/admin-api';

const FIELDS = [
  { key: 'profile.name', label: '站点名称', placeholder: 'Kale的数字花园', max: 100 },
  { key: 'profile.motto', label: '园主短句', placeholder: '把日子码成可检索的形状。', max: 200 },
  { key: 'profile.bio', label: '个人简介', placeholder: '介绍一下自己…', max: 500 },
  { key: 'profile.avatar', label: '头像地址', placeholder: 'https://… 或站内图片路径', max: 500 },
  { key: 'site.announcement', label: '站点公告', placeholder: '想告诉读者的近况', max: 1000 },
  { key: 'site.icp', label: '备案信息', placeholder: '没有则留空', max: 100 },
  { key: 'site.started_at', label: '建站日期', placeholder: '', max: 10, type: 'date' }
];

function SiteSettings({ token, onDirtyChange }: { token: string; onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const dirty = !!initial && JSON.stringify(values) !== initial;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    adminRequest<{ settings: Record<string, string> }>('/api/admin/settings', { signal: controller.signal }).then(({ settings }) => {
      const next = Object.fromEntries([...FIELDS.map((field) => field.key), 'site.about', 'site.social_links'].map((key) => [key, settings[key] ?? (key === 'site.social_links' ? '[]' : '')]));
      const links: unknown = JSON.parse(next['site.social_links'] ?? '[]');
      if (!Array.isArray(links) || !links.every((item) => item && typeof item === 'object' && typeof item.label === 'string' && typeof item.url === 'string')) throw new Error('已有社交链接格式异常，请先检查站点配置');
      setValues(next); setInitial(JSON.stringify(next));
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const socialLinks: Array<{ label: string; url: string }> = (() => {
    try { return JSON.parse(values['site.social_links'] || '[]') as Array<{ label: string; url: string }>; } catch { return []; }
  })();
  function changeLinks(links: Array<{ label: string; url: string }>) { setValues({ ...values, 'site.social_links': JSON.stringify(links) }); }

  async function save() {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError(''); setMessage('');
    try {
      const links: unknown = JSON.parse(values['site.social_links'] || '[]');
      if (!Array.isArray(links) || links.length > 20 || !links.every((item) => {
        if (!item || typeof item !== 'object' || typeof item.label !== 'string' || typeof item.url !== 'string' || !item.label.trim() || item.label.length > 100 || item.url.length > 500) return false;
        try { return ['http:', 'https:'].includes(new URL(item.url).protocol); } catch { return false; }
      })) throw new Error('社交链接最多 20 项，请填写名称和有效的 http(s) 地址');
      const snapshot = { ...values, 'site.social_links': JSON.stringify(links) };
      await adminRequest('/api/admin/settings', adminWrite(token, 'PUT', snapshot));
      setValues(snapshot); setInitial(JSON.stringify(snapshot)); setMessage('站点设置已保存，前台刷新后生效');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { lock.current = false; setSaving(false); }
  }

  if (loading) return <div role="status" className="admin-empty">{t("正在加载设置…")}</div>;
  if (!initial) return <div role="alert" className="admin-notice">{t(error)}<button type="button" className="btn" onClick={() => setRetry((value) => value + 1)}>{t("重试")}</button></div>;
  return <>
    {message && <p role="status" className="admin-notice">{t(message)}</p>}{error && <p role="alert" className="admin-notice">{t(error)}</p>}
    <form className="admin-panel" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="admin-panel-heading"><h2>{t("站点资料")}</h2><span className="text-xs text-muted">{dirty ? t('有未保存的修改') : t('与服务端同步')}</span></div>
      <fieldset disabled={saving} className="admin-settings-grid">
        {FIELDS.map((field) => <div key={field.key}><label htmlFor={field.key} className="admin-field-label">{t(field.label)}</label><input id={field.key} className="field" type={field.type ?? 'text'} value={values[field.key] ?? ''} maxLength={field.max} placeholder={t(field.placeholder)} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} /></div>)}
        <div className="admin-span-full"><label htmlFor="site.about" className="admin-field-label">{t("关于页面 · Markdown")}</label><textarea id="site.about" className="field min-h-48 font-mono" maxLength={20000} value={values['site.about'] ?? ''} onChange={(event) => setValues({ ...values, 'site.about': event.target.value })} /></div>
        <section className="admin-span-full"><div className="flex items-center justify-between mb-3"><h3 className="admin-field-label !mb-0">{t("社交链接")}</h3><button type="button" className="btn" disabled={socialLinks.length >= 20} onClick={() => changeLinks([...socialLinks, { label: '', url: '' }])}>{t("＋ 添加链接")}</button></div>
          {socialLinks.map((link, index) => <div className="admin-social-row" key={index}><input className="field" aria-label={t("链接 {0} 名称", index + 1)} placeholder={t("例如 GitHub")} maxLength={100} value={link.label} onChange={(event) => changeLinks(socialLinks.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} /><input className="field" type="url" aria-label={t("链接 {0} 地址", index + 1)} placeholder="https://…" maxLength={500} value={link.url} onChange={(event) => changeLinks(socialLinks.map((item, position) => position === index ? { ...item, url: event.target.value } : item))} /><button type="button" className="btn btn-ghost" aria-label={t("移除链接 {0}", index + 1)} onClick={() => changeLinks(socialLinks.filter((_, position) => position !== index))}>{t("移除")}</button></div>)}
          {!socialLinks.length && <p className="text-xs text-muted">{t("还没有社交链接，可添加 GitHub、个人主页等入口。")}</p>}
        </section>
      </fieldset>
      <div className="admin-pagination"><span>{t("只修改站点内容，不涉及登录密钥与基础设施配置。")}</span><button type="submit" className="btn btn-primary" disabled={saving || !dirty}>{saving ? t('保存中…') : t('保存设置')}</button></div>
    </form>
  </>;
}

export default withLocale(SiteSettings);
