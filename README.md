# Customer Service

面向个人运营者和小团队的轻量客服系统，独立于 `Qz121314/site` 开发和部署。

## 产品定位

本项目分成两个明确边界：

```text
客服管理中心
→ 管理员配置客服账号、客服分组、分组成员和分流规则
→ 不在管理中心处理访客聊天

客服坐席端
→ 所有客服访问同一个 /agent 登录入口
→ 每个客服使用自己的账号 + 密码登录
→ 登录后只看到系统分配给自己的会话
```

访客链路：

```text
Site 产品
→ 在线客服转化组
→ customer-service 客服分组
→ 分流引擎选择在线客服
→ 具体客服账号的坐席工作台
→ 客服回复访客
```

`site` 不参与客服系统内部的客服账号、分流和聊天处理。

## 与 Site 的接入模型

`site` 只保存：

```text
客服系统公网 URL
验证 Token
```

验证由 Site 管理员浏览器直接调用：

```text
POST {customer-service-public-url}/integration/v1/verify
Authorization: Bearer <token>
```

验证成功后返回：

```text
clientApiUrl
realtimeUrl
groups
```

因此客服系统可以部署在任意 Cloudflare Account，也可以部署在其他提供公网 HTTPS / WebSocket 的平台；不依赖 Cloudflare Service Binding、固定 Worker 名称或同账号资源。

## 当前功能

- React 19 + Vite 中文管理中心和客服坐席工作台；
- Hono Worker API；
- 管理员使用 `ADMIN_PASSWORD` 登录管理中心；
- D1 独立客服账号、密码凭据和登录 Session；
- 客服分组与客服成员配置；
- 客服启用 / 停用、最大同时会话数、每日新会话上限；
- 管理员和客服本人都可查看完整自然月的会话统计，按月份自动展示 28、29、30 或 31 天；坐席端在当前工作台弹窗内查看，不发生页面切换；统计按 America/Los_Angeles 自然日记账并独立保留 45 天；
- WebSocket 长连接心跳维护客服在线状态，网络恢复时使用 REST heartbeat 对账；
- 每个客服使用独立实时收件箱，不接收其他客服的会话摘要；
- 只向已登录且心跳有效的客服分流；
- 停用客服时立即撤销登录与实时连接，并将其未结束会话重新分流；
- 分区 / 分类 / 指定产品动态负责范围，最少进行中会话优先分流；
- 客服只读取和回复分配给自己的会话；
- Durable Object + WebSocket 实时消息广播；
- D1 持久化访客、会话和消息；
- `integration/v1` 跨域公网验证；
- `client/v1` Storefront REST / WebSocket 协议；
- GitHub Actions 校验和 Cloudflare 生产部署。

## 界面入口

管理中心：

```text
/
```

管理员使用 Cloudflare Worker Secret 中的 `ADMIN_PASSWORD` 登录。

客服统一登录入口：

```text
/agent
```

所有客服访问同一个地址，使用管理中心创建的客服账号和密码登录。

## 客服在线与分流

客服登录成功后状态变为在线。坐席工作台以 WebSocket 为主通道，连接建立和 ping/pong 会维护 `last_seen_at`；不再通过固定 30 秒 HTTP 轮询维持在线。浏览器从离线、休眠或断线状态恢复时，会执行一次 REST heartbeat + 状态对账。

负责范围按规则保存，不展开成大量产品 ID：

```text
整个分区（可多选）
→ 动态覆盖所选分区当前及未来新增产品

指定分类
→ 动态覆盖分区内选中的分类

指定产品
→ 只覆盖明确选择的产品
```

分流优先使用上述 `agent_routing_scopes`。只有没有任何分区 / 分类 / 产品范围命中时，才使用旧客服分组成员关系作为兼容回退。

候选客服必须满足：

```text
账号已启用
账号可登录
客服状态为 online
最近 2 分钟内有有效在线记录
负责范围命中当前产品（或进入兼容分组回退）
未超过最大同时会话数
未达到当天每日新会话上限
```

