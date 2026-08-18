import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const isAgentRoute = window.location.pathname.startsWith('/agent');
const mobileAgentQuery = window.matchMedia('(max-width: 760px)');
const AGENT_HISTORY_KEY = '__customerServiceAgentView';

type AgentThreadHistoryMarker = {
  view: 'thread';
  conversationId: string;
};

function readAgentThreadHistoryMarker(): AgentThreadHistoryMarker | null {
  const state = window.history.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const marker = (state as Record<string, unknown>)[AGENT_HISTORY_KEY];
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null;
  const record = marker as Record<string, unknown>;
  if (
    record.view !== 'thread' ||
    typeof record.conversationId !== 'string' ||
    !record.conversationId
  ) {
    return null;
  }
  return { view: 'thread', conversationId: record.conversationId };
}

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

function installAgentHistoryNavigation() {
  const root = document.getElementById('root');
  if (!root) return;

  const staleMarker = readAgentThreadHistoryMarker();
  if (staleMarker) {
    const state = {
      ...(window.history.state as Record<string, unknown>),
    };
    delete state[AGENT_HISTORY_KEY];
    window.history.replaceState(state, '', window.location.href);
  }

  let frame = 0;
  let replayConversationId: string | null = null;
  let replayClickPending = false;
  let historyBackPending = false;

  const syncNavigation = () => {
    frame = 0;
    const marker = readAgentThreadHistoryMarker();
    const shell = root.querySelector<HTMLElement>('.workspace-shell');
    const threadOpen = shell?.classList.contains('is-thread-open') ?? false;

    if (replayConversationId) {
      if (!marker || marker.conversationId !== replayConversationId) {
        replayConversationId = null;
        replayClickPending = false;
      } else if (threadOpen) {
        replayConversationId = null;
        replayClickPending = false;
        historyBackPending = false;
        return;
      } else if (!replayClickPending) {
        const row = [
          ...root.querySelectorAll<HTMLButtonElement>(
            '.conversation-row[data-conversation-id]',
          ),
        ].find(
          (item) => item.dataset.conversationId === replayConversationId,
        );
        if (row) {
          replayClickPending = true;
          row.click();
        }
        return;
      } else {
        return;
      }
    }

    if (!marker) {
      historyBackPending = false;
      if (threadOpen) {
        root
          .querySelector<HTMLButtonElement>('.thread-back-button')
          ?.click();
      }
      return;
    }

    if (!threadOpen && !historyBackPending) {
      historyBackPending = true;
      window.history.back();
    }
  };

  const scheduleNavigation = () => {
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(syncNavigation);
  };

  window.addEventListener('popstate', () => {
    historyBackPending = false;
    replayClickPending = false;
    replayConversationId = readAgentThreadHistoryMarker()?.conversationId ?? null;
    scheduleNavigation();
  });

  const observer = new MutationObserver(scheduleNavigation);
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
