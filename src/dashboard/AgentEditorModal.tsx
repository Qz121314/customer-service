import type { FormEvent } from 'react';
import type {
  AgentQuotaAdjustment,
  AgentQuotaLedger,
  ProductCatalogItem,
} from './api';
import type { AgentDraft } from './dashboard-runtime';
import { relativeTime } from './dashboard-runtime';
import { ProductAssignmentPicker } from './ProductAssignmentPicker';
import { UiIcon } from './icons';
import { Button } from './ui';

export function AgentEditorModal({
  draft,
  products,
  saving,
  deleting,
  quotaAdjustments,
  quotaLedger,
  quotaHistoryBusy,
  quotaHistoryError,
  onDraftChange,
  onLoadQuotaLedger,
  onDelete,
  onClose,
  onSubmit,
}: {
  draft: AgentDraft;
  products: ProductCatalogItem[];
  saving: boolean;
  deleting: boolean;
  quotaAdjustments: AgentQuotaAdjustment[];
  quotaLedger: AgentQuotaLedger | null;
  quotaHistoryBusy: boolean;
  quotaHistoryError: string;
  onDraftChange: (draft: AgentDraft) => void;
  onLoadQuotaLedger: () => void;
  onDelete?: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const username = draft.username.trim();
  const canSave =
    Boolean(username) && Boolean(draft.id || draft.password.length >= 4);
  const quotaTotalAfterSave = draft.trafficQuotaTotal + draft.trafficQuotaTopUp;
  const quotaRemainingAfterSave = Math.max(
    0,
    quotaTotalAfterSave - draft.trafficQuotaUsed,
  );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => !saving && !deleting && onClose()}
    >
      <section
        className="agent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-editor-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="agent-editor-header">
          <div className="agent-editor-title-block">
            <span className="agent-editor-kicker">客服账号</span>
            <div>
              <h2 id="agent-editor-title">
                {draft.id ? '编辑客服' : '新增客服'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="关闭"
            disabled={saving || deleting}
            onClick={() => !saving && !deleting && onClose()}
          >
            <UiIcon name="close" />
          </button>
        </header>

        <form className="agent-editor-form" onSubmit={onSubmit}>
          <div className="agent-editor-layout">
            <section className="agent-editor-settings-pane agent-editor-workspace-card">
              <div className="agent-editor-section agent-editor-account-section">
                <div className="agent-editor-section-head">
                  <strong>登录账号</strong>
                </div>

                <div className="agent-editor-account-grid">
                  <label className="agent-editor-field">
                    <span>账号</span>
                    <input
                      value={draft.username}
                      required
                      autoFocus
                      autoComplete="off"
                      placeholder="例如 amy01"
                      onChange={(event) => {
                        const nextUsername = event.target.value;
                        onDraftChange({
                          ...draft,
                          username: nextUsername,
                          name: draft.id ? draft.name : nextUsername,
                        });
                      }}
                    />
                  </label>

                  <label className="agent-editor-field">
                    <span>{draft.id ? '重置密码' : '登录密码'}</span>
                    <input
                      type="password"
                      value={draft.password}
                      required={!draft.id}
                      minLength={4}
                      autoComplete="new-password"
                      placeholder={
                        draft.id ? '留空表示不修改' : '至少 4 个字符'
                      }
                      onChange={(event) =>
                        onDraftChange({
                          ...draft,
                          password: event.target.value,
                        })
                      }
                    />
                  </label>

                  <div className="agent-editor-status-row">
                    <strong>启用账号</strong>
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
              </div>

              <div className="agent-editor-section agent-editor-capacity-section">
                <div className="agent-editor-section-head">
                  <strong>每日接待上限</strong>
                  <span className="agent-editor-section-hint">
                    0 = 不限制 · 达到上限后当天停止自动分流
                  </span>
                </div>

                <div className="agent-editor-capacity-grid">
                  <label className="agent-editor-number-field">
                    <strong>每日接待上限</strong>
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
                      <em>次</em>
                    </div>
                  </label>
                </div>
              </div>

              <div className="agent-editor-section agent-editor-quota-section">
                <div className="agent-editor-section-head">
                  <strong>咨询额度</strong>
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
                    <strong>{quotaTotalAfterSave}</strong>
                  </div>
                  <div>
                    <span>已使用额度</span>
                    <strong>{draft.trafficQuotaUsed}</strong>
                  </div>
                  <div>
                    <span>保存后剩余</span>
                    <strong>{quotaRemainingAfterSave}</strong>
                  </div>
                </div>

                <div className="traffic-quota-topup">
                  <div className="traffic-quota-topup-label">
                    <span>{draft.id ? '本次追加额度' : '初始额度'}</span>
                  </div>
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
                  每个会话首次有效接待只扣 1
                  次。每日接待上限参与自动分流，并按洛杉矶业务日自动重置；咨询额度按累计总量计算。内部重新分配和等待恢复同一会话不会重复扣减咨询额度。
                </p>

                {draft.id ? (
                  <div className="traffic-quota-history">
                    <div className="traffic-quota-history-head">
                      <strong>额度账本</strong>
                      {quotaLedger ? (
                        <span
                          className={
                            quotaLedger.consistent ? 'is-ok' : 'is-warning'
                          }
                        >
                          {quotaLedger.consistent ? '账本已核对' : '账本需检查'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="traffic-quota-load"
                          disabled={quotaHistoryBusy}
                          onClick={onLoadQuotaLedger}
                        >
                          {quotaHistoryBusy ? '读取中…' : '查看记录'}
                        </button>
                      )}
                    </div>

                    {quotaHistoryBusy ? (
                      <p>正在读取…</p>
                    ) : quotaHistoryError ? (
                      <p className="traffic-quota-history-error">
                        {quotaHistoryError}
                      </p>
                    ) : quotaLedger && !quotaLedger.consistent ? (
                      <div className="traffic-quota-history-list">
                        <div className="traffic-quota-history-row quota-ledger-warning">
                          <strong>核对异常</strong>
                          <span>
                            总额度 {quotaLedger.total}/
                            {quotaLedger.expectedTotal} · 已使用额度{' '}
                            {quotaLedger.used}/{quotaLedger.expectedUsed}
                          </span>
                          <time>请检查</time>
                        </div>
                      </div>
                    ) : quotaLedger && quotaAdjustments.length ? (
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
                    ) : quotaLedger ? (
                      <p>账本已核对，暂无追加记录</p>
                    ) : (
                      <p className="traffic-quota-history-hint">
                        不查看时不会额外读取账本数据
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="agent-editor-routing-pane agent-editor-workspace-card">
              <div className="agent-editor-routing-head">
                <strong>分流负责范围</strong>
              </div>
              <ProductAssignmentPicker
                products={products}
                scope={draft.routingScope}
                disabled={saving || deleting}
                onChange={(routingScope) =>
                  onDraftChange({ ...draft, routingScope })
                }
              />
            </section>
          </div>

          <footer className="agent-editor-footer">
            {draft.id && onDelete ? (
              <Button
                type="button"
                variant="destructive"
                className="agent-delete-button"
                disabled={saving || deleting}
                onClick={onDelete}
              >
                {deleting ? '删除中…' : '删除客服'}
              </Button>
            ) : null}
            <div className="agent-editor-footer-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={saving || deleting}
                onClick={onClose}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving || deleting || !canSave}>
                {saving ? '保存中…' : draft.id ? '保存修改' : '创建客服'}
              </Button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
