-- ⚠️ 需牢大审核后人工执行；AI 不执行迁移、触发器或数据库写入。
-- 前置：0003→0004→0005→0006；先执行 rollback/0007 的只读盘点。
-- SQLite 项目既有公共审计字段；新增发布开关默认 false，专用密钥不得写入 Git。
-- 迁移必须由人工工具以事务执行，失败须整体回滚；不可单独删除旧门禁后停止。
-- 0006 的绑定 INSERT/DELETE 和帖子 INSERT/DELETE 保护继续保留。

CREATE VIEW archive_publication_snapshots AS
SELECT p.id AS publication_id, p.archive_id, b.id AS post_id, b.version AS post_version,
  json_object(
    'publicationId', p.id, 'archiveId', p.archive_id, 'sourceVersionId', p.version_id,
    'postId', b.id, 'postVersion', b.version, 'status', b.status,
    'title', b.title, 'slug', b.slug, 'summary', b.summary, 'content', b.content,
    'coverImage', b.cover_image, 'authorId', b.author_id,
    'authorName', COALESCE(u.display_name, u.username, ''), 'authorAvatar', COALESCE(u.avatar_url, ''),
    'wordCount', b.word_count,
    'categories', json((SELECT json_group_array(json_object('id', id, 'name', name, 'slug', slug))
      FROM (SELECT c.id, c.name, c.slug FROM post_categories pc JOIN categories c ON c.id = pc.category_id
        WHERE pc.post_id = b.id AND c.deleted_at IS NULL ORDER BY c.id))),
    'tags', json((SELECT json_group_array(json_object('id', id, 'name', name, 'slug', slug))
      FROM (SELECT t.id, t.name, t.slug FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.post_id = b.id AND t.deleted_at IS NULL ORDER BY t.id)))
  ) AS snapshot_json
FROM archive_publications p JOIN posts b ON b.id = p.post_id
LEFT JOIN users u ON u.id = b.author_id;

CREATE TABLE archive_publication_confirmations (
  id TEXT PRIMARY KEY NOT NULL,
  publication_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  expected_post_version INTEGER NOT NULL CHECK(expected_post_version >= 0 AND expected_post_version < 9007199254740991),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash) = 64),
  references_snapshot_json TEXT NOT NULL CHECK(json_valid(references_snapshot_json)),
  references_hash TEXT NOT NULL CHECK(length(references_hash) = 64),
  policy_version TEXT NOT NULL CHECK(policy_version = 'text-review-v2'),
  site_origin TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(publication_id, expected_post_version),
  FOREIGN KEY(publication_id) REFERENCES archive_publications(id),
  FOREIGN KEY(post_id) REFERENCES posts(id)
);
CREATE INDEX idx_archive_confirmations_post ON archive_publication_confirmations(post_id, expected_post_version);

-- BEFORE 校验与 AFTER 发布在一条 INSERT 中完成；任何触发器失败回滚整条语句。
CREATE TRIGGER archive_confirmation_guard BEFORE INSERT ON archive_publication_confirmations
WHEN NEW.created_by = '' OR NEW.updated_by IS NOT NEW.created_by
  OR NEW.created_at IS NOT datetime('now') OR NEW.updated_at IS NOT NEW.created_at
  OR NEW.deleted_at IS NOT NULL OR NEW.version != 0
  OR NEW.request_hash GLOB '*[^0-9a-f]*' OR NEW.snapshot_hash GLOB '*[^0-9a-f]*' OR NEW.references_hash GLOB '*[^0-9a-f]*'
  OR NEW.expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
  OR NEW.expires_at > CAST(strftime('%s', 'now') AS INTEGER) + 600
  OR json_type(NEW.references_snapshot_json) IS NOT 'array'
  OR json_array_length(NEW.references_snapshot_json) > 200
  OR EXISTS (SELECT 1 FROM json_each(NEW.references_snapshot_json)
    WHERE json_type(value) IS NOT 'object' OR json_extract(value, '$.verdict') IS NOT 'review')
  OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.created_by AND u.role = 'admin' AND u.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM archive_publication_confirmations c WHERE c.id = NEW.id
    OR c.operation_id = NEW.operation_id OR (c.publication_id = NEW.publication_id AND c.expected_post_version = NEW.expected_post_version))
  OR NOT EXISTS (
    SELECT 1 FROM archive_publications p JOIN posts b ON b.id = p.post_id
    JOIN archives a ON a.id = p.archive_id JOIN archive_sources s ON s.id = a.source_id
    JOIN archive_publication_snapshots v ON v.publication_id = p.id
    WHERE p.id = NEW.publication_id AND p.post_id = NEW.post_id
      AND p.deleted_at IS NULL AND b.deleted_at IS NULL AND a.deleted_at IS NULL AND s.deleted_at IS NULL
      AND a.conflict_state = 'none' AND b.status = 'draft' AND b.version = NEW.expected_post_version
      AND v.snapshot_json = NEW.snapshot_json AND length(NEW.snapshot_json) <= 200000
      AND length(b.content) <= 100000 AND instr(b.content, char(0)) = 0
      AND json_array_length(NEW.snapshot_json, '$.categories') <= 200
      AND json_array_length(NEW.snapshot_json, '$.tags') <= 200
  )
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_STALE');
END;
CREATE TRIGGER archive_confirmation_no_update BEFORE UPDATE ON archive_publication_confirmations
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_CONFIRMATION_IMMUTABLE'); END;
CREATE TRIGGER archive_confirmation_no_delete BEFORE DELETE ON archive_publication_confirmations
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_CONFIRMATION_IMMUTABLE'); END;

