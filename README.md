# 个人博客（Personal Blog）

基于 Astro + Hono + Cloudflare Workers 的个人博客：内容浏览、Markdown 写作、私密数字档案、GitHub 登录、评论/留言审核、R2 封面、主题/中英文/繁简/全屏/打印、SEO 与本地工具箱。

**线上地址：<https://blog.kalevip.top/>**

## 功能概览

- **前台**：文章、分类、标签、归档时间线、友人帐（友链）、留言板、评论、站内快捷搜索、RSS / Sitemap / SEO；导航栏「中 / EN」一键切换中英文界面。
- **私密数字档案**：管理员专属私密文库（`/private`，入口隐藏）、档案版本审计、发布确认、文章转档案迁移、批量文章管理。
- **后台**（`/admin`）：编辑室布局——文章目录与编辑器、分类与标签管理（增删改查、排序、简介）、友人帐友链管理（增删改排序）、评论/留言审核、站点设置、媒体封面（R2）、审核待办与站点账目。
- **工具箱**：12 个纯本地工具（格式化、时间戳、Diff、编解码、正则、二维码、JWT、URL、安全生成器等），输入不离开浏览器。
- **通知**：Resend 邮件（可选，缺省静默降级）。

## 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Astro 7（`output: server`）+ `@astrojs/cloudflare` |
| 交互 | React 19 Islands + Tailwind 4 + GSAP 动效 |
| 后端 | Hono 4（挂在 `/api/*`，路由：health / posts / post-actions / comments / guestbook / auth / admin / media / taxonomy / archives / archive-imports） |
| 数据 | Cloudflare D1（SQLite，迁移 0001~0007）+ R2（对象存储）+ KV（会话） |
| 校验 | Zod 4 |
| 运行 | 单仓、单 Worker |

## 目录结构

```
src/
  pages/        页面路由（首页/文章/分类/标签/归档/友链/留言板/搜索/工具箱/后台/私密文库）+ rss/sitemap 动态输出 + api 桥接
  layouts/      BaseLayout / AdminLayout
  components/   Header/Footer/ArticleCard/评论/留言/搜索/后台等
  server/
    routes/     Hono 路由（health/posts/post-actions/comments/guestbook/auth/admin/media/taxonomy/archives/archive-imports）
    services/   业务编排（auth/content/interactions/posts/notifications）
    db/         SQL 访问（auth/content/interactions/settings/client）
    middleware/ 会话 + CSRF
  lib/          常量、API 封装、i18n、Markdown、Mermaid、工具箱定义、slug
  types/        领域与 API 类型
migrations/     0001_init / 0002_seed / 0003~0007 档案体系 + rollback/
scripts/        冒烟、导入（语雀/档案）、迁移、各专项 UI 回归
docs/requirements/  三条需求流水线文档（见文档索引）
```

## 本地开发

```bash
npm install
npm run db:local:migrate    # 建表（0001~0007）
npm run db:local:seed       # 灌种子数据
npm run dev                 # http://localhost:4321
```

另开一个终端跑冒烟：`npm run smoke`。

### 本地登录

本地通过 `POST /api/auth/dev-login` 创建管理员会话（仅 `ENVIRONMENT=development && AUTH_DEV_MODE=true` 时可用）。
公开登录入口：`/login`（旧入口 `/admin/login` 自动跳转）。普通访客可登录评论和留言；后台页面、编辑器与管理接口仅向 `GITHUB_ADMIN_USERNAME` 配置的站主开放，服务端在输出页面前验证会话，历史管理员角色不能绕过站主校验。

### 中英文界面

导航栏「中 / EN」一键切换中文与英文，覆盖前台、搜索、工具箱和后台；后台位于顶栏，登录页位于右上角。
偏好保存在一年有效、HttpOnly、SameSite=Lax 的 `blog-locale` Cookie，刷新与跨页面保留，首次默认中文。
切换保留当前路径、查询和锚点；服务端输出对应 `html lang`、页面标题、日期及反馈，无 JS 也可在前台切换。
文章标题/正文/摘要、分类与标签、留言、站点配置与工具输入输出保留原文，不进行机器翻译。
维护界面翻译：`src/lib/i18n/en.json`；只翻译显式界面文案，禁止自动替换 DOM/用户内容。

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 本地开发（predev 自动同步 Mermaid） |
| `npm run check` | `astro check`（类型/语法） |
| `npm run build` | check + 生产构建 |
| `npm run preview` | 预览构建产物 |
| `npm run lint` | ESLint |
| `npm run smoke` | 端到端冒烟（需先起 dev） |
| `npm run test:toolbox` | 工具箱核心回归（Node.js 22.18+，无需数据库/网络） |
| `npm run db:local:migrate` | 本地 D1 迁移 |
| `npm run db:local:seed` | 本地灌种子 |
| `npm run db:local:init` | 迁移 + 种子一步到位 |
| `npm run archives:import` | 导入档案（`scripts/import-archives.mjs`） |
| `npm run deploy` | build + `wrangler deploy`（产出用） |

