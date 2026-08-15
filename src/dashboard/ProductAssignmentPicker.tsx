import { useEffect, useMemo, useState } from 'react';
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
      if (product.sectionId !== categorySectionId || !product.categoryId)
        continue;
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
      if (product.sectionId !== filterSectionId || !product.categoryId)
        continue;
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

  const selectedSectionIds = useMemo(
    () => new Set(scope.type === 'section' ? scope.sectionIds : []),
    [scope],
  );
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
        if (filterSectionId && product.sectionId !== filterSectionId)
          return false;
        if (filterCategoryId && product.categoryId !== filterCategoryId)
          return false;
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

  const sectionProductCount = useMemo(
    () =>
      enabledProducts.filter(
        (product) =>
          Boolean(product.sectionId) &&
          selectedSectionIds.has(product.sectionId as string),
      ).length,
    [enabledProducts, selectedSectionIds],
  );
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
        scope.type === 'section'
          ? (scope.sectionIds[0] ?? '')
          : scope.type === 'category'
            ? scope.sectionId
            : '',
      );
    }
    if (nextMode === 'product') {
      setFilterSectionId(
        scope.type === 'section'
          ? (scope.sectionIds[0] ?? '')
          : scope.type === 'category'
            ? scope.sectionId
            : '',
      );
      setFilterCategoryId('');
      setQuery('');
    }
    setMode(nextMode);
    onChange({ type: 'none' });
  }

  function toggleSection(sectionId: string, checked: boolean) {
    const next = new Set(selectedSectionIds);
    if (checked) next.add(sectionId);
    else next.delete(sectionId);
    const sectionIds = [...next];
    onChange(
      sectionIds.length ? { type: 'section', sectionIds } : { type: 'none' },
    );
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
    onChange(
      productIds.length ? { type: 'product', productIds } : { type: 'none' },
    );
  }

  if (products.length === 0) {
    return (
      <fieldset>
        <legend>负责范围</legend>
        <div className="product-assignment-empty">
          <strong>还没有同步产品目录</strong>
          <span>
            回到 Site 后台重新验证客服系统，产品目录会自动同步到这里。
          </span>
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
          <div className="product-assignment-panel-head">
            <div>
              <strong>选择负责分区</strong>
              <span>可同时选择多个分区</span>
            </div>
            <span className="selection-count">
              已选 {selectedSectionIds.size} 个
            </span>
          </div>
          <div className="product-assignment-sections">
            {sections.map((section) => (
              <label key={section.id} className="product-assignment-section">
                <input
                  type="checkbox"
                  checked={selectedSectionIds.has(section.id)}
                  disabled={disabled}
                  onChange={(event) =>
                    toggleSection(section.id, event.target.checked)
                  }
                />
                <span>
                  <strong>{section.name}</strong>
                  <small>{section.count} 个产品</small>
                </span>
                <i aria-hidden="true">✓</i>
              </label>
            ))}
          </div>
          <div className="product-assignment-note">
            <strong>
              {selectedSectionIds.size
                ? `已选 ${selectedSectionIds.size} 个分区，当前覆盖 ${sectionProductCount} 个产品`
                : '请选择至少一个负责分区'}
            </strong>
            <span>保存的是分区规则，之后新增到这些分区的产品会自动纳入。</span>
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
                  <label
                    key={category.id}
                    className="product-assignment-category"
                  >
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
                <div
                  key={product.id}
                  className="product-assignment-selected-item"
                >
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
              <div className="product-assignment-empty compact">
                没有匹配的产品
              </div>
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
