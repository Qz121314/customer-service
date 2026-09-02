import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentPortal } from './AgentPortal';

const mobileAgentQuery = window.matchMedia('(max-width: 760px)');

async function loadAgentStyles() {
  await import('./agent-route.css');
}

function installAgentVisualViewportSync() {
  const root = document.getElementById('root');
  if (!root) return;

  let frame = 0;
  let activeShell: HTMLElement | null = null;

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
  };

  const applyGeometry = () => {
    frame = 0;
    const shell = activeShell;
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
  };

  const scheduleGeometry = () => {
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(applyGeometry);
  };

  const bindShell = () => {
    const shell = root.querySelector<HTMLElement>('.workspace-shell');
    if (shell === activeShell) return;
    if (activeShell) clearGeometry(activeShell);
    activeShell = shell;
    scheduleGeometry();
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

  const viewportRootObserver = new MutationObserver(bindShell);
  viewportRootObserver.observe(root, { childList: true });
  bindShell();
}

function installAgentServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
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

export async function bootstrap() {
  await loadAgentStyles();
  installAgentServiceWorker();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AgentPortal />
    </StrictMode>,
  );
  installAgentVisualViewportSync();
}
