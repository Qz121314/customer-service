# Customer Service Performance Optimization Plan

> 本文档是 `customer-service` 性能优化的执行契约。后续性能工作必须先对照本清单，再修改生产代码。目标不是“大重构”，而是在不改变现有业务结果的前提下，减少无意义渲染、重复 D1、隐式副作用、重复实现和历史补丁层。

## 1. 优化目标

本轮优化只解决以下问题：

1. 坐席端首次加载、移动端交互、输入和长会话渲染性能；
2. 消息发送和实时传播链路中的重复 D1 查询与不必要等待；
3. Inbox、Overview、Agent Session 等重复实现形成的多事实来源；
4. 会话创建链路中已经完成迁移、但运行时仍保留的历史兼容补丁；
5. 建立可长期执行的性能预算、测试契约和回归 Gate。

本轮优化不以“代码更抽象”“文件更多”“层次更多”为目标。任何重构都必须能证明至少满足以下一项：

- 减少一次或多次 D1 读写；
- 减少一次或多次网络/DO 往返；
- 减少 React 无意义 render 或同步主线程工作；
- 删除一个重复事实来源；
- 删除一个已经确认不再需要的兼容分支；
- 让同一业务行为由更少、更明确的步骤完成。

---

## 2. 不可改变的业务契约

性能优化期间，下列业务语义视为冻结。除非先单独修改 README 中的产品/路由契约并更新行为测试，否则性能 PR 不得改变这些结果。

### 2.1 新会话分流

- 仅对尚未分配客服的新流量执行候选筛选和轮询；
- 客服必须同时满足：账号启用、`status = online`、负责范围命中、登录凭证存在、每日上限未达、启用额度时仍有剩余额度；
- 忙碌、离线、停用、额度耗尽、每日上限只影响新流量，不自动转走已有会话；
- CTA 两小时活动会话优先复用原会话；
- 已关闭的两小时内历史会话只提供客服亲和，不绕过正常资格检查；
- 普通新流量最终使用站点级全局严格轮询；
- 无可用客服时返回 `503 / NO_AGENT_AVAILABLE` 和后台配置提示语；
- 无客服时不建立 waiting 队列、不保留未分配临时会话、不推进轮询游标。

### 2.2 消息与会话

- 消息必须保持幂等；重复 `clientMessageId` 不得生成第二条消息；
- 客服回复 `open` 会话后可进入 `pending`，但不得错误关闭、重分配或丢失会话；
- Visitor/Agent unread count、read receipt、last message preview、last message time 必须保持一致；
- 文本、图片、名片、自动问候语都必须继续正常实时到达；
- WebSocket 断开重连后必须可以恢复缺失消息和状态；
- 已关闭会话不能接受新的正常消息写入；
- 24 小时临时会话生命周期保持不变。

### 2.3 数据与统计

- 有效分配继续产生唯一流量凭证；
- 每日接待量、购买额度、产品归因、客服统计不能因为性能优化重复计数或漏计；
- D1 中负责并发安全和原子性的关键约束、trigger 不得仅为了“代码简单”移到前端或拆成多次非原子请求。

---

## 3. 优化期间禁止事项

以下行为默认禁止：

- 不进行全项目重写；
- 不重新设计 Routing Contract；
- 不把当前单次 D1 原子操作拆成多次 Worker/D1 往返；
- 不为了“架构好看”新增大量 `service / repository / manager / provider` 包装层；
- 不把业务修复、性能优化、migration 大改和大规模测试删除混在同一个 PR；
- 不为了让 CI 变绿而直接删除失败测试；
- 不让旧的源码结构测试绑死新的正确实现；
- 不在没有生产数据兼容证明时删除 legacy fallback；
- 不在同一阶段同时改 Routing、Realtime、Conversation Create、Migration 和前端状态架构；
- 不在缺少回归测试时修改高风险数据库 trigger；
- 不把同步可靠性要求错误地改成“全部异步”，涉及持久化结果的操作必须先成功落库。

---

## 4. Test-first 规则

每一个优化模块在修改生产代码前，第一步必须检查对应 tests。

### 4.1 Test 分类

所有相关 test 先归入以下类别：

