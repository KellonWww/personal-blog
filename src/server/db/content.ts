import type { D1Database } from '@cloudflare/workers-types';
import type { Category, PostDetail, PostSummary, SiteSummary, Tag } from '@/types/domain';
import { placeholders, queryAll, queryOne } from './client';
import { hasArchivePublicationTable } from './post-actions';

interface PostRow {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  cover_image: string;
  status: 'draft' | 'published';
  author_id: string;
  view_count: number;
  word_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_avatar: string;
}

interface TaxonomyRow {
  post_id: string;
  id: string;
  name: string;
  slug: string;
  description?: string;
  parent_id?: string;
  sort_order?: number;
}

export interface PostQuery {
  search?: string;
  categoryId?: string;
  privateDocument?: boolean;
  order?: 'updated';
  page?: number;
  pageSize?: number;
  category?: string;
  tag?: string;
  year?: string;
  month?: string;
  status?: 'published' | 'draft' | 'all';
}

function mapPost(row: PostRow): PostSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    coverImage: row.cover_image,
    status: row.status,
    authorId: row.author_id,
    authorName: row.author_name || '站点主人',
    authorAvatar: row.author_avatar,
    viewCount: row.view_count,
    wordCount: row.word_count,
    commentCount: 0,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    categories: [],
    tags: []
  };
}

const PARAM_CHUNK_SIZE = 90;

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

async function loadTaxonomy(db: D1Database, postIds: string[]): Promise<Map<string, { categories: Category[]; tags: Tag[] }>> {
  const result = new Map<string, { categories: Category[]; tags: Tag[] }>();
  postIds.forEach((postId) => result.set(postId, { categories: [], tags: [] }));
  if (postIds.length === 0) {
    return result;
  }
  for (const ids of chunk(postIds, PARAM_CHUNK_SIZE)) {
    const marks = placeholders(ids.length);
    const [categoryRows, tagRows] = await Promise.all([
      queryAll<TaxonomyRow>(
        db,
        `SELECT pc.post_id, c.id, c.name, c.slug, c.description, c.parent_id, c.sort_order
         FROM post_categories pc
         JOIN categories c ON c.id = pc.category_id
         WHERE pc.post_id IN (${marks}) AND c.deleted_at IS NULL`,
        ids
      ),
      queryAll<TaxonomyRow>(
        db,
        `SELECT pt.post_id, t.id, t.name, t.slug
         FROM post_tags pt
         JOIN tags t ON t.id = pt.tag_id
         WHERE pt.post_id IN (${marks}) AND t.deleted_at IS NULL`,
        ids
      )
    ]);
    categoryRows.forEach((row) => {
      result.get(row.post_id)?.categories.push({
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description ?? '',
        parentId: row.parent_id ?? '',
        sortOrder: row.sort_order ?? 0
      });
    });
    tagRows.forEach((row) => {
      result.get(row.post_id)?.tags.push({ id: row.id, name: row.name, slug: row.slug });
    });
  }
  return result;
}

async function loadCommentCounts(db: D1Database, postIds: string[]): Promise<Map<string, number>> {
  if (postIds.length === 0) {
    return new Map();
  }
  const counts = new Map<string, number>();
  for (const ids of chunk(postIds, PARAM_CHUNK_SIZE)) {
    const rows = await queryAll<{ post_id: string; comment_count: number }>(
      db,
      `SELECT post_id, COUNT(*) AS comment_count
       FROM comments
       WHERE deleted_at IS NULL AND status = 'approved' AND post_id IN (${placeholders(ids.length)})
       GROUP BY post_id`,
      ids
    );
    rows.forEach((row) => counts.set(row.post_id, Number(row.comment_count)));
  }
  return counts;
}

async function decoratePosts(db: D1Database, rows: PostRow[]): Promise<PostSummary[]> {
  const posts = rows.map(mapPost);
  const ids = posts.map((post) => post.id);
  const [taxonomy, counts] = await Promise.all([loadTaxonomy(db, ids), loadCommentCounts(db, ids)]);
  return posts.map((post) => {
    const item = taxonomy.get(post.id);
    return {
      ...post,
      categories: item?.categories ?? [],
      tags: item?.tags ?? [],
      commentCount: counts.get(post.id) ?? 0
    };
  });
}

