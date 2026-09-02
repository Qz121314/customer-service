import { Suspense, lazy } from 'react';
import type { AdminAgentStatisticsModalProps } from './AdminAgentStatisticsModalImpl';

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