| 类型 | 处理原则 |
| --- | --- |
| 行为测试 | 必须保留。验证业务输入/输出和用户可见结果。 |
| 安全/权限测试 | 必须保留。不得为性能让步。 |
| 并发/幂等测试 | 必须保留。核心热路径优先级最高。 |
| 性能预算测试 | 保留并按新目标更新预算。不能绑定偶然实现细节。 |
| 数据库契约测试 | 保留关键约束、索引、trigger 和 migration 安全检查。 |
| 浏览器/Smoke 测试 | 保留真实 UI、移动端、WebSocket、发送/接收链路。 |
| 源码结构测试 | 重点审查。若只匹配函数名、字符串或旧代码布局，应优先改成行为/预算测试。 |
| 历史实现测试 | 如果产品契约已不再要求旧实现，先确认后更新或删除。 |

### 4.2 修改顺序

如果“产品要求发生变化”：

```text
产品/README 契约
→ 行为测试
→ 生产代码
→ Smoke / CI
```

如果“产品要求不变，只改变实现方式”：

```text
检查现有 test 是否绑死实现
→ 保留行为/安全/并发测试
→ 更新或删除不合理的源码结构约束
→ 重构生产代码
→ 全量回归
```

禁止采用：

```text
先改生产代码
→ test 失败
→ 为了绿灯直接删 test
```

---

## 5. 优化前 Baseline

在 Phase 1 修改任何生产代码前，必须在最新 `main` 记录一份 baseline。至少包括：

### 5.1 CI / Build 基线

执行并记录：

```bash
pnpm guardrails
pnpm format
pnpm lint
pnpm typecheck
pnpm db:migrate:local
pnpm test
pnpm build
pnpm cf:check
```

也可以使用仓库现有总入口：

```bash
pnpm verify
```

记录：

- test 总数、通过数、失败数；
- build 是否成功；
- Worker dry-run 是否成功；
- 现有 warning；
- 当前生产 Smoke 状态。

### 5.2 前端性能基线

至少记录：

- `/agent` 首屏资源请求数量；
- `/agent` CSS chunk 数量与加载顺序；
- 登录后到 Inbox 可操作的时间；
- 打开普通会话的请求数量；
- 打开长会话时加载 message 数量；
- 输入文本时是否触发同步 localStorage 写入；
- 每条消息渲染时 attachment 查找复杂度；
- 移动端 visual viewport 监听/MutationObserver 触发方式。

### 5.3 Worker / D1 热路径基线

至少按代码路径记录理论 D1 成本，并在可以测量时补实际 timing：

- Agent bootstrap；
- Agent inbox refresh；
- Visitor conversation create；
- Visitor send text；
- Agent send text；
- mark read；
- assignment；
- realtime broadcast；
- media init / complete。

后续性能 PR 不能只写“感觉更快”，必须指出减少了哪一步、哪一类 query/render/network cost。

---

## 6. 风险分级

| 等级 | 范围 | 典型内容 | 执行要求 |
| --- | --- | --- | --- |
| Low | 前端局部实现 | CSS 加载、memo/map、draft debounce | 可先做，但仍需全量 CI + 浏览器 Smoke |
| Medium | 共享查询/状态 | Inbox/Overview/Session 去重、移动 viewport | 独立 PR，必须验证 PC + Mobile |
| High | 消息热路径 | D1 batch、realtime event pipeline | 单独阶段，完整消息矩阵测试 |
| Very High | 创建/路由/DB | conversation create、routing SQL、trigger、migration | 不与其他改动混合，要求行为/并发/迁移专项测试 |

原则：**每个 PR 只跨一个主要风险等级。**

---

## 7. Phase 0 — Test 与 Baseline 收口

### 目标

在动生产代码前，确认测试描述的是当前产品契约，而不是历史源码结构。

### Checklist

- [ ] 运行 `pnpm verify`，记录当前 baseline；
- [ ] 列出所有 performance / cost / routing / realtime / agent inbox / message send 相关 tests；
- [ ] 将相关 tests 分类为行为、安全、并发、性能预算、数据库契约、Smoke、源码结构、历史实现；
- [ ] 标记所有 `readFileSync/readFile + regex/string matching` 类型测试；
- [ ] 判断每一个源码结构测试是否仍有实际业务/性能价值；
- [ ] 对已过期的源码结构约束先改成行为或预算约束；
- [ ] 不删除仍能阻止真实性能/业务回退的测试；
- [ ] 输出 baseline 记录并提交后，再进入 Phase 1。

