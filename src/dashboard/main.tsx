import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const isAgentRoute = window.location.pathname.startsWith('/agent');

async function loadRouteStyles() {
  if (isAgentRoute) {
    await Promise.all([
      import('./agent-foundation.css'),
      import('./media-view.css'),
      import('./agent-statistics.css'),
      import('./agent-avatar.css'),
      import('./agent-workspace.css'),
      import('./agent-desktop.css'),
      import('./agent-mobile.css'),
    ]);
    return;
  }

  await Promise.all([
    import('./styles.css'),
    import('./product-assignment.css'),
    import('./chat-dialogue.css'),
    import('./media-view.css'),
    import('./agent-statistics.css'),
    import('./cloud-service-ui.css'),
    import('./ui-polish.css'),
    import('./agent-editor.css'),
    import('./agent-avatar.css'),
  ]);
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
