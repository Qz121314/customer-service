import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentPortal } from './AgentPortal';
import {
  clearAgentThreadHistoryMarker,
  readAgentThreadHistoryMarker,
} from './agent-history';

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

function installAgentHistoryNavigation() {
  const root = document.getElementById('root');
  if (!root) return;

  document.body.style.overscrollBehaviorX = 'auto';
  clearAgentThreadHistoryMarker();

  let backPending = false;
  let wasThreadOpen = false;
  let observedShell: HTMLElement | null = null;

  const threadIsOpen = () =>
    observedShell?.classList.contains('is-thread-open') ?? false;

  const clickThreadBack = () => {
    root.querySelector<HTMLButtonElement>('.thread-back-button')?.click();
  };

  const reopenHistoryThread = (conversationId: string) => {
    const row = [
      ...root.querySelectorAll<HTMLButtonElement>(
        '.conversation-row[data-conversation-id]',
      ),
    ].find((item) => item.dataset.conversationId === conversationId);
    row?.click();
  };

  root.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('.thread-back-button')) return;
      if (!readAgentThreadHistoryMarker()) return;
      event.preventDefault();
      event.stopPropagation();
      backPending = true;
      window.history.back();
    },
    true,
  );

  window.addEventListener('popstate', () => {
    backPending = false;
    const marker = readAgentThreadHistoryMarker();
    if (marker) {
      if (!threadIsOpen()) reopenHistoryThread(marker.conversationId);
      return;
    }
    if (threadIsOpen()) clickThreadBack();
  });

  const reconcileThreadClosure = () => {
    const threadOpen = threadIsOpen();
    if (
      wasThreadOpen &&
      !threadOpen &&
      readAgentThreadHistoryMarker() &&
      !backPending
    ) {
      backPending = true;
      window.history.back();
    }
    wasThreadOpen = threadOpen;
  };

  const threadStateObserver = new MutationObserver(reconcileThreadClosure);

  const bindShell = () => {
    const shell = root.querySelector<HTMLElement>('.workspace-shell');
    if (shell === observedShell) return;

    threadStateObserver.disconnect();
    observedShell = shell;
    if (shell) {
      threadStateObserver.observe(shell, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    reconcileThreadClosure();
  };

  const historyRootObserver = new MutationObserver(bindShell);
  historyRootObserver.observe(root, { childList: true });
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
  installAgentHistoryNavigation();
}
