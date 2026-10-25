import { useI18n } from '@/lib/i18n/react';
import { MAX_FRIENDS, type FriendLink } from '@/lib/friends';

export default function FriendLinksEditor({ friends, onChange }: { friends: FriendLink[]; onChange: (friends: FriendLink[]) => void }) {
  const { t } = useI18n();
  function update(index: number, patch: Partial<FriendLink>) {
    onChange(friends.map((friend, position) => position === index ? { ...friend, ...patch } : friend));
  }
  function move(index: number, offset: number) {
    const next = [...friends];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }
  return <section className="admin-span-full" aria-labelledby="friend-links-heading">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <h3 id="friend-links-heading" className="admin-field-label !mb-0">{t('友人帐 · 友链')}</h3>
      <button type="button" className="btn" disabled={friends.length >= MAX_FRIENDS} onClick={() => onChange([...friends, { name: '', url: '', desc: '' }])}>{t('＋ 添加友链')}</button>
    </div>
    <p className="text-xs text-muted mb-3">{t('按列表顺序展示在友人帐，保存设置后生效。最多 100 项。')}</p>
    {friends.map((friend, index) => <fieldset key={index} className="admin-friend-card">
      <legend className="admin-field-label">{t('友链 {0}', index + 1)}</legend>
      <div className="admin-settings-grid">
        <div><label className="admin-field-label" htmlFor={`friend-name-${index}`}>{t('站点名称')}</label><input id={`friend-name-${index}`} className="field" required maxLength={100} value={friend.name} onChange={(event) => update(index, { name: event.target.value })} /></div>
        <div><label className="admin-field-label" htmlFor={`friend-url-${index}`}>{t('站点地址')}</label><input id={`friend-url-${index}`} className="field" type="url" required maxLength={500} placeholder="https://…" value={friend.url} onChange={(event) => update(index, { url: event.target.value })} /></div>
        <div className="admin-span-full"><label className="admin-field-label" htmlFor={`friend-desc-${index}`}>{t('简介（选填）')}</label><input id={`friend-desc-${index}`} className="field" maxLength={500} value={friend.desc ?? ''} onChange={(event) => update(index, { desc: event.target.value })} /></div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className="btn btn-ghost" disabled={index === 0} aria-label={t('上移友链 {0}', index + 1)} onClick={() => move(index, -1)}>{t('上移')}</button>
        <button type="button" className="btn btn-ghost" disabled={index === friends.length - 1} aria-label={t('下移友链 {0}', index + 1)} onClick={() => move(index, 1)}>{t('下移')}</button>
        <button type="button" className="btn btn-ghost" aria-label={t('移除友链 {0}', index + 1)} onClick={() => { if (window.confirm(t('确定移除这条友链？保存设置后生效。'))) onChange(friends.filter((_, position) => position !== index)); }}>{t('移除')}</button>
      </div>
    </fieldset>)}
    {!friends.length && <p className="text-xs text-muted">{t('还没有友链，添加一位朋友吧。')}</p>}
  </section>;
}
