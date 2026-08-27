# Customer Service

面向个人运营者和小团队的轻量客服坐席与咨询流量分发系统，独立于 [`Qz121314/site`](https://github.com/Qz121314/site) 开发和部署。

> 这个项目不是长期 CRM。它的核心职责是把 Site / 产品页产生的有效咨询，按产品负责范围、账号启用状态、已购买额度、CTA 两小时原客服优先和严格轮询，稳定地分配给具体客服，并提供 24 小时临时聊天接待能力。

生产地址：<https://customer-service-app.fcqz121314.workers.dev>

## 1. 系统边界

完整链路：

```text
Site / 产品页
→ 生成临时访客与唯一 sourceHandoffId
→ customer-service 校验产品上下文与防滥用规则
→ 根据负责范围、账号启用状态和剩余额度筛选坐席
→ CTA 两小时原客服优先，否则按严格轮询选择坐席
→ D1 原子分配到具体客服
→ 客服坐席工作台接待
→ 生成可统计、可对账的有效流量凭证
```

系统分为三个边界：

| 部分                | 职责                                                 |
| ------------------- | ---------------------------------------------------- |
| Site / Storefront   | 展示产品、生成临时访客、发起咨询、传递产品上下文     |
| 客服管理中心 `/`    | 配置客服账号、负责范围、人工转接限制、按量额度和统计 |
| 客服坐席端 `/agent` | 登录、接收分配会话、聊天、转接、头像、通知和个人工具 |

`site` 只保存客服系统公网 URL 和验证 Token，并批量同步产品目录。实际访客咨询直接访问本项目，Site 后台不代理聊天，也不参与坐席选择。

本项目当前负责：

- 有效咨询接入、幂等、去重、防滥用和 24 小时临时会话；
- 分区 / 分类 / 指定产品的动态坐席负责范围；
- 负责范围、账号启用状态、按量额度和 CTA 原客服优先约束下的严格轮询；
- 客服坐席实时聊天、图片、已读、输入状态、声音和 Web Push；
- 客服头像自助上传与访客端展示；
- 客服可在坐席工作台维护对外昵称；登录账号保持独立，访客端只展示昵称；
- 产品自然月流量分布、坐席每日接待统计、流量凭证和 `sourceHandoffId` 对账；
- 会话、媒体和临时访客的自动清理。

本项目不负责：

- 产品内容、产品页面、转化组和站点 CMS；
- 套餐价格、订单、支付、余额和财务结算；
- 长期客户档案、CRM、工单、SLA 或营销自动化；
- 多层企业 RBAC、审批流等个人/小团队不需要的企业功能。

## 2. 技术架构

主要运行在 Cloudflare：

```text
React + Vite
      ↓
Cloudflare Static Assets + Worker / Hono
      ├─ Static Assets：管理端 / 坐席端页面与构建资源
      ├─ D1：账号、会话、消息、路由、统计、额度
      ├─ R2：聊天图片、客服头像
      ├─ Durable Objects：会话和坐席实时 WebSocket
      ├─ Rate Limiting：登录、新建会话与媒体突发限制
      ├─ Web Push：访客 / 坐席后台通知
      └─ Cron：过期数据与孤立资源清理
```

原则：

- 静态 UI 资源保持 Assets-first，不把所有请求都改成 `run_worker_first: true`；只有 `/api/*`、`/client/*`、`/integration/*` 和已移除协议的 `/management/v1*` 等必要协议路径优先进入 Worker；
- Static Assets 使用 `not_found_handling: none`。普通 GET / HEAD 页面导航只有在 Worker 返回 404 且请求明确接受 HTML 时，才显式回退到 `/index.html`；API、Client、Integration、Management 等协议命名空间不会继承 SPA 的 HTTP 200 fallback；
- Worker 只承担必要协议和业务边界；
- D1 热路径优先单条 SQL、批量 SQL、原子更新，避免逐项请求；
- 前端能够本地完成的筛选、搜索和草稿不消耗 Worker / D1；
- R2 对象使用稳定键或批量删除，避免无界垃圾对象；
- 不为了理论扩展性提前引入额外服务、消息队列或复杂状态管理。

### 2.1 UI 技术基线

管理中心和客服坐席端共享一套源码可控的 UI 设计系统：

| 技术                         | 项目中的职责                                             |
| ---------------------------- | -------------------------------------------------------- |
| shadcn/ui `new-york` 结构    | 组件源码直接保存在仓库，不依赖不可控的整套默认皮肤       |
| Tailwind CSS 4 + Vite Plugin | 生成组件级样式、响应式状态和统一设计令牌                 |
| Radix UI Slot                | 提供可组合、可继承语义的基础组件能力                     |
| Lucide React                 | 管理端和坐席端唯一的功能图标来源，按需打包               |
| CSS Variables                | 统一颜色、圆角、边框、阴影、焦点环和桌面/移动端控件尺寸  |
| 业务 CSS                     | 只保留聊天几何、移动端安全区、键盘视口和页面专属复杂布局 |

`components.json` 是 shadcn 组件生成配置，`src/dashboard/ui/` 是通用组件唯一入口，`src/dashboard/ui-system.css` 是全局设计令牌和 Tailwind 入口。新增按钮、输入框、文本框、通用弹层或图标时，必须优先扩展这些入口，不能重新在页面中复制一套 `.primary-button`、输入框基础样式或本地 SVG。

当前 CSS 按所有权收敛：

```text
ui-system.css                 全局令牌、重置、媒体基础
admin-*.css                   管理端页面与业务布局
agent-foundation.css          坐席登录与基础壳层
agent-workspace.css           PC/手机共享的工作台结构
agent-desktop-layout.css      桌面端几何与输入区
agent-mobile-layout.css       移动端几何、安全区与功能菜单
agent-overlays.css            坐席弹层及稳定合成层动效
feature.css                   统计、头像、聊天线程等独立复杂功能
```

组件库迁移遵循增量兼容：先迁移通用控件，再删除被完全替代的旧选择器；聊天线程、Visual Viewport、PWA 安全区和弹层几何不能为了追求纯 Tailwind 而改写成难以验证的工具类堆叠。

## 3. 管理中心 `/`

管理员通过 Cloudflare Secret `ADMIN_PASSWORD` 登录。

主要能力：

- 创建、编辑、启用或停用客服账号；
- 配置客服登录账号和密码；
- 设置人工指定转接使用的同时会话和每日接待限制；
- 启用坐席按量额度，并使用 100 / 500 / 1000 或自定义数量追加；
- 查看总额度、已消耗、剩余额度和最近额度变更；
- 设置整个分区、指定分类或指定产品负责范围；
- 在“流量统计”查看产品带来的自然月有效咨询分布与整体每日趋势；
- 在客服账号列表按需打开单个客服的每日接待统计；
- 复制或打开统一客服登录入口。

管理中心只做配置和统计，不参与实际聊天转发。

## 4. 客服坐席端 `/agent`

所有客服使用统一入口，以各自账号和密码登录；登录后只能读取和操作分配给自己的会话。

主要能力：

- 在线 / 忙碌工作状态；
- 新会话、处理中、已关闭状态；
- 未读优先和本地关键词搜索；
- 文字、图片、发送失败重试和本地草稿；
- 消息已读状态和双方输入状态；
- 当前商品封面、名称、分区、分类和商品链接；
- 会话转给其他仍有容量的在线客服；
- 排除自己后重新进入自动分流；
- 浏览器后台新消息通知和前台提示音；
- 当前工作台内查看个人自然月统计；
- 自助上传、更换和删除客服头像。

### 4.1 客服头像

客服可以点击自己的头像打开居中头像弹窗。

上传流程：

```text
选择 JPG / PNG / WebP 原图
→ 浏览器本地读取和居中裁成正方形
→ 最大 512 × 512
→ 优先压缩为 WebP，必要时回退 JPEG
→ 本地预览
→ 客服确认
→ 才上传 Worker / R2
```

头像规则：

- 原图最多 15 MB；
- 上传后的头像目标约 220 KB，服务器硬上限 320 KB；
- 服务器再次验证 Content-Type、文件大小和图片签名；
- 每名客服只保留一个固定 R2 对象：`agent-avatars/<agentId>/current`；
- 更换头像使用同一 R2 key 覆盖旧对象，不产生历史头像垃圾；
- 删除头像同时删除 R2 对象并清空 D1 版本号；
- URL 带版本参数，便于长期缓存同时确保更换后立即更新；
- Client v1 会话返回 `agentName` 和 `agentAvatarUrl`，用户端可以显示实际客服头像。

## 5. Site 接入模型

Site 管理员只配置：

```text
客服系统公网 URL
验证 Token
```

Customer Service 侧对应的 Cloudflare Secret 名称是 `INTEGRATION_VERIFY_TOKEN`。Site 保存的验证 Token 必须与这个 Secret 完全一致。

验证：

```http
POST {customer-service-public-url}/integration/v1/verify
Authorization: Bearer <token>
Content-Type: application/json
```

验证时可以一次提交当前产品目录。客服系统批量同步产品、分区和分类上下文，管理员随后可以按动态范围配置客服。

产品目录同步不会变成“一件产品一次 Worker / D1 请求”的模型；批量数据在 Worker 内一次处理并由 D1 批量展开。

实际访客会话直接调用 Client v1：

```text
/client/v1/conversations
/client/v1/conversations/:id
/client/v1/conversations/:id/messages
/client/v1/conversations/:id/realtime
/client/v1/media/...
```

系统只依赖公网 HTTPS / WSS，不要求与 Site 位于同一个 Cloudflare Account，也不要求固定 Worker 名称或 Service Binding。

## 6. 路由规则

### 6.1 负责范围

正式路由表为 `agent_routing_scopes`，管理 API 只接受和返回统一的 `routingScope`，不再维护旧的顶层 `productIds` 或单 `sectionId` 兼容协议：

| 范围     | 行为                                     |
| -------- | ---------------------------------------- |
| 整个分区 | 可多选，自动覆盖该分区当前及未来新增产品 |
| 指定分类 | 覆盖选中分区中的指定分类                 |
| 指定产品 | 只覆盖明确选择的产品                     |

如果没有任何启用范围命中当前产品，会话保持等待状态，不回退到旧客服分组模型。

### 6.2 候选坐席

坐席必须同时满足：

```text
账号已启用
负责范围命中当前产品
已配置可登录的客服账号和密码
未耗尽坐席总接待额度（未启用额度限制时跳过）
不是本次手动退回自动分流时被排除的原客服
```

自动分流不读取在线 / 忙碌 / 离线状态、心跳新鲜度、当前进行中会话数、并发上限或每日接待上限。工作状态只用于坐席端展示和触发等待队列恢复，不改变严格轮询的候选资格。停用账号会撤销登录资格并释放仍未结束的会话重新分配。

### 6.3 分配顺序

候选顺序：

```text
有效的 CTA 两小时原客服优先
→ round_robin_seq 最小
→ 客服 ID
```

`round_robin_seq` 是站点内单调递增的轮询游标。候选选择和会话写入在 D1 单条原子更新中完成，分配触发器在同一写入内推进游标；即使多个请求发生在同一毫秒，也不会因为时间戳并列集中到同一客服。

没有合格客服时，会话保持等待。登录、在线心跳、状态切换、关闭会话、补充额度或修改负责范围等生命周期事件可以触发恢复；系统每次最多读取 10 条最早等待会话，并让每条会话重新进入同一套严格轮询。触发恢复的客服不会获得分配优先权。

### 6.4 CTA 两小时重复保护

- 服务端以 `siteId + visitorId + productId` 识别同一条产品咨询；
- 同一产品最近活动会话仍在 2 小时窗口内且状态为新会话或处理中时，CTA 直接返回原会话和原客服；
- 复用不会新建 D1 会话、重复消耗访客 / 来源创建额度、坐席流量额度或重复发送首次分配通知；
- 最近会话已经关闭但仍在 2 小时内时，新建独立会话，并把原客服放在合格候选的第一顺位；
- 原客服在线、忙碌或离线都不影响该优先级；如果原客服被停用、额度耗尽、不再负责该产品或被本次重排除外，则立即降级到其他合格客服，不因保护期保持等待；
- 不同产品彼此隔离，超过 2 小时后恢复正常新建和分配；
- 每个 CTA handoff 仍单独保存幂等映射，因此任何一次网络重试都能返回它最初对应的会话；
- D1 唯一开始键和原子额度凭证共同处理多标签页 / 并发点击，前端防抖只承担交互反馈。

### 6.5 人工转接

人工指定转接是显式运营操作，不参与自动轮询排序。目标客服仍需处于在线状态、保持有效心跳，并满足后台配置的人工转接并发 / 每日限制。会话退回自动分流时会排除释放它的原客服，再重新进入统一严格轮询。

每个会话只在首次有效分配时消耗一次咨询额度并生成不可变流量凭证；人工转接、重新排队和等待恢复都不会重复扣减。

## 7. 会话生命周期与计数

### 7.1 24 小时临时会话

- 生命周期从创建时固定计算 24 小时；
- `conversations.expires_at` 是运行时唯一权威到期字段，历史 NULL 数据由 migration 回填；
- 热路径直接按 `expires_at` 查询，保留 `idx_conversations_expiry` 的索引价值；
- 新消息不续期；
- 到期后删除会话、消息、媒体记录和相关 R2 对象；
- 无会话的过期临时访客随后删除；
- Worker Cron 每个整点进行一次有界清理，到期数据通常在 0～60 分钟内物理删除；
- 24 小时用于覆盖一次临时咨询，不代表长期客户历史。

### 7.2 有效流量

一次会话只在首次成功进入坐席时计为 1 个有效接待：

- 转接、重新排队、关闭、重新打开不重复计数；
- 未分配会话不计数；
- 被防滥用或额度限制拦截的请求不计数；
- 新建 v1 会话必须提供 UUID v4 `sourceHandoffId`；
- 相同 `sourceHandoffId` 重试返回原结果，不创建第二笔流量；
- 会话流量凭证、有效接待凭证与每日客服统计独立于 24 小时聊天数据，保留当前业务日及此前 89 天，共 90 个自然日；
- 流量凭证保存首次接待时的产品 ID 和产品名称快照，使产品归因不依赖短期会话数据。

### 7.3 统计与额度

每日接待日期按 `America/Los_Angeles` 自然日计算。

统计界面按用途拆分：

- 管理中心“流量统计”只展示前端会话总数、首次接待客服分布和产品会话分布；尚未分配客服的会话归入“待接待”，两个分布都必须与会话总数对账；
- 客服账号列表的“统计”按钮只查询该客服一个自然月的每日接待量，不加载产品维度；
- 流量总览和单客服月报各使用一次有日期边界的 D1 查询，避免列表批量查询。

额度模型：

```text
上游完成价格 / 订单 / 收款
→ 管理员为指定客服追加已购买咨询次数
→ 首次有效接待扣 1
→ 剩余为 0 后停止接收新会话
```

计算：

```text
剩余额度 = max(总额度 - 已消耗, 0)
```

额度追加使用唯一 `trafficQuotaRequestId` 保证幂等；成功追加写入不可变的额度变更记录。关闭额度限制不会清除历史额度和消耗。

## 8. 防滥用与成本控制

新建会话采用多层限制：

- Cloudflare Rate Limiting 先拦截短时间突发创建；
- 单个 `visitorId` 在 24 小时活动窗口最多成功创建 10 个会话；
- 同一来源指纹在 24 小时活动窗口最多成功创建 20 个会话；
- 两类计数在同一条 D1 SQL 中原子消费，失败请求不会只消耗其中一个计数；
- 同一访客重复点击同一产品 CTA 时，两小时复用凭证保证并发请求只消费一次计数；
- `sourceHandoffId` 和 `clientMessageId` 提供幂等保护。

登录接口同样使用独立的 Cloudflare Rate Limiting binding。管理员和坐席登录在进入 D1 查询或坐席密码派生前先按来源限流，登录防刷本身不增加 D1 计数写入。

资源策略：

- 静态页面、JS、CSS 和图标默认直接由 Static Assets 提供，不为普通 UI 资源执行 Worker；
- Inbox 一次返回会话概览、额度摘要和可转接坐席；
- 状态筛选、搜索、未读优先在浏览器本地完成；
- 输入草稿完全本地化；
- 单个会话的消息和媒体合并读取；
- 产品范围保存为动态规则，不展开成大量产品 ID；
- 等待队列每次只读取最早的 10 条会话，逐条进入同一套严格轮询，避免无界扫描；
- WebSocket 仍以 60 秒 ping 维持连接，但 D1 `last_seen_at` 写入做时间门限，避免每个 ping 都持久化；
- 在线心跳只按时间门限持久化，并用于工作状态展示和触发等待队列恢复；自动路由不读取在线新鲜度；
- 过期数据清理从每 5 分钟降低到每小时一次，每月 Cron 调用从约 8,640 次降至约 720 次；

## 9. 图片与 R2

聊天图片和客服头像都使用 R2，但用途分开：

- 聊天图片与会话绑定，随 24 小时会话清理；
- 客服头像与账号绑定，不随会话删除；
- 图片上传使用幂等 upload ID；
- 服务端限制类型、大小和对象归属；
- 孤立 / 失败媒体由有界后台清理处理；
- 客户端头像读取接口允许跨域缓存使用。

聊天媒体优先使用浏览器直传 R2。生产环境配置以下 Secret 后，Worker 只负责创建约 5 分钟有效的预签名上传地址：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`R2_BUCKET_NAME` 可选，未设置时使用 `customer-service-media`。如果直传凭证缺失，系统会回退到 Worker proxy upload，功能仍可用，但正式部署应优先配置直传以减少 Worker 数据路径。

## 10. 实时连接与通知

- 会话实时通道：Durable Object + WebSocket Hibernation；
- 坐席 Inbox 有独立实时连接；
- WebSocket 断开后使用递增退避和 jitter 自动恢复；
- 浏览器重新可见或网络恢复时会执行一次状态恢复；
- 前台可以播放提示音；
- 后台使用 Web Push；
- Web Push 的 VAPID 配置由系统在 D1 中按需生成和保存，不需要额外配置 VAPID Secret；
- 通知发送失败不会改变消息事务结果。

## 11. PWA

客服端提供可安装 PWA：

- Manifest `id` / `start_url` / `scope` 都限定在 `/agent`；
- Service Worker 只控制 `/agent` 导航，不接管管理后台 `/`；
- 支持 standalone / minimal-ui；
- 使用 `viewport-fit=cover` 和安全区布局；
- 移动端顶部只保留齿轮入口，通知、提示音、首次问候语、接待流量、PWA 安装和退出统一进入功能菜单；
- 功能菜单与子弹层使用轻量合成层动效；异步数据只更新弹层内部，不能改变移动端弹层外壳位置并造成跳动；
- 管理后台和坐席工作台的功能图标统一使用内置 SVG 组件，保持线宽、尺寸、颜色继承和无障碍语义一致；
- 手机聊天头部、输入区、头像弹窗和主要操作都有独立的触控/安全区规则。

## 12. 数据清理

Cron 当前在每个整点运行一次：

```text
过期会话
→ 找出关联媒体对象
→ 批量删除 R2
→ 删除 D1 conversation
→ messages / media_items 通过外键级联删除
→ 删除孤立且已到期 visitor
```

额外清理：

- 未完成媒体先转 failed，再经过宽限期删除；
- 过期 Push subscription 定期清理；
- 防滥用窗口记录定期清理；
- 会话流量凭证 / 每日客服统计 / 有效接待凭证每天按 `America/Los_Angeles` 业务日清理，固定保留 90 个自然日。

所有循环都有固定 batch / pass 上限，避免单次 Cron 无界扫描。

## 13. 开发与验证

环境要求：

```text
Node.js >= 22
pnpm >= 11
```

安装：

```bash
pnpm install
```

本地开发：

```bash
pnpm dev
```

常用检查：

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cf:check
```

完整本地验证：

```bash
pnpm verify
```

D1 migration：

```bash
pnpm db:migrate:local
pnpm db:migrate:remote
```

部署：

```bash
pnpm deploy:cloudflare
```

生产部署至少需要配置以下 Cloudflare Secret：

```text
ADMIN_PASSWORD
INTEGRATION_VERIFY_TOKEN
```

为了让聊天图片走浏览器直传 R2、减少 Worker 数据路径，生产环境建议同时配置：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`R2_BUCKET_NAME` 可选。生产部署由 GitHub Actions 在 `main` 上自动执行。

## 14. CI 验收

仓库只保留 `.github/workflows/ci.yml` 一个正式工作流，名称固定为 `CI and Deploy`。分支和 Pull Request 复用同一套验证步骤，合并到 `main` 后自动部署 Cloudflare 并执行生产协议 Smoke；不再创建一次性、诊断、格式化、补丁生成或分支专用 workflow。Actions 对仓库内容保持只读，不能在 Runner 内生成代码、提交或推送分支。

CI 顺序：

```text
D1 local migrations
→ Prettier
→ ESLint
→ TypeScript
→ Node tests
→ Vite build
→ Worker dry-run bundle
→ Chromium 客服 UI smoke
→ main 部署 Cloudflare
→ production protocol smoke
```

Chromium UI smoke 覆盖关键易回归路径：

- 客服登录；
- PC / 手机头像点击与居中弹窗；
- 核心触控面积；
- 打开真实分配会话；
- 会话状态和回复输入区；
- 手机窄屏输入区不越界。

生产 Smoke 继续验证 Health、Integration v1、Client CORS、REST 和 WebSocket，并严格要求已经移除的旧 public / management 协议保持 HTTP 404，不能被 SPA fallback 重新包装成 HTML 200。

Pull Request 全绿只代表可以合并；真正的发布完成条件是 `main` 上 Cloudflare production deploy 和 production protocol smoke 同样全部成功。

## 15. Migration 原则

已经上线的 migration 不改名、不重写、不删除，即使其中记录的是历史结构。

最终 schema 通过后续 migration 收口，例如：

- 旧路由表已经通过后续 migration 删除；
- 旧 D1 快捷回复表已经删除；
- 快捷回复兼容 view 再由后续 migration 删除；
- 客服头像字段通过独立 migration 增加；
- `0037_finalize_conversation_expiry.sql` 最终回填历史 NULL `expires_at`，运行时统一使用权威到期字段。
- `0038_cta_conversation_reuse.sql` 增加 CTA 两小时复用键、额度幂等凭证和多 handoff 映射。
- `0039_cta_hard_agent_affinity.sql` 最初增加关闭后新会话的两小时原客服关联字段。
- `0042_simple_round_robin_routing.sql` 将当前自动分流收口为负责范围、账号启用、咨询额度、CTA 原客服优先和严格轮询；在线状态、心跳、并发和每日限制不再阻塞自动分流。

新变更只继续追加新的序号 migration，保证生产数据库升级路径稳定。

## 16. 当前设计原则

这个项目面向个人和小团队，后续优化遵循：

1. 功能稳定优先于功能数量；
2. 少 Worker 请求、少 D1 热读写、少 R2 垃圾对象；
3. 能批量就不逐项请求；
4. 能在浏览器安全完成的便利功能不放到服务器；
5. PC 和手机共享业务逻辑，但响应式样式边界明确；管理端与坐席端样式分别维护，不交叉覆盖；
6. 不再通过不断追加 CSS 补丁层解决 UI 问题；
7. 不引入本项目实际用不到的企业级复杂度；
8. 每次上线都必须通过自动化构建、协议和关键 UI 验收；
9. 项目进入收口维护阶段后，默认优先修复真实缺陷、集成问题、成本回归和可观测性问题，不再为了“功能看起来更多”继续扩展范围。
10. 新的通用 UI 必须从 `src/dashboard/ui/` 复用或扩展，不允许页面内重复实现按钮、输入框和通用弹层；
11. 功能图标只能使用 `lucide-react` 并通过 `UiIcon` 语义映射，禁止页面本地 SVG、字符图标和 data URI 图标；
12. 颜色、圆角、阴影、控件高度和焦点状态只能由 `ui-system.css` 的语义令牌统一管理，不在业务页面硬编码第二套视觉系统；
13. CSS 文件按“通用设计系统 / 管理端 / 坐席共享 / 桌面 / 移动 / 独立复杂功能”划分，禁止通过新增末尾覆盖文件解决级联冲突；
14. shadcn 组件代码属于项目源码，升级组件必须审查 diff，并同时验证桌面端、移动端、键盘视口、弹层和 PWA 安全区；
15. UI 组件升级不得增加 Worker 或 D1 请求；筛选、展开、主题和纯视觉状态继续在浏览器本地完成。
