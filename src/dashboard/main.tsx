import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './product-assignment.css';
import './chat-dialogue.css';
import './media-view.css';
import './agent-statistics.css';
import './cloud-service-ui.css';
import './ui-polish.css';
import './agent-editor.css';
import './agent-workspace.css';
import './agent-desktop.css';
import './agent-mobile.css';
import './agent-composer-status.css';
import './agent-avatar.css';

if (
  window.location.pathname.startsWith('/agent') &&
  'serviceWorker' in navigator
) {
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
