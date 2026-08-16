import { AdminPortal } from './AdminPortal';
import { AgentPortal } from './AgentPortal';

export function App() {
  return window.location.pathname.startsWith('/agent') ? (
    <AgentPortal />
  ) : (
    <AdminPortal />
  );
}
