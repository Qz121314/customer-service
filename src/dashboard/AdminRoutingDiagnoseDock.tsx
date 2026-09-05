import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getProductCatalog, type ProductCatalogItem } from './api';
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

const reasonLabels: Record<ExclusionReason, string> = {
  disabled: '已停用',
  not_online: '未 Online',
  account_unconfigured: '账号未配置',
  scope_mismatch: '负责范围不匹配',
  daily_limit_reached: '今日接待已满',
  quota_exhausted: '咨询额度已用尽',
};

export function AdminRoutingDiagnoseDock() {
  const [triggerHost, setTriggerHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [productId, setProductId] = useState('');
  const [diagnostics, setDiagnostics] = useState<RoutingDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let ownedHost: HTMLElement | null = null;

    const syncTriggerHost = () => {
      const header = document.querySelector<HTMLElement>('.admin-content-head');
      const title = header?.querySelector('h1')?.textContent?.trim();

      if (!header || title !== '客服坐席') {
        if (ownedHost?.isConnected) ownedHost.remove();
        ownedHost = null;
        setTriggerHost(null);
        return;
      }

      if (ownedHost?.isConnected && ownedHost.parentElement === header) {
        setTriggerHost(ownedHost);
        return;
      }

      ownedHost?.remove();
      const host = document.createElement('div');
      host.className = 'routing-diagnose-trigger-host';
      const addAgentButton = Array.from(header.children).find((element) =>
        element.textContent?.includes('新增客服'),
      );
      header.insertBefore(host, addAgentButton ?? null);
      ownedHost = host;
      setTriggerHost(host);
    };

    syncTriggerHost();
    const observer = new MutationObserver(syncTriggerHost);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      ownedHost?.remove();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!open || products.length > 0) return;
    let active = true;
    setLoading(true);
    setError('');
    getProductCatalog()
      .then((items) => {
        if (!active) return;
        const enabled = items.filter((item) => item.isEnabled);
        setProducts(enabled);
        if (!productId && enabled[0]) setProductId(enabled[0].id);
      })
      .catch(() => {
        if (active) setError('无法加载产品目录，请重新登录后台后重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, productId, products.length]);

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

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId) ?? null,
    [productId, products],
  );

  return (
    <>
      {triggerHost
        ? createPortal(
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(true)}
            >
              分流诊断
            </Button>,
            triggerHost,
          )
        : null}

      {open ? (
        <div className="routing-diagnose-layer" role="presentation">
          <button
            type="button"
            className="routing-diagnose-backdrop"
            aria-label="关闭分流诊断"
            onClick={() => setOpen(false)}
          />
          <section
            className="routing-diagnose-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="routing-diagnose-title"
          >
            <header className="routing-diagnose-head">
              <div>
                <strong id="routing-diagnose-title">分流诊断</strong>
                <span>只读检查当前产品的严格轮询资格</span>
              </div>
              <button
                type="button"
                className="routing-diagnose-close"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <UiIcon name="close" />
              </button>
            </header>

            <div className="routing-diagnose-body">
              <label className="routing-diagnose-product">
                <span>诊断产品</span>
                <select
                  value={productId}
                  onChange={(event) => setProductId(event.target.value)}
                  disabled={loading && products.length === 0}
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title}
                    </option>
                  ))}
                </select>
              </label>

              {error ? (
                <div className="routing-diagnose-error">{error}</div>
              ) : null}
              {loading && !diagnostics ? (
                <div className="routing-diagnose-empty">正在检查分流资格…</div>
              ) : null}

              {diagnostics ? (
                <>
                  <section className="routing-diagnose-summary">
                    <div className="routing-diagnose-product-title">
                      <div>
                        <strong>
                          {selectedProduct?.title ?? diagnostics.product.title}
                        </strong>
                        <span>业务日期 {diagnostics.businessDate}</span>
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

                    <div className="routing-diagnose-cursor">
                      <div>
                        <span>上一棒</span>
                        <strong>
                          {diagnostics.cursor.lastAgentId ?? '暂无'}
                        </strong>
                      </div>
                      <div>
                        <span>下一棒</span>
                        <strong>{diagnostics.cursor.nextAgentId ?? '无'}</strong>
                      </div>
                    </div>
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
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <strong>{value}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                  </section>

                  <section className="routing-diagnose-agents">
                    <div className="routing-diagnose-section-title">
                      <strong>客服资格明细</strong>
                      <span>按当前产品即时计算</span>
                    </div>
                    <div className="routing-diagnose-agent-list">
                      {diagnostics.agents.map((agent) => (
                        <article
                          key={agent.id}
                          className={`routing-diagnose-agent ${
                            agent.eligible ? 'is-eligible' : 'is-excluded'
                          } ${agent.nextRoundRobin ? 'is-next' : ''}`}
                        >
                          <div className="routing-diagnose-agent-main">
                            <div>
                              <strong>{agent.adminLabel || agent.name}</strong>
                              <span>{agent.name}</span>
                            </div>
                            <div className="routing-diagnose-agent-state">
                              {agent.nextRoundRobin ? <b>下一棒</b> : null}
                              <span>{agent.eligible ? '可分配' : '已排除'}</span>
                            </div>
                          </div>

                          <div className="routing-diagnose-agent-meta">
                            <span>
                              {agent.status === 'online'
                                ? 'Online'
                                : agent.status}
                            </span>
                            <span>
                              今日 {agent.todayConversationCount}
                              {agent.dailyConversationLimit > 0
                                ? ` / ${agent.dailyConversationLimit}`
                                : ' / 不限'}
                            </span>
                            <span>
                              额度{' '}
                              {agent.trafficQuotaEnabled
                                ? `${Math.max(
                                    0,
                                    agent.trafficQuotaTotal -
                                      agent.trafficQuotaUsed,
                                  )} 剩余`
                                : '不限'}
                            </span>
                          </div>

                          {agent.exclusionReasons.length > 0 ? (
                            <div className="routing-diagnose-reasons">
                              {agent.exclusionReasons.map((reason) => (
                                <span key={reason}>{reasonLabels[reason]}</span>
                              ))}
                            </div>
                          ) : (
                            <div className="routing-diagnose-reasons is-clear">
                              <span>所有资格条件通过</span>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}
            </div>

            <footer className="routing-diagnose-foot">
              <span>诊断不会修改客服状态、额度或轮询游标。</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!productId) return;
                  setDiagnostics(null);
                  setLoading(true);
                  setError('');
                  void fetchDiagnostics(productId)
                    .then(setDiagnostics)
                    .catch(() => setError('分流诊断加载失败，请稍后重试。'))
                    .finally(() => setLoading(false));
                }}
              >
                刷新
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

async function fetchDiagnostics(productId: string): Promise<RoutingDiagnostics> {
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
