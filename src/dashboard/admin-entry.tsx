import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPortal } from './AdminPortal';
import './styles.css';
import './product-assignment.css';
import './agent-statistics.css';
import './month-picker.css';
import './cloud-service-ui.css';
import './agent-editor.css';
import './agent-avatar.css';
import './admin-commercial.css';
import './admin-agents.css';
import './admin-statistics.css';
import './admin-layout.css';
import './commercial-polish.css';
import './admin-design-system.css';

export function bootstrap() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AdminPortal />
    </StrictMode>,
  );
}
