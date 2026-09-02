import type { FormEvent } from 'react';
import type {
  AgentQuotaAdjustment,
  AgentQuotaLedger,
  ProductCatalogItem,
} from './api';
import type { AgentDraft } from './dashboard-runtime';

export type AgentEditorModalProps = {
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
};

export * from './AgentEditorModalRuntime';