export async function listPosts(db: D1Database, query: PostQuery = {}): Promise<{ items: PostSummary[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 10)));
  const status = query.status ?? 'published';
  const conditions: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (status !== 'all') {
    conditions.push('p.status = ?');
    params.push(status);
  }
  if (query.privateDocument !== undefined) {
    const archiveSupport = await hasArchivePublicationTable(db);
    // Keep the same binding semantics as the private archive publication guard, including tombstones.
    if (archiveSupport) {
      conditions.push((query.privateDocument ? 'EXISTS' : 'NOT EXISTS') +
        ' (SELECT 1 FROM archive_publications a WHERE a.post_id = p.id)');
    } else if (query.privateDocument) {
      conditions.push('1 = 0');
    }
  }
  if (query.search?.trim()) {
    conditions.push('instr(lower(p.title || char(32) || p.summary || char(32) || p.slug), lower(?)) > 0');
    params.push(query.search.trim().slice(0, 200));
  }
  if (query.categoryId) {
    conditions.push('EXISTS (SELECT 1 FROM post_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.post_id = p.id AND c.id = ? AND c.deleted_at IS NULL)');
    params.push(query.categoryId);
  }
  if (query.category) {
    conditions.push('EXISTS (SELECT 1 FROM post_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.post_id = p.id AND c.slug = ? AND c.deleted_at IS NULL)');
    params.push(query.category);
  }
  if (query.tag) {
    conditions.push('EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id AND t.slug = ? AND t.deleted_at IS NULL)');
    params.push(query.tag);
  }
  if (query.year) {
    conditions.push("strftime('%Y', p.published_at) = ?");
    params.push(query.year);
  }
  if (query.month) {
    conditions.push("strftime('%m', p.published_at) = ?");
    params.push(query.month.padStart(2, '0'));
  }
  const where = conditions.join(' AND ');
  const countRow = await queryOne<{ total: number }>(db, `SELECT COUNT(*) AS total FROM posts p WHERE ${where}`, params);
  const total = Number(countRow?.total ?? 0);
  const rows = await queryAll<PostRow>(
    db,
    `SELECT p.id, p.title, p.slug, p.summary, p.content, p.cover_image, p.status, p.author_id,
            p.view_count, p.word_count, p.published_at, p.created_at, p.updated_at,
            COALESCE(u.display_name, u.username, '') AS author_name,
            COALESCE(u.avatar_url, '') AS author_avatar
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE ${where}
     ORDER BY ${query.order === 'updated' ? 'p.updated_at DESC, p.id DESC' : 'COALESCE(p.published_at, p.created_at) DESC, p.created_at DESC, p.id DESC'}
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    items: await decoratePosts(db, rows),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

export async function getPostBySlug(db: D1Database, slug: string, includeDraft = false): Promise<PostDetail | null> {
  const row = await queryOne<PostRow>(
    db,
    `SELECT p.id, p.title, p.slug, p.summary, p.content, p.cover_image, p.status, p.author_id,
            p.view_count, p.word_count, p.published_at, p.created_at, p.updated_at,
            COALESCE(u.display_name, u.username, '') AS author_name,
            COALESCE(u.avatar_url, '') AS author_avatar
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.slug = ? AND p.deleted_at IS NULL ${includeDraft ? '' : "AND p.status = 'published'"}
     LIMIT 1`,
    [slug]
  );
  if (!row) {
    return null;
  }
  const [post] = await decoratePosts(db, [row]);
  if (!post) {
    return null;
  }
  return { ...post, content: row.content };
}

export async function getPostById(db: D1Database, id: string): Promise<PostDetail | null> {
  const row = await queryOne<PostRow>(
    db,
    `SELECT p.id, p.title, p.slug, p.summary, p.content, p.cover_image, p.status, p.author_id,
            p.view_count, p.word_count, p.published_at, p.created_at, p.updated_at,
            COALESCE(u.display_name, u.username, '') AS author_name,
            COALESCE(u.avatar_url, '') AS author_avatar
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.id = ? AND p.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  if (!row) {
    return null;
  }
  const [post] = await decoratePosts(db, [row]);
  return post ? { ...post, content: row.content } : null;
}

export async function getRelatedPosts(db: D1Database, post: PostDetail, limit = 3): Promise<PostSummary[]> {
  const tagIds = post.tags.map((tag) => tag.id).slice(0, PARAM_CHUNK_SIZE - 4);
  if (tagIds.length === 0) {
    return [];
  }
  const rows = await queryAll<PostRow>(
    db,
    `SELECT DISTINCT p.id, p.title, p.slug, p.summary, p.cover_image, p.status, p.author_id,
            p.view_count, p.word_count, p.published_at, p.created_at, p.updated_at, p.content,
            COALESCE(u.display_name, u.username, '') AS author_name,
            COALESCE(u.avatar_url, '') AS author_avatar
     FROM posts p
     JOIN post_tags pt ON pt.post_id = p.id
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.id <> ?
       AND pt.tag_id IN (${placeholders(tagIds.length)})
     ORDER BY COALESCE(p.published_at, p.created_at) DESC
     LIMIT ?`,
    [post.id, ...tagIds, limit]
  );
  return decoratePosts(db, rows);
}

