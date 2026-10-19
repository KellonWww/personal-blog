-- 安全回滚仅关闭 ARCHIVES_ENABLED 并回退应用，不删审计字段、触发器或不可变快照。
-- 本脚本仅只读盘点；需要彻底移除结构时必须另行备份/审核，不执行无条件 DROP。
-- 保留来源/冲突保护触发器不会影响旧的合法来源导入。
SELECT kind, count(*) AS version_count,
  sum(CASE WHEN request_hash != '' THEN 1 ELSE 0 END) AS audited_mutations
FROM archive_versions GROUP BY kind;
