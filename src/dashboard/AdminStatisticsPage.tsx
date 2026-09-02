import { Suspense, lazy, type ComponentProps } from 'react';

type AdminStatisticsPageModule = typeof import('./AdminStatisticsPageImpl');
type AdminStatisticsPageProps = ComponentProps<
  AdminStatisticsPageModule['AdminStatisticsPage']
>;

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
