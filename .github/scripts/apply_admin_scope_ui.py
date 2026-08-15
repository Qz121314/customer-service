from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    source = read(path)
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old[:120]!r}')
    write(path, source.replace(old, new, 1))


# Keep the normalized server rule explicitly available to presentation code.
replace_once(
    'src/dashboard/api.ts',
    """    return {
      ...agent,
      productIds: attachProductSelectionScope(""",
    """    return {
      ...agent,
      routingScope: scope,
      productIds: attachProductSelectionScope(""",
)

# Scope-aware presentation helpers. The admin list should describe the rule
# itself, not materialize hundreds of product titles for section/category rules.
replace_once(
    'src/dashboard/App.tsx',
    """function sortedConversationList(items: Conversation[]): Conversation[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.last_message_at || left.created_at);
    const rightTime = Date.parse(right.last_message_at || right.created_at);
    return rightTime - leftTime;
  });
}

export function App()""",
    """function sortedConversationList(items: Conversation[]): Conversation[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.last_message_at || left.created_at);
    const rightTime = Date.parse(right.last_message_at || right.created_at);
    return rightTime - leftTime;
  });
}

type AgentScopeSummary = {
  tone: 'none' | 'section' | 'category' | 'product';
  title: string;
  detail: string;
};

function agentScopeSummary(
  agent: AgentAccount,
  products: ProductCatalogItem[],
): AgentScopeSummary {
  const scope = agent.routingScope;
  if (!scope || scope.type === 'none') {
    return {
      tone: 'none',
      title: '未配置负责范围',
      detail: '不会参与基于产品范围的新会话分流',
    };
  }

  if (scope.type === 'section') {
    const product = products.find((item) => item.sectionId === scope.sectionId);
    const sectionName = product?.sectionName || scope.sectionId;
    return {
      tone: 'section',
      title: `${sectionName} · 整个分区`,
      detail: `动态覆盖 ${agent.productIds.length} 个产品`,
    };
  }

  if (scope.type === 'category') {
    const sectionProduct = products.find(
      (item) => item.sectionId === scope.sectionId,
    );
    const sectionName = sectionProduct?.sectionName || scope.sectionId;
    const names = scope.categoryIds.map((categoryId) => {
      const product = products.find(
        (item) =>
          item.sectionId === scope.sectionId && item.categoryId === categoryId,
      );
      return product?.categoryName || categoryId;
    });
    const visible = names.slice(0, 2).join('、');
    const remainder = Math.max(0, names.length - 2);
    return {
      tone: 'category',
      title: `${sectionName} · ${scope.categoryIds.length} 个分类`,
      detail: `${visible}${remainder ? ` 等 ${names.length} 个分类` : ''} · 动态覆盖 ${agent.productIds.length} 个产品`,
    };
  }

  const names = scope.productIds.map(
    (productId) =>
      products.find((item) => item.id === productId)?.title || productId,
  );
  const visible = names.slice(0, 2).join('、');
  const remainder = Math.max(0, names.length - 2);
  return {
    tone: 'product',
    title: `指定 ${scope.productIds.length} 个产品`,
    detail: names.length
      ? `${visible}${remainder ? ` 等 ${names.length} 个产品` : ''}`
      : '未选择产品',
  };
}

export function App()""",
)

# Modal keyboard behavior belongs to the admin configuration surface.
replace_once(
    'src/dashboard/App.tsx',
    """  useEffect(() => {
    refresh()
      .catch((reason) => setError(message(reason, '无法加载配置')))
      .finally(() => setBusy(false));
  }, [refresh]);

  const workspaceUrl""",
    """  useEffect(() => {
    refresh()
      .catch((reason) => setError(message(reason, '无法加载配置')))
      .finally(() => setBusy(false));
  }, [refresh]);

  useEffect(() => {
    if (!editorOpen || saving) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [editorOpen, saving]);

  const workspaceUrl""",
)

replace_once(
    'src/dashboard/App.tsx',
    """  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const assignedProductCount""",
    """  const assignedProductCount""",
)

