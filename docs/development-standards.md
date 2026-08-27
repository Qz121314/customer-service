# 开发与测试前置规则

本仓库与 Site 使用同一原则：开发前先确定约束，CI 只做最终验证。格式、Lint、TypeScript、D1 迁移边界和运行时协议都必须在提交代码前明确，不接受先随意实现、再根据 CI 报错反复修正的工作流。

## 开发前

1. 阅读 `README.md`、相关接口、D1 migrations 和目标模块现有数据模型。
2. 在基线分支运行 `pnpm preflight`；基线失败时先修基线。
3. 以 `.editorconfig`、`prettier.config.mjs`、`eslint.config.mjs`、TypeScript 配置作为唯一代码规范。
4. 明确改动属于客服 UI、Worker API、D1、R2、WebSocket 或 Web Push 哪一层，不为了方便破坏独立客服系统与 Site 的运行时边界。

`pnpm install` 会通过 `prepare` 把 Git hooks 指向 `.githooks`。提交前 `pre-commit` 会运行 `pnpm preflight`，因此格式、Lint 或类型不通过的代码不能正常提交。

## 开发过程中

- 按 Prettier 最终形态直接编写代码，不依赖 CI 事后格式化。
- D1 schema 变化只能通过新的 migration 演进，不修改已发布迁移。
- 消息、已读、未读、WebSocket、Web Push 等状态必须以服务端真实状态为准，不在 UI 伪造业务结果。
- 测试默认验证可观察行为：API 响应、D1 持久化结果、状态变化、路由结果、协议结果、浏览器交互和明确的成本预算；不验证变量名、函数名、源码排版或组件内部实现方式。
- 业务、API 和 UI 契约测试禁止把 `src/`、`README.md` 或组件源码当作文本读取后用 `includes` / 正则表达式锁定具体代码片段。稳定 API / 数据契约必须通过真实接口、纯函数、数据库状态或浏览器行为验证。
- 只有架构与成本类 Guardrail 可以做静态源码检查，例如 Worker / D1 请求预算、运行时边界、设计系统所有权和构建配置；这类测试必须以 `cost`、`boundary`、`design-system` 等目的明确命名，并只锁粗粒度不变量，不能代替业务行为测试。
- 如果一个源码字符串测试与行为测试重复，删除源码字符串测试；如果暂时没有行为覆盖且该规则确实重要，优先补行为测试，而不是继续扩大字符串断言。
- 删除临时代码、过期兼容层和无价值测试；不要通过持续追加覆盖层来修复已经可以归并的样式问题。
- 通用控件统一从 `src/dashboard/ui/` 引入；shadcn 组件源码归仓库所有，Tailwind 只负责组件样式和设计令牌，不替代聊天几何、Visual Viewport、PWA 安全区等专用 CSS。
- 新功能图标统一通过 `UiIcon` 映射到 `lucide-react`，禁止页面本地 SVG、字符图标和 CSS data URI 图标。
- 新增或拆分 CSS 必须先确定唯一所有者；管理端、坐席共享、桌面端、移动端和独立复杂功能之间不能互相追加补丁覆盖。

## 提交前

日常改动至少运行：

```bash
pnpm preflight
pnpm test
```

涉及 Worker、D1 或部署链路时运行：

```bash
pnpm verify
```

`pnpm verify` 依次验证格式、Lint、类型、D1 本地迁移、测试、构建和 Worker dry-run。GitHub Actions 继续作为最终发布门禁，但不作为发现基础格式问题的第一现场。

## 发布完成条件

Pull Request 只有在 D1 migrations、Prettier、ESLint、TypeScript、Node tests、Vite build、Worker dry-run 和 Chromium UI smoke 全部通过后才能合并。

合并到 `main` 后，发布还没有结束。必须继续满足：

```text
Cloudflare production deploy = success
production protocol smoke = success
```

生产 Smoke 必须继续严格验证 Health、Integration v1、Client CORS / REST / WebSocket，以及已经移除的旧协议保持 HTTP 404。不能为了让发布变绿而放宽这些协议边界。
