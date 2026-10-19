# 代码现状核对：私人数字档案馆

> 2026-10-19｜静态核查结论；项目根目录：C:/Users/wkl/Desktop/codex_work_space/personal-blog。
> 仅代码与本地报告，不代表线上配置、数据和功能已经验证。新需求独立建目录，不覆盖原 personal-blog 流水线。

## 1. 已阅读约定

- 用户提供的 AGENTS.md、项目 DESIGN.md、package.json、astro.config.mjs、wrangler.jsonc、.gitignore。
- 全局 coding-standards、个人项目工作流、MEMORY、跨 agent 交接索引；跨 agent 旧交接为其他项目，不据此推断本项目。
- 使用 doc-tech-solution 技能及标准模板；本项目沿用 TypeScript/SQLite，不硬套 Java/MyBatis/Hutool 规则。
- Git origin 为 KellonWww/personal-blog；核查前工作区干净；未 commit/push，未读取 .dev.vars 或 Cloudflare 凭据。

## 2. 实现链路与证据

| 功能 | 文件及定位 | 结论 |
|---|---|---|
| SSR 技术栈 | astro.config.mjs output: server、Cloudflare adapter；package.json 依赖 | 继续 Astro/React/Hono/D1，不换框架 |
| API 挂载 | src/server/app.ts；src/pages/api/[...route].ts | 统一会话/CSRF、分模块路由及全局错误处理，可扩展新档案模块 |
| 管理员门禁 | src/server/routes/admin.ts:14-24 | 现有后台 API 对匿名 401、非 admin 403；新子路由必须显式挂共用门禁 |
| 页面授权 | src/pages/admin/editor.astro；src/components/admin/AdminDashboard.tsx:51-53 | 页面为空壳，由客户端加载会话；新私有页面应增加服务端授权，不把秘密塞 SSR/静态数据 |
| GitHub 登录 | src/server/routes/auth.ts；src/server/services/auth.ts:64-72 | 按 GitHub 用户名配置赋管理员角色；真实 OAuth 与线上角色数据未验证 |
| 开发登录 | src/server/routes/auth.ts:42-56 | 仅 ENVIRONMENT=development 且 AUTH_DEV_MODE=true 开放；生产配置声明 false，不等于线上测试结果 |
| 文章写入 | src/server/services/posts.ts:39-96 | 创建/覆盖更新现有 posts；version 递增但没有历史快照表 |
| 公共文章查询 | src/server/db/content.ts:155-235,257-277,387-401 | 默认 published、未删除；相关文章亦限制 published |
| 搜索服务端 | src/server/routes/posts.ts:42-44；src/server/db/content.ts:351-384 | 公开索引响应不含正文；SQL 查过 content 不代表实现正文搜索 |
| 搜索客户端 | src/components/SearchApp.tsx:25,50-59 | 浏览器标题/摘要/分类/标签 contains，多词 AND |
| 分类与标签 | src/server/db/content.ts:280-313 | 全量词表可公开，且计数用关联表 ID；不得把档案词表塞进现有表，否则名称会泄漏 |
| RSS/sitemap | src/pages/rss.xml.ts；src/pages/sitemap.xml.ts | 来自 published posts，sitemap 还列公开分类标签 |
| 评论与留言 | src/server/routes/comments.ts、guestbook.ts；src/server/services/interactions.ts | 有实际业务及审核链路；待回归，不另造系统 |
| Markdown | src/lib/markdown.ts | marked 转义原生 HTML，仅放行 br；不等于协议白名单或远程图片隐私保护 |
| 后台视觉 | DESIGN.md；src/components/admin/AdminShell.tsx；src/styles/admin.css | 现有双主题/后台布局可复用，增加档案入口，不重新设计公开站 |

## 3. 旧语雀导入与附件风险

