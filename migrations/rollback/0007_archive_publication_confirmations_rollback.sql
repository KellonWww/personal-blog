-- 只读盘点；⚠️ 迁移/回滚需牢大审核后人工执行，AI 不执行任何写入。
-- 0007 应用回退时保留所有绑定、确认日志、视图和保护触发器，不 DROP/解除门禁。
-- 迁移前有 published 关联稿、异常绑定或缺少 0006 触发器时停止，另行审核。
SELECT p.id, p.post_id, b.status, b.version, b.deleted_at
FROM archive_publications p LEFT JOIN posts b ON b.id = p.post_id
WHERE b.id IS NULL OR b.status = 'published' OR p.deleted_at IS NOT NULL LIMIT 100;
SELECT name, type FROM sqlite_master WHERE name LIKE 'archive_%' AND type IN ('trigger', 'view') ORDER BY name LIMIT 100;
-- 以下两项仅 0007 已应用后可运行；盘点本身不重新发布或删除审计。
SELECT id, publication_id, post_id, expected_post_version, created_at, created_by
FROM archive_publication_confirmations ORDER BY created_at DESC LIMIT 100;
SELECT p.id, p.status AS binding_status, b.status AS post_status, p.confirmed_post_version, b.version
FROM archive_publications p JOIN posts b ON b.id = p.post_id
WHERE p.status != b.status OR (b.status = 'published' AND p.confirmed_post_version != b.version) LIMIT 100;
