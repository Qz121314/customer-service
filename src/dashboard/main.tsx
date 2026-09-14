import './ui-system.css';

const isTauriDesktop =
  window.location.protocol === 'tauri:' ||
  window.location.hostname === 'tauri.localhost';

if (isTauriDesktop && !window.location.pathname.startsWith('/agent')) {
  window.history.replaceState(null, '', '/agent');
}

const routeEntry = window.location.pathname.startsWith('/agent')
  ? import('./agent-entry')
  : window.location.pathname.startsWith('/chat')
    ? import('./visitor-entry')
    : import('./admin-entry');

void routeEntry.then(({ bootstrap }) => bootstrap());
