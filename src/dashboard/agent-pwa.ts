type InstallChoice = {
  outcome: 'accepted' | 'dismissed';
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

export function setupAgentPwaInstall() {
  if (!window.location.pathname.startsWith('/agent')) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  let deferredPrompt: InstallPromptEvent | null = null;
  const installButton = document.createElement('button');
  installButton.type = 'button';
  installButton.className = 'agent-pwa-install';
  installButton.textContent = '安装坐席应用';
  installButton.hidden = true;
  document.body.append(installButton);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    installButton.hidden = false;
  });

  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    installButton.disabled = true;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installButton.remove();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installButton.remove();
  });
}
