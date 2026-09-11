import './ui-system.css';

const routeEntry = window.location.pathname.startsWith('/agent')
  ? import('./agent-entry')
  : window.location.pathname.startsWith('/chat')
    ? import('./visitor-entry')
    : import('./admin-entry');

void routeEntry.then(({ bootstrap }) => bootstrap());
