# 实现日志：私人数字档案馆

## 元数据
- 需求编号：private-digital-archive
- 开始时间：2026-10-19
- 最后更新：2026-10-19（Asia/Shanghai）
- 负责人：牢大

## 任务清单

| 任务 | 状态 | 改动文件 | 编译结果 | 未验证项 |
|---|---|---|---|---|
| 恢复中断前的数据模型与检索底座 | 部分完成 | migrations/0003、0004 及对应 rollback；db/archives.ts；types/archive.ts | 已纳入本轮构建，通过 | 迁移、trigram、备份恢复待牢大人工执行 |
| 接入管理员档案读取接口 | 代码完成，未联调 | routes/archives.ts；services/archives.ts；services/archive-query.ts；app.ts | 通过 | 登录角色、分页、中文短词及版本归属待接口验证 |
| 默认关闭及私有响应门禁 | 代码完成，未联调 | routes/archives.ts；env.d.ts；wrangler.jsonc | 通过 | 真实环境隔离和原博客回归待验证 |
| 文本导入、批次报告、幂等及三方冲突判定 | 代码完成，离线预检通过 | scripts/import-archives.mjs；scripts/lib/archive-manifest.mjs；routes/archive-imports.ts；services/archive-import*、archive-text.ts；db/archive-import*；app.ts；API 入口 | build/check/lint 通过 | D1 事务、断点重试及真实鉴权未联调 |
| 编辑、冲突解决与历史恢复 | 代码完成，未联调 | routes/archives.ts；services/archive-mutation*；db/archive-mutations.ts；共享 taxonomy；0005 及 rollback | build/check/lint 通过 | 迁移、幂等/CAS/冲突/恢复待人工联调 |
| 历史差异与文本导出 | 代码完成，未联调 | services/archive-diff.ts、archive-reading.ts；routes/archives.ts；types/archive.ts | build/check/lint 通过 | 权限、版本归属、差异边界及下载待人工验证 |
| 私人档案管理页面 | 代码完成，未联调 | ArchiveManager、ArchiveWorkspace、ArchiveHistory、archive-admin；后台入口与样式 | build/check/lint 通过 | 浏览器交互、权限、冲突重试及原设置页导航待人工验证 |
| 主动转博客草稿及发布封锁 | 代码完成，未联调 | archive-publication*；ArchiveDrafts/Workspace；posts/admin；0006 及只读 rollback | build/check/lint 通过 | 事务/重试/CAS/旧入口阻断待人工验证 |
| 确认预览及受控发布 | 未开始 | — | — | 引用校验、预览版本/哈希及确认发布待后续实现 |

## 详细改动记录

### 档案读取及安全门禁

- 新增 GET /api/admin/archives、archive-sources、archive-taxonomy、archives/:id、archives/:id/versions、archives/:id/versions/:versionId。
- 路由 → services → db；列表及详情映射 DTO，版本读取校验档案归属，历史列表不返回正文。
- 参数校验覆盖 ID、分页、筛选和关键词上限；长词参数化 MATCH，短词参数化 instr，摘要为纯文本。
- 所有档案读取限定管理员，响应 private/no-store、noindex；专属门禁不拦截原博客后台路由。
- ARCHIVES_ENABLED 默认 false；只有人工完成迁移及隔离验证后才允许启用。关闭时管理员访问档案返回 503，不查询档案表；匿名及普通用户分别返回 401/403。
- 未执行数据库写入、迁移、私人资料导入、部署、commit 或 push；旧文章及对象存储代码未改。

| 检查 | 结果 |
|---|---|
| npm run build（包含 npm run check） | 通过，约 20 秒；0 errors / 0 warnings / 0 hints |
| 打包提示 | 存在大于 500 kB 的 chunk 提示，未作为本需求重构范围 |
| npm run lint | 通过 |
| git diff --check | 通过；有 Windows 换行转换提示 |
| 数据库/接口/浏览器/备份恢复 | 未执行；不能以编译通过代替业务验收 |
| 单元测试 | 按开发偏好未新增、未执行 |

### 第二批：文本导入与幂等冲突判定（2026-10-19）

