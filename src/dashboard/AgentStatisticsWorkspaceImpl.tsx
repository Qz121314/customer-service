import type { AgentIdentity } from './api';

export type AgentStatisticsModalProps = {
  identity: AgentIdentity;
  onClose: () => void;
};

export * from './AgentStatisticsWorkspaceRuntime';
