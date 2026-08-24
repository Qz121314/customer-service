import { useEffect, useMemo, useState } from 'react';
import type { ProductCatalogItem, ProductTrafficMonthlyStats } from './api';
import { calendarMonthPeriod } from '../shared/calendar-month';

const CHART_WIDTH = 760;
const CHART_HEIGHT = 180;
const CHART_LEFT = 42;
const CHART_RIGHT = 18;
const CHART_TOP = 18;
const CHART_BOTTOM = 32;
const PRODUCTS_PER_PAGE = 4;
const DISTRIBUTION_COLORS = [
  '#5b5ce2',
  '#7c6cf2',
  '#2f9e8f',
  '#ef9b41',
  '#ec6e8b',
  '#a0a6b5',
];

type TrendPoint = {
  x: number;
  y: number;
  value: number;
  day: number;
};

type ProductTrafficItem = {
  key: string;
  productId: string | null;
  title: string;
  coverUrl: string | null;
  category: string;
  count: number;
};

function formatDecimal(value: number) {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatShare(value: number, total: number) {
  return total ? `${formatDecimal((value / total) * 100)}%` : '0.0%';
}

function buildTrendPoints(dailyValues: Array<{ day: number; value: number }>) {
  const maxValue = Math.max(1, ...dailyValues.map((item) => item.value));
  const plotWidth = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const plotHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
  const denominator = Math.max(1, dailyValues.length - 1);
  const points: TrendPoint[] = dailyValues.map((item, index) => ({
    x: CHART_LEFT + (index / denominator) * plotWidth,
    y: CHART_TOP + (1 - item.value / maxValue) * plotHeight,
    value: item.value,
    day: item.day,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const baseline = CHART_HEIGHT - CHART_BOTTOM;
  const area = points.length
    ? `${CHART_LEFT},${baseline} ${line} ${points.at(-1)?.x ?? CHART_LEFT},${baseline}`
    : '';
  return { points, line, area, maxValue };
}

export function AdminStatisticsPage({
  products,
  month,
  stats,
  busy,
  error,
  onClearError,
  onMonthChange,
}: {
  products: ProductCatalogItem[];
  month: string;
  stats: ProductTrafficMonthlyStats | null;
  busy: boolean;
  error: string;
  onClearError: () => void;
  onMonthChange: (month: string) => void;
}) {
  const [productPage, setProductPage] = useState(0);
  const days = useMemo(
    () =>
      stats?.month === month ? stats.days : calendarMonthPeriod(month).days,
    [month, stats],
  );
  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const productTraffic = useMemo(() => {
    const grouped = new Map<
      string,
      { productId: string | null; productTitle: string | null; count: number }
    >();
    for (const row of stats?.rows ?? []) {
      const key = row.productId || '__unknown__';
      const current = grouped.get(key);
      grouped.set(key, {
        productId: row.productId,
        productTitle: row.productTitle || current?.productTitle || null,
        count: (current?.count ?? 0) + row.count,
      });
    }
    return [...grouped.entries()]
      .map(([key, item]): ProductTrafficItem => {
        const catalog = item.productId ? productMap.get(item.productId) : null;
        return {
          key,
          productId: item.productId,
          title:
            catalog?.title ||
            item.productTitle ||
            (item.productId ? `产品 ${item.productId}` : '未知产品'),
          coverUrl: catalog?.coverUrl ?? null,
          category:
            catalog?.categoryName || catalog?.sectionName || '历史或未归因流量',
          count: item.count,
        };
      })
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.title.localeCompare(right.title, 'zh-CN'),
      );
  }, [productMap, stats]);
  const dailyTraffic = useMemo(() => {
    const totals = new Map<number, number>();
    for (const row of stats?.rows ?? []) {
      totals.set(row.day, (totals.get(row.day) ?? 0) + row.count);
    }
    return days.map((day) => ({ day, value: totals.get(day) ?? 0 }));
  }, [days, stats]);
  const total = productTraffic.reduce((sum, product) => sum + product.count, 0);
  const activeProducts = productTraffic.filter(
    (product) => product.productId,
  ).length;
  const unknownTraffic =
    productTraffic.find((product) => !product.productId)?.count ?? 0;
  const attributedTraffic = Math.max(0, total - unknownTraffic);
  const attributionRate = total ? (attributedTraffic / total) * 100 : 100;
  const catalogCoverage = products.length
    ? (activeProducts / products.length) * 100
    : 0;
  const leader = productTraffic[0] ?? null;
  const peak = dailyTraffic.reduce(
    (current, item) => (item.value > current.value ? item : current),
    { day: 0, value: 0 },
  );
  const chart = useMemo(() => buildTrendPoints(dailyTraffic), [dailyTraffic]);
  const pageCount = Math.max(
    1,
    Math.ceil(productTraffic.length / PRODUCTS_PER_PAGE),
  );
  const visibleProducts = productTraffic.slice(
    productPage * PRODUCTS_PER_PAGE,
    (productPage + 1) * PRODUCTS_PER_PAGE,
  );
  const distribution = useMemo(() => {
    const leading = productTraffic.slice(0, 5);
    const other = productTraffic
      .slice(5)
      .reduce((sum, item) => sum + item.count, 0);
    return other
      ? [
          ...leading,
          { ...leading[0], key: '__other__', title: '其他产品', count: other },
        ]
      : leading;
  }, [productTraffic]);
  const donutBackground = useMemo(() => {
    if (!total) return '#ececf2';
    let offset = 0;
    const stops = distribution.map((item, index) => {
      const start = offset;
      offset += (item.count / total) * 100;
      return `${DISTRIBUTION_COLORS[index]} ${start}% ${offset}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [distribution, total]);

  useEffect(() => setProductPage(0), [month, stats]);

  return (
    <section className="admin-statistics-page">
      {error && (
        <button type="button" className="notice error" onClick={onClearError}>
          {error}
        </button>
      )}
      <section
        className={`product-traffic-workspace${busy ? ' is-loading' : ''}`}
        aria-busy={busy}
      >
        <div className="product-traffic-analysis product-traffic-bento">
          <section className="product-traffic-hero">
            <div className="product-hero-head">
              <div>
                <span>TRAFFIC INTELLIGENCE</span>
                <strong>产品流量分布</strong>
              </div>
              <label>
                <span>统计月份</span>
                <input
                  type="month"
                  value={month}
                  onChange={(event) => onMonthChange(event.target.value)}
                />
              </label>
            </div>
            <div className="product-hero-metric">
              <strong>{busy ? '—' : total}</strong>
              <div>
                <span>本月有效会话</span>
                <small>
                  日均 {formatDecimal(days.length ? total / days.length : 0)} 次
                </small>
              </div>
            </div>
            <div className="product-hero-bars" aria-hidden="true">
              {[32, 46, 38, 64, 52, 78, 60, 92, 70, 84].map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          </section>

          <article className="product-kpi-card is-products">
            <span className="product-kpi-label">有流量产品</span>
            <strong>{busy ? '—' : activeProducts}</strong>
            <small>{products.length} 个在册产品</small>
            <div className="product-kpi-meter">
              <i style={{ width: `${Math.min(100, catalogCoverage)}%` }} />
            </div>
          </article>

          <article className="product-kpi-card is-leader">
            <span className="product-kpi-label">本月流量冠军</span>
            <strong className="is-name" title={leader?.title ?? ''}>
              {busy ? '—' : (leader?.title ?? '暂无产品')}
            </strong>
            <small>
              {leader
                ? `${leader.count} 次 · ${formatShare(leader.count, total)}`
                : '等待首次有效咨询'}
            </small>
          </article>

          <article className="product-kpi-card is-unattributed">
            <span className="product-kpi-label">未归因</span>
            <strong>{busy ? '—' : unknownTraffic}</strong>
            <small>{unknownTraffic ? '历史数据待识别' : '归因数据完整'}</small>
          </article>

          <section className="product-distribution-card">
            <header>
              <div>
                <span>DISTRIBUTION</span>
                <strong>产品贡献占比</strong>
              </div>
              <small>首次有效接待</small>
            </header>
            <div className="product-distribution-body">
              <div
                className="product-distribution-donut"
                style={{ background: donutBackground }}
              >
                <div>
                  <strong>{busy ? '—' : total}</strong>
                  <span>有效会话</span>
                </div>
              </div>
              <div className="product-distribution-legend">
                {distribution.length ? (
                  distribution.map((item, index) => (
                    <div key={item.key}>
                      <i style={{ background: DISTRIBUTION_COLORS[index] }} />
                      <span title={item.title}>{item.title}</span>
                      <strong>{formatShare(item.count, total)}</strong>
                    </div>
                  ))
                ) : (
                  <div className="product-card-empty">
                    <span>暂无产品流量</span>
                    <strong>—</strong>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="product-ranking-card">
            <header>
              <div>
                <span>TOP PRODUCTS</span>
                <strong>有效咨询贡献</strong>
              </div>
              <div className="product-ranking-pagination">
                <button
                  type="button"
                  aria-label="上一页产品"
                  disabled={productPage === 0}
                  onClick={() => setProductPage((value) => value - 1)}
                >
                  ‹
                </button>
                <span>
                  {Math.min(productPage + 1, pageCount)} / {pageCount}
                </span>
                <button
                  type="button"
                  aria-label="下一页产品"
                  disabled={productPage >= pageCount - 1}
                  onClick={() => setProductPage((value) => value + 1)}
                >
                  ›
                </button>
              </div>
            </header>
            <div className="product-ranking-list">
              {visibleProducts.length ? (
                visibleProducts.map((product, index) => (
                  <div className="product-ranking-row" key={product.key}>
                    <span className="product-rank-number">
                      {String(
                        productPage * PRODUCTS_PER_PAGE + index + 1,
                      ).padStart(2, '0')}
                    </span>
                    {product.coverUrl ? (
                      <img src={product.coverUrl} alt="" />
                    ) : (
                      <span className="product-cover-fallback">
                        {product.title.slice(0, 1)}
                      </span>
                    )}
                    <div className="product-rank-copy">
                      <strong title={product.title}>{product.title}</strong>
                      <small>{product.category}</small>
                    </div>
                    <div className="product-rank-meter">
                      <i
                        style={{
                          width: `${leader ? (product.count / leader.count) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="product-rank-value">
                      <strong>{product.count}</strong>
                      <small>{formatShare(product.count, total)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="product-ranking-empty">
                  <span>本月暂无产品咨询</span>
                  <small>产生首次有效接待后将在这里形成排行</small>
                </div>
              )}
            </div>
          </section>

          <section className="product-trend-card">
            <header>
              <div>
                <span>DAILY MOMENTUM</span>
                <strong>每日有效会话</strong>
              </div>
              <small>
                {peak.value
                  ? `${peak.day} 日最高 · ${peak.value} 次`
                  : '本月暂无峰值'}
              </small>
            </header>
            <div className="product-trend-chart">
              <svg
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label={`${month} 每日产品有效会话趋势`}
              >
                {[0, 0.5, 1].map((ratio) => {
                  const y =
                    CHART_TOP +
                    ratio * (CHART_HEIGHT - CHART_TOP - CHART_BOTTOM);
                  return (
                    <line
                      key={ratio}
                      x1={CHART_LEFT}
                      x2={CHART_WIDTH - CHART_RIGHT}
                      y1={y}
                      y2={y}
                      className="product-chart-grid"
                    />
                  );
                })}
                {chart.area && (
                  <polygon points={chart.area} className="product-chart-area" />
                )}
                {chart.line && (
                  <polyline
                    points={chart.line}
                    className="product-chart-line"
                  />
                )}
                {chart.points
                  .filter((point) => point.value > 0)
                  .map((point) => (
                    <circle
                      key={point.day}
                      cx={point.x}
                      cy={point.y}
                      r="3.5"
                      className="product-chart-point"
                    >
                      <title>
                        {point.day} 日：{point.value} 次
                      </title>
                    </circle>
                  ))}
                {[1, 6, 11, 16, 21, 26, days.length]
                  .filter(
                    (day, index, values) =>
                      days.includes(day) && values.indexOf(day) === index,
                  )
                  .map((day) => {
                    const point = chart.points[day - 1];
                    return point ? (
                      <text
                        key={day}
                        x={point.x}
                        y={CHART_HEIGHT - 8}
                        textAnchor="middle"
                      >
                        {day}日
                      </text>
                    ) : null;
                  })}
              </svg>
            </div>
          </section>

          <aside className="product-quality-card">
            <div className="product-quality-head">
              <span>ATTRIBUTION</span>
              <small>数据质量</small>
            </div>
            <div className="product-quality-score">
              <strong>
                {busy ? '—' : `${formatDecimal(attributionRate)}%`}
              </strong>
              <span>产品归因率</span>
            </div>
            <div className="product-quality-meter">
              <i style={{ width: `${attributionRate}%` }} />
            </div>
            <dl>
              <div>
                <dt>已归因会话</dt>
                <dd>{busy ? '—' : attributedTraffic}</dd>
              </div>
              <div>
                <dt>单日峰值</dt>
                <dd>{busy ? '—' : peak.value}</dd>
              </div>
            </dl>
          </aside>
        </div>
        <footer className="product-traffic-foot">
          统计保留范围从 {stats?.retainedFrom ?? '—'} 起 ·
          产品名称按首次接待时快照归档
        </footer>
      </section>
    </section>
  );
}