| 范围 | 本批实现 |
|---|---|
| 离线 CLI | 只读 manifest 与 UTF-8 Markdown；身份碰撞整批停止，缺失/坏编码/越界/超限逐项失败；不扫描或读取附件 |
| 预检与提交 | 默认离线预检；可经管理员只读接口比较；apply 需要稳定 run-id、可信 origin、短期会话、CSRF 和仅文本确认，由牢大人工运行 |
| 批次接口 | 来源批次创建、50 项基线、逐篇提交、报告、完成；逐篇事务及固定批次/文档幂等键；更改已登记的文本需新批次 |
| 三方判定 | 当前/已接受来源/最新来源比较；来源未变跳过，本地无修改推进工作头，分歧仅保留来源候选；A→B→A 不按永久哈希去重 |
| 并发保护 | 应用校验 expectedVersion/expectedHead，依赖迁移草案中的触发器和不可变版本约束；真实 D1 行为待人工验证 |
| 已删除项 | 登记 ARCHIVE_DELETED 失败结果，允许批次结束为 partial；不恢复、不覆盖档案 |
| 安全边界 | 早于会话/CSRF 设置私有响应头；档案错误不打印数据库原始原因；Astro 入口前置 1 MiB 限制，Hono 二次校验 |
| 工程入口 | npm run archives:import -- --help；不调用旧公开文章/图片导入链路 |

| 检查 | 结果 |
|---|---|
| npm run build（含 check） | 通过，约 15 秒；98 个文件，0 errors / 0 warnings / 0 hints；仍有既有 chunk 大小提示 |
| npm run lint | 通过；已修复中断代码中的 AbortSignal no-undef |
| node --check（CLI 和 manifest 模块） | 通过 |
| git diff --check | 通过；Git 有 LF→CRLF 提示；新增文件另行扫描空白 |
| 合成 Markdown 离线预检 | 正常文本退出 0；混合资料准确报告 5 项失败并退出 1；重复 JSON 键/重复路径整批停止并退出 1 |
| 数据库/网络 | 未执行迁移、D1 写入、apply、真实私人备份读取或部署；未跑数据库/在线接口验证 |
| 单元测试 | 按牢大偏好未新增、未运行；CLI 合成资料预检为手工离线检查 |

证据：~/.agents/evidence/private-digital-archive/文本导入预检-20261019.md

后续批次：管理页面 → 主动转稿与发布门禁。
来源“本次未见”的全量对账尚未实现；当前不会因为清单缺项删除档案或撤稿。
全部数据库写入、迁移及含写入的联调由牢大审核后人工执行；保持 ARCHIVES_ENABLED=false，不把离线预检或构建通过当作整体验收。

### 第三批：编辑、冲突解决与历史恢复（2026-10-19）

| 范围 | 本批实现 |
|---|---|
| 管理员接口 | PATCH /api/admin/archives/:id；POST /api/admin/archives/:id/restore、resolve；沿用管理员、CSRF、私有响应及默认关闭门禁 |
| 并发与幂等 | expectedVersion/expectedHead 双校验；版本插入触发器事务内断言；固定 operationId 与请求哈希，重复请求返回已有结果，异参复用返回 409 |
| 编辑/恢复 | 全量替换标题、正文与私有分类标签；恢复校验历史归属，复制快照追加新版本并记录 restored_from；不覆盖历史，不隐式接受来源 |
| 解决冲突 | 支持保留本地、接受来源、手工合并；校验 pending 与 expectedSource；仅成功解决后推进 accepted_source 并清除冲突 |
| 投影与类型 | 编辑、恢复及解决成功后同批维护分类标签和 FTS；导入复用 taxonomy；变更种类与请求类型使用判别联合 |
| 审计草案 | 0005 增加 request_hash/change_reason、来源存活及最新冲突候选保护触发器；历史 API 返回 reason；回滚草案仅只读盘点并保留审计历史 |
| 启用前置 | 新版本读取 SQL 也依赖 0005；必须由牢大人工按 0003→0004→0005 完成迁移及隔离验证后才允许启用，保持 ARCHIVES_ENABLED=false |

| 检查 | 结果 |
|---|---|
| npm run build（含 check） | 通过，约 15 秒；103 个文件，0 errors / 0 warnings / 0 hints；打包仍提示 chunk 超过 500 kB |
| npm run lint | 通过 |
| git diff --check | 通过；Windows 换行转换提示不影响退出码；新增文件另行扫描尾随空白 |
| 数据库与业务联调 | 未执行任何迁移或写入；D1 原子性、权限/CSRF、并发、幂等重试、三种冲突解决、恢复与索引一致性待牢大人工验证 |
| 单元测试及上线 | 未新增、未运行单元测试；未部署、commit 或 push |

