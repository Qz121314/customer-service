from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{path}: expected one regex match, found {count}: {pattern!r}')
    write(path, updated)


# ---------------------------------------------------------------------------
# Dashboard API state is rule-native. Section/category scopes are never expanded
# into per-product IDs for application state or admin POST/PATCH payloads.
# ---------------------------------------------------------------------------
replace_once(
    'src/dashboard/api.ts',
    """  hasPassword: boolean;
  productIds: string[];
  routingScope?: AgentRoutingScope;
};""",
    """  hasPassword: boolean;
  routingScope: AgentRoutingScope;
};""",
)

regex_once(
    'src/dashboard/api.ts',
    r"const productSelectionScopeKey = Symbol\('product-selection-routing-scope'\);[\s\S]*?type AdminBootstrapPayload = \{\n  agents: AgentAccount\[\];\n  products: ProductCatalogItem\[\];\n};",
    """type AdminBootstrapAgent = Omit<AgentAccount, 'routingScope'> & {
  productIds?: string[];
  routingScope?: AgentRoutingScope;
};

type AdminBootstrapPayload = {
  agents: AdminBootstrapAgent[];
  products: ProductCatalogItem[];
};""",
)

regex_once(
    'src/dashboard/api.ts',
    r"export function attachProductSelectionScope\([\s\S]*?export async function getAdminSession",
    """export async function getAdminSession""",
)

regex_once(
    'src/dashboard/api.ts',
    r"export async function getAgents\(\): Promise<AgentAccount\[\]> \{[\s\S]*?\n}\n\nexport async function createAgent",
    """export async function getAgents(): Promise<AgentAccount[]> {
  const response = await getAdminBootstrap();
  return response.agents.map((agent) => ({
    ...agent,
    routingScope: normalizeRoutingScope(
      agent.routingScope,
      agent.productIds ?? [],
    ),
  }));
}

export async function createAgent""",
)

replace_once(
    'src/dashboard/api.ts',
    """  password: string;
  productIds: string[];
  maxActiveConversations: number;""",
    """  password: string;
  routingScope: AgentRoutingScope;
  maxActiveConversations: number;""",
)
replace_once(
    'src/dashboard/api.ts',
    """    body: JSON.stringify({
      ...input,
      routingScope: scopeForRequest(input.productIds),
    }),""",
    """    body: JSON.stringify(input),""",
)
replace_once(
    'src/dashboard/api.ts',
    """    password?: string;
    productIds: string[];
    maxActiveConversations: number;""",
    """    password?: string;
    routingScope: AgentRoutingScope;
    maxActiveConversations: number;""",
)
replace_once(
    'src/dashboard/api.ts',
    """    body: JSON.stringify({
      ...input,
      routingScope: scopeForRequest(input.productIds),
    }),""",
    """    body: JSON.stringify(input),""",
)

regex_once(
    'src/dashboard/api.ts',
    r"\nfunction expandRoutingScopeProductIds\([\s\S]*?\nfunction openSocket",
    "\nfunction openSocket",
)

