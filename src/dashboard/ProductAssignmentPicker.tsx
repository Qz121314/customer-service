import { useMemo, useState } from 'react';
import type { ProductCatalogItem } from './api';

type Props = {
  products: ProductCatalogItem[];
  selectedIds: string[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
};

export function ProductAssignmentPicker({
  products,
  selectedIds,
  disabled = false,
  onChange,
}: Props) {
  const [query, setQuery] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const enabledProducts = useMemo(
    () => products.filter((product) => product.isEnabled),
    [products],
  );
  const sections = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of enabledProducts) {
      if (product.sectionId) {
        map.set(product.sectionId, product.sectionName || product.sectionId);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }, [enabledProducts]);
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of enabledProducts) {
      if (
        product.categoryId &&
        (!sectionId || product.sectionId === sectionId)
      ) {
        map.set(product.categoryId, product.categoryName || product.categoryId);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }, [enabledProducts, sectionId]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProducts = useMemo(
    () =>
      enabledProducts.filter((product) => {
        if (sectionId && product.sectionId !== sectionId) return false;
        if (categoryId && product.categoryId !== categoryId) return false;
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
      }),
    [categoryId, enabledProducts, normalizedQuery, sectionId],
  );

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIds = visibleProducts.map((product) => product.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleProduct(productId: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(productId);
    else next.delete(productId);
    onChange([...next]);
  }

  function toggleVisible() {
    const next = new Set(selectedIds);
    if (allVisibleSelected) {
      for (const id of visibleIds) next.delete(id);
    } else {
      for (const id of visibleIds) next.add(id);
    }
    onChange([...next]);
  }

  if (products.length === 0) {
    return (
      <fieldset>
        <legend>负责产品</legend>
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
      <legend>负责产品</legend>
      <div className="product-assignment-toolbar">
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder="搜索产品"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={sectionId}
          disabled={disabled}
          onChange={(event) => {
            setSectionId(event.target.value);
            setCategoryId('');
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
          value={categoryId}
          disabled={disabled}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">全部分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="product-assignment-summary">
        <span>已分配 {selectedIds.length} 个产品</span>
        <button
          type="button"
          className="table-action"
          disabled={disabled || visibleIds.length === 0}
          onClick={toggleVisible}
        >
          {allVisibleSelected ? '取消当前筛选' : '全选当前筛选'}
        </button>
      </div>

      <div className="product-assignment-list">
        {visibleProducts.length === 0 ? (
          <div className="product-assignment-empty compact">没有匹配的产品</div>
        ) : (
          visibleProducts.map((product) => (
            <label key={product.id} className="product-assignment-option">
              <input
                type="checkbox"
                checked={selected.has(product.id)}
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
          ))
        )}
      </div>
    </fieldset>
  );
}
