-- 安全回滚：关闭 ARCHIVES_ENABLED；保留关联、审计列和全部发布保护触发器。
-- 不能通过 DROP 触发器、删关联或回退旧应用来解除发布门禁。
-- 本文件仅只读盘点；迁移前关联 published 数必须为 0，否则停止并人工审核。
SELECT p.status AS publication_status, b.status AS post_status,
  CASE WHEN b.deleted_at IS NULL THEN 'active' ELSE 'deleted' END AS post_state,
  count(*) AS binding_count
FROM archive_publications p JOIN posts b ON b.id = p.post_id
GROUP BY p.status, b.status, post_state LIMIT 100;
SELECT name FROM sqlite_master WHERE type = 'trigger'
  AND (name LIKE 'archive_publications_draft_%' OR name LIKE 'archive_posts_draft_%')
ORDER BY name LIMIT 100;
