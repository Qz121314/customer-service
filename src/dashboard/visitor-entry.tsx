import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VisitorChatPage } from './VisitorChatPage';

export function bootstrap() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <VisitorChatPage />
    </StrictMode>,
  );
}
