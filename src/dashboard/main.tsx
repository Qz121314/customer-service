import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const isAgentRoute = window.location.pathname.startsWith('/agent');

async function loadAgentStyles() {
  await import('./agent-foundation.css');
  await import('./media-view.css');
  await import('./agent-statistics.css');
  await import('./agent-avatar.css');
  await import('./agent-workspace.css');
  await import('./agent-desktop.css');
  await import('./agent-mobile.css');
}

async function loadAdminStyles() {
  await import('./styles.css');
  await import('./product-assignment.css');
  await import('./chat-dialogue.css');
  await import('./media-view.css');
  await import('./agent-statistics.css');
  await import('./cloud-service-ui.css');
  await import('./ui-polish.css');
  await import('./agent-editor.css');
  await import('./agent-avatar.css');
}

async function loadRouteStyles() {
  if (isAgentRoute) {
    await loadAgentStyles();
    return;
  }
  await loadAdminStyles();
}

if (isAgentRoute && 'serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker
        .register('/agent-sw.js', { scope: '/agent' })
        .catch(() => undefined);
    },
    { once: true },
  );
}

async function bootstrap() {
  await loadRouteStyles();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