### 完成标准

- `main` 当前业务行为全部可被现有/更新后的测试明确描述；
- 后续重构不会因为单纯改函数名、文件位置或实现手法就无意义失败；
- 性能关键路径仍有防回退测试。

---

## 8. Phase 1 — 坐席端前端 P0 性能

这是第一轮正式生产代码优化。**不修改 Routing、conversation create、数据库 trigger。**

### 8.1 CSS 加载

当前方向：Agent/Admin route 已经分包，继续保留 route-level 分离，但移除串行 CSS `await import()` waterfall。

Checklist：

- [ ] Agent CSS 不再逐文件串行等待；
- [ ] Admin CSS 不再逐文件串行等待；
- [ ] 保留 Agent/Admin 路由级资源隔离；
- [ ] 检查 Vite 输出，避免把所有后台 CSS 合成不必要的全站巨包；
- [ ] 首屏视觉不能出现明显 FOUC。

### 8.2 草稿持久化

Checklist：

- [ ] 输入每个字符时仍立即更新内存状态；
- [ ] localStorage 写入改为 debounce / idle flush；
- [ ] 推荐 debounce 约 300–500ms；
- [ ] 切换会话、页面隐藏或卸载时执行必要 flush；
- [ ] 草稿 24h TTL 语义保持不变；
- [ ] 浏览器存储异常不得阻断聊天。

### 8.3 Attachment 查找

Checklist：

- [ ] 不再为每一条 message 执行全量 `messageAttachments.filter()`；
- [ ] 使用 memoized `Map<messageId, attachments[]>` 或等价 O(1) lookup；
- [ ] 图片、名片、自动问候附件显示结果保持一致。

### 8.4 React Render Boundary

目标不是拆成几十个文件，而是建立三个稳定状态域：

```text
Inbox
Thread
Composer
```

Checklist：

- [ ] 输入 Composer 草稿不会无必要地重算整个 Inbox；
- [ ] Inbox realtime 更新不会无必要重建整个 Thread message tree；
- [ ] Thread message 更新不会导致不相关设置面板重渲染；
- [ ] 保持现有 UI 和功能行为。

### 8.5 长会话分页

Checklist：

- [ ] 初次打开会话不再默认把最多 500 条消息全部送到浏览器；
- [ ] 初始目标建议 50–100 条最新消息；
- [ ] 支持向上加载更早历史；
- [ ] 新消息增量同步保持现有 cursor 语义；
- [ ] read state 不得因为分页错误丢失；
- [ ] 如真实 DOM 数量仍过大，再评估虚拟列表，不提前引入复杂依赖。

### 8.6 Mobile visual viewport

Checklist：

- [ ] 优先使用 CSS `dvh / flex / safe-area`；
- [ ] JS 只处理浏览器确实无法仅靠 CSS 解决的键盘/viewport 差异；
- [ ] 尽量移除对整个 React root 的 subtree MutationObserver；
- [ ] 不因每一条聊天消息插入而重新执行全局 geometry 测量；
- [ ] 验证 iOS/Android 风格移动 viewport、软键盘、旋转、返回会话列表。

### Phase 1 验收

- [ ] PC Agent 首屏正常；
- [ ] Mobile Agent 首屏正常；
- [ ] 输入框连续输入无明显卡顿；
- [ ] 长会话滚动正常；
- [ ] 图片/名片/文字消息显示正常；
- [ ] 移动软键盘打开/关闭布局不抖动；
- [ ] `pnpm verify` 全绿；
- [ ] Chromium Agent Smoke 全绿。

---

## 9. Phase 2 — 重复实现收口

这一阶段只合并“同一事实的重复实现”，不修改业务语义。

### 9.1 Agent Inbox

- [ ] `agent-api` 与 `agent-bootstrap-api` 使用同一个 Inbox loader；
- [ ] bootstrap 和 refresh 返回结构保持兼容；
- [ ] closed preview limit、overview count、quota overview 只维护一套实现；
- [ ] 不增加新的 D1 round trip。

