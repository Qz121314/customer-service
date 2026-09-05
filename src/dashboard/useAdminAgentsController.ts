import { useEffect, useState, type FormEvent } from 'react';
import {
  type AgentAccount,
  type AgentQuotaAdjustment,
  type AgentQuotaLedger,
  createAgent,
  deleteAgent,
  getAgentQuotaLedger,
  updateAgent,
} from './api';
import type { AgentEditorModalProps } from './AgentEditorModalImpl';
import type { AgentFilter } from './AdminAgentsPage';
import { type AgentDraft, emptyAgentDraft, message } from './dashboard-runtime';

type AdminAgentsControllerOptions = {
  refresh: () => Promise<void>;
  setError: (error: string) => void;
  onAgentDeleted: (agentId: string) => void;
};

export function useAdminAgentsController({
  refresh,
  setError,
  onAgentDeleted,
}: AdminAgentsControllerOptions) {
  const [agentSearch, setAgentSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all');
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [quotaAdjustments, setQuotaAdjustments] = useState<
    AgentQuotaAdjustment[]
  >([]);
  const [quotaLedger, setQuotaLedger] = useState<AgentQuotaLedger | null>(null);
  const [quotaHistoryBusy, setQuotaHistoryBusy] = useState(false);
  const [quotaHistoryError, setQuotaHistoryError] = useState('');

  useEffect(() => {
    if (!editorOpen || saving) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [editorOpen, saving]);

  function resetQuotaLedgerState() {
    setQuotaAdjustments([]);
    setQuotaLedger(null);
    setQuotaHistoryBusy(false);
    setQuotaHistoryError('');
  }

  function createNewAgent() {
    setDraft({
      ...emptyAgentDraft,
      trafficQuotaRequestId: crypto.randomUUID(),
    });
    resetQuotaLedgerState();
    setEditorOpen(true);
    setError('');
  }

  function editAgent(agent: AgentAccount) {
    setDraft({
      id: agent.id,
      name: agent.name,
      adminLabel: agent.adminLabel,
      username: agent.username ?? '',
      password: '',
      routingScope: agent.routingScope,
      dailyConversationLimit: agent.dailyConversationLimit,
      trafficQuotaEnabled: agent.trafficQuotaEnabled,
      trafficQuotaTotal: agent.trafficQuotaTotal,
      trafficQuotaUsed: agent.trafficQuotaUsed,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: crypto.randomUUID(),
      isEnabled: agent.isEnabled,
    });
    resetQuotaLedgerState();
    setEditorOpen(true);
    setError('');
  }

  async function loadQuotaLedger() {
    if (!draft.id || quotaHistoryBusy) return;
    setQuotaHistoryBusy(true);
    setQuotaHistoryError('');
    try {
      const result = await getAgentQuotaLedger(draft.id);
      setQuotaAdjustments(result.adjustments);
      setQuotaLedger(result.ledger);
    } catch (reason) {
      setQuotaHistoryError(message(reason, '无法核对咨询额度账本'));
    } finally {
      setQuotaHistoryBusy(false);
    }
  }

  async function saveAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.username.trim()) return;
    if (!draft.id && draft.password.length < 4) {
      setError('新客服必须设置至少 4 个字符的登录密码。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (draft.id) {
        await updateAgent(draft.id, {
          name: draft.name,
          adminLabel: draft.adminLabel,
          username: draft.username,
          password: draft.password || undefined,
          routingScope: draft.routingScope,
          dailyConversationLimit: draft.dailyConversationLimit,
          trafficQuotaEnabled: draft.trafficQuotaEnabled,
          trafficQuotaTopUp: draft.trafficQuotaTopUp,
          trafficQuotaRequestId: draft.trafficQuotaRequestId,
          isEnabled: draft.isEnabled,
        });
      } else {
        await createAgent({
          name: draft.name,
          adminLabel: draft.adminLabel,
          username: draft.username,
          password: draft.password,
          routingScope: draft.routingScope,
          dailyConversationLimit: draft.dailyConversationLimit,
          trafficQuotaEnabled: draft.trafficQuotaEnabled,
          trafficQuotaTopUp: draft.trafficQuotaTopUp,
          trafficQuotaRequestId: draft.trafficQuotaRequestId,
          isEnabled: draft.isEnabled,
        });
      }
      setEditorOpen(false);
      setDraft(emptyAgentDraft);
      resetQuotaLedgerState();
      await refresh();
    } catch (reason) {
      setError(message(reason, '保存客服失败'));
    } finally {
      setSaving(false);
    }
  }

  async function removeAgent(agent: Pick<AgentAccount, 'id' | 'name'>) {
    if (deletingAgentId) return;
    const confirmed = window.confirm(
      `确定永久删除客服「${agent.name}」？\n\n仍有进行中的会话时系统会拒绝删除；请先停用账号并处理完会话。历史聊天与统计记录会保留。`,
    );
    if (!confirmed) return;

    setDeletingAgentId(agent.id);
    setError('');
    try {
      await deleteAgent(agent.id);
      onAgentDeleted(agent.id);
      if (draft.id === agent.id) {
        setEditorOpen(false);
        setDraft(emptyAgentDraft);
        resetQuotaLedgerState();
      }
      await refresh();
    } catch (reason) {
      setError(message(reason, '删除客服失败'));
    } finally {
      setDeletingAgentId(null);
    }
  }

  const editingAgentId = draft.id;
  const editorProps: Omit<AgentEditorModalProps, 'products'> = {
    draft,
    saving,
    deleting: editingAgentId !== null && deletingAgentId === editingAgentId,
    quotaAdjustments,
    quotaLedger,
    quotaHistoryBusy,
    quotaHistoryError,
    onDraftChange: setDraft,
    onLoadQuotaLedger: () => void loadQuotaLedger(),
    onDelete: editingAgentId
      ? () =>
          void removeAgent({
            id: editingAgentId,
            name: draft.name,
          })
      : undefined,
    onClose: () => {
      if (!saving && !deletingAgentId) setEditorOpen(false);
    },
    onSubmit: (event) => void saveAgent(event),
  };

  return {
    pageProps: {
      agentSearch,
      agentFilter,
      onSearchChange: setAgentSearch,
      onFilterChange: setAgentFilter,
      onClearFilters: () => {
        setAgentSearch('');
        setAgentFilter('all');
      },
      onCreateAgent: createNewAgent,
      onEditAgent: editAgent,
    },
    editorOpen,
    editorProps,
  };
}
