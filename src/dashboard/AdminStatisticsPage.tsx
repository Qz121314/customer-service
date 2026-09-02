import { Suspense, lazy } from 'react';

type AdminStatisticsPageModule = typeof import('./AdminStatisticsPageImpl');
type AdminStatisticsPageProps = Parameters<
  AdminStatisticsPageModule['AdminStatisticsPage']
>[0];

const LazyAdminStatisticsPage = lazy(() =>
  import('./AdminStatisticsPageImpl').then(({ AdminStatisticsPage }) => ({
    default: AdminStatisticsPage,
  })),
);

export function AdminStatisticsPage(props: AdminStatisticsPageProps) {
  return (
    <Suspense fallback={<div className="empty-state">正在加载流量统计…</div>}>
      <LazyAdminStatisticsPage {...props} />
    </Suspense>
  );
}