# ---------------------------------------------------------------------------
# Scope picker works directly with AgentRoutingScope. It computes counts only
# for presentation and never materializes a section/category selection array.
# ---------------------------------------------------------------------------
write(
    'src/dashboard/ProductAssignmentPicker.tsx',
    """import { useEffect, useMemo, useState } from 'react';
import type { AgentRoutingScope, ProductCatalogItem } from './api';

type Props = {
  products: ProductCatalogItem[];
  scope: AgentRoutingScope;
  disabled?: boolean;
  onChange: (scope: AgentRoutingScope) => void;
};

type ScopeMode = Exclude<AgentRoutingScope['type'], 'none'>;

type NamedCount = {
  id: string;
  name: string;
  count: number;
};

const searchResultLimit = 60;

export function ProductAssignmentPicker({
  products,
  scope,
  disabled = false,
  onChange,
}: Props) {
  const [mode, setMode] = useState<ScopeMode>(() =>
    scope.type === 'none' ? 'section' : scope.type,
  );
  const [categorySectionId, setCategorySectionId] = useState(() =>
    scope.type === 'category' ? scope.sectionId : '',
  );
  const [query, setQuery] = useState('');
  const [filterSectionId, setFilterSectionId] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');

  useEffect(() => {
    if (scope.type === 'none') return;
    setMode(scope.type);
    if (scope.type === 'category') setCategorySectionId(scope.sectionId);
  }, [scope]);

  const enabledProducts = useMemo(
    () => products.filter((product) => product.isEnabled),
    [products],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const sections = useMemo<NamedCount[]>(() => {
    const map = new Map<string, NamedCount>();
    for (const product of enabledProducts) {
      if (!product.sectionId) continue;
      const current = map.get(product.sectionId);
      if (current) current.count += 1;
      else {
        map.set(product.sectionId, {
          id: product.sectionId,
          name: product.sectionName || product.sectionId,
          count: 1,
        });
      }
    }
    return [...map.values()].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN'),
    );
  }, [enabledProducts]);

  const categories = useMemo<NamedCount[]>(() => {
    if (!categorySectionId) return [];
    const map = new Map<string, NamedCount>();
    for (const product of enabledProducts) {
      if (product.sectionId !== categorySectionId || !product.categoryId) continue;
      const current = map.get(product.categoryId);
      if (current) current.count += 1;
      else {
        map.set(product.categoryId, {
          id: product.categoryId,
          name: product.categoryName || product.categoryId,
          count: 1,
        });
      }
    }
    return [...map.values()].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN'),
    );
  }, [categorySectionId, enabledProducts]);

  const filterCategories = useMemo<NamedCount[]>(() => {
    if (!filterSectionId) return [];
    const map = new Map<string, NamedCount>();
    for (const product of enabledProducts) {
      if (product.sectionId !== filterSectionId || !product.categoryId) continue;
      const current = map.get(product.categoryId);
      if (current) current.count += 1;
      else {
        map.set(product.categoryId, {
          id: product.categoryId,
          name: product.categoryName || product.categoryId,
          count: 1,
        });
      }
    }
    return [...map.values()].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN'),
    );
  }, [enabledProducts, filterSectionId]);

  const selectedSectionId = scope.type === 'section' ? scope.sectionId : '';
  const selectedCategoryIds = useMemo(
    () =>
      new Set(
        scope.type === 'category' && scope.sectionId === categorySectionId
          ? scope.categoryIds
          : [],
      ),
    [categorySectionId, scope],
  );
  const selectedProductIds = useMemo(
    () => new Set(scope.type === 'product' ? scope.productIds : []),
    [scope],
  );
  const selectedProducts = useMemo(
    () =>
      [...selectedProductIds]
        .map((id) => productById.get(id) ?? null)
        .filter((product): product is ProductCatalogItem => Boolean(product)),
    [productById, selectedProductIds],
  );

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const hasProductSearch = Boolean(
    normalizedQuery || filterSectionId || filterCategoryId,
  );
  const searchResults = useMemo(() => {
    if (!hasProductSearch) return [];
    return enabledProducts
      .filter((product) => {
        if (filterSectionId && product.sectionId !== filterSectionId) return false;
        if (filterCategoryId && product.categoryId !== filterCategoryId) return false;
        if (!normalizedQuery) return true;
        return [
          product.title,
          product.sectionName,
          product.categoryName,
          product.id,
        ]
          .filter(Boolean)
          .some((value) =>
            String(value).toLocaleLowerCase().includes(normalizedQuery),
          );
      })
      .slice(0, searchResultLimit);
  }, [
    enabledProducts,
    filterCategoryId,
    filterSectionId,
    hasProductSearch,
    normalizedQuery,
  ]);

  const sectionProductCount = selectedSectionId
    ? enabledProducts.filter((product) => product.sectionId === selectedSectionId).length
    : 0;
  const categoryProductCount = useMemo(() => {
    if (scope.type !== 'category') return 0;
    const ids = new Set(scope.categoryIds);
    return enabledProducts.filter(
      (product) =>
        product.sectionId === scope.sectionId &&
        Boolean(product.categoryId) &&
        ids.has(product.categoryId as string),
    ).length;
  }, [enabledProducts, scope]);

  function selectMode(nextMode: ScopeMode) {
    if (nextMode === mode) return;
    if (nextMode === 'category') {
      setCategorySectionId(
        scope.type === 'section' || scope.type === 'category'
          ? scope.sectionId
          : '',
      );
    }
    if (nextMode === 'product') {
      setFilterSectionId(
        scope.type === 'section' || scope.type === 'category'
          ? scope.sectionId
          : '',
      );
      setFilterCategoryId('');
      setQuery('');
    }
    setMode(nextMode);
    onChange({ type: 'none' });
  }

  function selectSection(sectionId: string) {
    onChange(sectionId ? { type: 'section', sectionId } : { type: 'none' });
  }

  function toggleCategory(categoryId: string, checked: boolean) {
    if (!categorySectionId) return;
    const next = new Set(selectedCategoryIds);
    if (checked) next.add(categoryId);
    else next.delete(categoryId);
    const categoryIds = [...next];
    onChange(
      categoryIds.length
        ? { type: 'category', sectionId: categorySectionId, categoryIds }
        : { type: 'none' },
    );
  }

  function toggleProduct(productId: string, checked: boolean) {
    const next = new Set(selectedProductIds);
    if (checked) next.add(productId);
    else next.delete(productId);
    const productIds = [...next];
    onChange(productIds.length ? { type: 'product', productIds } : { type: 'none' });
  }

  if (products.length === 0) {
    return (
      <fieldset>
        <legend>负责范围</legend>
        <div className="product-assignment-empty">
          <strong>还没有同步产品目录</strong>
          <span>回到 Site 后台重新验证客服系统，产品目录会自动同步到这里。</span>
        </div>
      </fieldset>
    );
  }

  return (
    <fieldset className="product-assignment-fieldset">
      <legend>负责范围</legend>

      <div className="product-assignment-modes" aria-label="负责范围类型">
        <button
          type="button"
          className={mode === 'section' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => selectMode('section')}
        >
          <strong>整个分区</strong>
          <span>该分区全部产品</span>
        </button>
        <button
          type="button"
          className={mode === 'category' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => selectMode('category')}
        >
          <strong>指定分类</strong>
          <span>按分类批量负责</span>
        </button>
        <button
          type="button"
          className={mode === 'product' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => selectMode('product')}
        >
          <strong>指定产品</strong>
          <span>只负责单独产品</span>
        </button>
      </div>

      {mode === 'section' ? (
        <div className="product-assignment-panel">
          <label>
            <span>负责分区</span>
            <select
              value={selectedSectionId}
              disabled={disabled}
              onChange={(event) => selectSection(event.target.value)}
            >
              <option value="">选择分区</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}（{section.count}）
                </option>
              ))}
            </select>
          </label>
          <div className="product-assignment-note">
            <strong>
              {selectedSectionId
                ? `当前覆盖 ${sectionProductCount} 个产品`
                : '选择一个分区'}
            </strong>
            <span>保存的是分区规则，之后新增到该分区的产品会自动纳入。</span>
          </div>
        </div>
      ) : null}

      {mode === 'category' ? (
        <div className="product-assignment-panel">
          <label>
            <span>所属分区</span>
            <select
              value={categorySectionId}
              disabled={disabled}
              onChange={(event) => {
                setCategorySectionId(event.target.value);
                onChange({ type: 'none' });
              }}
            >
              <option value="">选择分区</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </label>

          {categorySectionId ? (
            <div className="product-assignment-categories">
              {categories.length ? (
                categories.map((category) => (
                  <label key={category.id} className="product-assignment-category">
                    <input
                      type="checkbox"
                      checked={selectedCategoryIds.has(category.id)}
                      disabled={disabled}
                      onChange={(event) =>
                        toggleCategory(category.id, event.target.checked)
                      }
                    />
                    <span>
                      <strong>{category.name}</strong>
                      <small>{category.count} 个产品</small>
                    </span>
                  </label>
                ))
              ) : (
                <div className="product-assignment-empty compact">
                  这个分区还没有可用分类
                </div>
              )}
            </div>
          ) : null}

          <div className="product-assignment-note">
            <strong>
              {scope.type === 'category'
                ? `已选 ${scope.categoryIds.length} 个分类，当前覆盖 ${categoryProductCount} 个产品`
                : '选择需要负责的分类'}
            </strong>
            <span>保存的是分类规则，分类中后续新增的产品会自动纳入。</span>
          </div>
        </div>
      ) : null}

      {mode === 'product' ? (
        <div className="product-assignment-panel">
          <div className="product-assignment-toolbar">
            <input
              type="search"
              value={query}
              disabled={disabled}
              placeholder="搜索产品名称"
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              value={filterSectionId}
              disabled={disabled}
              onChange={(event) => {
                setFilterSectionId(event.target.value);
                setFilterCategoryId('');
              }}
            >
              <option value="">全部分区</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
            <select
              value={filterCategoryId}
              disabled={disabled || !filterSectionId}
              onChange={(event) => setFilterCategoryId(event.target.value)}
            >
              <option value="">全部分类</option>
              {filterCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="product-assignment-summary">
            <span>已选择 {selectedProductIds.size} 个产品</span>
            <span>可按分区和分类缩小查找范围</span>
          </div>

          {selectedProducts.length ? (
            <div className="product-assignment-selected">
              {selectedProducts.map((product) => (
                <div key={product.id} className="product-assignment-selected-item">
                  <span>
                    <strong>{product.title}</strong>
                    <small>
                      {[product.sectionName, product.categoryName]
                        .filter(Boolean)
                        .join(' / ') || '未分类'}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="table-action"
                    disabled={disabled}
                    onClick={() => toggleProduct(product.id, false)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="product-assignment-list">
            {!hasProductSearch ? (
              <div className="product-assignment-empty compact">
                输入名称或选择分区 / 分类后再查找产品
              </div>
            ) : searchResults.length === 0 ? (
              <div className="product-assignment-empty compact">没有匹配的产品</div>
            ) : (
              searchResults.map((product) => {
                const checked = selectedProductIds.has(product.id);
                return (
                  <label key={product.id} className="product-assignment-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) =>
                        toggleProduct(product.id, event.target.checked)
                      }
                    />
                    {product.coverUrl ? (
                      <img src={product.coverUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="product-assignment-cover-placeholder" />
                    )}
                    <span className="product-assignment-copy">
                      <strong>{product.title}</strong>
                      <small>
                        {[product.sectionName, product.categoryName]
                          .filter(Boolean)
                          .join(' / ') || '未分类'}
                      </small>
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {searchResults.length === searchResultLimit ? (
            <small className="product-assignment-limit-hint">
              当前只显示前 {searchResultLimit} 个结果，可继续输入名称缩小范围。
            </small>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
""",
)

