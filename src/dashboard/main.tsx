import './ui-system.css';

const routeEntry = window.location.pathname.startsWith('/agent')
  ? import('./agent-entry')
  : import('./admin-entry');

void routeEntry.then(({ bootstrap }) => bootstrap());
