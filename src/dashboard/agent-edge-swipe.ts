const mobileAgentQuery = window.matchMedia('(max-width: 760px)');

const EDGE_START_MAX_X = 28;
const DIRECTION_LOCK_DISTANCE = 8;
const FAST_SWIPE_MIN_DISTANCE = 48;
const FAST_SWIPE_MIN_VELOCITY = 0.45;
const FAST_SWIPE_MIN_DURATION_MS = 16;
const FAST_SWIPE_MAX_DURATION_MS = 240;
const COMMIT_DISTANCE_RATIO = 0.28;
const COMMIT_DISTANCE_MIN = 88;
const COMMIT_DISTANCE_MAX = 132;
const SETTLE_DURATION_MS = 180;
const REBOUND_CURVE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const COMMIT_CURVE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SWIPE_SURFACE_SELECTOR = '[data-agent-swipe-back-surface]';
const SWIPE_TRIGGER_SELECTOR = '[data-agent-swipe-back-trigger]';

type SwipeBackMode = 'direct' | 'history';

type SwipeTarget = {
  element: HTMLElement;
  backButton: HTMLButtonElement;
  mode: SwipeBackMode;
};

type InlineGestureStyles = {
  animation: string;
  transform: string;
  transition: string;
  willChange: string;
  boxShadow: string;
};

type ThreadStackStyles = {
  sidebarDisplay: string;
  conversationDisplay: string;
  threadPosition: string;
  threadInset: string;
  threadZIndex: string;
  threadWidth: string;
  threadHeight: string;
};

type ActiveGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startAt: number;
  distanceX: number;
  direction: 'pending' | 'horizontal';
  stackPrepared: boolean;
  restoreStack: () => void;
  target: SwipeTarget;
  styles: InlineGestureStyles;
};

function elementIsVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function registerSwipeSurface(
  element: HTMLElement,
  backButton: HTMLButtonElement,
  mode: SwipeBackMode = 'direct',
) {
  element.dataset.agentSwipeBackSurface = 'true';
  if (!element.dataset.agentSwipeBackMode) {
    element.dataset.agentSwipeBackMode = mode;
  }
  backButton.dataset.agentSwipeBackTrigger = 'true';
}

function registerExistingAgentSurfaces(root: HTMLElement) {
  const settingsPage = root.querySelector<HTMLElement>(
    '.mobile-agent-settings-page',
  );
  const settingsBack = settingsPage?.querySelector<HTMLButtonElement>(
    'button[aria-label="返回工作台"]',
  );
  if (settingsPage && settingsBack) {
    registerSwipeSurface(settingsPage, settingsBack);
  }

  const threadPane = root.querySelector<HTMLElement>('.thread-pane');
  const threadBack = threadPane?.querySelector<HTMLButtonElement>(
    '.thread-back-button',
  );
  if (threadPane && threadBack) {
    registerSwipeSurface(threadPane, threadBack, 'history');
  }

  for (const dialog of document.querySelectorAll<HTMLElement>(
    '[role="dialog"][aria-modal="true"]',
  )) {
    const backButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label^="关闭"], button[aria-label^="返回"]',
    );
    if (!backButton) continue;
    const surface =
      dialog.parentElement instanceof HTMLElement
        ? dialog.parentElement
        : dialog;
    registerSwipeSurface(surface, backButton);
  }
}

function readSwipeBackMode(element: HTMLElement): SwipeBackMode {
  return element.dataset.agentSwipeBackMode === 'history'
    ? 'history'
    : 'direct';
}

function findSwipeTarget(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): SwipeTarget | null {
  if (!mobileAgentQuery.matches) return null;

  registerExistingAgentSurfaces(root);

  for (const hit of document.elementsFromPoint(clientX, clientY)) {
    const surface = hit.closest<HTMLElement>(SWIPE_SURFACE_SELECTOR);
    if (!surface || !elementIsVisible(surface)) continue;
    const backButton = surface.querySelector<HTMLButtonElement>(
      SWIPE_TRIGGER_SELECTOR,
    );
    if (
      !backButton ||
      backButton.disabled ||
      !elementIsVisible(backButton)
    ) {
      continue;
    }
    return {
      element: surface,
      backButton,
      mode: readSwipeBackMode(surface),
    };
  }

  return null;
}

