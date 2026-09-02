import type { AgentAccount } from './api';

export type AdminAgentStatisticsModalProps = {
  agent: AgentAccount;
  onClose: () => void;
};

export * from './AdminAgentStatisticsModalRuntime';
