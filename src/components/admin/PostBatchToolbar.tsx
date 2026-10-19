import { useState } from 'react';
import type { PostBatchAction, PostTaxonomy } from '@/types/post-actions';

export type PostManagerAction = PostBatchAction | 'archive';
export const POST_ACTION_LABELS: Record<PostManagerAction, string> = {
  archive: '转存私人档案', publish: '发布', draft: '撤回草稿', delete: '删除', categories: '替换分类', tags: '替换标签'
};
export default function PostBatchToolbar({ count, disabled, taxonomy, onApply, onClear }: {
  count: number; disabled: boolean; taxonomy: PostTaxonomy;
  onApply: (action: PostManagerAction, taxonomyIds?: string[]) => void; onClear: () => void;
}) {
  const [action, setAction] = useState<PostManagerAction>('archive');
  const [terms, setTerms] = useState<string[]>([]);
  const editingTaxonomy = action === 'categories' || action === 'tags';
  const options = action === 'categories' ? taxonomy.categories : taxonomy.tags;
  return <div className="post-batch-toolbar">
    <div className="admin-toolbar">
      <span role="status" aria-live="polite">已选 {count} 篇（仅当前页）</span>
      <button type="button" className="btn btn-ghost" disabled={disabled || !count} onClick={onClear}>取消选择</button>
      <select className="field" aria-label="批量操作" value={action} disabled={disabled} onChange={(event) => {
        setAction(event.target.value as PostManagerAction); setTerms([]);
      }}>
        {Object.entries(POST_ACTION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      <button type="button" className="btn" disabled={disabled || !count} onClick={() => onApply(action, editingTaxonomy ? terms : undefined)}>对所选文章执行</button>
    </div>
    {editingTaxonomy && <fieldset className="post-batch-terms" disabled={disabled}>
      <legend>目标{action === 'categories' ? '分类' : '标签'}：替换所选文章原有项目，未勾选任何项表示清空（最多 20 项）</legend>
      <div>{options.map((term) => <label key={term.id}>
        <input type="checkbox" checked={terms.includes(term.id)} disabled={!terms.includes(term.id) && terms.length >= 20} onChange={(event) => {
          setTerms((previous) => event.target.checked ? [...previous, term.id] : previous.filter((id) => id !== term.id));
        }} />{term.name}
      </label>)}</div>
      {!options.length && <p>暂无可选项目；执行将清空文章现有项目。</p>}
    </fieldset>}
    <p className="post-batch-hint">转档保留原文，且不会同步覆盖已建档案。档案关联稿不能批量发布，须在私人档案中逐篇审阅。</p>
  </div>;
}
