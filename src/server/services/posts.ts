import type { D1Database } from '@cloudflare/workers-types';
import { countWords } from '@/lib/format';
import { slugify } from '@/lib/slug';
import type { PostDetail, PostStatus } from '@/types/domain';
import { execute, queryAll, queryOne } from '@/server/db/client';
import { getPostById, getPostBySlug } from '@/server/db/content';

export class PostValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'PostValidationError'; }
}

export interface PostInput {
  title: string;
  slug?: string;
  summary: string;
  content: string;
  coverImage?: string;
  status: PostStatus;
  categoryIds?: string[];
  tagIds?: string[];
}

function normalizeIds(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

async function assertSlugAvailable(db: D1Database, slug: string, excludeId?: string): Promise<void> {
  const row = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM posts WHERE slug = ? AND deleted_at IS NULL ${excludeId ? 'AND id <> ?' : ''} LIMIT 1`,
    excludeId ? [slug, excludeId] : [slug]
  );
  if (row) {
    throw new PostValidationError('文章路径已被占用，请换一个 slug');
  }
}

async function insertRelations(db: D1Database, postId: string, categoryIds: string[], tagIds: string[], operatorId: string): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  for (const [table, ids] of [['categories', categoryIds], ['tags', tagIds]] as const) {
    if (!ids.length) continue;
    const selected = JSON.stringify(ids);
    // A manager can delete a term after the editor loaded: reject stale selections atomically.
    statements.push(db.prepare(`SELECT CASE WHEN COUNT(*) = json_array_length(?) THEN 1 ELSE json('TAXONOMY_CHANGED') END
      FROM ${table} WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`).bind(selected, selected));
  }
  categoryIds.forEach((categoryId) => {
    statements.push(db.prepare('INSERT OR IGNORE INTO post_categories (post_id, category_id, created_by) VALUES (?, ?, ?)').bind(postId, categoryId, operatorId));
  });
  tagIds.forEach((tagId) => {
    statements.push(db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id, created_by) VALUES (?, ?, ?)').bind(postId, tagId, operatorId));
  });
  return statements;
}

export async function createPost(db: D1Database, input: PostInput, operatorId: string): Promise<PostDetail> {
  const slug = slugify(input.slug?.trim() || input.title);
  await assertSlugAvailable(db, slug);
  const id = crypto.randomUUID();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const status = input.status;
  const publishedAt = status === 'published' ? now : null;
  const statements = [
    db.prepare(
      `INSERT INTO posts (id, title, slug, summary, content, cover_image, status, author_id, view_count, word_count, published_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).bind(id, input.title.trim(), slug, input.summary.trim(), input.content, input.coverImage ?? '', status, operatorId, countWords(input.content), publishedAt, operatorId, operatorId),
    ...(await insertRelations(db, id, normalizeIds(input.categoryIds), normalizeIds(input.tagIds), operatorId))
  ];
  await db.batch(statements);
  const post = await getPostById(db, id);
  if (!post) {
    throw new Error('文章创建后读取失败');
  }
  return post;
}

export async function updatePost(db: D1Database, id: string, input: PostInput, operatorId: string): Promise<PostDetail> {
  const slug = slugify(input.slug?.trim() || input.title);
  await assertSlugAvailable(db, slug, id);
  const current = await getPostById(db, id);
  if (!current) {
    throw new PostValidationError('文章不存在');
  }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const publishedAt = input.status === 'published' ? (current.publishedAt ?? now) : null;
  const statements = [
    db.prepare(
      `UPDATE posts
       SET title = ?, slug = ?, summary = ?, content = ?, cover_image = ?, status = ?, word_count = ?, published_at = ?,
           updated_at = datetime('now'), updated_by = ?, version = version + 1
       WHERE id = ? AND deleted_at IS NULL`
    ).bind(input.title.trim(), slug, input.summary.trim(), input.content, input.coverImage ?? '', input.status, countWords(input.content), publishedAt, operatorId, id),
    db.prepare('DELETE FROM post_categories WHERE post_id = ?').bind(id),
    db.prepare('DELETE FROM post_tags WHERE post_id = ?').bind(id),
    ...(await insertRelations(db, id, normalizeIds(input.categoryIds), normalizeIds(input.tagIds), operatorId))
  ];
  await db.batch(statements);
  const post = await getPostById(db, id);
  if (!post) {
    throw new Error('文章更新后读取失败');
  }
  return post;
}

export async function softDeletePost(db: D1Database, id: string, operatorId: string): Promise<void> {
  await execute(db, `UPDATE posts SET deleted_at = datetime('now'), updated_at = datetime('now'), updated_by = ?, version = version + 1 WHERE id = ? AND deleted_at IS NULL`, [operatorId, id]);
}

export async function getAdminPost(db: D1Database, id: string): Promise<PostDetail | null> {
  return getPostById(db, id);
}

export async function getPublicPost(db: D1Database, slug: string): Promise<PostDetail | null> {
  return getPostBySlug(db, slug, false);
}

export async function listSelectableTaxonomy(db: D1Database): Promise<{ categories: Array<{ id: string; name: string }>; tags: Array<{ id: string; name: string }> }> {
  const [categories, tags] = await Promise.all([
    queryAll<{ id: string; name: string }>(db, 'SELECT id, name FROM categories WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC'),
    queryAll<{ id: string; name: string }>(db, 'SELECT id, name FROM tags WHERE deleted_at IS NULL ORDER BY name ASC')
  ]);
  return { categories, tags };
}