replace_once(
    'src/dashboard/App.tsx',
    """  const sectionHint =
    section === 'agents'
      ? '管理员创建客服账号，并给每个坐席分配负责的产品。'
      : '员工统一使用这个地址登录聊天工作台，管理后台本身不处理访客会话。';""",
    """  const sectionHint =
    section === 'agents'
      ? '管理员创建客服账号，并按分区、分类或单个产品配置负责范围。'
      : '员工统一使用这个地址登录聊天工作台，管理后台本身不处理访客会话。';""",
)

replace_once(
    'src/dashboard/App.tsx',
    """                  <strong>客服账号列表</strong>
                  <span>员工使用各自账号登录坐席工作台</span>""",
    """                  <strong>客服账号列表</strong>
                  <span>负责范围以动态分流规则保存，分区和分类后续新增产品会自动纳入</span>""",
)

replace_once(
    'src/dashboard/App.tsx',
    """                        <th>负责产品</th>""",
    """                        <th>负责范围</th>""",
)

replace_once(
    'src/dashboard/App.tsx',
    """                          <td>
                            <div className="group-tags">
                              {agent.productIds.length ? (
                                <>
                                  {agent.productIds.slice(0, 2).map((id) => (
                                    <span key={id}>
                                      {productById.get(id)?.title || '未知产品'}
                                    </span>
                                  ))}
                                  {agent.productIds.length > 2 ? (
                                    <em>+{agent.productIds.length - 2}</em>
                                  ) : null}
                                </>
                              ) : (
                                <em>未分配产品</em>
                              )}
                            </div>
                          </td>""",
    """                          <td>
                            {(() => {
                              const summary = agentScopeSummary(agent, products);
                              return (
                                <div className={`agent-scope-summary ${summary.tone}`}>
                                  <strong>{summary.title}</strong>
                                  <small>{summary.detail}</small>
                                </div>
                              );
                            })()}
                          </td>""",
)

replace_once(
    'src/dashboard/App.tsx',
    """          <section
            className="agent-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >""",
    """          <section
            className="agent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-editor-title"
            onMouseDown={(event) => event.stopPropagation()}
          >""",
)
replace_once(
    'src/dashboard/App.tsx',
    """                <h2>{draft.id ? '编辑客服账号' : '新增客服账号'}</h2>
                <p>账号和负责产品都由管理员统一配置。</p>""",
    """                <h2 id="agent-editor-title">
                  {draft.id ? '编辑客服账号' : '新增客服账号'}
                </h2>
                <p>账号与分流负责范围由管理员统一配置。</p>""",
)

replace_once(
    'src/dashboard/App.tsx',
    """            <form
              className="agent-editor-form"
              onSubmit={(event) => void saveAgent(event)}
            >
              <div className="form-two-columns">""",
    """            <form
              className="agent-editor-form"
              onSubmit={(event) => void saveAgent(event)}
            >
              <div className="agent-editor-section-title">
                <strong>账号设置</strong>
                <span>配置坐席身份、登录凭据和同时接待上限</span>
              </div>
              <div className="form-two-columns">""",
)

replace_once(
    'src/dashboard/App.tsx',
    """              <ProductAssignmentPicker
                products={products}""",
    """              <div className="agent-editor-section-title scope-title">
                <strong>分流负责范围</strong>
                <span>分区 = 全选，分类 = 批量选择，指定产品 = 精确选择</span>
              </div>
              <ProductAssignmentPicker
                products={products}""",
)

