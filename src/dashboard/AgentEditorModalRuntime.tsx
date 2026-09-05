import type { FormEvent } from 'react';
import type {
  AgentQuotaAdjustment,
  AgentQuotaLedger,
  ProductCatalogItem,
} from './api';
import type { AgentDraft } from './dashboard-runtime';
import {
  AgentEditorAccountSection,
  AgentEditorCapacitySection,
  AgentEditorFooter,
  AgentEditorQuotaSection,
  AgentEditorRoutingSection,
} from './AgentEditorSections';
import { UiIcon } from './icons';

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
            <div className="agent-editor-primary-grid">
              <section className="agent-editor-account-pane agent-editor-workspace-card">
                <AgentEditorAccountSection
                  draft={draft}
                  onDraftChange={onDraftChange}
                />
              </section>

              <section className="agent-editor-operations-pane agent-editor-workspace-card">
                <AgentEditorCapacitySection
                  draft={draft}
                  onDraftChange={onDraftChange}
                />
                <AgentEditorQuotaSection
                  draft={draft}
                  quotaAdjustments={quotaAdjustments}
                  quotaLedger={quotaLedger}
                  quotaHistoryBusy={quotaHistoryBusy}
                  quotaHistoryError={quotaHistoryError}
                  onDraftChange={onDraftChange}
                  onLoadQuotaLedger={onLoadQuotaLedger}
                />
              </section>
            </div>

            <AgentEditorRoutingSection
              draft={draft}
              products={products}
              saving={saving}
              deleting={deleting}
              onDraftChange={onDraftChange}
            />
          </div>

          <AgentEditorFooter
            draft={draft}
            saving={saving}
            deleting={deleting}
            canSave={canSave}
            onDelete={onDelete}
            onClose={onClose}
          />
        </form>
      </section>
    </div>
  );
}
