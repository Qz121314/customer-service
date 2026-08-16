import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { setupAgentMobileNavigation } from './agent-mobile';
import './styles.css';
import './product-assignment.css';
import './chat-dialogue.css';
import './dialogue-flow.css';
import './agent-mobile-layout.css';
import './agent-mobile-thread.css';
import './agent-mobile-composer.css';
import './media-view.css';
import './agent-statistics.css';
import './cloud-service-ui.css';
import './ui-polish.css';
import './agent-editor-single-screen.css';
import './agent-editor-precision.css';

setupAgentMobileNavigation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