DROP TRIGGER archive_posts_draft_publish_guard;
CREATE TRIGGER archive_posts_draft_publish_guard BEFORE UPDATE ON posts
WHEN EXISTS (SELECT 1 FROM archive_publications p WHERE p.post_id = OLD.id OR p.post_id = NEW.id)
  AND NOT (
    NEW.id IS OLD.id AND (
      (NEW.status = 'draft' AND NEW.version = OLD.version + 1 AND OLD.version < 9007199254740991)
      OR (NEW.status = 'published' AND OLD.status = 'draft' AND NEW.version = OLD.version + 1
        AND NEW.id IS OLD.id
      AND NEW.title IS OLD.title
      AND NEW.slug IS OLD.slug
      AND NEW.summary IS OLD.summary
      AND NEW.content IS OLD.content
      AND NEW.cover_image IS OLD.cover_image
      AND NEW.author_id IS OLD.author_id
      AND NEW.word_count IS OLD.word_count
      AND NEW.view_count IS OLD.view_count
      AND NEW.created_at IS OLD.created_at
      AND NEW.created_by IS OLD.created_by
      AND NEW.deleted_at IS OLD.deleted_at
        AND EXISTS (SELECT 1 FROM archive_publication_confirmations c
          JOIN archive_publication_snapshots v ON v.publication_id = c.publication_id
          WHERE c.post_id = OLD.id AND c.expected_post_version = OLD.version
            AND c.snapshot_json = v.snapshot_json AND c.expires_at > CAST(strftime('%s', 'now') AS INTEGER)
            AND NEW.updated_by = c.created_by AND NEW.updated_at = c.created_at AND NEW.published_at = c.created_at))
      OR (OLD.status = 'published' AND NEW.view_count = OLD.view_count + 1
        AND NEW.id IS OLD.id
      AND NEW.title IS OLD.title
      AND NEW.slug IS OLD.slug
      AND NEW.summary IS OLD.summary
      AND NEW.content IS OLD.content
      AND NEW.cover_image IS OLD.cover_image
      AND NEW.author_id IS OLD.author_id
      AND NEW.word_count IS OLD.word_count
      AND NEW.created_at IS OLD.created_at
      AND NEW.created_by IS OLD.created_by
      AND NEW.deleted_at IS OLD.deleted_at
      AND NEW.status IS OLD.status
      AND NEW.published_at IS OLD.published_at
      AND NEW.updated_at IS OLD.updated_at
      AND NEW.updated_by IS OLD.updated_by
      AND NEW.version IS OLD.version)
    )
  )
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

DROP TRIGGER archive_publications_draft_no_update;
CREATE TRIGGER archive_publications_draft_no_update BEFORE UPDATE ON archive_publications
WHEN NEW.id IS NOT OLD.id
  OR NEW.archive_id IS NOT OLD.archive_id
  OR NEW.version_id IS NOT OLD.version_id
  OR NEW.post_id IS NOT OLD.post_id
  OR NEW.operation_id IS NOT OLD.operation_id
  OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.archive_sequence IS NOT OLD.archive_sequence
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.deleted_at IS NOT OLD.deleted_at
  OR NEW.version != OLD.version + 1
  OR NOT EXISTS (SELECT 1 FROM posts b WHERE b.id = OLD.post_id AND NEW.status = b.status
    AND NEW.updated_by = b.updated_by AND NEW.updated_at = b.updated_at)
  OR (NEW.status = 'draft' AND (NEW.confirmed_at IS NOT OLD.confirmed_at
    OR NEW.confirmed_by IS NOT OLD.confirmed_by OR NEW.confirmed_post_version IS NOT OLD.confirmed_post_version
    OR NEW.confirmed_content_hash IS NOT OLD.confirmed_content_hash OR NEW.references_snapshot_json IS NOT OLD.references_snapshot_json))
  OR (NEW.status = 'published' AND NOT EXISTS (
    SELECT 1 FROM archive_publication_confirmations c JOIN posts b ON b.id = c.post_id
    WHERE c.publication_id = OLD.id AND c.expected_post_version + 1 = b.version
      AND NEW.confirmed_at = c.created_at AND NEW.confirmed_by = c.created_by
      AND NEW.confirmed_post_version = b.version AND NEW.confirmed_content_hash = c.snapshot_hash
      AND NEW.references_snapshot_json = c.references_snapshot_json))
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_IMMUTABLE'); END;