### 9.2 Agent Overview

- [ ] 收口 `agent-api`、`client-api`、`assignment-broadcast` 中重复的 overview 逻辑；
- [ ] 统一字段：open/pending/closed/total/quota；
- [ ] 明确哪些 event 真正需要 overview，普通 message event 不全量聚合；
- [ ] 增加/更新性能测试，防止 overview 被重新放回所有消息热路径。

### 9.3 Agent Session

- [ ] Agent HTTP API 使用同一套 session helper；
- [ ] Cookie 解析、token hash、session expiry、agent enabled/login identity 只有一个实现来源；
- [ ] 不因为抽取 helper 增加第二次 session D1 lookup；
- [ ] 暂不为了减少一次 auth query 引入复杂 edge cache，除非 profiling 证明必要。

### Phase 2 验收

- [ ] 同一个业务概念只保留一份 runtime 实现；
- [ ] query 数量不增加；
- [ ] Agent bootstrap / refresh 返回结果完全一致；
- [ ] 登录、登出、busy/online、账号停用行为正常；
- [ ] `pnpm verify` + Agent Smoke 全绿。

---

## 10. Phase 3 — Agent 消息发送 Hot Path

这是第一轮高风险后端优化。必须独立 PR，不混 UI 大改。

### 10.1 目标链路

目标从：

```text
HTTP
→ session
→ ownership
→ INSERT message
→ UPDATE conversation
→ broadcaster 再 SELECT conversation
→ 必要时 overview 再 SELECT
→ Durable Object broadcast
→ HTTP response
```

逐步收敛为：

```text
HTTP
→ authenticate
→ ownership
→ message + conversation 原子/批量持久化
→ 生成明确 event snapshot
→ 返回业务响应
→ 非事务性 realtime / push 使用 waitUntil 或等价后台交付
```

### 10.2 必须保持的同步边界

- message persistence 必须在响应成功前完成；
- conversation status/unread/preview 更新必须在响应成功前完成；
- duplicate/conflict 检测必须在响应前完成；
- realtime/push 失败不得把已经成功持久化的消息改成写入失败；
- 但不能把“需要确认的数据落库”误移入 `waitUntil`。

### 10.3 Checklist

- [ ] Agent 正常文本发送尽量使用 batch/单 command；
- [ ] 不在消息刚写入后为了广播重新读取完整 conversation；
- [ ] event dispatcher 接收调用方已知 snapshot；
- [ ] 普通 message event 不重新计算无必要 overview；
- [ ] realtime/push 与核心写事务明确解耦；
- [ ] 保持 clientMessageId 幂等；
- [ ] 保持 open → pending；
- [ ] 保持 visitor_unread / agent_unread；
- [ ] 保持 last_message_at / last_message_preview；
- [ ] 保持访客端和客服端实时消息顺序。

### 10.4 必测矩阵

- [ ] Agent 发普通文本；
- [ ] 重复 clientMessageId；
- [ ] clientMessageId 冲突；
- [ ] closed conversation；
- [ ] open → pending；
- [ ] Visitor 实时收到；
- [ ] Agent 自己 Thread 实时状态正确；
- [ ] Inbox last message 正确；
- [ ] unread count 正确；
- [ ] mark read 正确；
- [ ] WebSocket 断开后重连补数据；
- [ ] Push 失败不影响消息持久化；
- [ ] DO broadcast 失败不制造重复消息。

### Phase 3 性能完成标准

- 正常 Agent text send 路径 D1 round trip 明确少于 baseline；
- broadcast 不再隐藏一次无条件 full conversation SELECT；
- 用户可见发送成功时间不再等待非关键 Push；
- 所有消息行为测试和 Smoke 全绿。

---

## 11. Phase 4 — Conversation Create 补丁链收口

这是高风险阶段，必须最后做。

### 11.1 保持固定决策顺序

```text
A. replay / idempotency
B. active conversation reuse
C. candidate eligibility
D. closed-conversation affinity
E. global strict round robin
F. atomic assignment
G. no-agent cleanup
```

不得为了减少代码而改变优先级。