export async function listTags(db: D1Database): Promise<Tag[]> {
  const rows = await queryAll<{ id: string; name: string; slug: string; post_count: number }>(
    db,
    `SELECT t.id, t.name, t.slug, COUNT(pt.post_id) AS post_count
     FROM tags t
     LEFT JOIN post_tags pt ON pt.tag_id = t.id
     LEFT JOIN posts p ON p.id = pt.post_id AND p.status = 'published' AND p.deleted_at IS NULL
     WHERE t.deleted_at IS NULL
     GROUP BY t.id
     ORDER BY post_count DESC, t.name ASC`
  );
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, postCount: Number(row.post_count) }));
}

export async function listCategories(db: D1Database): Promise<Category[]> {
  const rows = await queryAll<{ id: string; name: string; slug: string; description: string; parent_id: string; sort_order: number; post_count: number }>(
    db,
    `SELECT c.id, c.name, c.slug, c.description, c.parent_id, c.sort_order, COUNT(pc.post_id) AS post_count
     FROM categories c
     LEFT JOIN post_categories pc ON pc.category_id = c.id
     LEFT JOIN posts p ON p.id = pc.post_id AND p.status = 'published' AND p.deleted_at IS NULL
     WHERE c.deleted_at IS NULL
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.name ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    parentId: row.parent_id,
    sortOrder: Number(row.sort_order),
    postCount: Number(row.post_count)
  }));
}

export async function listArchive(db: D1Database): Promise<Array<{ month: string; count: number }>> {
  return queryAll<{ month: string; count: number }>(
    db,
    `SELECT strftime('%Y-%m', COALESCE(published_at, created_at)) AS month, COUNT(*) AS count
     FROM posts
     WHERE status = 'published' AND deleted_at IS NULL
     GROUP BY month
     ORDER BY month DESC`
  );
}

export async function getSiteSummary(db: D1Database): Promise<SiteSummary> {
  const row = await queryOne<{ post_count: number; total_words: number; total_views: number }>(
    db,
    `SELECT COUNT(*) AS post_count, COALESCE(SUM(word_count), 0) AS total_words, COALESCE(SUM(view_count), 0) AS total_views
     FROM posts WHERE status = 'published' AND deleted_at IS NULL`
  );
  const [comments, guestbook] = await Promise.all([
    queryOne<{ count: number }>(db, `SELECT COUNT(*) AS count FROM comments WHERE status = 'approved' AND deleted_at IS NULL`),
    queryOne<{ count: number }>(db, `SELECT COUNT(*) AS count FROM guestbook WHERE status = 'approved' AND deleted_at IS NULL`)
  ]);
  return {
    postCount: Number(row?.post_count ?? 0),
    totalWords: Number(row?.total_words ?? 0),
    totalViews: Number(row?.total_views ?? 0),
    commentCount: Number(comments?.count ?? 0),
    guestbookCount: Number(guestbook?.count ?? 0),
    runningDays: 0
  };
}

export async function incrementPostView(db: D1Database, postId: string): Promise<void> {
  await db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ? AND deleted_at IS NULL').bind(postId).run();
}

export interface SearchIndexItem {
  id: string;
  title: string;
  slug: string;
  summary: string;
  publishedAt: string | null;
  wordCount: number;
  tags: string[];
  categories: string[];
}

export async function listSearchIndex(db: D1Database): Promise<SearchIndexItem[]> {
  const rows = await queryAll<PostRow>(
    db,
    `SELECT p.id, p.title, p.slug, p.summary, p.content, p.cover_image, p.status, p.author_id,
            p.view_count, p.word_count, p.published_at, p.created_at, p.updated_at,
            COALESCE(u.display_name, u.username, '') AS author_name,
            COALESCE(u.avatar_url, '') AS author_avatar
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.status = 'published' AND p.deleted_at IS NULL
     ORDER BY COALESCE(p.published_at, p.created_at) DESC`
  );
  const decorated = await decoratePosts(db, rows);
  return decorated.map((post) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    summary: post.summary,
    publishedAt: post.publishedAt,
    wordCount: post.wordCount,
    tags: post.tags.map((tag) => tag.name),
    categories: post.categories.map((category) => category.name)
  }));
}

export async function listPublishedSummaries(db: D1Database, limit = 500): Promise<PostSummary[]> {
  const rows = await queryAll<PostRow>(
    db,
    `SELECT p.id, p.title, p.slug, p.summary, p.content, p.cover_image, p.status, p.author_id,
            p.view_count, p.word_count, p.published_at, p.created_at, p.updated_at,
            COALESCE(u.display_name, u.username, '') AS author_name,
            COALESCE(u.avatar_url, '') AS author_avatar
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.status = 'published' AND p.deleted_at IS NULL
     ORDER BY COALESCE(p.published_at, p.created_at) DESC
     LIMIT ?`,
    [limit]
  );
  return decoratePosts(db, rows);
}