### 第四批：有界历史差异与 Markdown 导出（2026-10-19）

| 范围 | 本批实现 |
|---|---|
| 差异接口 | GET /api/admin/archives/:id/diff?from=版本ID&to=版本ID；两端均校验档案归属与来源存活，缺失返回 404 |
| 差异内容 | 标题/分类标签前后值与变化标记；正文逐行 context/add/remove、双侧行号及增删统计；保持纯文本，前端必须文本渲染，不执行 Markdown/HTML |
| 计算边界 | 每端最多 2000 行；剔除公共前后缀后 LCS 矩阵最多 1000000 单元，超限返回 422 DIFF_TOO_LARGE，提示分别导出；末尾换行保留为末尾空行 |
| 导出接口 | GET /api/admin/archives/:id/export?versionId=版本ID；必须指定不可变版本，不回落到当前版本，不读附件或请求外链 |
| 文本格式 | YAML frontmatter 包含所选快照标题、分类标签、版本/恢复/来源基线/原因和来源身份；正文保留原快照，来源名称/地址明确为导出时现值 |
| 下载安全 | Markdown attachment、固定 ASCII 文件名、nosniff、CSP sandbox；沿用管理员、private/no-store、noindex 及默认关闭门禁；元数据字符用 JSON/YAML 转义 |
| 导出边界 | 明示不含原始来源文本、图片或附件，不是完整灾备；不触发转稿或发布；无新增依赖、数据库语句或迁移 |

| 检查 | 结果 |
|---|---|
| npm run build（含 check） | 通过，约 12 秒；105 个文件，0 errors / 0 warnings / 0 hints；仍有既有 chunk 大小提示 |
| npm run lint / git diff --check | 通过；新增文件另行扫描尾随空白；Git 有 LF→CRLF 提示 |
| 未验证项 | D1 查询、实际管理员/匿名请求、跨档案版本、超限差异、特殊字符导出与浏览器下载待人工验证；未以编译通过代替业务验收 |
| 执行边界 | 未新增或运行单元测试；未执行数据库写入、迁移、真实私人资料读取、部署、commit 或 push；ARCHIVES_ENABLED=false |

### 第五批：私人档案管理页面（2026-10-19）

| 范围 | 本批实现 |
|---|---|
| 入口及检索 | 后台私人档案导航；关键词、来源、私有分类/标签及冲突筛选、分页；来源与词表可继续加载 |
| 编辑及冲突 | 纯文本标题/Markdown/私有词表与变更原因；保留本地、接受来源、手工合并及恢复确认 |
| 请求保护 | 带版本/工作头/最新来源及 operationId；结果不明时锁定编辑，重试原始请求；业务拒绝保留草稿 |
| 历史及导出 | 历史分页、跨页版本选择、纯文本快照、标题/词表/逐行差异、指定版本 Markdown 下载 |
| 离开保护 | 编辑与未知请求联动后台导航、退出、重读及 beforeunload；不导出未保存编辑 |
| 展示与安全 | 沿用双主题及响应式布局；不渲染 Markdown/HTML/图片，不自动请求来源链接；读取 no-store |
| 共享能力 | admin-api 增加携带 HTTP 状态及业务码的错误类型；原设置页复用泛化后的未保存状态 |

| 检查 | 结果 |
|---|---|
| npm run build（含 check） | 通过，约 15 秒；109 个文件，0 errors / 0 warnings / 0 hints；既有 chunk 大小提示仍存在 |
| npm run lint / git diff --check | 通过；新增文件单独扫描尾随空白；已修复下载 DOM 类型冲突与 deprecated 事件用法 |
| 未验证项 | 浏览器下载/双主题/移动端、真实角色/CSRF、409 与丢响应重试、离开保护和原设置页导航待人工验证 |
| 执行边界 | 未运行单元测试、数据库写入、迁移、真实接口联调、部署、commit 或 push；ARCHIVES_ENABLED=false |