### 11.2 Legacy handoff 收口

当前新表 `conversation_source_handoffs` 已承担正式 handoff ownership。删除旧 fallback 前必须：

- [ ] 验证历史 migration 已完整回填当前生产所需数据；
- [ ] 增加一次一致性检查；
- [ ] 确认 runtime 已无必须读取 `conversations.source_handoff_id` 的场景；
- [ ] 先删除 runtime fallback；
- [ ] 观察一轮生产；
- [ ] 是否删除 legacy column 另做 migration，不与 runtime cleanup 同 PR。

### 11.3 Replay / Reuse Snapshot

- [ ] 避免同一个 conversation 在同一 request 中连续多次 `ownedConversation()`；
- [ ] replay 查询返回后续真正需要的数据；
- [ ] `rememberSourceHandoff` 后尽量不重复读取同一 owner；
- [ ] `continueConversationStart` 不无条件再读一次 conversation；
- [ ] assignment/broadcast 已有最终 snapshot 时直接复用。

### 11.4 禁止优化

- 不把 routing CTE 拆成多个 SELECT；
- 不取消 D1 原子 assignment；
- 不删除并发 quota/daily guard；
- 不让前端决定候选客服；
- 不为了少一次 SQL 而牺牲 sourceHandoff/clientMessageId 幂等。

### Phase 4 必测矩阵

- [ ] 首次 CTA；
- [ ] 同一 sourceHandoffId 重放；
- [ ] 同一 clientMessageId 重放；
- [ ] 两标签页并发 CTA；
- [ ] 两小时 active reuse；
- [ ] active reuse 原客服 online；
- [ ] active reuse 原客服 busy/offline/disabled；
- [ ] closed affinity 原客服仍合格；
- [ ] closed affinity 原客服不合格；
- [ ] global round robin；
- [ ] scope miss；
- [ ] daily limit exhausted；
- [ ] traffic quota exhausted；
- [ ] no-agent cleanup；
- [ ] no-agent 不推进 cursor；
- [ ] successful assignment 只计一次 stats/quota；
- [ ] concurrent assignment 不超 daily limit。

---

## 12. Routing / D1 保护区

当前 Routing 的复杂 SQL 并不等于错误架构。候选、资格、亲和、轮询和 assignment 尽量压在单一 D1 statement 中是为了减少 round trip 和并发竞态。

因此：

### 默认允许

- [ ] 根据 `EXPLAIN QUERY PLAN` / 实际 profiling 增加或调整必要索引；
- [ ] 删除确认不再使用且造成写放大的索引；
- [ ] 修复明确 bug；
- [ ] 减少已证明重复的子查询；
- [ ] 增加性能/并发回归测试。

### 默认禁止

- [ ] 重新设计轮询算法；
- [ ] 拆成多次 SELECT + UPDATE；
- [ ] 把 cursor 更新移到非原子应用层；
- [ ] 把 daily/quota 并发 guard 仅放在 JS；
- [ ] 为“最近在线”“最少会话”等未定义业务加入隐藏优先级。

---

## 13. Database Trigger 管理原则

Assignment 更新会触发统计、额度、round-robin、自动问候等副作用。它们提供了原子性，但也形成隐式写成本。

后续要求：

- [ ] 建立一份“当前有效 assignment trigger 清单”；
- [ ] 记录每次首次 assignment 理论最大写入数量；
- [ ] 任何新增 trigger 必须说明为什么不能在现有 trigger/statement 中完成；
- [ ] 不允许两个 trigger 重复维护同一个字段；
- [ ] 对 retired trigger 用 migration 明确 `DROP TRIGGER`；
- [ ] migration 历史文件不删除；
- [ ] 可新增 current-schema snapshot 供审计，但它不能替代历史 migrations。

---

## 14. Realtime Event Pipeline 目标

最终推荐统一为：

```text
Domain write
→ explicit snapshot/event
→ realtime dispatcher
   ├ conversation room
   ├ agent inbox room
   ├ visitor room
   └ push notification
```

要求：

- event 名称和 payload 明确；
- dispatcher 本身不隐藏不必要 D1 full read；
- handler 不通过“检查 HTTP response path/status/body”猜测应该发送什么业务事件；
- unknown realtime event 不立即无限制触发全量 refresh；
- recovery 必须 throttle，并优先增量同步。

