import { sha256Hex } from '@/server/auth/crypto';
import { archiveSourceId, findImportHeads } from '@/server/db/archive-imports';
import { findPostCopySource, postArchiveStatements } from '@/server/db/post-archives';
import type { ImportWritePlan } from '@/server/db/archive-import-writes';
import { findPostArchiveSnapshots, findPostLabels, type PostArchiveSnapshot, type PostLabel } from '@/server/db/post-actions';
import { importItemSchema, type ImportRunInput, type ImportRunRow } from '@/server/services/archive-import-model';
import { PostActionError } from '@/server/services/post-action-model';
import { assertSelectedPosts } from '@/server/services/post-actions';
import { archiveTaxonomyIds } from '@/server/services/archive-taxonomy';
import { prepareArchiveText } from '@/server/services/archive-text';
import type { PostArchiveResult } from '@/types/post-actions';

const SOURCE = { provider: 'blog', namespace: 'post-copies', name: '普通文章转存' };
function labelsByPost(labels: PostLabel[]) {
  const result = new Map<string, string[]>();
  for (const label of labels) result.set(label.postId, [...(result.get(label.postId) ?? []), label.name]);
  return result;
}
async function copyPlan(post: PostArchiveSnapshot, context: {
  categories: Map<string, string[]>; tags: Map<string, string[]>; run: ImportRunRow; operator: string;
}): Promise<ImportWritePlan> {
  const input = importItemSchema.safeParse({ docId: post.id, title: post.title, rawContent: post.content,
    expectedVersion: 0, expectedHead: null, sourcePath: '/post/' + post.slug, sourceUrl: '',
    metadata: { categories: context.categories.get(post.id) ?? [], tags: context.tags.get(post.id) ?? [] } });
  if (!input.success || post.content.includes('\0')) {
    throw new PostActionError('ARCHIVE_COPY_INVALID', '所选文章超出档案限制：标题 200 字、正文 100000 字、分类 10 项、标签 20 项，且不能包含空字节；请缩小范围或整理后再转存', 422);
  }
  const { expectedVersion: _version, expectedHead: _head, ...payload } = input.data;
  const text = await prepareArchiveText(input.data);
  const operationHash = await sha256Hex(JSON.stringify([context.run.id, post.id]));
  return { run: context.run, input: input.data, head: null, text,
    archiveId: 'arc_' + await sha256Hex(JSON.stringify([context.run.sourceId, post.id])),
    operationId: 'imp_' + operationHash, versionId: 'ver_' + operationHash,
    requestHash: await sha256Hex(JSON.stringify(payload)), action: 'created',
    taxonomy: await archiveTaxonomyIds(text.metadata), operator: context.operator };
}

export async function copyPostsToArchives(db: D1Database, ids: string[], operator: string): Promise<PostArchiveResult> {
  const posts = await findPostArchiveSnapshots(db, ids);
  assertSelectedPosts(posts, ids);
  const sourceId = await archiveSourceId(SOURCE);
  const source = await findPostCopySource(db, sourceId);
  if (source?.deletedAt) throw new PostActionError('ARCHIVE_COPY_SOURCE_DELETED', '文章转存来源已停用，请先人工核对来源状态');
  const heads = await findImportHeads(db, sourceId, ids);
  if (heads.some((head) => head.deletedAt)) {
    throw new PostActionError('ARCHIVE_COPY_DELETED', '所选文章曾转存的档案已删除；为避免重复建档，本次不自动重建，请取消勾选对应文章');
  }
  const existing = new Map(heads.map((head) => [head.docId, head]));
  const pending = posts.filter((post) => !existing.has(post.id));
  const items: PostArchiveResult['items'] = heads.map((head) => ({ postId: head.docId, archiveId: head.id, action: 'existing' }));
  if (!pending.length) return { items };
  const pendingIds = pending.map((post) => post.id);
  const [categories, tags] = await Promise.all([
    findPostLabels(db, pendingIds, 'categories'), findPostLabels(db, pendingIds, 'tags')
  ]);
  const input: ImportRunInput = { runId: 'postcopy_' + crypto.randomUUID(), source: SOURCE,
    manifestHash: await sha256Hex(JSON.stringify(pending.map((post) => [post.id, post.version]).sort())), expectedItems: pending.length };
  const run: ImportRunRow = { id: input.runId, sourceId, manifestHash: input.manifestHash, expectedItems: pending.length, status: 'running' };
  const context = { run, operator, categories: labelsByPost(categories), tags: labelsByPost(tags) };
  const plans = await Promise.all(pending.map((post) => copyPlan(post, context)));
  try {
    await db.batch(postArchiveStatements(db, input, run, plans, pending, operator));
  } catch {
    // No raw database errors: bindings may contain the entire private Markdown.
    throw new PostActionError('ARCHIVE_COPY_RECHECK', '转档结果待核对，请刷新后重试；并发修改或转档可能导致本次整批取消，重试不会重复建档');
  }
  return { items: [...items, ...plans.map((plan) => ({ postId: plan.input.docId, archiveId: plan.archiveId, action: 'created' as const }))] };
}