启用前由牢大人工执行 0003→0004→0005 并完成隔离验证；当前版本读取也依赖 0005。下一批为主动转博客草稿与统一确认发布门禁；来源“本次未见”全量对账仍未实现。

### 第六批：主动转博客草稿与发布封锁（2026-10-19）

| 范围 | 本批实现 |
|---|---|
| 转稿接口 | POST archives/:id/blog-draft，管理员/CSRF/默认关闭/1 MiB 限制沿用档案入口；严格校验 operationId、expectedVersion、expectedHead |
| 原子绑定 | 同一 D1 batch 新建 draft 与 publication；0006 草案校验来源存活、事件序号/工作头、无待解决冲突及逐字标题正文快照 |
| 数据隔离 | 只复制标题/正文；新建无来源含义的 slug；不复制来源元数据、私有词表、摘要或封面，不自动请求资源 |
| 幂等与删除 | 操作 ID 与请求/操作者哈希绑定；丢响应重试读取原关联；不同入参 409；博客稿软删除后原操作仍返回已删除记录，不重建 |
| 发布封锁 | 0006 数据库触发器阻断关联稿变为 published、换 ID、INSERT/UPDATE OR REPLACE 及硬删除；绑定自身不可改/删，普通独立文章不依赖新表查询 |
| 旧接口响应 | 普通 PUT 触发门禁返回 409；文章创建/更新只回传明确业务错误，不透出含私人文本的驱动异常 |
| 管理页面 | 保存且解决冲突后才可明确确认转稿；复用未知请求锁定/原请求重试；分页显示关联记录及草稿删除状态，不自动导航或预览 |
| 读取接口 | GET archives/:id/publications，分页最多 50，DTO 不含请求哈希；来源更新不改已转稿正文 |

| 检查 | 结果 |
|---|---|
| npm run build（含 check） | 通过，约 15 秒；113 个文件，0 errors / 0 warnings / 0 hints；既有 chunk 大小提示仍存在 |
| npm run lint / git diff --check | 通过；新增文件单独扫描尾随空白；Git 有 LF→CRLF 提示 |
| 静态写入口盘点 | 已核对普通创建/更新/软删、转稿、阅读计数和旧导入脚本；数据库触发器是否实际覆盖须人工验证 |
| 未验证项 | 0006 迁移/触发器语法、D1 batch 回滚、并发/丢响应/删稿重试、普通 PUT 绕过、真实鉴权及浏览器待人工验证 |
| 执行边界 | 未运行单元测试、数据库写入、迁移、真实接口联调、私人文件读取、部署、commit 或 push；ARCHIVES_ENABLED=false |

⚠️ 需牢大审核后人工执行：启用前按 0003→0004→0005→0006 迁移并隔离验证；先用 0006 rollback 中只读盘点确认无已发布关联稿，否则停止另行审核。不删除绑定/触发器回滚；0006 必须随关联稿保留，即使回退应用或关闭档案。
下一批补资源引用清单/校验、预览版本与内容哈希、统一确认发布事务；本批是“未实现确认前全部禁止发布”，不代表确认发布功能完成。来源“本次未见”全量对账仍未实现。

### 第七批：只读审阅快照与资源引用核查（2026-10-19）

| 范围 | 本批实现 |
|---|---|
| 只读 API | GET archives/:id/publications/:publicationId/preview；复用档案管理员/默认关闭/no-store 门禁；关联必须属于请求档案且档案/来源/博客稿仍存活 |
| 一致快照 | 单次 SELECT 读取当前文章、作者与按 ID 排序分类/标签；返回版本和 SHA-256 指纹，不发发布许可 |
| 有界审阅 | 正文 100000 字符、分类/标签各 200 项、JSON 快照 200000 字符；正文空字节或任何截断情况拒绝审阅 |
| 引用清单 | 独立 marked lexer，覆盖行内/引用式链接及图片、封面、作者头像；代码块不当资源；HTML 除 br 外标阻断 |
| 保守核查 | 本地/相对地址、危险协议、编码/实体、IP/保留域、凭据、非标准端口、管理/API 路径标阻断；引用超 200 条明确提示不完整 |
| 人工边界 | 外链及既有相对媒体路径只标待核对；不读取图片/文件、不 fetch/DNS/重定向验证，不保证资源存在或已获公开授权 |
| 管理界面 | 关联列表主动打开纯文本审阅；显示公开字段、Markdown、引用理由及版本哈希；重读时清除旧快照，关闭/切换中止读取，不渲染 HTML 或自动请求资源 |
| 发布边界 | 保留 0006 全量封锁；没有确认按钮、发布许可、确认事务或新迁移，不把只读指纹当审批凭据 |

