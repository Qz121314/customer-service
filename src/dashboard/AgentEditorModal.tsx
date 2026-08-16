import type { FormEvent } from 'react';
import type { AgentQuotaAdjustment, ProductCatalogItem } from './api';
import type { AgentDraft } from './dashboard-runtime';
import { initials, relativeTime } from './dashboard-runtime';
import { ProductAssignmentPicker } from './ProductAssignmentPicker';

export function AgentEditorModal({
  draft,
  products,
  saving,
  quotaAdjustments,
  quotaHistoryBusy,
  onDraftChange,
  onClose,
  onSubmit,
}: {
  draft: AgentDraft;
  products: ProductCatalogItem[];
  saving: boolean;
  quotaAdjustments: AgentQuotaAdjustment[];
  quotaHistoryBusy: boolean;
  onDraftChange: (draft: AgentDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={() => !saving && onClose()}>
      <section
        className="agent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="agent-editor-title">
              {draft.id ? '编辑客服账号' : '新增客服账号'}
            </h2>
            <p>账号、接待规则、额度与分流范围在一个工作台内完成配置。</p>
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
            <aside className="agent-editor-account-pane">
              <div className="agent-editor-pane-heading">
                <span>01</span>
                <div>
                  <strong>账号与接待配置</strong>
                  <small>登录身份、接待上限、账号状态与流量额度</small>
                </div>
              </div>

              <div className="agent-editor-account-grid">
                <div className="agent-editor-identity-preview">
                  <span>{initials(draft.name || '客服')}</span>
                  <div>
                    <strong>{draft.name.trim() || '新客服'}</strong>
                    <small>@{draft.username.trim() || '登录账号'}</small>
                  </div>
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
                          maxActiveConversations: Number(event.target.value) || 0,
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
                          dailyConversationLimit: Number(event.target.value) || 0,
                        })
                      }
                    />
                    <small>次日恢复 · 0 = 不限</small>
                  </div>
                </label>

                <label className="account-enable-line agent-editor-status-card">
                  <input
                    type="checkbox"
                    checked={draft.isEnabled}
                    onChange={(event) =>
                      onDraftChange({ ...draft, isEnabled: event.target.checked })
                    }
                  />
                  <span>
                    <strong>启用客服账号</strong>
                    <small>关闭后停止登录和新会话分流</small>
                  </span>
                </label>
              </div>

              <section className="traffic-quota-editor agent-editor-quota-workspace">
                <div className="traffic-quota-editor-head">
                  <div>
                    <strong>接待额度套餐</strong>
                    <small>按有效咨询扣减，用完停止新分流</small>
                  </div>
                  <label className="switch-control">
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
                    <span>保存后总额度</span>
                    <strong>
                      {draft.trafficQuotaTotal + draft.trafficQuotaTopUp}
                    </strong>
                  </div>
                  <div>
                    <span>已消耗</span>
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
                  追加额度只累加，不清零已消耗；保存失败后重试不会重复增加额度。
                </p>

                {draft.id ? (
                  <div className="traffic-quota-history">
                    <div className="traffic-quota-history-head">
                      <strong>最近额度变更</strong>
                      <span>打开编辑时读取</span>
                    </div>
                    {quotaHistoryBusy ? (
                      <p>正在读取…</p>
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
                      <p>暂无追加记录</p>
                    )}
                  </div>
                ) : null}
              </section>
            </aside>

            <section className="agent-editor-routing-pane">
              <div className="agent-editor-pane-heading">
                <span>02</span>
                <div>
                  <strong>分流负责范围</strong>
                  <small>分区可多选，分类批量负责，产品用于精确指定</small>
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
              disabled={saving || !draft.name.trim() || !draft.username.trim()}
            >
              {saving ? '保存中…' : draft.id ? '保存修改' : '创建客服'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
