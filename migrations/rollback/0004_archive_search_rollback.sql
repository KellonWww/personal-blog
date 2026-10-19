-- ⚠️ 需牢大审核后人工执行。先关闭档案入口/写入并备份；仅移除可重建索引，不删正文。
DROP TRIGGER IF EXISTS archive_search_insert;
DROP TRIGGER IF EXISTS archive_search_update;
DROP TRIGGER IF EXISTS archive_search_delete;
DROP TABLE IF EXISTS archive_search;
-- 重新开放前必须人工重建 FTS 并校验；不允许把索引缺失静默降级为标题搜索。
