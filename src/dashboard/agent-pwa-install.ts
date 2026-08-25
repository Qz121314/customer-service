export type AgentInstallCapability =
  | 'installed'
  | 'prompt'
  | 'ios'
  | 'manual';

type AgentInstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
};

const isAgentRoute = window.location.pathname.startsWith('/agent');
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    navigatorWithStandalone.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

function isIos() {
  return /iPad|iPhone|iPod/u.test(navigator.userAgent);
}

function emitCapabilityChange() {
  for (const listener of listeners) listener();
}

if (isAgentRoute) {
  installed = isStandalone();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emitCapabilityChange();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    emitCapabilityChange();
  });
}

export function getAgentInstallCapability(): AgentInstallCapability {
  if (!isAgentRoute) return 'manual';
  if (installed || isStandalone()) return 'installed';
  if (deferredPrompt) return 'prompt';
  return isIos() ? 'ios' : 'manual';
}

export function subscribeAgentInstallCapability(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function promptAgentInstall(): Promise<AgentInstallOutcome> {
  if (!isAgentRoute || !deferredPrompt) return 'unavailable';

  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === 'accepted') installed = true;
  emitCapabilityChange();
  return choice.outcome;
}
