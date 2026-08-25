import { useCallback, useEffect, useState } from 'react';

type AgentPwaInstallState = 'available' | 'installed' | 'manual';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installConfirmed = false;
const installStateListeners = new Set<() => void>();

function isStandaloneAgentPwa() {
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function readInstallState(): AgentPwaInstallState {
  if (installConfirmed || isStandaloneAgentPwa()) return 'installed';
  return deferredInstallPrompt ? 'available' : 'manual';
}

function notifyInstallStateListeners() {
  for (const listener of installStateListeners) listener();
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event as BeforeInstallPromptEvent;
  notifyInstallStateListeners();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  installConfirmed = true;
  notifyInstallStateListeners();
});

export function useAgentPwaInstall() {
  const [state, setState] = useState<AgentPwaInstallState>(() =>
    readInstallState(),
  );

  useEffect(() => {
    const syncState = () => setState(readInstallState());
    const displayMode = window.matchMedia('(display-mode: standalone)');
    installStateListeners.add(syncState);
    displayMode.addEventListener('change', syncState);
    window.addEventListener('pageshow', syncState);
    syncState();
    return () => {
      installStateListeners.delete(syncState);
      displayMode.removeEventListener('change', syncState);
      window.removeEventListener('pageshow', syncState);
    };
  }, []);

  const install = useCallback(async () => {
    if (isStandaloneAgentPwa()) {
      setState('installed');
      return 'installed' as const;
    }
    const prompt = deferredInstallPrompt;
    if (!prompt) return 'manual' as const;

    deferredInstallPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    installConfirmed = choice.outcome === 'accepted';
    const nextState = readInstallState();
    setState(nextState);
    notifyInstallStateListeners();
    return choice.outcome === 'accepted'
      ? ('accepted' as const)
      : ('dismissed' as const);
  }, []);

  return { state, install };
}