另有零散脚本直接 `node scripts/xxx.mjs` 运行：`import-yuque.mjs`（语雀导入）、`migrate-posts-to-archives.mjs`（文章转档案迁移）及各专项 UI 回归（见下文）。

## 环境变量 / 绑定

| 名称 | 类型 | 说明 |
|------|------|------|
| `DB` | D1 | 数据库绑定 |
| `BUCKET` | R2 | 资源桶（封面等媒体） |
| `SESSION` | KV | 会话存储 |
| `SITE_URL` | var | 站点地址，用于 OAuth 回调与来源校验 |
| `ENVIRONMENT` | var | `development` / `production` |
| `AUTH_DEV_MODE` | var | 本地开发登录开关，**生产必须 `false`** |
| `ARCHIVES_ENABLED` | var | 私密档案功能开关 |
| `ARCHIVE_PUBLICATION_ENABLED` | var | 档案发布确认开关 |

生产密钥（用 `wrangler secret put`）：

```
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_ADMIN_USERNAME
RESEND_API_KEY / NOTIFY_EMAIL   # 可选，缺省则静默降级
```

## 生产部署（摘要）

```bash
wrangler d1 create personal-blog-db          # 拿 database_id，替换 wrangler.jsonc
wrangler r2 bucket create personal-blog-assets
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_ADMIN_USERNAME
wrangler d1 migrations apply personal-blog-db --remote
npm ci && npm run build
wrangler deploy
```

完整清单见 `docs/requirements/personal-blog/09-release-checklist.md`。

## 后台管理

- **分类与标签**：支持新增、编辑、搜索和删除；分类可设置简介、排序。删除仅解除文章关联，不删除文章；有子分类时不能删除，被已发布档案关联稿使用时不能修改或删除，修改路径会影响旧筛选链接，无需迁移。
- **友人帐（友链）**：站点设置内新增、编辑、删除和排序，保存后刷新 `/social/` 生效；名称及 http(s) 地址必填、简介选填，最多 100 项。沿用 `site.friends`，无需数据库迁移；异常旧配置会阻止覆盖，未保存修改有离开提醒。
- **编辑室布局**：真实最近编辑入口、文章目录、站点账目和审核待办；沿用前台双主题；文章编辑器支持筛选/选择、未保存保护、键盘导航、空态/重试及减少动态效果。

## 工具箱

| 路由 | 功能 |
|------|------|
| `/toolbox/format` | JSON、SQL、HTML、CSS、JavaScript、TypeScript、Markdown、YAML 格式化；JSON 另支持校验 / 压缩 / 字段路径；输入 200,000、输出 1,000,000 字符 |
| `/toolbox/json` | 旧入口，301 跳转至文本格式化 |
| `/toolbox/time` | 秒 / 毫秒时间戳双向转换，上海 / UTC / 东京 / 纽约 / 伦敦时区；校验夏令时空缺与重复 |
| `/toolbox/diff` | 逐行对比、行号、忽略空白、交换左右、复制结果；每侧最多 1,000 行 / 100,000 字符 |
| `/toolbox/codec` | Base64（UTF-8）、URL 参数值、Unicode 转义编解码；输入 100,000 / 输出 500,000 字符 |
| `/toolbox/text` | 按行去重、自然排序、去空行、修剪、大/小写、前后缀；支持结果继续处理；输入 100,000 / 输出 500,000 字符 |
| `/toolbox/regex` | JavaScript 正则匹配高亮、捕获组、替换预览；文本 20,000 字符、表达式/模板各 2,000 字符、替换结果 200,000 字符 |
| `/toolbox/qr` | 二维码实时预览，L/M/Q/H 纠错，512–2048px PNG / SVG 下载；最多 1,200 UTF-8 字节；只生成，不识别图片 |
| `/toolbox/jwt` | 三段 JWT / Bearer 解析，Header、Payload、时间声明；最多 32,768 字符，只解析不验签，不支持加密 JWE |
| `/toolbox/url` | http(s) URL 拆解、参数编辑、重复参数、追踪参数移除；最多 20,000 字符 / 200 组参数 |
| `/toolbox/generator` | UUID v4（1–50 条）、安全随机密码（8–128 位 / 1–20 条）、文本 / 文件 SHA-256；文本 1,000,000 字符 / 文件 20 MiB |

