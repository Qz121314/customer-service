import { Suspense, lazy, type ComponentProps } from 'react';

type AdminAgentStatisticsModalModule =
  typeof import('./AdminAgentStatisticsModalImpl');
type AdminAgentStatisticsModalProps = ComponentProps<
  AdminAgentStatisticsModalModule['AdminAgentStatisticsModal']
>;

const LazyAdminAgentStatisticsModal = lazy(() =>
  import('./AdminAgentStatisticsModalImpl').then(
    ({ AdminAgentStatisticsModal }) => ({
      default: AdminAgentStatisticsModal,
    }),
  ),
);

export function AdminAgentStatisticsModal(
  props: AdminAgentStatisticsModalProps,
) {
  return (
    <Suspense fallback={null}>
      <LazyAdminAgentStatisticsModal {...props} />
    </Suspense>
  );
}
