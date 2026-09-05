import { useEffect, useMemo, useState } from 'react';
import type { ProductCatalogItem } from './api';
import { UiIcon } from './icons';
import { Button } from './ui';

type ExclusionReason =
  | 'disabled'
  | 'not_online'
  | 'account_unconfigured'
  | 'scope_mismatch'
  | 'daily_limit_reached'
  | 'quota_exhausted';

type DiagnosticAgent = {
  id: string;
  name: string;
  adminLabel: string;
  status: string;
  isEnabled: boolean;
  accountConfigured: boolean;
  scopeMatched: boolean;
  todayConversationCount: number;
  dailyConversationLimit: number;
  dailyLimitAvailable: boolean;
  trafficQuotaEnabled: boolean;
  trafficQuotaTotal: number;
  trafficQuotaUsed: number;
  quotaAvailable: boolean;
  eligible: boolean;
  exclusionReasons: ExclusionReason[];
  nextRoundRobin: boolean;
};

type RoutingDiagnostics = {
  siteId: string;
  product: {
    id: string;
    title: string;
    sectionId: string | null;
    categoryId: string | null;
  };
  businessDate: string;
  cursor: { lastAgentId: string | null; nextAgentId: string | null };
  funnel: {
    total: number;
    enabled: number;
    online: number;
    accountConfigured: number;
    scopeMatched: number;
    dailyLimitAvailable: number;
    quotaAvailable: number;
    eligible: number;
  };
  agents: DiagnosticAgent[];
};

type AdminRoutingDiagnoseTriggerProps = {
  onOpen: () => void;
};

type AdminRoutingDiagnoseDockProps = {
  products: ProductCatalogItem[];
  open: boolean;
  onClose: () => void;
};

const reasonLabels: Record<ExclusionReason, string> = {
  disabled: '已停用',
  not_online: '当前不在线',
  account_unconfigured: '账号未配置',
  scope_mismatch: '不在产品服务范围',
  daily_limit_reached: '今日已达上限',
  quota_exhausted: '咨询额度已用尽',
};

export function AdminRoutingDiagnoseTrigger({
  onOpen,
}: AdminRoutingDiagnoseTriggerProps) {
  return (
    <div className="routing-diagnose-trigger">
      <Button type="button" variant="secondary" onClick={onOpen}>
        分流诊断
      </Button>
    </div>
  );
}

