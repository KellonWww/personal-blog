-- ⚠️ 需牢大审核后人工执行；AI 不执行迁移或数据库写入。
-- 前置：0003→0004→0005；保留现有 SQLite 公共审计字段，不套用 MySQL 字段规范。
-- 先执行 rollback/0006 的只读盘点；若已有关联 published 稿，停止并另行审核迁移。
-- 本批只支持转为 draft，尚无确认发布能力；普通文章不受此门禁影响。
ALTER TABLE archive_publications ADD COLUMN request_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE archive_publications ADD COLUMN archive_sequence INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER archive_publications_draft_head_guard BEFORE INSERT ON archive_publications
WHEN NOT EXISTS (
  SELECT 1 FROM archives a JOIN archive_sources s ON s.id = a.source_id
  JOIN archive_versions v ON v.archive_id = a.id AND v.id = a.current_version_id
  WHERE a.id = NEW.archive_id AND a.deleted_at IS NULL AND s.deleted_at IS NULL
    AND a.version = NEW.archive_sequence AND a.current_version_id = NEW.version_id
    AND a.conflict_state = 'none'
)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_DRAFT_HEAD_CONFLICT');
END;

-- 校验复制的是确切工作快照；来源身份/私有词表不会自动进入博客字段或关系表。
CREATE TRIGGER archive_publications_draft_post_guard BEFORE INSERT ON archive_publications
WHEN length(NEW.request_hash) != 64 OR NEW.archive_sequence < 1
  OR NEW.status != 'draft' OR NEW.confirmed_at IS NOT NULL OR NEW.confirmed_by != ''
  OR NEW.confirmed_post_version IS NOT NULL OR NEW.confirmed_content_hash != ''
  OR NEW.references_snapshot_json != '[]' OR NEW.deleted_at IS NOT NULL OR NEW.version != 0
  OR NEW.created_by = '' OR NEW.updated_by != NEW.created_by
  OR EXISTS (SELECT 1 FROM archive_publications p
    WHERE p.id = NEW.id OR p.post_id = NEW.post_id OR p.operation_id = NEW.operation_id)
  OR NOT EXISTS (
    SELECT 1 FROM posts b JOIN archive_versions v ON v.id = NEW.version_id AND v.archive_id = NEW.archive_id
    WHERE b.id = NEW.post_id AND b.status = 'draft' AND b.deleted_at IS NULL AND b.version = 0
      AND b.published_at IS NULL AND b.title = v.title AND b.content = v.content_md
      AND b.summary = '' AND b.cover_image = '' AND b.author_id = NEW.created_by
      AND b.created_by = NEW.created_by AND b.updated_by = NEW.created_by
      AND NOT EXISTS (SELECT 1 FROM post_categories c WHERE c.post_id = b.id)
      AND NOT EXISTS (SELECT 1 FROM post_tags t WHERE t.post_id = b.id)
  )
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_DRAFT_INVALID');
END;

-- 关联不可被删除、软删除或换绑以绕过门禁；确认能力须在后续审核迁移中显式替换该保护。
CREATE TRIGGER archive_publications_draft_no_update BEFORE UPDATE ON archive_publications
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_IMMUTABLE');
END;
CREATE TRIGGER archive_publications_draft_no_delete BEFORE DELETE ON archive_publications
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_IMMUTABLE');
END;

-- 数据库层保护不依赖应用开关，退回旧应用也不能经普通 PUT 发布关联稿。
CREATE TRIGGER archive_posts_draft_publish_guard BEFORE UPDATE ON posts
WHEN EXISTS (SELECT 1 FROM archive_publications p WHERE p.post_id = OLD.id OR p.post_id = NEW.id)
  AND (NEW.status = 'published' OR NEW.id IS NOT OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED');
END;
-- 防御 INSERT OR REPLACE 删除旧行后重新插入，不能仅依赖 FK 或 delete trigger。
CREATE TRIGGER archive_posts_draft_insert_guard BEFORE INSERT ON posts
WHEN EXISTS (SELECT 1 FROM archive_publications p WHERE p.post_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED');
END;
CREATE TRIGGER archive_posts_draft_delete_guard BEFORE DELETE ON posts
WHEN EXISTS (SELECT 1 FROM archive_publications p WHERE p.post_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_PUBLICATION_CONFIRM_REQUIRED');
END;
