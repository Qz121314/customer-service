import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import {
  clearAgentThreadHistoryMarker,
  readAgentThreadHistoryMarker,
} from './agent-history';

const isAgentRoute = window.location.pathname.startsWith('/agent');
const mobileAgentQuery = window.matchMedia('(max-width: 760px)');

async function loadAgentStyles() {
  await import('./agent-foundation.css');
  await import('./media-view.css');
  await import('./agent-statistics.css');
  await import('./agent-auto-reply.css');
  await import('./agent-avatar.css');
  await import('./agent-workspace.css');
  await import('./agent-desktop.css');
  await import('./agent-desktop-composer.css');
  await import('./agent-mobile.css');
  await import('./agent-unread.css');
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
  await import('./admin-commercial.css');
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
    if (conversationPane) {
      const sidebarHeight =
        shell
          .querySelector<HTMLElement>('.workspace-sidebar')
          ?.getBoundingClientRect().height || 52;
      conversationPane.style.height = `calc(100% - ${Math.round(sidebarHeight)}px)`;
    }

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

function installAgentHistoryNavigation() {
  const root = document.getElementById('root');
  if (!root) return;

  // Keep vertical overscroll containment, but allow the browser/OS edge-back
  // gesture to consume the same History entry as the visible back button.
  document.body.style.overscrollBehaviorX = 'auto';
  clearAgentThreadHistoryMarker();

  let backPending = false;
  let wasThreadOpen = false;

  const threadIsOpen = () =>
    root
      .querySelector<HTMLElement>('.workspace-shell')
      ?.classList.contains('is-thread-open') ?? false;

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

  const observer = new MutationObserver(reconcileThreadClosure);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
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
  if (isAgentRoute) {
    installAgentVisualViewportSync();
    installAgentHistoryNavigation();
  }
}

void bootstrap();