CREATE TRIGGER archive_post_publication_sync AFTER UPDATE ON posts
WHEN NEW.version != OLD.version AND EXISTS (SELECT 1 FROM archive_publications p WHERE p.post_id = NEW.id)
BEGIN
  UPDATE archive_publications SET status = NEW.status,
    confirmed_at = CASE WHEN NEW.status = 'published' THEN NEW.updated_at ELSE confirmed_at END,
    confirmed_by = CASE WHEN NEW.status = 'published' THEN NEW.updated_by ELSE confirmed_by END,
    confirmed_post_version = CASE WHEN NEW.status = 'published' THEN NEW.version ELSE confirmed_post_version END,
    confirmed_content_hash = CASE WHEN NEW.status = 'published' THEN
      (SELECT c.snapshot_hash FROM archive_publication_confirmations c WHERE c.post_id = NEW.id AND c.expected_post_version + 1 = NEW.version)
      ELSE confirmed_content_hash END,
    references_snapshot_json = CASE WHEN NEW.status = 'published' THEN
      (SELECT c.references_snapshot_json FROM archive_publication_confirmations c WHERE c.post_id = NEW.id AND c.expected_post_version + 1 = NEW.version)
      ELSE references_snapshot_json END,
    updated_at = NEW.updated_at, updated_by = NEW.updated_by, version = version + 1
  WHERE post_id = NEW.id;
END;

CREATE TRIGGER archive_confirmation_publish AFTER INSERT ON archive_publication_confirmations
BEGIN
  UPDATE posts SET status = 'published', published_at = NEW.created_at,
    updated_at = NEW.created_at, updated_by = NEW.created_by, version = version + 1
  WHERE id = NEW.post_id AND version = NEW.expected_post_version AND status = 'draft' AND deleted_at IS NULL;
END;

CREATE TRIGGER archive_post_categories_insert_guard BEFORE INSERT ON post_categories
WHEN EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.id = NEW.post_id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_post_categories_update_guard BEFORE UPDATE ON post_categories
WHEN EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.id = OLD.post_id AND b.status = 'published')
  OR EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.id = NEW.post_id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_post_categories_delete_guard BEFORE DELETE ON post_categories