export function AdminRoutingDiagnoseDock({
  products,
  open,
  onClose,
}: AdminRoutingDiagnoseDockProps) {
  const [productId, setProductId] = useState('');
  const [diagnostics, setDiagnostics] = useState<RoutingDiagnostics | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const enabledProducts = useMemo(
    () => products.filter((product) => product.isEnabled),
    [products],
  );

  useEffect(() => {
    if (productId || !enabledProducts[0]) return;
    setProductId(enabledProducts[0].id);
  }, [enabledProducts, productId]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !productId) return;
    let active = true;
    setLoading(true);
    setError('');
    void fetchDiagnostics(productId)
      .then((result) => {
        if (active) setDiagnostics(result);
      })
      .catch(() => {
        if (active) setError('分流诊断加载失败，请稍后重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, productId]);

  if (!open) return null;

  function refreshDiagnostics() {
    if (!productId || loading) return;
    setLoading(true);
    setError('');
    void fetchDiagnostics(productId)
      .then(setDiagnostics)
      .catch(() => setError('分流诊断加载失败，请稍后重试。'))
      .finally(() => setLoading(false));
  }

  return (
    <div className="routing-diagnose-layer" role="presentation">
      <button
        type="button"
        className="routing-diagnose-backdrop"
        aria-label="关闭分流诊断"
        onClick={onClose}
      />
      <section
        className="routing-diagnose-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="routing-diagnose-title"
      >
        <header className="routing-diagnose-head">
          <div className="routing-diagnose-title">
            <strong id="routing-diagnose-title">分流诊断</strong>
            <span>只读检查当前产品的严格轮询资格</span>
          </div>
          <label className="routing-diagnose-product">
            <span>诊断产品</span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              disabled={loading && enabledProducts.length === 0}
            >
              {enabledProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!productId || loading}
            onClick={refreshDiagnostics}
          >
            刷新
          </Button>
          <button
            type="button"
            className="routing-diagnose-close"
            aria-label="关闭"
            onClick={onClose}
          >
            <UiIcon name="close" />
          </button>
        </header>

        <div className="routing-diagnose-body">
          {error ? <div className="routing-diagnose-error">{error}</div> : null}
          {loading && !diagnostics ? (
            <div className="routing-diagnose-empty">正在检查分流资格…</div>
          ) : null}

          {diagnostics ? (
            <>
              <section
                className="routing-diagnose-context"
                aria-label="诊断上下文"
              >
                <ContextItem label="业务日期" value={diagnostics.businessDate} />
                <ContextItem
                  label="当前产品"
                  value={diagnostics.product.title}
                  wide
                />
                <ContextItem
                  label="可分配客服"
                  value={`${diagnostics.funnel.eligible} / ${diagnostics.funnel.total} 总数`}
                />
                <CursorItem label="上一棒" value={diagnostics.cursor.lastAgentId} />
                <CursorItem label="下一棒" value={diagnostics.cursor.nextAgentId} />
              </section>

              <section
                className="routing-diagnose-funnel"
                aria-label="资格漏斗"
              >
                {[
                  ['总客服', diagnostics.funnel.total],
                  ['已启用', diagnostics.funnel.enabled],
                  ['Online', diagnostics.funnel.online],
                  ['账号可用', diagnostics.funnel.accountConfigured],
                  ['范围匹配', diagnostics.funnel.scopeMatched],
                  ['今日未满', diagnostics.funnel.dailyLimitAvailable],
                  ['额度可用', diagnostics.funnel.quotaAvailable],
                  ['最终可分配', diagnostics.funnel.eligible],
                ].map(([label, value], index, items) => (
                  <div
                    key={String(label)}
                    className={index === items.length - 1 ? 'is-final' : ''}
                  >
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </section>

              <section className="routing-diagnose-agents">
                <div className="routing-diagnose-section-title">
                  <div>
                    <strong>客服资格明细</strong>
                    <span>按当前产品即时计算</span>
                  </div>
                  <span
                    className={
                      diagnostics.funnel.eligible > 0
                        ? 'routing-diagnose-health is-ok'
                        : 'routing-diagnose-health is-blocked'
                    }
                  >
                    {diagnostics.funnel.eligible > 0
                      ? `${diagnostics.funnel.eligible} 位可分配`
                      : '当前无可分配客服'}
                  </span>
                </div>
                <div className="routing-diagnose-table-wrap">
                  <table className="routing-diagnose-table">
                    <thead>
                      <tr>
                        <th>客服</th>
                        <th>在线状态</th>
                        <th>今日接待 / 上限</th>
                        <th>额度剩余</th>
                        <th>范围匹配</th>
                        <th>资格结果</th>
                        <th>原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.agents.map((agent) => (
                        <tr
                          key={agent.id}
                          className={`${agent.eligible ? 'is-eligible' : 'is-excluded'} ${
                            agent.nextRoundRobin ? 'is-next' : ''
                          }`}
                        >
                          <td>
                            <div className="routing-diagnose-agent-name">
                              <span aria-hidden="true">{initials(agent)}</span>
                              <div>
                                <strong>{agent.adminLabel || agent.name}</strong>
                                <small>{agent.name}</small>
                              </div>
                              {agent.nextRoundRobin ? <b>下一棒</b> : null}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`routing-diagnose-online ${
                                agent.status === 'online' ? 'is-online' : ''
                              }`}
                            >
                              {agent.status === 'online' ? 'Online' : 'Offline'}
                            </span>
                          </td>
                          <td className="routing-diagnose-number">
                            {agent.todayConversationCount} /{' '}
                            {agent.dailyConversationLimit > 0
                              ? agent.dailyConversationLimit
                              : '不限'}
                          </td>
                          <td className="routing-diagnose-number">
                            {agent.trafficQuotaEnabled
                              ? Math.max(
                                  0,
                                  agent.trafficQuotaTotal - agent.trafficQuotaUsed,
                                )
                              : '不限'}
                          </td>
                          <td>
                            <span
                              className={`routing-diagnose-check ${
                                agent.scopeMatched ? 'is-ok' : 'is-no'
                              }`}
                            >
                              {agent.scopeMatched ? '匹配' : '不匹配'}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`routing-diagnose-result ${
                                agent.eligible ? 'is-ok' : 'is-no'
                              }`}
                            >
                              {agent.eligible ? '可分配' : '不可分配'}
                            </span>
                          </td>
                          <td>
                            <span className="routing-diagnose-reason">
                              {agent.exclusionReasons.length > 0
                                ? agent.exclusionReasons
                                    .map((reason) => reasonLabels[reason])
                                    .join(' · ')
                                : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </div>

        <footer className="routing-diagnose-foot">
          <span>只读诊断，不会修改客服状态、额度或轮询游标。</span>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </footer>
      </section>
    </div>
  );
}

function ContextItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'is-wide' : ''}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CursorItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="routing-diagnose-cursor-item">
      <span>{label}</span>
      <strong title={value ?? undefined}>{value ? compactId(value) : '暂无'}</strong>
      {value ? (
        <button
          type="button"
          aria-label={`复制${label}`}
          onClick={() => void navigator.clipboard?.writeText(value)}
        >
          复制
        </button>
      ) : null}
    </div>
  );
}

function compactId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function initials(agent: DiagnosticAgent): string {
  const source = agent.adminLabel || agent.name;
  return source.trim().slice(0, 2).toUpperCase() || '客';
}

async function fetchDiagnostics(
  productId: string,
): Promise<RoutingDiagnostics> {
  const response = await fetch(
    `/api/admin/routing-diagnose?productId=${encodeURIComponent(productId)}`,
    { credentials: 'same-origin' },
  );
  const payload = (await response.json()) as {
    diagnostics?: RoutingDiagnostics;
    error?: string;
  };
  if (!response.ok || !payload.diagnostics) {
    throw new Error(payload.error ?? `HTTP_${response.status}`);
  }
  return payload.diagnostics;
}
