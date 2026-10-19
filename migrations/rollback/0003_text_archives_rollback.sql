-- 安全回滚：先人工设置 ARCHIVES_ENABLED=false，再回退应用；保留全部档案基础表。
-- 本脚本仅只读盘点，不删除资料；即使目前为空也不提供无条件 DROP 数据表脚本。
-- 有档案关联博客稿时，必须保留发布确认安全补丁，或同时暂停后台文章写入。
-- 后续如需彻底清理表结构，先备份全部版本/关联、验证恢复，再另行审核。
SELECT 'archives' AS entity, count(*) AS row_count FROM archives
UNION ALL SELECT 'versions', count(*) FROM archive_versions
UNION ALL SELECT 'publications', count(*) FROM archive_publications
UNION ALL SELECT 'import_runs', count(*) FROM archive_import_runs;
