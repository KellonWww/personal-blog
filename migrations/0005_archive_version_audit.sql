-- ⚠️ 需牢大审核后人工执行；依赖 0003/0004，AI 不执行本迁移。
-- 编辑/恢复/解决冲突启用前需完成本迁移；已有来源快照保留空请求哈希与原因。
ALTER TABLE archive_versions ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''
  CHECK(request_hash = '' OR length(request_hash) = 64);
ALTER TABLE archive_versions ADD COLUMN change_reason TEXT NOT NULL DEFAULT '' CHECK(length(change_reason) <= 500);

-- 防止来源在应用预读后被软删除，导致继续追加版本。
CREATE TRIGGER archive_versions_active_source_guard BEFORE INSERT ON archive_versions
WHEN NOT EXISTS (
  SELECT 1 FROM archives a JOIN archive_sources s ON s.id = a.source_id
  WHERE a.id = NEW.archive_id AND a.deleted_at IS NULL AND s.deleted_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_SOURCE_UNAVAILABLE');
END;

-- 三方解决必须接受当前最新来源；旧候选绝不能被当成新基线。
CREATE TRIGGER archive_versions_resolution_guard BEFORE INSERT ON archive_versions
WHEN NEW.kind = 'resolution' AND NOT EXISTS (
  SELECT 1 FROM archives a WHERE a.id = NEW.archive_id AND a.conflict_state = 'pending'
  AND a.latest_source_version_id IS NEW.based_on_source AND NEW.based_on_source IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_SOURCE_CONFLICT');
END;
