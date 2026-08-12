# Customer Service

面向个人运营者和小团队的轻量客服管理系统，独立于 `Qz121314/site` 开发和部署。

## 当前阶段

第一阶段目标不是堆功能，而是先形成稳定的客服闭环：

```text
访客创建会话
→ 访客发送消息
→ 客服工作台实时收到
→ 客服回复
→ D1 持久化历史消息
→ Durable Object 负责实时连接与广播
```

当前基础版本包含：

- React 19 + Vite 中文客服管理工作台；
- Hono Worker API；
- 单管理员密码登录；
- 会话列表、状态筛选、会话详情和回复；
- 公共访客会话 / 消息 API；
- Durable Object + WebSocket Hibernation 实时会话通道；
- D1 会话、访客、消息数据模型；
- R2 独立媒体 Bucket 预留；
- GitHub Actions 代码质量 CI；
- Cloudflare Workers Builds 原生生产部署；
- GitHub Actions 手动应急部署入口。

## 管理系统语言

客服管理系统统一使用简体中文，包括：

```text
登录与配置提示
会话列表与筛选
会话状态
空状态与错误提示
回复编辑器
日期与相对时间
```

对外访客接口仍保持稳定的 API 字段和错误码，不把后台中文文案耦合进接口协议。

## Cloudflare 资源命名

本项目与 `site` 使用同一个 Cloudflare Account，但资源完全隔离：

```text
Worker  customer-service-app
D1      customer-service-db
R2      customer-service-media
DO      ConversationRoom
```

禁止复用 `site` 的以下资源：

```text
service-catalog-site
service-catalog-site-db
service-catalog-site-assets
```

`wrangler.jsonc` 是 Cloudflare 绑定的代码侧来源，D1 已固定绑定到 `customer-service-db`，不再通过 CI 动态生成生产配置。

## 生产部署

### 主部署：Cloudflare Workers Builds

生产发布不再依赖 GitHub Hosted Runner 执行 Wrangler。将 `customer-service-app` 连接到 GitHub 仓库：

```text
Repository: Qz121314/customer-service
Production branch: main
Build command: pnpm build
Deploy command: pnpm deploy:cloudflare
Non-production branch builds: Disabled
```

`pnpm deploy:cloudflare` 会按顺序执行：

```text
D1 remote migrations
→ wrangler deploy --keep-vars
```

关闭非生产分支 Builds，是为了避免当前阶段的预览版本复用生产 D1 / R2 绑定。后续如果需要正式的 staging 环境，再使用独立 Wrangler Environment 和独立数据资源。

### GitHub Actions

`.github/workflows/ci.yml` 只负责：

```text
D1 migration 本地校验
Prettier
ESLint
TypeScript
Test
Build
Wrangler dry-run
```

不再在 `main` push 后自动执行 Cloudflare 生产部署。

### 手动应急部署

如果 Cloudflare Workers Builds 临时不可用，可以手动运行：

```text
GitHub Actions
→ Manual Cloudflare Deploy
→ Run workflow
```

这个应急流程仍使用：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

因此这两个 GitHub Repository Secrets 建议保留，但日常生产部署不会依赖它们。

## Worker 运行时变量

管理员密码由 `customer-service-app` 自己的 Cloudflare Worker Secret 管理：

```text
ADMIN_PASSWORD
```

在 Cloudflare Dashboard 中配置：

```text
Workers & Pages
→ customer-service-app
→ Settings
→ Variables and Secrets
→ Add

Type:  Secret
Name:  ADMIN_PASSWORD
Value: 自定义后台登录密码
```

密码不要写入 `wrangler.jsonc`，也不要提交到 GitHub。

部署配置启用了：

```jsonc
"keep_vars": true
```

部署命令同时使用：

```text
wrangler deploy --keep-vars
```

因此 Dashboard 中维护的 Worker Variables 会被保留；`ADMIN_PASSWORD` 由 Worker Secret 独立管理，普通代码部署不会主动覆盖或删除它。

## 数据边界

### D1

`customer-service-db` 保存长期业务数据：

```text
sites
visitors
conversations
messages
```

### Durable Object

`ConversationRoom` 只负责实时协调：

```text
WebSocket 连接
消息广播
连接恢复
实时状态
```

正式历史消息仍以 D1 为准，避免把长期会话历史绑定到实时运行时状态。

### R2

`customer-service-media` 用于后续客服附件、截图和文件。当前第一阶段只建立独立资源边界，不开放附件 UI。

## 本地开发

要求：

```text
Node.js >= 22
pnpm >= 11
```

安装：

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

如果需要分别开发 UI：

```bash
pnpm dev
pnpm dev:ui
```

Vite 会把 `/api` 代理到本地 Worker `127.0.0.1:8787`。

## API 基线

管理端：

```text
GET  /api/health
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
GET  /api/admin/overview
GET  /api/admin/conversations
GET  /api/admin/conversations/:id/messages
POST /api/admin/conversations/:id/messages
POST /api/admin/conversations/:id/status
GET  /api/admin/realtime/:id
```

访客端：

```text
GET  /api/public/sites/:publicKey
POST /api/public/conversations
POST /api/public/conversations/:id/messages
GET  /api/public/realtime/:id?token=...
```

默认 migration 会建立一个开发接入站点：

```text
site id:    default
public key: pk_default
```

后续由客服后台的“接入站点”模块管理，不长期依赖默认值。

## 设计原则

```text
独立项目
简单稳定
实时优先
数据可恢复
后台统一中文
不做大型企业 RBAC
不做无需求的微服务拆分
不把 site 数据库直接暴露给客服系统
```

`site` 与本项目最终只通过 HTTPS / WebSocket 公共协议连接。
