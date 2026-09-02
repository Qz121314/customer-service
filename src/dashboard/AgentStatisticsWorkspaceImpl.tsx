import type { AgentIdentity } from './api';

export type AgentStatisticsModalProps = {
  identity: AgentIdentity;
  onClose: (reason?: 'dismiss' | 'notification') => void;
};

export * from './AgentStatisticsWorkspaceRuntime';