工具无需登录，需要 JavaScript；所有计算在本地执行（独立 Web Worker，超时终止、可取消），不向接口发送输入，也不写入浏览器存储。编解码不是加密；格式化器按需从本站加载；HTML / Markdown 内嵌脚本保持原样不渲染执行。安全生成器需要 HTTPS 或 localhost。

## 站内快捷搜索

前台页面按 `Ctrl+F`（macOS：`⌘F`）或点击顶部搜索按钮，打开居中搜索弹窗。
输入标题、摘要、标签或分类关键词即时匹配，空格分隔的多个关键词须全部命中。
`Esc`、关闭按钮或点击遮罩关闭；弹窗限制键盘焦点并恢复原焦点，同页再次打开保留关键词。
首次打开才请求文章索引；`/search` 独立搜索页保留，无 JavaScript 时顶部链接仍跳转至该页（搜索需要 JavaScript）。
此快捷键替代前台页面的浏览器页内查找；后台不受影响。

## UI 设计（雾林手记）

全站采用奶油钴蓝×青柠／墨蓝酸橙×冰川青双主题，保留悬浮毛玻璃导航与居中搜索浮层；首页以蓝底青柠／冰川青植物标本和真实文章形成识别。正文保持中性纸面，支持减少动态效果与透明度。设计规则见 `DESIGN.md`。

- Ctrl+F／⌘F 打开搜索：雾面玻璃面板与柔焦遮罩同步渐入，退出完成后恢复焦点与滚动。
- 导航主题按钮一步切换明暗；旁边箭头保留主题设置和跟随系统。系统减少动态效果时禁用过渡。

## 测试与回归

以下 UI 回归均需先启动 dev；格式 `node scripts/<脚本> [playwright模块路径] [浏览器channel]`，可省略参数使用环境默认；截图与结果保存在仓库外 `~/.agents/evidence/personal-blog/`。

| 脚本 | 覆盖 |
|------|------|
| `scripts/ui-motion-test.mjs` | 前台内页与后台双主题、320–1440px 布局、键盘导航、减少动态效果、无 JS 阅读（只读，不改数据） |
| `scripts/language-ui-test.mjs` | 中英文界面切换（只读页面，后台 API 用模拟数据） |
| `scripts/admin-access-test.mjs` | 隔离会话夹具：页面渲染前鉴权、旧管理员降权、接口拒绝和回跳安全；不访问真实数据库 |
| `scripts/admin-moderation-ui-test.mjs` | 真实组件与构建 CSS：双语双主题、320–1440px、互动列表留白、批量审核、错误重试与公开退出；仅内存 mock |
| `scripts/admin-redesign-test.mjs` | 后台编辑室：双主题、320–1440px、六个后台视图、编辑器、未保存保护、空态/重试（API 全部只读 mock） |
| `scripts/taxonomy-ui-test.mjs` | 分类与标签界面（mock，不写真实数据） |
| `scripts/friends-ui-test.mjs` | 友链增删改排序、保存与重载（mock，不写真实数据库） |
| `scripts/toolbox-ui-test.mjs` | 工具箱双主题 / 响应式 / 复制与失败反馈 / 无 JS 提示 |
| `scripts/search-ui-test.mjs` | 快捷键、搜索、失败重试、焦点、关闭、双主题与移动端 |
| `scripts/studio-ui-test.mjs` | 雾林手记：双主题、13 个路由、320–1440px、文字对比与快捷键搜索 |
| `scripts/spacing-ui-test.mjs` / `scripts/editorial-ui-test.mjs` | 双语卡片留白 / 前台去统计化、搜索反馈及双语响应式布局（`UI_TEST_BASE` 可指向 dev 或 preview） |
| `scripts/interaction-polish-test.mjs` | 搜索与主题切换交互打磨 |

不依赖浏览器的专项测试：

```bash
npm run test:toolbox                      # 工具箱核心回归
node --test scripts/friends.test.mjs      # 友链专项
node scripts/taxonomy-api-test.mjs        # 分类标签（内存库）
node scripts/admin-access-test.mjs        # 隔离后台页面与接口权限回归
node scripts/admin-api-test.mjs           # 后台鉴权与非法输入（不修改内容）
```

## 文档索引

`docs/requirements/` 下三条需求流水线：

| 目录 | 内容 |
|------|------|
| `personal-blog/` | 01 需求分析 → 02 代码库分析 → 03 技术方案 → 04 方案评审 → 05 实现日志 → 06 代码审查 → 07 自测清单 → 08 接口联调 → 09 发布清单 |
| `private-digital-archive/` | 00 过程记录、02 代码库分析、03 技术方案、05 实现日志 |
| `post-archive-transfer-and-batch/` | 01 需求分析、05 实现日志、09 发布清单（文章转档案与批量管理） |
