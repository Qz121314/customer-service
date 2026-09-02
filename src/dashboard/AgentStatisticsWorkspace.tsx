import { Suspense, lazy } from 'react';

type AgentStatisticsWorkspaceModule =
  typeof import('./AgentStatisticsWorkspaceImpl');
type AgentStatisticsModalProps = Parameters<
  AgentStatisticsWorkspaceModule['AgentStatisticsModal']
>[0];

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
