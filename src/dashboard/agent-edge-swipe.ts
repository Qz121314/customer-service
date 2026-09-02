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
const PAGE_BACK_TRIGGER_SELECTOR = 'button[aria-label^="返回"]';
const MODAL_CLOSE_TRIGGER_SELECTOR =
  'button[aria-label^="关闭"], button[aria-label^="返回"]';

type SwipeTarget = {
  element: HTMLElement;
  backButton: HTMLButtonElement;
};

type InlineGestureStyles = {
  animation: string;
  transform: string;
  transition: string;
  willChange: string;
  boxShadow: string;
};

type WorkspaceLayerStyles = {
  display: string;
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

function rememberSwipeContract(target: SwipeTarget) {
  target.element.dataset.agentSwipeBackSurface = 'true';
  target.backButton.dataset.agentSwipeBackTrigger = 'true';
}

function findVisibleModalTarget(hits: Element[]): SwipeTarget | null {
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    ),
  ].reverse();

  for (const dialog of dialogs) {
    if (!elementIsVisible(dialog)) continue;
    const surface =
      dialog.parentElement instanceof HTMLElement
        ? dialog.parentElement
        : dialog;
    if (!hits.some((hit) => surface.contains(hit))) continue;
    const backButton = dialog.querySelector<HTMLButtonElement>(
      MODAL_CLOSE_TRIGGER_SELECTOR,
    );
    if (
      !backButton ||
      backButton.disabled ||
      !elementIsVisible(backButton)
    ) {
      continue;
    }
    return { element: surface, backButton };
  }

  return null;
}

function findVisiblePageTarget(hits: Element[]): SwipeTarget | null {
  for (const hit of hits) {
    const surface = hit.closest<HTMLElement>('main, section');
    if (!surface || !elementIsVisible(surface)) continue;
    const backButton = surface.querySelector<HTMLButtonElement>(
      PAGE_BACK_TRIGGER_SELECTOR,
    );
    if (
      !backButton ||
      backButton.disabled ||
      !elementIsVisible(backButton)
    ) {
      continue;
    }
    return { element: surface, backButton };
  }

  return null;
}

function findSwipeTarget(clientX: number, clientY: number): SwipeTarget | null {
  if (!mobileAgentQuery.matches) return null;

  const hits = document.elementsFromPoint(clientX, clientY);
  const target = findVisibleModalTarget(hits) ?? findVisiblePageTarget(hits);
  if (!target) return null;
  rememberSwipeContract(target);
  return target;
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

function prepareWorkspaceUnderlay(target: SwipeTarget): () => void {
  if (target.element.tagName !== 'MAIN') return () => undefined;

  const shell = target.element.parentElement;
  if (!shell?.classList.contains('workspace-shell')) return () => undefined;

  const restoredLayers: Array<{
    element: HTMLElement;
    styles: WorkspaceLayerStyles;
  }> = [];

  for (const sibling of shell.children) {
    if (
      !(sibling instanceof HTMLElement) ||
      sibling === target.element
    ) {
      continue;
    }
    if (!['ASIDE', 'SECTION'].includes(sibling.tagName)) continue;
    if (window.getComputedStyle(sibling).display !== 'none') continue;
    restoredLayers.push({
      element: sibling,
      styles: { display: sibling.style.display },
    });
    sibling.style.display = 'flex';
  }

  if (restoredLayers.length === 0) return () => undefined;

  const position = target.element.style.position;
  const inset = target.element.style.inset;
  const zIndex = target.element.style.zIndex;
  const width = target.element.style.width;
  const height = target.element.style.height;

  target.element.style.position = 'absolute';
  target.element.style.inset = '0';
  target.element.style.zIndex = '60';
  target.element.style.width = '100%';
  target.element.style.height = '100%';

  return () => {
    for (const layer of restoredLayers) {
      layer.element.style.display = layer.styles.display;
    }
    target.element.style.position = position;
    target.element.style.inset = inset;
    target.element.style.zIndex = zIndex;
    target.element.style.width = width;
    target.element.style.height = height;
  };
}

function prepareGestureStack(gesture: ActiveGesture) {
  if (gesture.stackPrepared) return;
  gesture.stackPrepared = true;
  gesture.restoreStack = prepareWorkspaceUnderlay(gesture.target);
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
    const { element, backButton } = current.target;
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

      const restoreAfterHistory = () => {
        window.setTimeout(restorePending, 32);
      };
      window.addEventListener('popstate', restoreAfterHistory, { once: true });
      backButton.click();
      window.setTimeout(restorePending, 280);
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

    const target = findSwipeTarget(event.clientX, event.clientY);
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

  window.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('pointermove', onPointerMove, {
    capture: true,
    passive: false,
  });
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  window.addEventListener('pointercancel', cancelGesture, { capture: true });
  mobileAgentQuery.addEventListener('change', cancelGesture);
}
