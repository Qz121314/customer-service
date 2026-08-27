# Customer Service

面向个人运营者和小团队的轻量客服坐席与咨询流量分发系统，独立于 [`Qz121314/site`](https://github.com/Qz121314/site) 开发和部署。

生产地址：<https://customer-service-app.fcqz121314.workers.dev>

> 本项目不是长期 CRM。核心职责只有三件事：接收 Site / 产品页产生的有效咨询、按明确规则分配给客服坐席、提供 24 小时临时聊天接待和必要统计。

## 1. 最终系统边界

完整链路：

```text
Site / 产品页
→ 生成临时访客与唯一 sourceHandoffId
→ customer-service 校验产品上下文、幂等和防滥用
→ 按负责范围、账号启用状态、每日接待上限、剩余额度筛选坐席
→ CTA 两小时保护
→ 严格轮询选择坐席
→ D1 原子分配
→ 客服坐席工作台接待
→ 生成可统计、可对账的有效流量凭证
```

系统分为三个边界：

| 部分 | 职责 |
| --- | --- |
| Site / Storefront | 展示产品、生成临时访客、发起咨询、传递产品上下文 |
| 客服管理中心 `/` | 配置客服账号、负责范围、每日接待上限、按量额度和统计 |
| 客服坐席端 `/agent` | 登录、接收已分配会话、聊天、头像、昵称、通知和 PWA |

`site` 只保存客服系统公网 URL 和验证 Token，并批量同步产品目录。实际访客咨询直接访问本项目；Site 后台不代理聊天，也不参与坐席选择。

### 明确不做

- 人工转接、人工重新排队、转接目标选择；
- 长期客户档案、CRM、工单、SLA、营销自动化；
- 套餐价格、订单、支付和财务结算；
- 多层企业 RBAC、审批流等个人/小团队不需要的复杂功能。

**人工转接已经从产品定义中删除。** 运行时代码、API、实时事件、前端入口、测试都不应再依赖人工转接概念。

## 2. 最终分流规则

### 2.1 负责范围

正式路由表为 `agent_routing_scopes`：

| 范围 | 行为 |
| --- | --- |
| 整个分区 | 可多选，自动覆盖该分区当前及未来新增产品 |
| 指定分类 | 覆盖选中分区中的指定分类 |
| 指定产品 | 只覆盖明确选择的产品 |

没有任何启用范围命中当前产品时，会话保持等待，不回退到旧客服分组模型。

### 2.2 新分流候选条件

客服坐席必须同时满足：

```text
账号已启用
负责范围命中当前产品
已配置可登录账号和密码
当日接待量未达到每日接待上限（0 = 不限）
未耗尽已购买咨询额度（未启用额度限制时跳过）
```

在线 / 忙碌 / 离线状态和心跳用于工作台状态、通知和恢复机制，不作为严格轮询排序条件。

### 2.3 每日接待上限 —— 最终标准

**每日接待上限必须参与自动分流。**

规则固定为：

- `dailyConversationLimit = 0`：不限；
- `dailyConversationLimit > 0`：当天已接待数量达到该值后，该客服立即退出新分流候选集；
- 达到上限的客服不会占用本次轮询位置，不会推进自己的轮询游标；
- 其他仍符合条件的客服继续按严格轮询接收新会话；
- 所有匹配客服都达到上限或其他资格不满足时，会话保持等待；
- 下一业务日自动恢复资格，不需要管理员手动清零；
- 业务日统一按 `America/Los_Angeles` 自然日计算；
- 已存在会话继续聊天不重复消耗每日接待次数；新的坐席分配才属于一次新接待。

后台显示的“每日接待上限”与路由行为必须完全一致，不允许出现“UI 说限流、路由只统计不限流”的情况。

### 2.4 严格轮询

在所有合格候选中，使用数据库中的单调轮询游标：

```text
符合有效 CTA 两小时保护的客服
→ round_robin_seq 最小
→ 客服 ID
```

候选选择和会话写入在 D1 原子更新中完成；轮询游标由数据库写入过程推进，避免并发请求或同毫秒时间戳导致流量集中到同一客服。

没有合格客服时，会话保持等待。额度恢复、每日业务日切换后的下一次恢复机会、启用账号或修改负责范围后，等待会话重新进入同一套候选规则，不存在第二套分流算法。

### 2.5 CTA 两小时保护

服务端以 `siteId + visitorId + productId` 识别同一产品咨询。

目标是：**同一访客在两小时保护窗口内针对同一产品，不因为重复点击 CTA 被随机分给不同客服。**

- 可复用的活动会话直接返回原会话，不新建 D1 会话；
- 不重复消耗访客创建限制、咨询额度或每日接待次数；
- 不同产品彼此隔离；
- 超过两小时后恢复普通新会话和严格轮询；
- `sourceHandoffId` 和 `clientMessageId` 继续提供网络重试幂等保护。

## 3. 咨询额度

额度模型：

```text
管理员为指定客服追加已购买咨询次数
→ 首次有效接待扣 1
→ 剩余为 0 后停止接收新的付费流量
```

计算：

```text
剩余额度 = max(总额度 - 已消耗, 0)
```

规则：

- 额度限制未启用时，不以总额度筛选候选；
- 额度启用且剩余额度为 0 时，停止新的首次有效分配；
- 一次有效咨询只生成一次不可变流量凭证；
- 额度追加使用唯一 `trafficQuotaRequestId` 保证幂等；
- 关闭额度限制不会清除历史额度和消耗记录。

每日接待上限和已购买额度是两个独立条件，候选客服必须同时满足二者。

## 4. 客服管理中心 `/`

主要能力：

- 创建、编辑、启用、停用或删除客服账号；
- 配置客服登录账号和密码；
- 设置分区 / 分类 / 指定产品负责范围；
- 设置每日接待上限；
- 启用按量额度并追加咨询次数；
- 查看总额度、已消耗、剩余额度和最近额度变更；
- 查看会话总数、客服接待分布、产品会话分布；
- 查看单个客服自然月每日接待统计；
- 复制或打开统一客服登录入口。

管理中心只做配置和统计，不参与聊天转发。

## 5. 客服坐席端 `/agent`

所有客服使用统一入口，以各自账号和密码登录。登录后只能读取和操作分配给自己的会话。

主要能力：

- 在线 / 忙碌工作状态；
- 新会话、处理中、已关闭状态；
- 未读优先和本地关键词搜索；
- 文字、图片、发送失败重试和本地草稿；
- 消息已读状态和双方输入状态；
- 商品封面、名称、分区、分类和商品链接；
- 浏览器后台通知和前台提示音；
- 当前工作台查看个人统计；
- 自助设置对外昵称和头像；
- PWA 安装与移动端安全区适配。

**坐席端不存在人工转接按钮、转接菜单或转接 API。**

访客端展示客服昵称和客服头像，不展示客服登录账号。

## 6. 会话生命周期

### 6.1 24 小时临时会话

- 会话生命周期从创建时固定计算 24 小时；
- `conversations.expires_at` 是运行时权威到期字段；
- 新消息不续期；
- 过期后删除会话、消息、媒体记录和相关 R2 对象；
- 无会话的过期临时访客随后删除；
- Worker Cron 每个整点进行一次有界清理；
- 24 小时只用于一次临时咨询，不代表长期客户历史。

### 6.2 防滥用

- Cloudflare Rate Limiting 先拦截短时间突发创建；
- 单个 `visitorId` 在 24 小时活动窗口最多成功创建 10 个会话；
- 同一来源指纹在 24 小时活动窗口最多成功创建 20 个会话；
- `sourceHandoffId` 和 `clientMessageId` 提供幂等保护；
- 两小时 CTA 复用不会重复消费创建次数。

## 7. 统计

统计保留 **90 个自然日**，业务日按 `America/Los_Angeles` 计算。

管理中心只保留三类核心统计：

1. 会话总数；
2. 客服接待数分布；
3. 产品会话数分布。

单客服统计按自然月显示每日接待量。

统计与短期聊天数据分离；24 小时会话删除后，90 天统计和不可变流量凭证仍可用于对账。

## 8. 技术架构

```text
React + Vite
      ↓
Cloudflare Static Assets + Worker / Hono
      ├─ D1：账号、会话、消息、路由、统计、额度
      ├─ R2：聊天图片、客服头像
      ├─ Durable Objects：会话和坐席 WebSocket
      ├─ Rate Limiting：登录、新建会话与媒体突发限制
      ├─ Web Push：访客 / 坐席后台通知
      └─ Cron：过期数据与孤立资源清理
```

成本原则：

- 静态 UI 优先由 Static Assets 提供；
- D1 热路径优先单条 SQL、批量 SQL和原子更新；
- 不做按客服逐项查询；
- 前端本地完成搜索、筛选、草稿和纯 UI 状态；
- 产品目录同步采用一次请求 + 批量 D1 处理；
- 等待队列有固定读取上限，不做无界扫描；
- R2 使用稳定对象键和批量清理；
- 不为了理论扩展性增加额外服务、队列或复杂状态管理。

## 9. UI 与 PWA 基线

管理中心和坐席端共享源码可控的 UI 设计系统：

- shadcn/ui `new-york` 结构；
- Tailwind CSS 4；
- Radix UI Slot；
- Lucide React；
- `src/dashboard/ui/` 作为通用组件入口；
- `ui-system.css` 管理统一颜色、圆角、阴影、控件高度和焦点状态。

坐席端 PWA：

- Manifest `id` / `start_url` / `scope` 限定在 `/agent`；
- Service Worker 只控制 `/agent`；
- 支持 standalone / minimal-ui；
- 使用安全区和 Visual Viewport 处理移动键盘；
- 后台新消息依靠 Web Push；
- 关闭子弹层后返回功能菜单，不直接跳回会话列表；
- 弹层动画不得因异步数据更新产生位置抖动。

## 10. R2 与媒体

- 聊天图片与会话绑定，随会话清理；
- 客服头像与账号绑定，不随会话删除；
- 图片上传使用幂等 upload ID；
- 服务端限制类型、大小和对象归属；
- 孤立 / 失败媒体由有界后台清理处理；
- 正式环境优先使用浏览器直传 R2，减少 Worker 数据路径。

直传建议配置：

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`R2_BUCKET_NAME` 可选，默认 `customer-service-media`。

## 11. Site 接入

Site 管理员只配置：

```text
客服系统公网 URL
验证 Token
```

Customer Service 使用 Cloudflare Secret：

```text
INTEGRATION_VERIFY_TOKEN
```

验证接口：

```http
POST {customer-service-public-url}/integration/v1/verify
Authorization: Bearer <token>
Content-Type: application/json
```

实际访客会话使用 Client v1：

```text
/client/v1/conversations
/client/v1/conversations/:id
/client/v1/conversations/:id/messages
/client/v1/conversations/:id/realtime
/client/v1/media/...
```

系统只依赖公网 HTTPS / WSS，不要求 Site 与客服系统位于同一个 Cloudflare Account。

## 12. 开发与验证

环境：

```text
Node.js >= 22
pnpm >= 11
```

常用命令：

```bash
pnpm install
pnpm dev
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm cf:check
pnpm verify
```

D1：

```bash
pnpm db:migrate:local
pnpm db:migrate:remote
```

生产部署至少需要：

```text
ADMIN_PASSWORD
INTEGRATION_VERIFY_TOKEN
```

## 13. 测试标准

**测试业务行为，不测试源码写法。**

允许测试：

- API 输入输出；
- D1 数据变化；
- 路由最终分配结果；
- 会话状态与幂等结果；
- 额度和每日接待上限；
- 浏览器真实交互；
- 稳定协议、成本预算和明确架构边界。

禁止把业务正确性绑定到：

- 变量名、函数名；
- 某段源码字符串；
- React 组件内部结构；
- README 文案；
- 某个 SQL 片段必须以固定文本出现。

### 路由最低行为验收

路由测试至少覆盖：

```text
严格轮询顺序正确
禁用客服被跳过
负责范围不匹配被跳过
额度耗尽被跳过
每日接待达到上限被跳过
dailyConversationLimit = 0 时不限
达到上限的客服不消耗轮询位置
全部候选达到上限时返回无可用客服 / 会话等待
下一业务日按新日期重新获得每日额度
CTA 两小时重复不会被重新随机分配
```

## 14. CI 验收

正式工作流只保留 `.github/workflows/ci.yml`：`CI and Deploy`。

CI 顺序：

```text
Repository guardrails
→ Prettier
→ D1 local migrations
→ ESLint
→ TypeScript
→ Node behavior tests
→ Vite build
→ Worker dry-run bundle
→ Agent Chromium smoke
→ Admin Chromium smoke
→ main 部署 Cloudflare
→ production protocol smoke
```

Pull Request 全绿只代表可以合并。真正发布完成必须同时满足：

```text
main CI 全绿
Cloudflare production deploy 成功
production protocol smoke 成功
```

## 15. Migration 原则

已经上线的 migration：

- 不改名；
- 不重写；
- 不删除。

历史结构通过新的前向 migration 收口。运行时代码只依赖最终 schema，不因为旧 migration 中曾出现某功能就保留旧功能实现。

人工转接相关最终 schema 残留通过后续 migration 删除；历史 migration 本身仍作为数据库升级链保留。

## 16. 收口原则

项目进入收口阶段后默认执行：

1. 功能稳定优先于功能数量；
2. 最终业务规则以本 README 和行为测试为准；
3. README、测试、实现三者必须一致；
4. 删除无业务价值的兼容层、死代码、重复组件和无效配置；
5. 少 Worker 请求、少 D1 热读写、少 R2 垃圾对象；
6. 能批量就不逐项请求；
7. 不再新增人工转接、长期 CRM 等已经排除的功能；
8. 不通过提高预算、放宽 Guardrail 或删除有效行为测试来换取 CI 变绿；
9. UI 组件统一复用，禁止再长出第二套按钮、输入框、图标和弹层体系；
10. 每次合并前必须完成格式、类型、测试、构建和关键浏览器 Smoke；
11. 收口后默认只修真实缺陷、集成问题、成本回归和必要维护，不继续无边界扩展功能。