# Admin/table/modal visual hierarchy. Keep it sober and workspace-like rather
# than adding decorative cards.
styles = read('src/dashboard/styles.css')
styles += """

/* Admin scope semantics and editor workspace */
.agent-scope-summary {
  display: grid;
  min-width: 170px;
  max-width: 330px;
  gap: 3px;
}
.agent-scope-summary strong {
  overflow: hidden;
  color: #30343b;
  font-size: 12px;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-scope-summary small {
  overflow: hidden;
  color: #9297a0;
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-scope-summary.section strong::before,
.agent-scope-summary.category strong::before,
.agent-scope-summary.product strong::before {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 7px;
  border-radius: 50%;
  background: #2f343b;
  vertical-align: 1px;
  content: '';
}
.agent-scope-summary.none strong,
.agent-scope-summary.none small {
  color: #a0a4ac;
}
.agent-modal {
  width: min(780px, 100%);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  overscroll-behavior: contain;
}
.agent-modal > header {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  background: #fff;
}
.agent-editor-form {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.agent-editor-section-title {
  display: grid;
  gap: 3px;
  padding-bottom: 2px;
}
.agent-editor-section-title strong {
  color: #24272d;
  font-size: 13px;
}
.agent-editor-section-title span {
  color: #9297a0;
  font-size: 11px;
  font-weight: 500;
}
.agent-editor-section-title.scope-title {
  margin-top: 2px;
  padding-top: 15px;
  border-top: 1px solid #eff0f2;
}
.agent-editor-form footer {
  position: sticky;
  bottom: -22px;
  z-index: 3;
  margin: 0 -22px -22px;
  padding: 14px 22px calc(14px + env(safe-area-inset-bottom));
  border-top: 1px solid #e9ebee;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 -8px 22px rgba(20, 23, 29, 0.035);
  backdrop-filter: blur(10px);
}
@media (min-width: 1200px) {
  .workspace-shell {
    grid-template-columns: 216px minmax(330px, 372px) minmax(520px, 1fr);
  }
}
@media (max-width: 900px) {
  .admin-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 620px) {
  .modal-backdrop {
    padding: 0;
    place-items: end stretch;
  }
  .agent-modal {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top));
    border-radius: 16px 16px 0 0;
  }
  .agent-modal > header {
    padding: 16px 16px 14px;
  }
  .agent-editor-form {
    padding: 18px 16px;
  }
  .agent-editor-form footer {
    bottom: -18px;
    margin: 0 -16px -18px;
    padding-right: 16px;
    padding-left: 16px;
  }
  .agent-scope-summary {
    min-width: 145px;
  }
}
"""
write('src/dashboard/styles.css', styles)

picker = read('src/dashboard/product-assignment.css')
picker += """

/* Scope picker: flatter configuration controls with a clearer selected rule. */
.product-assignment-modes button {
  min-height: 68px;
  border-color: #e2e4e8;
  border-radius: 9px;
  background: #fff;
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    box-shadow 120ms ease;
}
.product-assignment-modes button.is-active {
  border-color: #25292f;
  background: #f7f8f9;
  box-shadow: inset 0 0 0 1px #25292f;
}
.product-assignment-note,
.product-assignment-empty {
  border: 1px solid #eceef1;
  border-radius: 9px;
  background: #f8f9fa;
}
.product-assignment-category,
.product-assignment-selected-item,
.product-assignment-option {
  border-color: #e4e6e9;
  border-radius: 9px;
  background: #fff;
}
.product-assignment-category:has(input:checked),
.product-assignment-option:has(input:checked) {
  border-color: #777d86;
  background: #f8f9fa;
}
.product-assignment-toolbar input,
.product-assignment-toolbar select,
.product-assignment-panel select {
  min-height: 42px;
  border: 1px solid #dfe2e6;
  border-radius: 9px;
  background: #fff;
  outline: none;
}
.product-assignment-toolbar input {
  padding: 0 12px;
}
.product-assignment-toolbar select,
.product-assignment-panel select {
  padding: 0 10px;
}
.product-assignment-toolbar input:focus,
.product-assignment-toolbar select:focus,
.product-assignment-panel select:focus {
  border-color: #868c95;
  box-shadow: 0 0 0 3px rgba(30, 34, 40, 0.06);
}
"""
write('src/dashboard/product-assignment.css', picker)

# Source-level contract guards the semantic direction and the responsive modal.
write(
    'test/admin-scope-ui-contract.test.mjs',
    """import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('admin UI presents dynamic routing scopes instead of expanded product lists', () => {
  const app = source('../src/dashboard/App.tsx');
  const api = source('../src/dashboard/api.ts');
  const styles = source('../src/dashboard/styles.css');

  assert.ok(app.includes('<th>负责范围</th>'));
  assert.ok(app.includes('agentScopeSummary(agent, products)'));
  assert.ok(app.includes('整个分区'));
  assert.ok(app.includes('动态覆盖'));
  assert.ok(!app.includes('<th>负责产品</th>'));
  assert.ok(api.includes('routingScope: scope'));
  assert.ok(styles.includes('width: min(780px, 100%)'));
  assert.ok(styles.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
  assert.ok(app.includes('aria-modal="true"'));
});
""",
)

print('Admin scope UI refinement applied.')
