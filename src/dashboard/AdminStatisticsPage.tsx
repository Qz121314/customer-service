import { Suspense, lazy, type ComponentProps } from 'react';

const LazyAdminStatisticsPage = lazy(() =>
  import('./AdminStatisticsPageImpl').then(({ AdminStatisticsPage }) => ({
    default: AdminStatisticsPage,
  })),
);

export function AdminStatisticsPage(
  props: ComponentProps<typeof LazyAdminStatisticsPage>,
) {
  return (
    <Suspense fallback={<div className="empty-state">正在加载流量统计…</div>}>
      <LazyAdminStatisticsPage {...props} />
    </Suspense>
  );
}
