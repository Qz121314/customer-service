import { isTauri } from '@tauri-apps/api/core';
import './ui-system.css';

const isTauriDesktop =
  isTauri() ||
  window.location.protocol === 'tauri:' ||
  window.location.hostname === 'tauri.localhost';

document.documentElement.classList.toggle('is-tauri-desktop', isTauriDesktop);

if (isTauriDesktop && !window.location.pathname.startsWith('/agent')) {
  window.history.replaceState(null, '', '/agent');
}

const routeEntry = window.location.pathname.startsWith('/agent')
  ? import('./agent-entry')
  : window.location.pathname.startsWith('/chat')
    ? import('./visitor-entry')
    : import('./admin-entry');

void routeEntry.then(({ bootstrap }) => bootstrap());
