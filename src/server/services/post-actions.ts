import { findLinkedPosts, findPostSnapshots, findTaxonomyIds, hasArchivePublicationTable, postBatchStatements, postSnapshotGuard, type PostSnapshot } from '@/server/db/post-actions';
import { PostActionError } from '@/server/services/post-action-model';
import type { PostBatchInput, PostBatchResult } from '@/types/post-actions';

export function assertSelectedPosts(posts: PostSnapshot[], ids: string[]) {
  if (posts.length !== ids.length) {
    throw new PostActionError('POST_SELECTION_CHANGED', '部分文章不存在或已删除，请刷新列表后重新选择', 404);
  }
}
export async function applyPostBatch(db: D1Database, input: PostBatchInput, operator: string): Promise<PostBatchResult> {
  const posts = await findPostSnapshots(db, input.ids);
  assertSelectedPosts(posts, input.ids);
  const checksArchiveBinding = ['publish', 'categories', 'tags'].includes(input.action);
  const archiveSupport = checksArchiveBinding && await hasArchivePublicationTable(db);
  const linkedPosts = archiveSupport ? await findLinkedPosts(db, input.ids) : [];
  if (input.action === 'publish' && linkedPosts.length) {
    throw new PostActionError('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED', '所选内容包含档案关联稿，请取消勾选，并从私人档案关联记录逐篇审阅发布');
  }
  if (input.action === 'categories' || input.action === 'tags') {
    const ids = input.taxonomyIds ?? [];
    const terms = await findTaxonomyIds(db, ids, input.action);
    if (terms.length !== ids.length) {
      throw new PostActionError('TAXONOMY_NOT_FOUND', '所选分类或标签已失效，请刷新后重试', 422);
    }
    const linked = new Set(linkedPosts.map((item) => item.postId));
    if (posts.some((post) => post.status === 'published' && linked.has(post.id))) {
      throw new PostActionError('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED', '已发布的档案关联稿须先撤回草稿，再修改分类或标签并重新审阅');
    }
  }
  try {
    await db.batch([postSnapshotGuard(db, posts), ...postBatchStatements(db, input, operator, archiveSupport)]);
    const targetStatus = input.action === 'publish' ? 'draft' : 'published';
    const statusAction = input.action === 'publish' || input.action === 'draft';
    return { affected: statusAction ? posts.filter((post) => post.status === targetStatus).length : posts.length };
  } catch {
    throw new PostActionError('POST_BATCH_RECHECK', '操作结果待核对：文章版本或关联状态可能已变化，请刷新列表核对后重试');
  }
}
