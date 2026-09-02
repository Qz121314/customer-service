import { Suspense, lazy } from 'react';
import type { AgentStatisticsModalProps } from './AgentStatisticsWorkspaceImpl';

const LazyAgentStatisticsModal = lazy(() =>
  import('./AgentStatisticsWorkspaceImpl').then(({ AgentStatisticsModal }) => ({
    default: AgentStatisticsModal,
  })),
);

export function AgentStatisticsModal(props: AgentStatisticsModalProps) {
  return (
    <Suspense fallback={null}>
      <LazyAgentStatisticsModal {...props} />
    </Suspense>
  );
}
