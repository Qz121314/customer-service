import type { FormEvent } from 'react';
import type {
  AgentQuotaAdjustment,
  AgentQuotaLedger,
  ProductCatalogItem,
} from './api';
import type { AgentDraft } from './dashboard-runtime';
import { initials, relativeTime } from './dashboard-runtime';
import { ProductAssignmentPicker } from './ProductAssignmentPicker';

export function AgentEditorModal({
  draft,
  products,
  saving,
  quotaAdjustments,
  quotaLedger,
  quotaHistoryBusy,
  onDraftChange,
  onClose,
  onSubmit,
}: {
  draft: AgentDraft;
  products: ProductCatalogItem[];
  saving: boolean;
  quotaAdjustments: AgentQuotaAdjustment[];
  quotaLedger: AgentQuotaLedger | null;
  quotaHistoryBusy: boolean;
  onDraftChange: (draft: AgentDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const identityName = draft.name.trim() || '新客服';
  const identityUsername = draft.username.trim() || '登录账号';

  return (
    <div className="modal-backdrop" onMouseDown={() => !saving && onClose()}>
      <section
        className="agent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="agent-editor-header">
          <div className="agent-editor-title-block">
            <span className="agent-editor-kicker">客服配置</span>
            <div>
              <h2 id="agent-editor-title">
                {draft.id ? '编辑客服账号' : '新增客服账号'}
              </h2>
              <p>
                {draft.id
                  ? `${identityName} · @${identityUsername}`
                  : '建立登录身份，并配置接待规则与分流范围'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="关闭"
            onClick={() => !saving && onClose()}
          >
            ×
          </button>
        </header>

        <form className="agent-editor-form" onSubmit={onSubmit}>
          <div className="agent-editor-layout">
            <section className="agent-editor-account-pane agent-editor-workspace-card">
              <div className="agent-editor-pane-heading">
                <div>
                  <strong>账号与接待</strong>
                  <small>登录身份、接待上限、账号状态与额度控制</small>
                </div>
              </div>

              <div className="agent-editor-account-grid">
                <div className="agent-editor-identity-preview">
                  <span>{initials(draft.name || '客服')}</span>
                  <div>
                    <strong>{identityName}</strong>
                    <small>@{identityUsername}</small>
                  </div>
                  <em
                    className={draft.isEnabled ? 'is-enabled' : 'is-disabled'}
                  >
                    {draft.isEnabled ? '启用' : '停用'}
                  </em>
                </div>

                <label className="agent-editor-field">
                  <span>显示名称</span>
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      onDraftChange({ ...draft, name: event.target.value })
                    }
                    placeholder="例如 Amy"
                    autoFocus
                  />
                </label>

                <label className="agent-editor-field">
                  <span>登录账号</span>
                  <input
                    value={draft.username}
                    onChange={(event) =>
                      onDraftChange({ ...draft, username: event.target.value })
                    }
                    placeholder="例如 amy01"
                    autoComplete="off"
                  />
                </label>

                <label className="agent-editor-field">
                  <span>{draft.id ? '重置登录密码' : '登录密码'}</span>
                  <input
                    type="password"
                    value={draft.password}
                    onChange={(event) =>
                      onDraftChange({ ...draft, password: event.target.value })
                    }
                    placeholder={
                      draft.id ? '留空表示不修改密码' : '至少 4 个字符'
                    }
                    autoComplete="new-password"
                  />
                </label>
              </div>

              <section className="agent-editor-subsection agent-editor-policy-section">
                <div className="agent-editor-subsection-head">
                  <div>
                    <strong>接待规则</strong>
                    <small>限制坐席负载，0 表示不限制</small>
                  </div>
                </div>

                <div className="agent-editor-policy-grid">
                  <label className="agent-editor-limit-card">
                    <span>同时会话</span>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="999"
                        value={draft.maxActiveConversations}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            maxActiveConversations:
                              Number(event.target.value) || 0,
                          })
                        }
                      />
                      <small>0 = 不限</small>
                    </div>
                  </label>

                  <label className="agent-editor-limit-card">
                    <span>每日接待</span>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="9999"
                        value={draft.dailyConversationLimit}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            dailyConversationLimit:
                              Number(event.target.value) || 0,
                          })
                        }
                      />
                      <small>次日恢复</small>
                    </div>
                  </label>

                  <div className="agent-editor-status-card">
                    <span>
                      <strong>启用客服账号</strong>
                      <small>允许登录并参与新会话分流</small>
                    </span>
                    <label className="switch-control" aria-label="启用客服账号">
                      <input
                        type="checkbox"
                        checked={draft.isEnabled}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            isEnabled: event.target.checked,
                          })
                        }
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>
                </div>
              </section>

              <section className="traffic-quota-editor agent-editor-quota-workspace">
                <div className="traffic-quota-editor-head">
                  <div>
                    <strong>咨询额度</strong>
                    <small>累计购买额度；每个会话首次有效接待只扣 1 次</small>
                  </div>
                  <label className="switch-control" aria-label="启用咨询额度">
                    <input
                      type="checkbox"
                      checked={draft.trafficQuotaEnabled}
                      onChange={(event) =>
                        onDraftChange({
                          ...draft,
                          trafficQuotaEnabled: event.target.checked,
                        })
                      }
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>

                <div className="traffic-quota-summary">
                  <div>
                    <span>保存后累计额度</span>
                    <strong>
                      {draft.trafficQuotaTotal + draft.trafficQuotaTopUp}
                    </strong>
                  </div>
                  <div>
                    <span>已使用额度</span>
                    <strong>{draft.trafficQuotaUsed}</strong>
                  </div>
                  <div>
                    <span>保存后剩余</span>
                    <strong>
                      {Math.max(
                        0,
                        draft.trafficQuotaTotal +
                          draft.trafficQuotaTopUp -
                          draft.trafficQuotaUsed,
                      )}
                    </strong>
                  </div>
                </div>

                <div className="traffic-quota-topup">
                  <span>{draft.id ? '本次追加' : '初始额度'}</span>
                  <div className="traffic-quota-presets">
                    {[100, 500, 1000].map((amount) => (
                      <button
                        type="button"
                        key={amount}
                        className={
                          draft.trafficQuotaTopUp === amount ? 'is-active' : ''
                        }
                        onClick={() =>
                          onDraftChange({ ...draft, trafficQuotaTopUp: amount })
                        }
                      >
                        +{amount}
                      </button>
                    ))}
                    <label>
                      <span>自定义</span>
                      <input
                        type="number"
                        min="0"
                        max="1000000"
                        step="1"
                        value={draft.trafficQuotaTopUp}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            trafficQuotaTopUp: Math.max(
                              0,
                              Math.min(
                                1_000_000,
                                Math.trunc(Number(event.target.value) || 0),
                              ),
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>

                <p className="agent-editor-quota-note">
                  每日接待上限按天重置；咨询额度是累计总量。转接、重新排队和恢复同一会话不会重复扣减。
                </p>

                {draft.id ? (
                  <div className="traffic-quota-history">
                    <div className="traffic-quota-history-head">
                      <strong>额度账本</strong>
                      <span
                        className={
                          quotaLedger?.consistent
                            ? 'is-ok'
                            : quotaLedger
                              ? 'is-warning'
                              : undefined
                        }
                      >
                        {quotaHistoryBusy
                          ? '正在核对'
                          : quotaLedger?.consistent
                            ? '账本已核对'
                            : quotaLedger
                              ? '账本需检查'
                              : '进入编辑时读取'}
                      </span>
                    </div>
                    {quotaHistoryBusy ? (
                      <p>正在读取…</p>
                    ) : quotaLedger && !quotaLedger.consistent ? (
                      <div className="traffic-quota-history-list">
                        <div className="traffic-quota-history-row quota-ledger-warning">
                          <strong>核对异常</strong>
                          <span>
                            总额 {quotaLedger.total}/{quotaLedger.expectedTotal}{' '}
                            · 已用 {quotaLedger.used}/{quotaLedger.expectedUsed}
                          </span>
                          <time>请检查</time>
                        </div>
                      </div>
                    ) : quotaAdjustments.length ? (
                      <div className="traffic-quota-history-list">
                        {quotaAdjustments.map((adjustment) => (
                          <div
                            className="traffic-quota-history-row"
                            key={adjustment.id}
                          >
                            <strong>+{adjustment.amount}</strong>
                            <span>
                              {adjustment.quotaTotalBefore} →{' '}
                              {adjustment.quotaTotalAfter}
                            </span>
                            <time>
                              {relativeTime(
                                adjustment.appliedAt ?? adjustment.createdAt,
                              )}
                            </time>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>账本正常，暂无追加记录</p>
                    )}
                  </div>
                ) : null}
              </section>
            </section>

            <section className="agent-editor-routing-pane agent-editor-workspace-card">
              <div className="agent-editor-pane-heading">
                <div>
                  <strong>分流负责范围</strong>
                  <small>按分区、分类或指定产品建立负责规则</small>
                </div>
              </div>
              <ProductAssignmentPicker
                products={products}
                scope={draft.routingScope}
                disabled={saving}
                onChange={(routingScope) =>
                  onDraftChange({ ...draft, routingScope })
                }
              />
            </section>
          </div>

          <footer>
            <span className="agent-editor-save-note">
              保存后，新规则会立即用于后续会话分流
            </span>
            <div className="agent-editor-footer-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={saving}
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="primary-button"
                disabled={
                  saving || !draft.name.trim() || !draft.username.trim()
                }
              >
                {saving ? '保存中…' : draft.id ? '保存修改' : '创建客服'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