WHEN EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.id = OLD.post_id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_categories_update_guard BEFORE UPDATE ON categories
WHEN EXISTS (SELECT 1 FROM post_categories l JOIN posts b ON b.id = l.post_id
  JOIN archive_publications p ON p.post_id = b.id WHERE l.category_id = OLD.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_categories_delete_guard BEFORE DELETE ON categories
WHEN EXISTS (SELECT 1 FROM post_categories l JOIN posts b ON b.id = l.post_id
  JOIN archive_publications p ON p.post_id = b.id WHERE l.category_id = OLD.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_post_tags_insert_guard BEFORE INSERT ON post_tags
WHEN EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.id = NEW.post_id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_post_tags_update_guard BEFORE UPDATE ON post_tags
WHEN EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.id = OLD.post_id AND b.status = 'published')
  OR EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.id = NEW.post_id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_post_tags_delete_guard BEFORE DELETE ON post_tags
WHEN EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.id = OLD.post_id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_tags_update_guard BEFORE UPDATE ON tags
WHEN EXISTS (SELECT 1 FROM post_tags l JOIN posts b ON b.id = l.post_id
  JOIN archive_publications p ON p.post_id = b.id WHERE l.tag_id = OLD.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_tags_delete_guard BEFORE DELETE ON tags
WHEN EXISTS (SELECT 1 FROM post_tags l JOIN posts b ON b.id = l.post_id
  JOIN archive_publications p ON p.post_id = b.id WHERE l.tag_id = OLD.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_author_update_guard BEFORE UPDATE ON users
WHEN (NEW.id IS NOT OLD.id OR NEW.display_name IS NOT OLD.display_name OR NEW.username IS NOT OLD.username OR NEW.avatar_url IS NOT OLD.avatar_url)
  AND EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.author_id = OLD.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;
CREATE TRIGGER archive_author_delete_guard BEFORE DELETE ON users
WHEN EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.author_id = OLD.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;
-- 防止 INSERT OR REPLACE 绕过词表/作者 UPDATE/DELETE 保护（不依赖 recursive_triggers）。
CREATE TRIGGER archive_categories_replace_guard BEFORE INSERT ON categories
WHEN EXISTS (SELECT 1 FROM post_categories l JOIN posts b ON b.id = l.post_id
  JOIN archive_publications p ON p.post_id = b.id WHERE l.category_id = NEW.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;
CREATE TRIGGER archive_tags_replace_guard BEFORE INSERT ON tags
WHEN EXISTS (SELECT 1 FROM post_tags l JOIN posts b ON b.id = l.post_id
  JOIN archive_publications p ON p.post_id = b.id WHERE l.tag_id = NEW.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;
CREATE TRIGGER archive_author_replace_guard BEFORE INSERT ON users
WHEN EXISTS (SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id WHERE b.author_id = NEW.id AND b.status = 'published')
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

-- 防御不同 ID 经唯一 slug 冲突替换受保护稿；同样拦截 UPDATE OR REPLACE。
CREATE TRIGGER archive_post_slug_insert_guard BEFORE INSERT ON posts
WHEN NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id
  WHERE b.slug = NEW.slug AND b.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;
CREATE TRIGGER archive_post_slug_update_guard BEFORE UPDATE ON posts
WHEN NEW.deleted_at IS NULL AND EXISTS (
  SELECT 1 FROM posts b JOIN archive_publications p ON p.post_id = b.id
  WHERE b.id != OLD.id AND b.slug = NEW.slug AND b.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_categories_unique_insert_guard BEFORE INSERT ON categories
WHEN EXISTS (SELECT 1 FROM categories target JOIN post_categories l ON l.category_id = target.id
  JOIN posts b ON b.id = l.post_id JOIN archive_publications p ON p.post_id = b.id
  WHERE b.status = 'published' AND (target.id = NEW.id OR (NEW.deleted_at IS NULL AND target.deleted_at IS NULL AND target.slug = NEW.slug)))
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_categories_unique_update_guard BEFORE UPDATE ON categories
WHEN EXISTS (SELECT 1 FROM categories target JOIN post_categories l ON l.category_id = target.id
  JOIN posts b ON b.id = l.post_id JOIN archive_publications p ON p.post_id = b.id
  WHERE b.status = 'published' AND (target.id = NEW.id OR (NEW.deleted_at IS NULL AND target.deleted_at IS NULL AND target.slug = NEW.slug)) AND target.id != OLD.id)
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_tags_unique_insert_guard BEFORE INSERT ON tags
WHEN EXISTS (SELECT 1 FROM tags target JOIN post_tags l ON l.tag_id = target.id
  JOIN posts b ON b.id = l.post_id JOIN archive_publications p ON p.post_id = b.id
  WHERE b.status = 'published' AND (target.id = NEW.id OR (NEW.deleted_at IS NULL AND target.deleted_at IS NULL AND target.slug = NEW.slug)))
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_tags_unique_update_guard BEFORE UPDATE ON tags
WHEN EXISTS (SELECT 1 FROM tags target JOIN post_tags l ON l.tag_id = target.id
  JOIN posts b ON b.id = l.post_id JOIN archive_publications p ON p.post_id = b.id
  WHERE b.status = 'published' AND (target.id = NEW.id OR (NEW.deleted_at IS NULL AND target.deleted_at IS NULL AND target.slug = NEW.slug)) AND target.id != OLD.id)
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_author_unique_insert_guard BEFORE INSERT ON users
WHEN EXISTS (SELECT 1 FROM users target JOIN posts b ON b.author_id = target.id
  JOIN archive_publications p ON p.post_id = b.id
  WHERE b.status = 'published' AND (target.id = NEW.id OR (NEW.github_id != '' AND target.github_id = NEW.github_id)))
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;

CREATE TRIGGER archive_author_unique_update_guard BEFORE UPDATE ON users
WHEN EXISTS (SELECT 1 FROM users target JOIN posts b ON b.author_id = target.id
  JOIN archive_publications p ON p.post_id = b.id
  WHERE b.status = 'published' AND (target.id = NEW.id OR (NEW.github_id != '' AND target.github_id = NEW.github_id)) AND target.id != OLD.id)
BEGIN SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED'); END;