# ---------------------------------------------------------------------------
# Admin draft stores the rule, not all resolved products. Coverage is computed
# on demand from the single product catalog only for UI counts/summaries.
# ---------------------------------------------------------------------------
replace_once(
    'src/dashboard/App.tsx',
    """  AgentAccount,
  ProductCatalogItem,""",
    """  AgentAccount,
  AgentRoutingScope,
  ProductCatalogItem,""",
)
replace_once(
    'src/dashboard/App.tsx',
    """  password: string;
  productIds: string[];
  maxActiveConversations: number;""",
    """  password: string;
  routingScope: AgentRoutingScope;
  maxActiveConversations: number;""",
)
replace_once(
    'src/dashboard/App.tsx',
    """  password: '',
  productIds: [],
  maxActiveConversations: 0,""",
    """  password: '',
  routingScope: { type: 'none' },
  maxActiveConversations: 0,""",
)

replace_once(
    'src/dashboard/App.tsx',
    """type AgentScopeSummary = {
  tone: 'none' | 'section' | 'category' | 'product';
  title: string;
  detail: string;
};

function agentScopeSummary(""",
    """type AgentScopeSummary = {
  tone: 'none' | 'section' | 'category' | 'product';
  title: string;
  detail: string;
};

function productsForScope(
  scope: AgentRoutingScope,
  products: ProductCatalogItem[],
): ProductCatalogItem[] {
  if (scope.type === 'none') return [];
  if (scope.type === 'product') {
    const ids = new Set(scope.productIds);
    return products.filter((product) => product.isEnabled && ids.has(product.id));
  }
  if (scope.type === 'section') {
    return products.filter(
      (product) => product.isEnabled && product.sectionId === scope.sectionId,
    );
  }
  const categoryIds = new Set(scope.categoryIds);
  return products.filter(
    (product) =>
      product.isEnabled &&
      product.sectionId === scope.sectionId &&
      Boolean(product.categoryId) &&
      categoryIds.has(product.categoryId as string),
  );
}

function scopeProductCount(
  scope: AgentRoutingScope,
  products: ProductCatalogItem[],
): number {
  return productsForScope(scope, products).length;
}

function agentScopeSummary(""",
)