迁移到该结构时必须逐步进行，不能一次替换所有 Visitor/Agent/Media/Attachment 通道。

---

## 15. 每个 PR 的固定 CI Gate

每一阶段、每一个 PR 都必须按以下顺序执行：

```text
1. Repository guardrails
2. Format
3. Lint
4. Typecheck
5. Local D1 migrations
6. Unit / behavior / security / concurrency tests
7. Performance contract tests
8. UI build
9. Worker dry-run / bundle validation
10. Agent Chromium Smoke
11. Admin Chromium Smoke（如果涉及 Admin）
12. Production protocol Smoke（合并部署后）
```

仓库已有命令优先使用：

```bash
pnpm verify
```

失败处理规则：

```text
Gate 失败
→ 停止当前阶段
→ 判断是业务回归、实现错误还是旧 test 约束
→ 修复当前问题
→ 从相关 Gate 重新执行
→ 全绿后才继续下一阶段
```

禁止在 Gate 未绿时继续叠加下一轮性能改动。

---

## 16. PR 拆分建议

建议按以下粒度执行，避免单个 PR 过大：

1. `perf(test): establish optimization baseline and contracts`
2. `perf(agent-ui): remove style loading waterfall`
3. `perf(agent-ui): debounce drafts and index attachments`
4. `perf(agent-ui): isolate thread render and paginate history`
5. `perf(agent-mobile): simplify visual viewport synchronization`
6. `refactor(worker): share inbox and overview loaders`
7. `refactor(worker): unify agent session authentication`
8. `perf(worker): reduce agent message send D1 and realtime cost`
9. `refactor(worker): make conversation events snapshot-driven`
10. `perf(client): collapse replay and conversation-start rereads`
11. `cleanup(client): retire verified handoff compatibility fallback`
12. 最后单独 `chore: remove verified dead performance scaffolding`

实际可以根据审计结果合并相邻低风险 PR，但高风险 Phase 3/4 不与 UI 大改混合。

---

## 17. 回滚策略

每个 Phase 必须可独立回滚。

### 前端

- 一个 PR 只处理一个明确性能主题；
- 不同时改变 UI 产品设计和状态架构；
- 出现 Mobile/PC regression 时可直接 revert 单个 PR。

### Worker

- 新 dispatcher/helper 迁移采用调用点逐步替换；
- 旧实现确认无人引用后再删除；
- 高风险 hot path PR 保持 commit 清晰，方便 revert。

### D1

- migration 视为向前执行，不能假设生产环境可以简单回滚 schema；
- 任何 destructive migration 必须单独计划；
- 本轮优先做 runtime cleanup，不急于删除 legacy column/table；
- 数据库结构删除必须晚于 runtime 停用和至少一轮生产验证。

---

## 18. Definition of Done

一项性能优化只有同时满足以下条件才算完成：

- [ ] 当前业务契约未改变，或已经先明确更新契约；
- [ ] 对应 tests 在改代码前已审查；
- [ ] 有清晰的 before / after 性能理由；
- [ ] 没有新增无必要包装层；
- [ ] 没有增加额外 D1/network round trip；
- [ ] 相关行为、安全、并发测试通过；
- [ ] `pnpm verify` 全绿；
- [ ] 真实 Agent/Admin Smoke 通过；
- [ ] PR 可以独立 revert；
- [ ] README / 本计划中需要同步的架构说明已更新；
- [ ] 完成项在本文件 Checklist 中勾选。

---

## 19. 总体执行原则

后续所有性能工作统一遵循：

> **先锁定业务契约和测试契约，再优化实现。每次只减少复杂度，不新增补丁层；每个阶段必须可独立验证、独立部署、独立回滚。**

判断一项优化是否值得做时，优先问四个问题：

1. 它减少了多少 D1 / network / render / main-thread work？
2. 它是否删除了一个重复事实来源或历史补丁？
3. 它是否保持现有业务与并发安全？
4. 它是否让下一次功能修改更不容易继续“打补丁”？

如果四个问题都没有明确收益，则不做该优化。
