import { Suspense, lazy, type ComponentProps } from 'react';

type AgentStatisticsWorkspaceModule =
  typeof import('./AgentStatisticsWorkspaceImpl');
type AgentStatisticsModalProps = ComponentProps<
  AgentStatisticsWorkspaceModule['AgentStatisticsModal']
>;

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