replace_once(
    'src/dashboard/App.tsx',
    """      detail: `动态覆盖 ${agent.productIds.length} 个产品`,""",
    """      detail: `动态覆盖 ${scopeProductCount(scope, products)} 个产品`,""",
)
replace_once(
    'src/dashboard/App.tsx',
    """      detail: `${visible}${remainder ? ` 等 ${names.length} 个分类` : ''} · 动态覆盖 ${agent.productIds.length} 个产品`,""",
    """      detail: `${visible}${remainder ? ` 等 ${names.length} 个分类` : ''} · 动态覆盖 ${scopeProductCount(scope, products)} 个产品`,""",
)

replace_once(
    'src/dashboard/App.tsx',
    """  const assignedProductCount = new Set(
    agents.flatMap((agent) => agent.productIds),
  ).size;""",
    """  const assignedProductCount = new Set(
    agents.flatMap((agent) =>
      productsForScope(agent.routingScope, products).map((product) => product.id),
    ),
  ).size;""",
)
replace_once(
    'src/dashboard/App.tsx',
    """      password: '',
      productIds: agent.productIds,
      maxActiveConversations: agent.maxActiveConversations,""",
    """      password: '',
      routingScope: agent.routingScope,
      maxActiveConversations: agent.maxActiveConversations,""",
)
replace_once(
    'src/dashboard/App.tsx',
    """          password: draft.password || undefined,
          productIds: draft.productIds,
          maxActiveConversations: draft.maxActiveConversations,""",
    """          password: draft.password || undefined,
          routingScope: draft.routingScope,
          maxActiveConversations: draft.maxActiveConversations,""",
)
replace_once(
    'src/dashboard/App.tsx',
    """          password: draft.password,
          productIds: draft.productIds,
          maxActiveConversations: draft.maxActiveConversations,""",
    """          password: draft.password,
          routingScope: draft.routingScope,
          maxActiveConversations: draft.maxActiveConversations,""",
)
replace_once(
    'src/dashboard/App.tsx',
    """              <ProductAssignmentPicker
                products={products}
                selectedIds={draft.productIds}
                disabled={saving}
                onChange={(productIds) => setDraft({ ...draft, productIds })}
              />""",
    """              <ProductAssignmentPicker
                products={products}
                scope={draft.routingScope}
                disabled={saving}
                onChange={(routingScope) => setDraft({ ...draft, routingScope })}
              />""",
)

