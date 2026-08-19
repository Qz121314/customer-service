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
- 新测试优先验证 API、数据转换、状态变化和运行时行为，而不是变量名、源码排版或无意义的实现细节。
- 对难以在普通单元测试中稳定复现、但又必须长期锁死的边界，可以保留少量源码契约测试，例如 Cloudflare 路由/Assets 边界、Worker/D1 成本约束、管理端与坐席端样式隔离、关键响应式几何；这类测试只锁业务或架构不变量，不应因为纯格式变化而失败。
- 删除临时代码、过期兼容层和无价值测试；不要通过持续追加覆盖层来修复已经可以归并的样式问题。

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
