import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const isAgentRoute = window.location.pathname.startsWith('/agent');
const mobileAgentQuery = window.matchMedia('(max-width: 760px)');

async function loadAgentStyles() {
  await import('./agent-foundation.css');
  await import('./media-view.css');
  await import('./agent-statistics.css');
  await import('./agent-avatar.css');
  await import('./agent-workspace.css');
  await import('./agent-desktop.css');
  await import('./agent-mobile.css');
}

async function loadAdminStyles() {
  await import('./styles.css');
  await import('./product-assignment.css');
  await import('./chat-dialogue.css');
  await import('./media-view.css');
  await import('./agent-statistics.css');
  await import('./cloud-service-ui.css');
  await import('./ui-polish.css');
  await import('./agent-editor.css');
  await import('./agent-avatar.css');
}

async function loadRouteStyles() {
  if (isAgentRoute) {
    await loadAgentStyles();
    return;
  }
  await loadAdminStyles();
}

function installAgentVisualViewportSync() {
  const root = document.getElementById('root');
  if (!root) return;

  let frame = 0;

  const clearGeometry = (shell: HTMLElement) => {
    for (const property of [
      'position',
      'top',
      'left',
      'width',
      'max-width',
      'height',
    ]) {
      shell.style.removeProperty(property);
    }
    shell
      .querySelector<HTMLElement>('.conversation-pane')
      ?.style.removeProperty('height');
    shell
      .querySelector<HTMLElement>('.thread-pane')
      ?.style.removeProperty('height');
  };

  const applyGeometry = () => {
    frame = 0;
    const shell = root.querySelector<HTMLElement>('.workspace-shell');
    if (!shell) return;

    if (!mobileAgentQuery.matches) {
      clearGeometry(shell);
      return;
    }

    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;

    shell.style.position = 'fixed';
    shell.style.top = `${Math.round(top)}px`;
    shell.style.left = `${Math.round(left)}px`;
    shell.style.width = `${Math.round(width)}px`;
    shell.style.maxWidth = 'none';
    shell.style.height = `${Math.round(height)}px`;

    const conversationPane =
      shell.querySelector<HTMLElement>('.conversation-pane');
    if (conversationPane) conversationPane.style.height = 'calc(100% - 60px)';

    const threadPane = shell.querySelector<HTMLElement>('.thread-pane');
    if (threadPane) threadPane.style.height = '100%';
  };

  const scheduleGeometry = () => {
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(applyGeometry);
  };

  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', scheduleGeometry, { passive: true });
  viewport?.addEventListener('scroll', scheduleGeometry, { passive: true });
  window.addEventListener('resize', scheduleGeometry, { passive: true });
  window.addEventListener('orientationchange', scheduleGeometry, {
    passive: true,
  });
  document.addEventListener('focusin', scheduleGeometry, { passive: true });
  document.addEventListener('focusout', scheduleGeometry, { passive: true });
  mobileAgentQuery.addEventListener('change', scheduleGeometry);

  const observer = new MutationObserver(scheduleGeometry);
  observer.observe(root, { childList: true, subtree: true });
  scheduleGeometry();
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
  if (isAgentRoute) installAgentVisualViewportSync();
}

void bootstrap();
