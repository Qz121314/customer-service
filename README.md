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

当前基础版本已经包含：

- React 19 + Vite 客服工作台；
- Hono Worker API；
- 单管理员密码登录；
- 会话列表、状态筛选、会话详情和回复；
- 公共访客会话 / 消息 API；
- Durable Object + WebSocket Hibernation 实时会话通道；
- D1 会话、访客、消息数据模型；
- R2 独立媒体 Bucket 预留；
- GitHub Actions CI + Cloudflare 自动部署；
- 首次部署自动创建独立 D1 / R2 资源。

## Cloudflare 资源命名

本项目与 `site` 使用同一个 Cloudflare Account，但资源必须完全隔离：

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

## GitHub Secrets

仓库部署只需要：

```text
CLOUDFLARE_ACCOUNT_ID   必需
CLOUDFLARE_API_TOKEN    必需
```

`CLOUDFLARE_API_TOKEN` 应只承担本仓库部署需要的 Workers / D1 / R2 权限。

`ADMIN_PASSWORD` 不放在 GitHub Secrets，也不由 CI 写入 Cloudflare。

## Worker 运行时变量

管理员密码由 `customer-service-app` 自己的 Cloudflare Worker Secret 管理：

```text
ADMIN_PASSWORD
```

推荐在 Cloudflare Dashboard 中进入：

```text
Workers & Pages
→ customer-service-app
→ Settings
→ Variables and Secrets
→ Add
```

配置：

```text
Type:  Secret
Name:  ADMIN_PASSWORD
Value: 自定义后台登录密码
```

密码属于敏感数据，不要放进 `wrangler.jsonc` 的 `vars`，也不要提交到 GitHub。

部署配置启用了：

```jsonc
"keep_vars": true
```

生产 CI 同时使用：

```text
wrangler deploy --keep-vars
```

因此 Cloudflare Dashboard 中维护的普通 Worker Variables 会在代码更新部署时保留；`ADMIN_PASSWORD` 使用 Worker Secret 管理，部署流程不会主动覆盖或删除它。只有显式修改或删除该 Secret 时才会变化。

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

后续会由客服后台的“接入站点”模块管理，不会长期依赖这个默认值。

## 设计原则

```text
独立项目
简单稳定
实时优先
数据可恢复
不做大型企业 RBAC
不做无需求的微服务拆分
不把 site 数据库直接暴露给客服系统
```

`site` 与本项目最终只通过 HTTPS / WebSocket 公共协议连接。