function readInlineGestureStyles(element: HTMLElement): InlineGestureStyles {
  return {
    animation: element.style.animation,
    transform: element.style.transform,
    transition: element.style.transition,
    willChange: element.style.willChange,
    boxShadow: element.style.boxShadow,
  };
}

function restoreInlineGestureStyles(
  element: HTMLElement,
  styles: InlineGestureStyles,
) {
  element.style.animation = styles.animation;
  element.style.transform = styles.transform;
  element.style.transition = styles.transition;
  element.style.willChange = styles.willChange;
  element.style.boxShadow = styles.boxShadow;
}

function prepareThreadStack(target: SwipeTarget): () => void {
  if (!target.element.classList.contains('thread-pane')) return () => undefined;

  const shell = target.element.closest<HTMLElement>(
    '.workspace-shell.is-thread-open',
  );
  const sidebar = shell?.querySelector<HTMLElement>('.workspace-sidebar');
  const conversation = shell?.querySelector<HTMLElement>('.conversation-pane');
  if (!shell || !sidebar || !conversation) return () => undefined;

  const styles: ThreadStackStyles = {
    sidebarDisplay: sidebar.style.display,
    conversationDisplay: conversation.style.display,
    threadPosition: target.element.style.position,
    threadInset: target.element.style.inset,
    threadZIndex: target.element.style.zIndex,
    threadWidth: target.element.style.width,
    threadHeight: target.element.style.height,
  };

  sidebar.style.display = 'flex';
  conversation.style.display = 'flex';
  target.element.style.position = 'absolute';
  target.element.style.inset = '0';
  target.element.style.zIndex = '60';
  target.element.style.width = '100%';
  target.element.style.height = '100%';

  return () => {
    sidebar.style.display = styles.sidebarDisplay;
    conversation.style.display = styles.conversationDisplay;
    target.element.style.position = styles.threadPosition;
    target.element.style.inset = styles.threadInset;
    target.element.style.zIndex = styles.threadZIndex;
    target.element.style.width = styles.threadWidth;
    target.element.style.height = styles.threadHeight;
  };
}

function prepareGestureStack(gesture: ActiveGesture) {
  if (gesture.stackPrepared) return;
  gesture.stackPrepared = true;
  gesture.restoreStack = prepareThreadStack(gesture.target);
}

function restoreGesture(gesture: ActiveGesture) {
  restoreInlineGestureStyles(gesture.target.element, gesture.styles);
  gesture.restoreStack();
  gesture.restoreStack = () => undefined;
}

function translateX(distanceX: number): string {
  return `translate3d(${Math.round(distanceX)}px, 0, 0)`;
}

function settleTransition(curve: string): string {
  return [
    `transform ${SETTLE_DURATION_MS}ms ${curve}`,
    `box-shadow ${SETTLE_DURATION_MS}ms ease`,
  ].join(', ');
}

function dragShadow(progress: number): string {
  const alpha = Math.min(0.16, 0.05 + progress * 0.11);
  return `-12px 0 30px rgba(15, 23, 42, ${alpha})`;
}

function applyDrag(gesture: ActiveGesture, distanceX: number) {
  const width = Math.max(
    1,
    gesture.target.element.getBoundingClientRect().width || window.innerWidth,
  );
  const clampedDistance = Math.min(Math.max(distanceX, 0), width);
  const progress = Math.min(clampedDistance / width, 1);
  gesture.distanceX = clampedDistance;
  gesture.target.element.style.animation = 'none';
  gesture.target.element.style.transition = 'none';
  gesture.target.element.style.willChange = 'transform';
  gesture.target.element.style.transform = translateX(clampedDistance);
  gesture.target.element.style.boxShadow = dragShadow(progress);
}

function commitDistance(width: number): number {
  return Math.min(
    COMMIT_DISTANCE_MAX,
    Math.max(COMMIT_DISTANCE_MIN, width * COMMIT_DISTANCE_RATIO),
  );
}

