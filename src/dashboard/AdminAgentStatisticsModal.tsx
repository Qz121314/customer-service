import { Suspense, lazy, type ComponentProps } from 'react';

const LazyAdminAgentStatisticsModal = lazy(() =>
  import('./AdminAgentStatisticsModalImpl').then(
    ({ AdminAgentStatisticsModal }) => ({
      default: AdminAgentStatisticsModal,
    }),
  ),
);

export function AdminAgentStatisticsModal(
  props: ComponentProps<typeof LazyAdminAgentStatisticsModal>,
) {
  return (
    <Suspense fallback={null}>
      <LazyAdminAgentStatisticsModal {...props} />
    </Suspense>
  );
}
