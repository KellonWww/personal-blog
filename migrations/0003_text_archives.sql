-- ⚠️ 需牢大审核后人工执行。SQLite / Cloudflare D1；AI 不执行本迁移。
-- 只新增文本档案表，不改 posts / 公开分类标签，不建立附件或对象存储表。
-- 应用默认 ARCHIVES_ENABLED=false；人工迁移和隔离验证后才启用。

CREATE TABLE archive_sources (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  namespace TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider, namespace)
);

CREATE TABLE archives (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  source_doc_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  source_path TEXT NOT NULL DEFAULT '',
  current_version_id TEXT,
  accepted_source_version_id TEXT,
  latest_source_version_id TEXT,
  conflict_state TEXT NOT NULL DEFAULT 'none' CHECK(conflict_state IN ('none', 'pending')),
  first_imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source_id, source_doc_id),
  FOREIGN KEY(source_id) REFERENCES archive_sources(id),
  FOREIGN KEY(current_version_id, id) REFERENCES archive_versions(id, archive_id),
  FOREIGN KEY(accepted_source_version_id, id) REFERENCES archive_versions(id, archive_id),
  FOREIGN KEY(latest_source_version_id, id) REFERENCES archive_versions(id, archive_id)
);
CREATE INDEX idx_archives_source_updated ON archives(source_id, updated_at DESC, id);
CREATE INDEX idx_archives_updated ON archives(updated_at DESC, id);
CREATE INDEX idx_archives_conflicts ON archives(conflict_state, updated_at DESC, id);

CREATE TABLE archive_versions (
  id TEXT PRIMARY KEY NOT NULL,
  archive_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  parent_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('import', 'edit', 'restore', 'resolution')),
  title TEXT NOT NULL DEFAULT '' CHECK(length(title) <= 200),
  content_md TEXT NOT NULL DEFAULT '' CHECK(length(content_md) <= 100000),
  plain_text TEXT NOT NULL DEFAULT '',
  metadata_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_snapshot_json)),
  content_hash TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  raw_hash TEXT NOT NULL DEFAULT '',
  raw_content_md TEXT CHECK(raw_content_md IS NULL OR length(raw_content_md) <= 100000),
  parser_version TEXT NOT NULL DEFAULT '',
  restored_from TEXT,
  based_on_source TEXT,
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(archive_id, sequence),
  UNIQUE(id, archive_id),
  CHECK(deleted_at IS NULL),
  FOREIGN KEY(archive_id) REFERENCES archives(id),
  FOREIGN KEY(parent_id, archive_id) REFERENCES archive_versions(id, archive_id),
  FOREIGN KEY(restored_from, archive_id) REFERENCES archive_versions(id, archive_id),
  FOREIGN KEY(based_on_source, archive_id) REFERENCES archive_versions(id, archive_id)
);
CREATE INDEX idx_archive_versions_history ON archive_versions(archive_id, sequence DESC);

-- CAS 在插入版本时断言，旧请求必须抛错，不能让 UPDATE 0 行被当作事务成功。
-- 后续写入必须在同一个 D1 batch 内插入版本、推进 version 和维护关联投影。
CREATE TRIGGER archive_versions_head_guard BEFORE INSERT ON archive_versions
WHEN NOT EXISTS (
  SELECT 1 FROM archives a WHERE a.id = NEW.archive_id AND a.deleted_at IS NULL
  AND a.version = NEW.sequence - 1 AND a.current_version_id IS NEW.parent_id
)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_HEAD_CONFLICT');
END;
CREATE TRIGGER archive_versions_no_update BEFORE UPDATE ON archive_versions
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_VERSION_IMMUTABLE');
END;
CREATE TRIGGER archive_versions_no_delete BEFORE DELETE ON archive_versions
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_VERSION_IMMUTABLE');
END;

CREATE TABLE archive_taxonomy (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('category', 'tag')),
  name TEXT NOT NULL DEFAULT '',
  normalized_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, normalized_name)
);
CREATE TABLE archive_taxonomy_links (
  archive_id TEXT NOT NULL,
  taxonomy_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(archive_id, taxonomy_id),
  FOREIGN KEY(archive_id) REFERENCES archives(id),
  FOREIGN KEY(taxonomy_id) REFERENCES archive_taxonomy(id)
);
CREATE INDEX idx_archive_taxonomy_links_taxonomy ON archive_taxonomy_links(taxonomy_id, archive_id);

CREATE TABLE archive_import_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'partial', 'failed')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  counts_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(counts_json)),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash) = 64),
  expected_items INTEGER NOT NULL CHECK(expected_items BETWEEN 1 AND 10000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(source_id) REFERENCES archive_sources(id)
);
CREATE INDEX idx_archive_import_runs_source ON archive_import_runs(source_id, started_at DESC);
CREATE TABLE archive_import_items (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  archive_id TEXT,
  version_id TEXT,
  action TEXT NOT NULL DEFAULT 'pending' CHECK(action IN ('pending', 'created', 'skipped', 'updated', 'conflict', 'failed')),
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '' CHECK(length(error_message) <= 500),
  operation_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
  expected_version INTEGER NOT NULL DEFAULT 0 CHECK(expected_version >= 0),
  expected_head TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(run_id, doc_id),
  FOREIGN KEY(run_id) REFERENCES archive_import_runs(id),
  FOREIGN KEY(archive_id) REFERENCES archives(id),
  FOREIGN KEY(version_id, archive_id) REFERENCES archive_versions(id, archive_id)
);
CREATE INDEX idx_archive_import_items_run_action ON archive_import_items(run_id, action, doc_id);


-- ⚠️ 需牢大审核后人工执行：导入逐项先占幂等键，再在同一 batch 内写版本和工作头。
CREATE TRIGGER archive_import_item_run_guard BEFORE INSERT ON archive_import_items
WHEN NOT EXISTS (
  SELECT 1 FROM archive_import_runs r JOIN archive_sources s ON s.id = r.source_id
  WHERE r.id = NEW.run_id AND r.status = 'running' AND r.deleted_at IS NULL AND s.deleted_at IS NULL
  AND (SELECT count(*) FROM archive_import_items i WHERE i.run_id = r.id) < r.expected_items
)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_IMPORT_RUN_CLOSED');
END;
CREATE TRIGGER archive_import_item_head_guard BEFORE INSERT ON archive_import_items
WHEN NEW.action != 'failed' AND NOT EXISTS (
  SELECT 1 FROM archives a JOIN archive_import_runs r ON r.source_id = a.source_id
  WHERE r.id = NEW.run_id AND a.id = NEW.archive_id AND a.source_doc_id = NEW.doc_id
  AND a.deleted_at IS NULL AND a.version = NEW.expected_version AND a.current_version_id IS NEW.expected_head
)
BEGIN
  SELECT RAISE(ABORT, 'ARCHIVE_HEAD_CONFLICT');
END;

CREATE TABLE archive_publications (
  id TEXT PRIMARY KEY NOT NULL,
  archive_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  post_id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
  confirmed_at TEXT,
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_post_version INTEGER,
  confirmed_content_hash TEXT NOT NULL DEFAULT '',
  references_snapshot_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(references_snapshot_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(archive_id) REFERENCES archives(id),
  FOREIGN KEY(version_id, archive_id) REFERENCES archive_versions(id, archive_id),
  FOREIGN KEY(post_id) REFERENCES posts(id)
);
CREATE INDEX idx_archive_publications_archive ON archive_publications(archive_id, created_at DESC);
