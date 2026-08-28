# Customer Service

面向个人运营者和小团队的轻量客服坐席与咨询流量分发系统，独立于 [`Qz121314/site`](https://github.com/Qz121314/site) 开发和部署。

生产地址：<https://customer-service-app.fcqz121314.workers.dev>

> 本项目不是长期 CRM。核心职责是接收有效咨询、按最终分流规则分配给客服坐席，并提供 24 小时临时聊天接待和必要统计。

## 1. 最终系统边界

完整链路：

```text
Site / 产品页
→ 生成临时访客与唯一 sourceHandoffId
→ customer-service 校验产品上下文、幂等和防滥用
→ 按负责范围、账号启用状态、在线状态、每日接待上限、剩余额度筛选坐席
→ CTA 两小时保护
→ 严格轮询选择坐席
→ D1 原子分配
→ 客服坐席工作台接待
→ 生成可统计、可对账的有效流量凭证
```

边界固定如下：

- Site / Storefront：展示产品、生成临时访客、发起咨询、传递产品上下文。
- 客服管理中心 `/`：配置客服账号、负责范围、每日接待上限、按量额度和统计。
- 客服坐席端 `/agent`：登录、接收已分配会话、聊天、昵称、头像、通知和 PWA。

`site` 只保存客服系统公网 URL 和验证 Token，并批量同步产品目录。实际访客咨询直接访问本项目；Site 后台不代理聊天，也不参与坐席选择。

### 明确不做

- 人工转接、人工重新排队、转接目标选择；
- 长期客户档案、CRM、工单、SLA、营销自动化；
- 套餐价格、订单、支付和财务结算；
- 多层企业 RBAC、审批流等个人或小团队不需要的复杂功能。

**人工转接已经从产品定义中删除。** 运行时代码、API、实时事件、前端入口和测试都不应再依赖人工转接概念。

## 2. 最终分流规则

### 2.1 负责范围

正式路由表为 `agent_routing_scopes`。

- 整个分区：可多选，自动覆盖该分区当前及未来新增产品。
- 指定分类：覆盖选中分区中的指定分类。
- 指定产品：只覆盖明确选择的产品。

没有任何启用范围命中当前产品时，会话保持等待，不回退到旧客服分组模型。

### 2.2 新流量候选条件

新的首次有效咨询只允许分配给同时满足以下条件的客服：

```text
账号已启用
客服本人当前选择“在线”
负责范围命中当前产品
已配置可登录账号和密码
当日接待量未达到每日接待上限（0 = 不限）
未耗尽已购买咨询额度（未启用额度限制时跳过）
```

在线状态是新会话分流资格：只有“账号已启用 + 当前在线”的客服进入严格轮询；忙碌和离线客服继续保留已有会话，但不接收新的自动分配。心跳只维护连接状态，不参与轮询排序。

### 2.3 每日接待上限

**每日接待上限必须参与新的首次有效咨询分流。**

规则固定为：

- `dailyConversationLimit = 0` 表示不限；
- `dailyConversationLimit > 0` 时，当天首次有效接待数量达到该值后，该客服立即退出新的咨询流量候选集；
- 达到上限的客服不会占用本次轮询位置，也不会因为被跳过而推进自己的轮询游标；
- 其他仍符合条件的客服继续按严格轮询接收新流量；
- 所有匹配客服都达到上限或其他资格不满足时，新会话保持等待；
- 下一业务日自动恢复每日接待资格，不需要管理员手动清零；
- 业务日统一按 `America/Los_Angeles` 自然日计算；
- 同一个已存在会话继续聊天不会重复计算每日接待；
- 已经产生不可变首次接待凭证的会话，如果因为原客服被删除而由系统自动恢复分配，不属于第二笔新流量，不重复消耗每日接待次数或购买额度。

后台“每日接待上限”的文案、统计、路由和行为测试必须保持一致。

### 2.4 严格轮询

合格候选的最终顺序：

```text
符合有效 CTA 两小时保护的客服
→ round_robin_seq 最小
→ 客服 ID
```

`round_robin_seq` 是站点内单调轮询游标。候选选择和会话写入在 D1 原子更新中完成，数据库触发器在同一写入路径推进游标，避免并发请求或同毫秒时间戳导致流量集中到同一客服。

没有合格客服时，会话保持等待。后续恢复仍重新进入同一套候选规则，不存在第二套分流算法。

### 2.5 CTA 两小时保护

服务端以 `siteId + visitorId + productId` 识别同一产品咨询。

目标固定为：**同一访客在两小时保护窗口内针对同一产品，不因为重复点击 CTA 被随机分给不同客服。**

- 可复用的活动会话直接返回原会话，不新建 D1 会话；
- 不重复消耗访客创建限制、咨询额度或每日接待次数；
- 不同产品彼此隔离；
- 超过两小时后恢复普通新会话和严格轮询；
- `sourceHandoffId` 和 `clientMessageId` 提供网络重试幂等保护。

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
- 关闭额度限制不会清除历史额度和消耗记录；
- 每日接待上限与购买额度是两个独立条件，新流量候选必须同时满足二者。

## 4. 管理中心与坐席端

客服管理中心 `/` 只负责配置和统计：

- 创建、编辑、启用、停用或删除客服账号；
- 配置客服登录账号和密码；
- 设置分区、分类或指定产品负责范围；
- 设置每日接待上限；
- 启用按量额度并追加咨询次数；
- 查看总额度、已消耗、剩余额度和最近额度变更；
- 查看会话总数、客服接待分布、产品会话分布；
- 查看单个客服自然月每日接待统计；
- 复制或打开统一客服登录入口。

客服坐席端 `/agent` 只操作分配给自己的会话：

- 在线或忙碌工作状态；
- 新会话、处理中、已关闭状态；
- 未读优先和本地关键词搜索；
- 文字、图片、发送失败重试和本地草稿；
- 消息已读状态和双方输入状态；
- 商品上下文；
- 新会话系统通知和工作台内提示音；
- 个人统计；
- 对外昵称和头像；
- PWA 安装与移动端安全区适配。

账号“停用”只关闭新的自动分流资格，不等于禁止登录。停用客服仍可登录工作台、切换在线/忙碌、处理原有会话和使用个人设置；重新启用后，只有其本人状态为在线时才恢复接收新会话。

这里的两种提醒都属于客服坐席工作台：工作台切换到其他应用或手机锁屏时，由“新会话通知”通过系统通知提醒；工作台正在屏幕上使用时，由“工作台提示音”在收到新分配会话或访客新消息时响铃。Android 可在支持 Web Push 的浏览器或已安装 PWA 中开启系统通知。iPhone / iPad 需要先把客服坐席添加到主屏幕，再从桌面图标打开并由客服主动授权通知。系统通知是否发声最终由 iOS / Android 的通知声音设置控制。

**坐席端不存在人工转接按钮、转接菜单或转接 API。** 访客端展示客服昵称和头像，不展示客服登录账号。

## 5. 会话生命周期与防滥用

24 小时临时会话规则：

- 生命周期从创建时固定计算 24 小时；
- `conversations.expires_at` 是运行时权威到期字段；
- 新消息不续期；
- 到期后删除会话、消息、媒体记录和相关 R2 对象；
- 无会话的过期临时访客随后删除；
- Worker Cron 每个整点执行一次有界清理。

防滥用规则：

- Cloudflare Rate Limiting 先拦截短时间突发创建；
- 单个 `visitorId` 在 24 小时活动窗口最多成功创建 10 个会话；
- 同一来源指纹在 24 小时活动窗口最多成功创建 20 个会话；
- `sourceHandoffId` 和 `clientMessageId` 提供幂等保护；
- 两小时 CTA 复用不会重复消费创建次数。

## 6. 统计

统计保留 **90 个自然日**，业务日按 `America/Los_Angeles` 计算。

管理中心只保留三类核心统计：

1. 会话总数；
2. 客服接待数分布；
3. 产品会话数分布。

单客服统计按自然月显示每日接待量。

统计与短期聊天数据分离。24 小时会话删除后，90 天统计和不可变流量凭证仍可用于对账。

## 7. 技术与成本原则

运行栈：

```text
React + Vite
Cloudflare Static Assets + Worker / Hono
D1
R2
Durable Objects + WebSocket Hibernation
Rate Limiting
Web Push
Cron
```

成本原则：

- 静态 UI 优先由 Static Assets 提供；
- D1 热路径优先单条 SQL、批量 SQL 和原子更新；
- 不做按客服逐项请求或重复读取；
- 搜索、筛选、草稿和纯 UI 状态尽量在浏览器本地完成；
- 产品目录同步使用一次请求和批量 D1 处理；
- 等待队列有固定读取上限，不做无界扫描；
- R2 使用稳定对象键和有界批量清理；
- 不为了理论扩展性增加额外服务、队列或复杂状态管理。

## 8. UI、PWA 与媒体

管理中心和坐席端共享项目内的统一 UI 设计系统：

- shadcn/ui `new-york` 结构；
- Tailwind CSS 4；
- Radix UI Slot；
- Lucide React；
- `src/dashboard/ui/` 作为通用组件入口；
- `ui-system.css` 管理统一设计令牌。

坐席端 PWA：

- Manifest `id`、`start_url`、`scope` 限定在 `/agent`；
- Service Worker 只控制 `/agent`；
- 支持 standalone / minimal-ui；
- 使用安全区和 Visual Viewport 处理移动键盘；
- 后台新消息依靠 Web Push；
- 关闭子弹层后返回功能菜单，不直接跳回会话列表；
- 弹层动画不得因异步数据更新产生位置抖动。

R2：

- 聊天图片随会话生命周期清理；
- 客服头像与账号绑定，不随会话删除；
- 上传使用幂等 ID，并限制类型、大小和对象归属；
- 正式环境优先浏览器直传 R2，减少 Worker 数据路径。

## 9. Site 接入

Site 管理员只配置：

```text
客服系统公网 URL
验证 Token
```

Customer Service 使用 Cloudflare Secret：

```text
INTEGRATION_VERIFY_TOKEN
```

实际访客会话使用 Client v1：

```text
/client/v1/conversations
/client/v1/conversations/:id
/client/v1/conversations/:id/messages
/client/v1/conversations/:id/realtime
/client/v1/media/...
```

实际聊天只依赖公网 HTTPS / WSS，Site 后台不参与实时会话链路。

## 10. 开发、测试与 CI

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

### 测试标准

**测试业务行为，不测试源码写法。**

允许验证：

- API 输入输出；
- D1 数据变化；
- 路由最终分配结果；
- 会话状态与幂等结果；
- 购买额度与每日接待上限；
- 浏览器真实交互；
- 稳定协议、成本预算和明确架构边界。

禁止把业务正确性绑定到：

- 变量名或函数名；
- 固定源码字符串；
- React 组件内部结构；
- README 文案；
- 某段 SQL 必须以固定文本出现。

路由行为测试至少覆盖：

```text
严格轮询顺序正确
禁用客服被跳过
忙碌和离线客服被跳过
负责范围不匹配被跳过
购买额度耗尽被跳过
每日接待达到上限被跳过
dailyConversationLimit = 0 时不限
达到上限的客服不消耗轮询位置
全部新流量候选达到上限时会话等待
下一业务日重新获得每日接待资格
CTA 两小时重复不会被重新随机分配
已经计数的会话做系统恢复分配时不重复扣日额度或购买额度
```

### CI 发布标准

正式工作流只保留 `.github/workflows/ci.yml`：`CI and Deploy`。

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

### 空 Cloudflare 账号一键部署

仓库中的 `wrangler.jsonc` 只声明可移植的资源名称和绑定，不保存任何 Cloudflare 账号专属 D1 UUID。复制仓库到新的 GitHub 仓库后，只需要添加两个 Repository Secrets：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

API Token 至少需要目标账号的以下权限：

```text
Workers Scripts: Edit
D1: Edit
Workers R2 Storage: Edit
```

Cloudflare 的 R2 是唯一的账号级前置条件：全新账号必须先在 Dashboard 的 `Storage & databases → R2` 完成一次 R2 subscription 开通。R2 有免费用量，但 Cloudflare 要求先完成该 checkout；这个账号动作不能由 GitHub Actions 或普通 API Token 代替。除此之外，不需要提前创建 Worker、D1、R2 Bucket 或 Durable Object。

第一次从 GitHub Actions 手动运行 `CI and Deploy`，部署流程会按资源名称执行幂等引导：

```text
复用已有 D1 / R2，缺失时创建
→ 应用全部 D1 migrations
→ 部署 Worker + Durable Object
→ 绑定 Rate Limit + Cron
→ 上传 Static Assets
→ 执行生产协议 Smoke
```

同一个流程同时兼容当前已经运营的 Cloudflare 账号：`customer-service-db` 和 `customer-service-media` 已存在时只会复用，不会删除、清空或新建替代资源；Worker Secret 也不会因部署而被删除。

首次部署成功后，在 Cloudflare Worker 中人工设置：

```text
ADMIN_PASSWORD
INTEGRATION_VERIFY_TOKEN
```

Worker 自定义域名按实际运营域名人工绑定。R2 自定义域名保持可选；聊天媒体桶默认保持私有，不需要为一键部署绑定公开域名。

Pull Request 全绿只代表可以合并。真正发布完成必须同时满足：

```text
main CI 全绿
Cloudflare production deploy 成功
production protocol smoke 成功
```

## 11. Migration 原则

已经上线的 migration 不改名、不重写、不删除。

历史结构和已经删除的历史功能只通过新的前向 migration 收口。运行时代码只依赖最终 schema，不因为旧 migration 中曾经存在某功能就保留对应运行时代码。

## 12. 收口原则

项目进入收口阶段后默认执行：

1. 功能稳定优先于功能数量；
2. 最终业务规则以 README 和行为测试为准；
3. README、测试和实现必须一致；
4. 删除无业务价值的兼容层、死代码、重复组件和无效配置；
5. 少 Worker 请求、少 D1 热读写、少 R2 垃圾对象；
6. 能批量就不逐项请求；
7. 不再新增人工转接、长期 CRM 等已经排除的功能；
8. 不通过提高预算、放宽 Guardrail 或删除有效行为测试来换取 CI 变绿；
9. UI 组件统一复用，不再维护第二套按钮、输入框、图标或弹层体系；
10. 每次合并前必须完成格式、类型、测试、构建和关键浏览器 Smoke；
11. 收口后默认只修真实缺陷、集成问题、成本回归和必要维护，不继续无边界扩展功能。