| 检查 | 结果 |
|---|---|
| npm run build（含 check） | 通过，117 文件，0 errors / warnings / hints；既有大于 500 kB 的 chunk 提示仍存在 |
| npm run lint | 首轮发现控制字符正则规则，修复后通过 |
| git diff --check / 新文件静态扫描 | 通过；Git 既有 LF→CRLF 提示保留；未跟踪文件单独检查尾随空白/空字节 |
| 未验证项 | 新 SELECT 的 D1 JSON/关联子查询执行、权限/跨档案访问、真实 Markdown 各类样例及浏览器/移动端/双主题均待人工验证 |
| 执行边界 | 未运行单元测试、数据库写入/迁移、真实接口联调、私人文件读取、部署、commit 或 push；ARCHIVES_ENABLED=false |

下一批：短时签名预览、统一幂等确认事务与 0007 审计/发布门禁草案；现有封锁不得先删。来源“本次未见”全量对账仍未实现。

### 第八批：签名预览与幂等确认发布（2026-10-19）

| 范围 | 实现/检查结果 |
|---|---|
| 签名审阅 | 规范 SQL JSON 快照哈希；专用 HMAC 密钥、600 秒令牌，绑定操作者/站点/版本/引用策略；双勾选后确认 |
| 原子确认 | 单条不可变审计 INSERT 触发发布及绑定同步；版本/快照 CAS；同请求优先读取历史成功，不再次发布撤回/删除稿 |
| 0007 草案 | 规范视图、审计、旧入口门禁、词表/作者锁及 REPLACE 绕过保护；仅源代码，未执行、未验证 SQLite/D1 语法或事务行为 |
| 管理界面 | 纯文本审阅、到期提示；未知结果保留原幂等请求重试并锁切换；编辑/审阅离开保护；Mermaid 暂阻断，不请求资源 |
| 登录兼容 | 专用作者字段锁触发时仅同步 email/role 等非公开字段；其他错误照常抛出；真实 OAuth 未验证 |
| build/check | 通过，120 文件，0 errors / warnings / hints；构建仍有既有大于 500 kB chunk 提示 |
| lint / diff | npm run lint、git diff --check 通过；新增文件另行静态扫描，Git LF→CRLF 提示保留 |
| 未验证 | 数据库迁移/触发器/并发/权限/真实接口、重试故障及浏览器/移动端/双主题均未验收；未新增或运行单测 |
| 默认状态 | ARCHIVES_ENABLED=false、ARCHIVE_PUBLICATION_ENABLED=false；不部署、不提交/推送，不运行数据库写入或含写入接口 |

⚠️ 需牢大审核后人工执行：0003→0004→0005→0006→0007；当前只读预览也依赖 0007。先备份/盘点并隔离验收，迁移须完整保留门禁；专用 secret 人工配置且不入 Git。0007 rollback 后两条查询仅迁移后执行；回退应用不删除绑定/审计/视图/触发器。
已发布关联稿修改/删除先撤回；共享词表/公开作者字段须先撤所有相关稿再改。下一批可补来源“本次未见”全量对账及人工验收清单；本批不代表可上线。

### 本次授权备份与迁移（2026-10-19）
- 用户明确授权本次执行，覆盖此前“仅人工执行”限制；备份：C:/Users/wkl/Desktop/personal-blog-before-archives-20261019-agent.sql（3248132 字节）；离线恢复及 0003～0007 演练、完整性/外键检查通过。
- 远端 0003～0007 已全部应用，迁移列表为空；45 个档案触发器、快照视图及 FTS 查询可用；161 篇文章（142 已发布）全字段指纹一致。两开关保持 false，未验证发布/并发/权限/浏览器，不代表功能验收。
- 证据：~/.agents/evidence/private-digital-archive/post-migration-result-20261019.json；离线演练：同目录 migration-rehearsal-20261019.json。仅文档更新，本次未重编译，未 commit/push。