function isFastSwipe(current: ActiveGesture, endAt: number): boolean {
  const duration = endAt - current.startAt;
  if (
    duration < FAST_SWIPE_MIN_DURATION_MS ||
    duration > FAST_SWIPE_MAX_DURATION_MS
  ) {
    return false;
  }
  if (current.distanceX < FAST_SWIPE_MIN_DISTANCE) return false;
  return current.distanceX / duration >= FAST_SWIPE_MIN_VELOCITY;
}

export function installAgentEdgeSwipeBack() {
  const root = document.getElementById('root');
  if (!root) return;

  let gesture: ActiveGesture | null = null;
  let settleTimer: number | null = null;
  let pendingRestore: (() => void) | null = null;

  const restorePending = () => {
    const restore = pendingRestore;
    pendingRestore = null;
    restore?.();
  };

  const clearSettleTimer = () => {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
    restorePending();
  };

  const settleBack = (current: ActiveGesture) => {
    const { element } = current.target;
    clearSettleTimer();
    pendingRestore = () => restoreGesture(current);
    element.style.animation = 'none';
    element.style.transition = settleTransition(REBOUND_CURVE);
    element.style.transform = translateX(0);
    element.style.boxShadow = 'none';
    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      restorePending();
    }, SETTLE_DURATION_MS + 24);
  };

  const finishBack = (current: ActiveGesture) => {
    const { element, backButton, mode } = current.target;
    const width = Math.max(
      1,
      element.getBoundingClientRect().width || window.innerWidth,
    );
    clearSettleTimer();
    pendingRestore = () => restoreGesture(current);
    element.style.animation = 'none';
    element.style.transition = settleTransition(COMMIT_CURVE);
    element.style.willChange = 'transform';
    element.style.transform = translateX(Math.ceil(width));
    element.style.boxShadow = '-14px 0 34px rgba(15, 23, 42, 0.16)';

    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      if (backButton.disabled) {
        restorePending();
        return;
      }

      if (mode === 'history') {
        const restoreAfterHistory = () => {
          window.setTimeout(restorePending, 32);
        };
        window.addEventListener('popstate', restoreAfterHistory, {
          once: true,
        });
        backButton.click();
        window.setTimeout(restorePending, 280);
        return;
      }

      backButton.click();
      window.requestAnimationFrame(restorePending);
    }, SETTLE_DURATION_MS - 16);
  };

  const cancelGesture = () => {
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    if (current.direction === 'horizontal') settleBack(current);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (event.clientX < 0 || event.clientX > EDGE_START_MAX_X) return;

    const target = findSwipeTarget(root, event.clientX, event.clientY);
    if (!target) return;

    clearSettleTimer();
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAt: event.timeStamp,
      distanceX: 0,
      direction: 'pending',
      stackPrepared: false,
      restoreStack: () => undefined,
      target,
      styles: readInlineGestureStyles(target.element),
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (gesture.direction === 'pending') {
      if (
        Math.abs(deltaX) < DIRECTION_LOCK_DISTANCE &&
        Math.abs(deltaY) < DIRECTION_LOCK_DISTANCE
      ) {
        return;
      }
      if (deltaX <= 0 || Math.abs(deltaY) >= Math.abs(deltaX)) {
        gesture = null;
        return;
      }
      gesture.direction = 'horizontal';
      prepareGestureStack(gesture);
    }

    if (event.cancelable) event.preventDefault();
    applyDrag(gesture, deltaX);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const current = gesture;
    gesture = null;

    if (current.direction !== 'horizontal') return;

    const width = Math.max(
      1,
      current.target.element.getBoundingClientRect().width || window.innerWidth,
    );
    const shouldCommit =
      current.distanceX >= commitDistance(width) ||
      isFastSwipe(current, event.timeStamp);

    if (shouldCommit) {
      finishBack(current);
      return;
    }
    settleBack(current);
  };

  const refreshContracts = () => registerExistingAgentSurfaces(root);
  const observer = new MutationObserver(refreshContracts);
  observer.observe(root, { childList: true, subtree: true });
  observer.observe(document.body, { childList: true, subtree: false });
  refreshContracts();

  window.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('pointermove', onPointerMove, {
    capture: true,
    passive: false,
  });
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  window.addEventListener('pointercancel', cancelGesture, { capture: true });
  mobileAgentQuery.addEventListener('change', cancelGesture);
}