排序策略：

```text
进行中会话最少
→ 最久未分配
→ 客服 ID
```

候选选择、容量判断和会话写入在同一个 SQLite CTE + UPDATE 中完成，避免并发会话基于过期容量快照重复压给同一客服。

如果访客发起会话时没有符合条件的客服，会话保持未分配；客服登录、恢复 heartbeat，或已有会话关闭释放容量时，会重新尝试分流。

## Cloudflare 资源

```text
Worker  customer-service-app
D1      customer-service-db
R2      customer-service-media
DO      ConversationRoom
```

这些资源独立于 `site`。

`wrangler.jsonc` 是 Cloudflare 绑定的代码侧来源，生产部署使用：

```text
wrangler deploy --keep-vars
```

## Worker Secrets

生产运行至少需要：

```text
ADMIN_PASSWORD
INTEGRATION_VERIFY_TOKEN
```

用途：

```text
ADMIN_PASSWORD
→ 管理中心管理员登录

INTEGRATION_VERIFY_TOKEN
→ 外部 Site 验证 customer-service 接入协议
```

这两个值都应在 Cloudflare Dashboard 的 `Variables and Secrets` 中配置为 Secret，不写入 `wrangler.jsonc`，不提交到 GitHub。

`keep_vars: true` 会保留 Dashboard 管理的变量和 Secret。

## 数据模型

D1 主要表：

```text
sites
support_groups
group_agents
agents
agent_routing_scopes
agent_sessions
product_catalog
visitors
conversations
messages
```

关系：

```text
agents
  ├─ agent_routing_scopes
  │    ├─ section
  │    ├─ category
  │    └─ product
  └─ agent_sessions

product_catalog
  └─ 为分流保存产品 / 分区 / 分类上下文

support_groups
  └─ group_agents
       └─ 仅作为未命中 scope 时的兼容回退

conversations
  ├─ product_id / section_id / category_id
  ├─ group_id
  └─ assigned_agent
```

管理员账号和客服账号不是同一身份体系。管理员只负责配置；客服账号才可以进入坐席工作台处理会话。

## API 基线

管理中心认证：

```text
GET  /api/auth/session
POST /api/auth/login
POST /api/auth/logout
```

管理中心配置：

```text
GET   /api/admin/agents
POST  /api/admin/agents
PATCH /api/admin/agents/:id

GET   /api/admin/groups
POST  /api/admin/groups
PATCH /api/admin/groups/:id
```

旧的管理员聊天接口已禁止使用：

```text
/api/admin/conversations*
/api/admin/realtime/*
```

客服坐席：

```text
GET  /api/agent/auth/session
POST /api/agent/auth/login
POST /api/agent/auth/logout
POST /api/agent/auth/heartbeat   # 恢复/兼容对账，不是固定周期轮询

GET  /api/agent/overview
GET  /api/agent/conversations
GET  /api/agent/conversations/:id/messages
POST /api/agent/conversations/:id/messages
POST /api/agent/conversations/:id/status
GET  /api/agent/realtime/inbox
GET  /api/agent/realtime/:id
```

Site / Storefront 接入：

```text
GET  /integration/v1/status
POST /integration/v1/verify

GET/POST /client/v1/...
```

## 部署流程

PR：

```text
D1 migration 本地校验
→ Prettier
→ ESLint
→ TypeScript
→ Test
→ Build
→ Wrangler dry-run
```

`main`：

```text
D1 remote migrations
→ wrangler deploy --keep-vars
→ 生产协议 Smoke Test
```

生产部署需要 GitHub Repository Secrets：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

## 本地开发

要求：

```text
Node.js >= 22
pnpm >= 11
```

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

## 设计原则

```text
独立项目
简单稳定
管理员配置与客服聊天分离
客服账号独立登录
按分区 / 分类 / 产品动态范围自动分流
客服分组仅保留兼容回退
实时消息与长期数据分离
不做大型企业 RBAC
不依赖 Site 数据库
不依赖同 Cloudflare Account
```
