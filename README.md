# Customer Service

面向个人运营者和小团队的轻量流量分发与客服坐席系统，独立于 [`Qz121314/site`](https://github.com/Qz121314/site) 开发和部署。

> 本项目的核心不是长期客服 CRM，而是把前端产生的有效咨询流量，按产品负责范围、坐席在线状态、容量、每日上限和已购买额度，稳定地分配给具体客服。聊天只是流量接待载体。

生产地址：<https://customer-service-app.fcqz121314.workers.dev>

## 1. 项目定位

完整链路：

```text
前端 Site / 产品页
→ 生成临时访客与唯一 sourceHandoffId
→ customer-service 验证项目和产品上下文
→ 过滤重复或超限请求
→ 根据负责范围寻找可接待坐席
→ 原子分配到具体客服账号
→ 坐席工作台接待
→ 生成可统计、可对账的有效流量凭证
```

系统分成三个边界清晰的部分：

| 部分              | 职责                                                       |
| ----------------- | ---------------------------------------------------------- |
| Site / Storefront | 展示产品、生成临时访客、发起咨询并传递产品上下文           |
| 客服管理中心      | 配置账号、负责范围、容量、每日上限、按量额度并查看坐席流量 |
| 客服坐席端        | 登录、接收系统分配的会话、回复访客和处理当前会话           |

`site` 只保存客服系统公网 URL 和验证 Token。它不参与客服账号管理、内部路由、坐席选择和聊天处理。

### 当前业务边界

本仓库已经负责：

- 有效咨询接入、去重、防滥用和临时会话；
- 产品到坐席的动态负责范围；
- 在线状态、容量、每日上限和坐席总额度约束下的流量分配；
- 坐席接待、实时消息、图片和浏览器通知；
- 每位坐席的自然月接待统计；
- 坐席级总额度、已消耗、剩余量、幂等追加和不可变额度变更记录；
- `sourceHandoffId` 上下游逐笔对账。

本仓库当前不负责：

- 产品内容、前端页面和转化组管理；
- 套餐定价、在线购买、支付、商家账户余额和财务结算；
- 长期客户档案、CRM、工单、SLA 或营销自动化；
- 把临时访客发展成长期用户体系；
- 为了“大而全”增加多层企业 RBAC 或复杂审批。

套餐价格、订单和收款仍由上游销售/计费系统管理；本项目负责把已购买数量追加到指定坐席，并在分流时维护总额度、已消耗和剩余额度。

## 2. 界面与角色

### 管理中心 `/`

管理员使用 Cloudflare Secret `ADMIN_PASSWORD` 登录。管理中心只做配置和统计，不直接处理访客会话。

主要能力：

- 创建、编辑、启用或停用客服账号；
- 设置客服登录账号和密码；
- 设置最大同时处理会话数；
- 设置每日新会话接待上限；
- 启用坐席按量额度，使用 100 / 500 / 1000 快捷套餐或自定义数量追加；
- 查看每名坐席的总额度、已消耗、剩余量及最近 10 笔额度变更；
- 设置分区、分类或指定产品负责范围；
- 分区负责范围支持多选；
- 查看所有坐席的完整自然月接待统计；
- 统计以弹窗展示，不离开当前管理界面；
- 复制或打开统一坐席入口。

### 客服坐席端 `/agent`

所有客服使用同一个入口，以各自账号和密码登录。登录后只能读取和操作分配给自己的会话。

主要能力：

- 在线接待 / 暂停接待；
- 新会话、处理中、已关闭状态筛选；
- 未读优先和本地关键词搜索；
- 文字和图片消息；
- 当前商品封面、名称、分区、分类和商品链接；
- 最多 30 条个人快捷回复；
- 会话转给另一名仍有容量的在线坐席；
- 排除自己后重新进入自动分流；
- 浏览器后台新消息通知；
- 当前工作台内弹窗查看本人的自然月接待统计；
- 网络断开、连接中、恢复中和实时在线状态提示。

### 访客端

访客端不是独立运营后台，而是 Site 产品页中的临时咨询入口：

- 访客标识只服务于 24 小时临时会话；
- 访客只能查看自己的会话；
- 会话携带产品、分区和分类上下文；
- 支持文字、图片、已读状态、WebSocket 和浏览器通知；
- 不创建长期客户资料，不提供历史客户运营能力。

## 3. Site 接入模型

Site 管理员录入：

```text
客服系统公网 URL
验证 Token
```

验证请求：

```http
POST {customer-service-public-url}/integration/v1/verify
Authorization: Bearer <token>
Content-Type: application/json
```

验证时可以一次提交当前产品目录。客服系统将产品、分区和分类上下文批量同步到 D1，供管理员配置动态负责范围；实际访客会话仍由前端直接调用客服系统，Site 后台不做代理。

验证成功返回协议版本、客户端 API、实时地址和产品目录同步结果。客服系统只要求公网 HTTPS / WebSocket，不依赖与 Site 位于同一个 Cloudflare Account，也不依赖固定 Worker 名称或 Service Binding。

产品目录同步使用固定大小的 JSON 批次在 D1 内通过 `json_each` 展开。即使产品数量增长，也不会变成“一件产品一次 D1 查询”的线性请求模型。

## 4. 流量分配规则

### 4.1 负责范围

路由统一使用 `agent_routing_scopes`，规则不展开成大量产品 ID：

| 范围     | 行为                                       |
| -------- | ------------------------------------------ |
| 整个分区 | 可多选，自动覆盖所选分区当前及未来新增产品 |
| 指定分类 | 覆盖选中分区/分类中的产品                  |
| 指定产品 | 只覆盖明确选择的单个产品                   |

如果当前产品没有任何启用的分区、分类或产品范围命中，会话保持等待状态，不再回退到旧客服分组模型。等待会话在匹配坐席恢复在线、释放容量、补充额度或管理员补充负责范围后再次尝试分配。

历史 `agent_products` 配置已在早期 migration 中转换为明确的产品级 `agent_routing_scopes`；旧客服分组和旧路由目录表已从最终 schema 删除。

### 4.2 候选坐席

坐席必须同时满足：

```text
账号已启用
状态为 online
最近 2 分钟内存在有效在线记录
负责范围命中当前产品
未超过最大同时会话数
未达到当天新会话接待上限
未耗尽坐席总接待额度（未启用时跳过）
```

“暂停接待”保留当前会话和实时连接，但不再参与新会话分配。停用账号会立即撤销登录和实时连接，并释放仍未结束的会话重新分流。

### 4.3 分配顺序与并发

候选坐席排序：

```text
进行中会话最少
→ 当日累计接待最少
→ 最久未分配
→ 客服 ID
```

候选选择、容量判断和会话写入由 D1 SQLite 的单条原子更新完成，避免并发请求依据同一份过期容量快照，把多个会话重复压给同一坐席。

如果当前没有合格坐席，会话保持未分配。坐席登录、恢复在线、已有会话结束释放容量，或额度耗尽后完成补额，系统会再次尝试分配。等待队列恢复不是逐会话重跑完整路由，而是针对当前坐席按剩余容量、每日上限和剩余额度一次批量认领；每次最多处理 10 个等待会话，避免无界 D1 扫描。

## 5. 会话生命周期与计数规则

### 5.1 临时会话

| 规则           | 当前值                                 |
| -------------- | -------------------------------------- |
| 会话生命周期   | 从创建时间起固定 24 小时               |
| 新消息是否续期 | 不续期                                 |
| 过期处理       | 删除会话、消息、媒体记录和对应 R2 对象 |
| 孤立访客       | 会话清理后自动删除                     |
| 清理调度       | Worker Cron 每分钟触发，按批次处理     |

24 小时用于覆盖同一次临时咨询，不代表长期客户记录。过期会话不能继续参与分配或读取。

### 5.2 有效流量计数

一次会话只在首次成功进入坐席时计为 1 个有效接待流量：

- 转接、重新排队、关闭或重新打开不重复计数；
- 未分配会话不计入任何坐席；
- 被频率限制、重复分发编号或额度限制拦截的请求不计数；
- `sourceHandoffId` 在会话和首次接待凭证中保持唯一；
- 新建 v1 会话必须提供合法 UUID v4 `sourceHandoffId`；
- 相同 `sourceHandoffId` 重试只返回原结果，不创建第二个会话或第二笔流量；
- 坐席流量凭证独立于 24 小时聊天记录保存 400 天。

### 5.3 统计周期

- 统计对象是每一名客服坐席，不是整个系统共用一个数字；
- 每个周期对应一个完整自然月；
- 自动展示当月实际的 28、29、30 或 31 天；
- 每日上限和接待日期按 `America/Los_Angeles` 自然日计算；
- 管理员可查看所有坐席，客服只能查看自己；
- 统计使用独立的 `agent_daily_stats` 和 `agent_traffic_receipts`，不会因为 24 小时会话清理而丢失。

### 5.4 坐席额度套餐

本项目采用“按量额度 + 每日接待上限”，不做月租订阅：

```text
上游完成价格、订单和收款
→ 管理员为指定坐席追加已购买的咨询次数
→ 每次首次有效接待扣 1
→ 剩余为 0 时停止分配新会话
```

- 新坐席默认启用按量额度，初始快捷值为 100；旧坐席迁移后默认不限额，避免上线时意外停流；
- 总额度只能正向追加，不允许覆盖或减少已消耗量；
- 每次追加必须携带唯一 `trafficQuotaRequestId`，相同请求重试只生效一次，不同金额复用同一编号会被拒绝；
- 每次成功追加写入不可变 `agent_quota_adjustments` 记录，坐席编辑弹窗按需读取最近 10 笔，不增加常驻轮询；
- 关闭额度限制不会清空历史总额和消耗，再次启用继续沿用原余额；
- 额度用完只影响新分流，已分配会话仍可继续处理；
- 在线坐席补额恢复资格后，立即对最早等待的会话执行一次最多 10 条的有界分配重试；
- 转接、重新排队、关闭后重新打开，以及相同 `sourceHandoffId` 的重试不重复扣减；
- 额度检查位于原子路由 SQL，扣减与首次接待凭证由 D1 的首次分配规则保证只发生一次。

计算口径：`剩余额度 = max(总额度 - 已消耗, 0)`。

## 6. 防滥用与资源额度规则

设计目标是阻止故意无限创建会话，同时把 Workers、D1 和 R2 成本控制在固定范围内。

### 6.1 新建会话

| 层级                     | 规则                                              | 资源影响                                   |
| ------------------------ | ------------------------------------------------- | ------------------------------------------ |
| Cloudflare Rate Limiting | 同一来源 60 秒最多 1 次新会话                     | 在进入主要 D1 写入和路由前拦截突发请求     |
| D1 访客额度              | 同一访客滚动 24 小时最多 10 次                    | 固定键计数，不扫描历史会话                  |
| D1 来源额度              | 同一 `IP + User-Agent` 哈希滚动 24 小时最多 20 次 | 更换本地访客编号仍不能无限创建              |
| 分发编号                 | 同一站点的 `sourceHandoffId` 唯一                 | 网络重试不产生重复流量                      |
| 幂等消息                 | `clientMessageId` 必填                            | 重试不会重复创建第一条消息                  |
| 产品上下文               | 新会话必须携带有效产品上下文                      | 分流不依赖额外回查旧客服组或旧路由目录      |

Visitor 与 Source 两个 D1 额度在同一条 SQLite 语句中先判断、再一起消费。只有两边都仍有额度时才同时增加计数；任意一边已经达到上限时，本次创建不会误扣另一边。正常允许路径因此只需要一次额度 SQL，拒绝路径仅额外读取当前计数用于确定错误类型和 `Retry-After`。

系统只存储来源哈希，不把原始 IP 或完整 User-Agent 写入 D1。超限响应包含 `Retry-After`；被拦截请求不进入坐席分配、不产生有效流量凭证，也不占用坐席容量。

过期防滥用计数每日最多清理 1000 行，避免一次性清理造成 D1 写入尖峰。

### 6.2 图片与 R2

| 规则              | 当前值                                                |
| ----------------- | ----------------------------------------------------- |
| 媒体预留频率      | 每个限流键每分钟最多 6 次                             |
| 同时待上传        | 每个会话、每种发送方最多 3 个                         |
| 访客媒体          | 每个会话最多 10 个有效/待上传媒体                     |
| 坐席媒体          | 每个会话最多 30 个有效/待上传媒体                     |
| WebP / JPEG / PNG | 单个最多 1 MiB                                        |
| GIF               | 单个最多 5 MiB                                        |
| 中断上传          | 2 小时后标记失败，再经过 1 小时删除 D1 记录与 R2 对象 |

媒体初始化和完成接口支持 `clientUploadId` 幂等重试。文件类型和实际大小在完成阶段再次校验，不合格对象立即从 R2 删除。

配置 R2 S3 凭据时使用短期签名 URL 让浏览器直传，减少 Worker 代理上传请求；未配置时回退到 Worker 代理上传。

## 7. 请求数与实时连接策略

系统优先减少不必要的 Worker 请求和 D1 读取：

- 坐席收件箱概览、统计摘要、会话列表、快捷回复和可转接坐席合并返回；
- 单个会话的消息与媒体合并读取；
- 状态筛选、关键词搜索和未读优先在前端本地完成；
- 分区负责范围保存为动态规则，不逐个读取或写入产品；
- 产品目录同步按固定 JSON 批次使用 `json_each` 在 D1 内展开，不逐产品执行 SQL；
- 等待会话恢复按坐席剩余容量一次批量认领，不逐会话重跑全局路由；
- Visitor + Source 创建额度用单条 SQL 原子判断和消费；
- WebSocket 负责实时消息和在线心跳，不使用固定 30 秒 HTTP 轮询；
- 浏览器恢复时只执行一次 REST heartbeat 对账；
- 重连后只补取最后一条消息之后的增量；
- 新建会话防滥用使用固定键索引，不随历史会话数量增长；
- 坐席额度直接读取 `agents` 行上的计数器，并随既有启动数据返回，不增加轮询或逐会话扫描；
- 额度变更历史只在打开坐席编辑弹窗时读取最近 10 笔；
- Cron 清理全部按批次执行，避免单次大查询和大删除。

## 8. 接待稳定性

- 新建会话使用 `sourceHandoffId` 唯一约束，上游重试可安全对账；
- 客户端消息使用 `clientMessageId` 唯一约束，发送失败可安全重试；
- 图片使用 `clientUploadId` 唯一约束，初始化和完成可重复调用；
- 文字草稿只保存在当前浏览器，按会话保存 24 小时；
- WebSocket 使用带抖动的指数退避重连；
- 断网期间仍可输入，本地草稿不会因界面切换丢失；
- 客服实时收件箱按登录账号隔离，不接收其他坐席的会话摘要；
- 浏览器页面可见时不重复展示后台 Push 通知。

这些机制服务于临时会话的稳定接待，不会扩展成长期客户时间线或 CRM 操作记录。

## 9. 技术架构

| 层级         | 技术                                           | 用途                                         |
| ------------ | ---------------------------------------------- | -------------------------------------------- |
| 管理/坐席 UI | React 19、TypeScript、Vite                     | 单页管理中心与坐席工作台                     |
| HTTP API     | Hono                                           | 管理、坐席、访客和集成协议                   |
| 运行时       | Cloudflare Workers                             | 单 Worker 承载静态资源、API、Cron 和路由入口 |
| 结构化数据   | Cloudflare D1 / SQLite                         | 账号、路由、临时会话、消息、计数和流量账本   |
| 媒体对象     | Cloudflare R2                                  | 临时会话图片                                 |
| 实时连接     | Durable Objects + WebSocket                    | 会话广播和坐席独立实时收件箱                 |
| 突发保护     | Workers Rate Limiting bindings                 | 新会话和媒体预留限流                         |
| 后台通知     | Web Push                                       | 访客和坐席浏览器通知                         |
| 自动清理     | Workers Cron Triggers                          | 过期会话、访客、媒体和防滥用计数清理         |
| 工程质量     | ESLint、Prettier、TypeScript、Node Test Runner | 格式、静态检查和自动测试                     |
| CI/CD        | GitHub Actions + Wrangler                      | D1 迁移、构建、部署和生产冒烟测试            |

采用单 Worker 是当前个人/小团队规模下的明确选择：部署简单、跨模块调用少、静态资源与 API 同源。D1、R2 和 Durable Object 仍使用独立绑定，未来只有在真实容量或权限边界需要时才拆分。

## 10. Cloudflare 资源

```text
Worker         customer-service-app
D1             customer-service-db
R2             customer-service-media
Durable Object ConversationRoom
Rate Limit     CONVERSATION_BURST_LIMITER
Rate Limit     MEDIA_BURST_LIMITER
Cron           * * * * *
```

这些资源独立于 `site`。`wrangler.jsonc` 是代码侧绑定来源，生产部署使用 `--keep-vars`，不会覆盖 Cloudflare Dashboard 中已有的变量和 Secret。

## 11. D1 数据模型

### 核心会话

```text
sites
visitors
conversations
messages
media_items
```

### 客服与路由

```text
agents
agent_sessions
agent_routing_scopes
product_catalog
agent_quick_replies
```

路由只依赖 `agent_routing_scopes + product_catalog`。早期 rollout 使用的 `support_groups`、`group_agents`、`group_routing_rules`、`routing_catalog_sections`、`routing_catalog_categories` 和 `agent_products` 已在 migration 0025 删除，不再属于最终运行时数据模型。

### 流量统计与防滥用

```text
agent_daily_stats
agent_traffic_receipts
agent_quota_adjustments
conversation_creation_limits
```

`agents` 同时保存坐席总额度、已消耗和是否启用额度限制；`agent_traffic_receipts.quota_consumed` 标记每个会话是否已经完成唯一扣量；`agent_quota_adjustments` 以坐席和请求编号唯一约束保存每次正向追加，确保网络重试不会重复加额。

### 通知

```text
visitor_push_vapid
visitor_push_subscriptions
agent_push_subscriptions
```

管理员账号和客服账号不是同一身份体系。管理员只负责配置；只有客服 Session 可以进入坐席工作台和处理分配给自己的会话。

## 12. API 基线

### 健康与集成

```text
GET  /api/health
GET  /integration/v1/status
POST /integration/v1/verify
```

### 管理中心

```text
GET  /api/auth/session
POST /api/auth/login
POST /api/auth/logout

GET   /api/admin/bootstrap
GET   /api/admin/agents
POST  /api/admin/agents
PATCH /api/admin/agents/:id
GET   /api/admin/agents/:id/quota-adjustments
GET   /api/admin/agent-stats?month=YYYY-MM
GET   /api/admin/products
```

创建或更新坐席可提交 `trafficQuotaEnabled`、`trafficQuotaTopUp` 和 `trafficQuotaRequestId`。追加数量大于 0 时请求编号必填并作为幂等键；`trafficQuotaTopUp` 只做正向追加，支付和订单信息不进入本 API。

管理员聊天接口已明确禁用：

```text
/api/admin/conversations*
/api/admin/realtime/*
```

旧 Public API 和旧 Management API 也已移除并在 Worker 最外层固定返回 404：

```text
/api/public/*
/management/v1/*
```

### 客服坐席

```text
GET  /api/agent/auth/session
POST /api/agent/auth/login
POST /api/agent/auth/logout
POST /api/agent/auth/heartbeat
POST /api/agent/auth/status

GET  /api/agent/overview
GET  /api/agent/stats?month=YYYY-MM
GET  /api/agent/conversations
GET  /api/agent/conversations/:id/messages
POST /api/agent/conversations/:id/read
POST /api/agent/conversations/:id/messages
POST /api/agent/conversations/:id/status
POST /api/agent/conversations/:id/transfer

POST   /api/agent/quick-replies
DELETE /api/agent/quick-replies/:id

POST /api/agent/conversations/:id/media/init
GET  /api/agent/conversations/:id/media
PUT  /api/agent/media/:id/content
POST /api/agent/media/:id/complete
GET  /api/agent/media/:id/content

GET  /api/agent/push/config
POST /api/agent/push/subscriptions
POST /api/agent/push/subscriptions/remove
GET  /api/agent/realtime/inbox
GET  /api/agent/realtime/:id
```

### Site / Storefront

```text
GET  /client/v1/conversations
POST /client/v1/conversations
GET  /client/v1/conversations/:id
POST /client/v1/conversations/:id/messages
POST /client/v1/conversations/:id/read
GET  /client/v1/conversations/:id/realtime
GET  /client/v1/realtime

POST /client/v1/conversations/:id/media/init
GET  /client/v1/conversations/:id/media
PUT  /client/v1/media/:id/content
POST /client/v1/media/:id/complete
GET  /client/v1/media/:id/content

GET  /client/v1/push/config
POST /client/v1/push/subscriptions
POST /client/v1/push/subscriptions/remove
```

新建 `POST /client/v1/conversations` 必须包含：

```text
visitorId
sourceHandoffId   # UUID v4
clientMessageId
message
product           # id / section / category / title / href / cover 等上下文
```

`sourceHandoffId` 用于上游 Site 与客服系统之间的逐笔流量对账和幂等重试；`clientMessageId` 用于第一条消息的发送幂等。

## 13. 环境变量与 Secret

生产必需：

```text
ADMIN_PASSWORD
INTEGRATION_VERIFY_TOKEN
```

| 名称                       | 用途                   |
| -------------------------- | ---------------------- |
| `ADMIN_PASSWORD`           | 管理中心管理员登录     |
| `INTEGRATION_VERIFY_TOKEN` | 外部 Site 验证接入协议 |

旧 `MANAGEMENT_TOKEN` 已删除，不再属于运行时配置。

可选的 R2 浏览器直传配置：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
```

未配置直传凭据时，图片自动回退到 Worker 代理上传。

Secret 应在 Cloudflare Dashboard 的 `Variables and Secrets` 中配置，不写入 `wrangler.jsonc`，不提交到 GitHub。

## 14. 本地开发

要求：

```text
Node.js >= 22
pnpm >= 11
```

安装和启动：

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

常用命令：

```bash
pnpm dev:ui              # 仅启动 Vite UI
pnpm typecheck           # UI + Worker 类型检查
pnpm test                # Node 测试
pnpm build               # UI 构建 + Worker 类型检查
pnpm cf:check            # 构建并执行 Wrangler dry-run
pnpm verify              # 完整本地验证
pnpm db:migrate:remote   # 远程 D1 迁移
pnpm deploy:cloudflare   # 迁移 D1 并部署 Worker
pnpm smoke:production    # 生产协议冒烟测试
```

## 15. CI/CD

Pull Request：

```text
安装锁定依赖
→ 本地 D1 完整迁移
→ Prettier
→ ESLint
→ TypeScript
→ Test
→ Vite Build
→ Wrangler dry-run
```

`main`：

```text
执行全部校验
→ 应用远程 D1 migrations
→ wrangler deploy --keep-vars
→ 生产协议 Smoke Test
```

生产 Smoke Test 会验证健康检查、Integration v1、废弃协议 404、Client CORS、Client REST 和 Client WebSocket，避免 SPA fallback 或路由调整把已删除协议重新暴露出来。

GitHub Repository Secrets：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

任何校验失败都会停止后续生产部署。D1 migration 必须先在本地完整迁移测试通过，再进入远程数据库。

## 16. 设计原则

```text
流量分配优先，聊天只是接待载体
个人和小团队优先，简单稳定
管理员配置与客服接待分离
访客会话临时化，不做长期 CRM
路由只使用分区 / 分类 / 产品动态负责范围
有效流量只计首次坐席接待
坐席总额度只正向追加，用唯一请求编号防止重复加额
上下游使用 sourceHandoffId 幂等对账
Visitor + Source 防滥用计数必须同时成功才消费
优先批量读取、一次返回和前端本地筛选
优先使用有界批处理，减少 Workers 请求、D1 查询和无界 R2 写入
不依赖 Site 数据库或同一 Cloudflare Account
不在没有真实需求时增加大型企业功能
```