write(
    'test/scope-native-dashboard-contract.test.mjs',
    """import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('admin dashboard stores and submits routing scopes without expanded product arrays', () => {
  const api = source('../src/dashboard/api.ts');
  const picker = source('../src/dashboard/ProductAssignmentPicker.tsx');
  const app = source('../src/dashboard/App.tsx');

  assert.ok(!api.includes('attachProductSelectionScope'));
  assert.ok(!api.includes('getProductSelectionScope'));
  assert.ok(!api.includes('expandRoutingScopeProductIds'));
  assert.ok(!api.includes('scopeForRequest'));
  assert.ok(api.includes('routingScope: AgentRoutingScope'));
  assert.ok(api.includes('body: JSON.stringify(input)'));

  assert.ok(picker.includes('scope: AgentRoutingScope'));
  assert.ok(picker.includes('onChange: (scope: AgentRoutingScope) => void'));
  assert.ok(picker.includes("{ type: 'section', sectionId }"));
  assert.ok(!picker.includes('attachProductSelectionScope'));
  assert.ok(!picker.includes('.map((product) => product.id)'));

  assert.ok(app.includes('routingScope: AgentRoutingScope'));
  assert.ok(app.includes('routingScope: agent.routingScope'));
  assert.ok(app.includes('scope={draft.routingScope}'));
  assert.ok(!app.includes('productIds: draft.productIds'));
});
""",
)

print('Scope-native dashboard refactor applied.')
