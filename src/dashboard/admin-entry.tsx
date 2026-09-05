import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPortal } from './AdminPortal';
import { AdminRoutingDiagnoseDock } from './AdminRoutingDiagnoseDock';

async function loadAdminStyles() {
  await import('./admin-route.css');
  await import('./admin-ui-overrides.css');
}

export async function bootstrap() {
  await loadAdminStyles();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AdminPortal />
      <AdminRoutingDiagnoseDock />
    </StrictMode>,
  );
}
