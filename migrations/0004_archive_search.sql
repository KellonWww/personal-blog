-- ⚠️ 需牢大审核后人工执行。必须先在隔离 D1 验证 trigram、中文和备份恢复。
-- 依赖 0003；没有附件或 R2 依赖。FTS 为可重建投影，基础正文在不可变版本内。
CREATE VIRTUAL TABLE archive_search USING fts5(archive_id UNINDEXED, title, body, tokenize='trigram');

CREATE TRIGGER archive_search_insert AFTER INSERT ON archives
WHEN NEW.current_version_id IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO archive_search(archive_id, title, body)
  SELECT NEW.id, title, plain_text FROM archive_versions WHERE id = NEW.current_version_id AND archive_id = NEW.id;
END;
CREATE TRIGGER archive_search_update AFTER UPDATE OF current_version_id, deleted_at ON archives
BEGIN
  DELETE FROM archive_search WHERE archive_id = OLD.id;
  INSERT INTO archive_search(archive_id, title, body)
  SELECT NEW.id, title, plain_text FROM archive_versions
  WHERE id = NEW.current_version_id AND archive_id = NEW.id AND NEW.deleted_at IS NULL;
END;
CREATE TRIGGER archive_search_delete AFTER DELETE ON archives
BEGIN
  DELETE FROM archive_search WHERE archive_id = OLD.id;
END;

-- 在同一人工迁移中回填已有工作头，非历史和来源冲突候选。
INSERT INTO archive_search(archive_id, title, body)
SELECT a.id, v.title, v.plain_text FROM archives a
JOIN archive_versions v ON v.id = a.current_version_id AND v.archive_id = a.id
WHERE a.deleted_at IS NULL;
