# 个人博客（Personal Blog）

基于 Astro + Hono + Cloudflare Workers 的个人博客：内容浏览、Markdown 写作、GitHub 登录、评论/留言审核、R2 封面、主题/繁简/全屏/打印、SEO。

## 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Astro 7（`output: server`）+ `@astrojs/cloudflare` |
| 交互 | React 19 Islands + Tailwind 4 |
| 后端 | Hono 4（挂在 `/api/*`） |
| 数据 | Cloudflare D1（SQLite）+ R2（对象存储） |
| 校验 | Zod 4 |
| 运行 | 单仓、单 Worker |

## 目录结构

```
src/
  pages/        页面路由 + rss/sitemap 动态输出 + api 桥接
  layouts/      BaseLayout / AdminLayout
  components/   Header/Footer/ArticleCard/评论/留言/搜索/后台等
  server/
    routes/     Hono 路由（health/posts/comments/guestbook/auth/admin/media）
    services/   业务编排（auth/content/interactions/posts/notifications）
    db/         SQL 访问（auth/content/interactions/settings/client）
    middleware/ 会话 + CSRF
  lib/          常量、API 封装、Markdown、格式化、slug
  types/        领域与 API 类型
migrations/     0001_init / 0002_seed + rollback/
scripts/        smoke.mjs（端到端冒烟）
docs/requirements/personal-blog/  需求流水线文档 00~09
```

## 本地开发

```powershell
cd C:\Users\wkl\Desktop\codex_work_space\personal-blog
npm install
npm run db:local:migrate    # 建表
npm run db:local:seed       # 灌种子数据
npm run dev                 # http://localhost:4321
```

另开一个终端跑冒烟：

```powershell
npm run smoke
```

视觉与动效回归（需先起 dev，后台仅拦截只读请求，不修改数据）：

```bash
node scripts/ui-motion-test.mjs [playwright模块路径] [浏览器channel]
```

覆盖前台内页与后台的双主题、320–1440px 布局、键盘导航、减少动态效果和无 JavaScript 阅读。
设计规则见 `DESIGN.md`；截图与运行结果保存在仓库外 `~/.agents/evidence/personal-blog/`。

### 本地登录

本地通过 `POST /api/auth/dev-login` 创建管理员会话（仅 `ENVIRONMENT=development && AUTH_DEV_MODE=true` 时可用）。
页面入口：`/admin/login`。

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 本地开发 |
| `npm run check` | `astro check`（类型/语法） |
| `npm run build` | check + 生产构建 |
| `npm run preview` | 预览构建产物 |
| `npm run lint` | ESLint |
| `npm run smoke` | 端到端冒烟（需先起 dev） |
| `npm run db:local:migrate` | 本地 D1 迁移 |
| `npm run db:local:seed` | 本地灌种子 |
| `npm run deploy` | build + `wrangler deploy`（产出用） |

## 环境变量 / 绑定

`wrangler.jsonc` 已配置本地绑定：

| 名称 | 类型 | 说明 |
|------|------|------|
| `DB` | D1 | 数据库绑定 |
| `BUCKET` | R2 | 资源桶 |
| `SITE_URL` | var | 站点地址，用于 OAuth 回调与来源校验 |
| `ENVIRONMENT` | var | `development` / `production` |
| `AUTH_DEV_MODE` | var | 本地开发登录开关，**生产必须 `false`** |

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

## 文档索引

| 文件 | 内容 |
|------|------|
| `01-requirements-analysis.md` | 需求分析 |
| `02-codebase-analysis.md` | 代码库分析 |
| `03-tech-solution.md` | 技术方案 |
| `04-solution-review.md` | 方案评审 + 复评 |
| `05-implementation-log.md` | 实现日志 |
| `06-code-review.md` | 代码审查 |
| `07-self-test-checklist.md` | 自测清单 |
| `08-frontend-integration.md` | 接口联调文档 |
| `09-release-checklist.md` | 发布上线清单 |

## 说明

- 本仓库按要求**未提交、未推送**任何 Git 记录。
- 娱乐页保留导航；工具箱提供 文本格式化、时间转换、文本 Diff、编解码、文本处理和正则测试；Diff 支持在可编辑文本框内高亮新增、删除及修改片段，编辑后重新对比。输入仅在浏览器内处理，不上传、不持久化。

## 后台 UI 回归

后台采用编辑室布局，提供真实最近编辑入口、文章目录、站点账目和审核待办；沿用前台双主题。
启动本地开发服务后，在另一个终端执行（需环境中已有 Playwright 和浏览器，不会新增项目依赖）：

```bash
node scripts/admin-redesign-test.mjs /absolute/path/to/playwright/index.mjs msedge
```

可省略模块路径以使用环境中的 `playwright`；不指定浏览器通道时使用 Playwright Chromium。
覆盖双主题、320–1440px、五个后台视图、文章编辑器、筛选/选择、未保存保护、键盘导航、空态/重试及减少动态效果。
所有 API 都由只读 mock 拦截，不登录真实账号、不验证或触发真实保存/发布/审核。截图和结果保存在仓库外的 `~/.agents/evidence/personal-blog/`。

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

工具无需登录，需要 JavaScript；所有计算在本地执行，不向接口发送输入，也不写入浏览器存储。
编解码不是加密；Base64 只解码 UTF-8 文本；URL 按参数值处理，`+` 不转换为空格。
Unicode 支持 `\uXXXX` / `\u{1F600}`，编码按 UTF-16 单元输出；文本去重区分大小写/空格，按行操作统一换行符。
正则支持 `g i m s u y`，替换遵循 JavaScript 引用规则；独立 Web Worker 运行，2 秒超时终止。
正则最多展示 500 处匹配（超限不生成替换结果），每处最多展示 50 个捕获组；位置是从 0 开始的 UTF-16 索引，零长度匹配显示竖线。
文本格式化可选 2 / 4 空格缩进；SQL 支持标准 SQL、MySQL/MariaDB、PostgreSQL、SQLite、SQL Server 方言，不支持存储过程或自定义 DELIMITER。
SQL 仅排版、不执行、不连接数据库，不代替数据库语法校验；非 JSON 不提供压缩或严格校验按钮。
格式化器按需从本站加载，独立 Web Worker 处理，15 秒超时终止，可取消；修改输入、类型、方言或缩进会清除旧结果。
HTML / Markdown 内嵌脚本、样式和代码块保持原样，输入仅作为文本展示，不渲染执行。
JSON 大整数需使用字符串；时间戳自动识别是启发式规则，边界日期请手动指定单位。
核心回归：`npm run test:toolbox`（Node.js 22.18+，直接执行 TypeScript）；不需要数据库或网络。

浏览器回归（先启动 dev）：`node scripts/toolbox-ui-test.mjs [playwright模块路径] [浏览器channel]`。覆盖双主题 / 320–1440px / 复制与失败反馈 / 无 JS 提示；截图保存在仓库外 `~/.agents/evidence/personal-blog/`。
