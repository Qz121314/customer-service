import { Suspense, lazy, type ComponentProps } from 'react';

const LazyAgentStatisticsModal = lazy(() =>
  import('./AgentStatisticsWorkspaceImpl').then(({ AgentStatisticsModal }) => ({
    default: AgentStatisticsModal,
  })),
);

export function AgentStatisticsModal(
  props: ComponentProps<typeof LazyAgentStatisticsModal>,
) {
  return (
    <Suspense fallback={null}>
      <LazyAgentStatisticsModal {...props} />
    </Suspense>
  );
}
