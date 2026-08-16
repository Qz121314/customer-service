import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './product-assignment.css';
import './chat-dialogue.css';
import './dialogue-flow.css';
import './media-view.css';
import './agent-statistics.css';
import './cloud-service-ui.css';
import './ui-polish.css';
import './agent-editor.css';
import './agent-workspace.css';

if (
  window.location.pathname.startsWith('/agent') &&
  'serviceWorker' in navigator
) {
  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker
        .register('/agent-sw.js', { scope: '/' })
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
