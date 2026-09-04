import './ui-system.css';

function normalizeAgentVibrationCapability(): void {
  if (
    !window.location.pathname.startsWith('/agent') ||
    navigator.maxTouchPoints > 0 ||
    typeof navigator.vibrate !== 'function'
  ) {
    return;
  }

  try {
    const navigatorPrototype = Object.getPrototypeOf(navigator) as object;
    Object.defineProperty(navigatorPrototype, 'vibrate', {
      configurable: true,
      value: () => false,
    });
  } catch {
    // Unsupported desktop vibration is best-effort only.
  }
}

normalizeAgentVibrationCapability();

const routeEntry = window.location.pathname.startsWith('/agent')
  ? import('./agent-entry')
  : import('./admin-entry');

void routeEntry.then(({ bootstrap }) => bootstrap());
