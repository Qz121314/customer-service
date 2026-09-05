import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPortal } from './AdminPortal';

async function loadAdminStyles() {
  await import('./admin-route.css');
}

export async function bootstrap() {
  await loadAdminStyles();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AdminPortal />
    </StrictMode>,
  );
}
