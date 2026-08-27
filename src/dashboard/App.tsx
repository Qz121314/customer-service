import { lazy, Suspense } from 'react';

const AdminPortal = lazy(() =>
  import('./AdminPortal').then(({ AdminPortal }) => ({ default: AdminPortal })),
);
const AgentPortal = lazy(() =>
  import('./AgentPortal').then(({ AgentPortal }) => ({ default: AgentPortal })),
);

export function App() {
  const portal = window.location.pathname.startsWith('/agent') ? (
    <AgentPortal />
  ) : (
    <AdminPortal />
  );
  return <Suspense fallback={null}>{portal}</Suspense>;
}