| 文件定位 | 事实及影响 |
|---|---|
| scripts/import-yuque.mjs:140-144 | 读取 .yuque-manifest.json 的 docs；这是离线备份导入，不是定时同步 |
| 同文件:241-267 | 顺序读取本地 Markdown、标题与 frontmatter；单篇读文件错误会终止，没有逐项恢复 |
| 同文件:296-310 | ID 由文档 ID 清洗生成，固定 status=published；来源库命名空间、内容指纹、稳定来源映射未单独保存 |
| 同文件:354-380 | upsert 覆盖标题/slug/摘要/正文/状态，更新 version；先删再建分类标签关系，可能抹掉人工编辑 |
| 同文件:25,148-183 | 图片目标 public/yuque-assets，按路径哈希命名；没有备份根 realpath 限制，且存在全局同尾路径回退匹配 |
| 同文件:319-337 | 图片直接复制或转 WebP，目标已存在就跳过，不保证附件内容更新和无损原件 |
| 同文件:387-414 | 有汇总 report.json 与部分缺失图片样本，但没有逐项数据库执行结果/冲突报告 |
| src/server/routes/media.ts:7-20 | 任意合法 key 均可读 BUCKET，无管理员检查；响应 public 一年缓存，不能承载私人资源 |
| src/server/routes/admin.ts:210-227 | 上传有管理员保护，但返回公共 media URL，key 为 uploads/；不能直接当私有上传使用 |
| src/env.d.ts:5-8；wrangler.jsonc | 声明 BUCKET 类型却没有 r2_buckets 配置；R2 的实际部署绑定、公共访问必须核实 |
| src/server/routes/health.ts:17-18 | 仅检查 BUCKET 是否存在；status 主要取决于 D1，健康响应 ok 不能证明 R2 上传下载正常 |

本地 tmp/yuque-sql/report.json 记载 157 篇、826 图片、74 缺失引用；public/yuque-assets 实际有 826 文件。未运行旧脚本，未应用它生成的 SQL，未把这些数量说成线上事实。
不修改已有公开文章权限、内容、分类标签和图片。后续新增导入只写 archive_* 文本；旧脚本不作为私人导入入口，本期不扩展或维护其附件流程。

## 4. 官方能力核对及限制

- 2026-10-19 获取 Cloudflare D1 官方 SQL 能力文档：明确支持 FTS5；没有因此声称目标部署 trigram 已验证。
- SQLite 官方 FTS5 文档说明 trigram 子串检索及短词限制；本方案针对 1～2 字采用正文匹配回退，必须实测中文和代码。
- D1 官方 batch 文档说明批处理事务失败可回滚；CAS 更新影响零行不是 SQL 异常，业务必须额外处理。
- D1 官方导出文档提示包含虚拟表的库有导出限制；FTS 将影响与博客共用的 D1 备份流程，必须隔离环境恢复演练，不默认删线上索引。
- 未执行任何 DDL、DML 或隔离库建表试验；官方声明、代码存在、本地旧报告、目标环境实测是四类不同证据。

证据：~/.agents/evidence/private-digital-archive/official-capabilities-20261019.md

## 5. 本轮完成与未完成

| 类别 | 状态 |
|---|---|
| 项目规范/实际代码/离线报告/官方文档核查 | 已完成；不只参考 README |
| 第一版最小方案 | 已输出 03-tech-solution.md，待牢大确认 |
| 业务改造、数据库迁移、真实资料导入 | 未开始；必须确认后编码，数据库操作由牢大审核后人工执行 |
| 类型检查、构建、lint、测试运行 | 本轮未执行；仅文档变更不冒充功能验收 |
| 线上数据/OAuth/FTS/备份恢复 | 未验证；上线前强制列入验证项；R2 不再是新档案功能的依赖 |

## 6. 2026-10-19 范围收缩说明

- 上述媒体/导入脚本事实保留为历史现状，不表示本期继续建设对象存储。
- 用户明确不做图片、文件存储：新档案仅存 D1 的 Markdown 正文、来源元数据及文本历史，原始 Markdown 文本在来源版本保存，不存原文件 bytes。
- 不新增 R2/其他文件存储，不建附件表、不上传下载或转存资源，不以 D1 二进制或静态 public 目录替代对象存储。
- CLI 仅处理 manifest 与 Markdown，不扫描/读取附件；引用原样保留为文本并提示未归档，预览不自动加载资源。
- 已有公开图片、文章及旧媒体代码不动；原媒体接口风险未修复，但新私有正文不经过该接口。
- 新方案以 03-tech-solution.md v0.2 为准；原“附件归档/导出/回滚”设计退出本期，原发布绕过问题仍需在文本转稿链路中处理。
