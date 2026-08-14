const MOBILE_THREAD_CLASS = 'mobile-thread-open';

export function setupAgentMobileNavigation() {
  if (!window.location.pathname.startsWith('/agent')) return;

  const media = window.matchMedia('(max-width: 760px)');
  let pushedThreadState = false;

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'agent-mobile-back';
  backButton.setAttribute('aria-label', '返回会话列表');
  backButton.textContent = '‹';
  backButton.hidden = true;
  document.body.append(backButton);

  const shell = () => document.querySelector<HTMLElement>('.workspace-shell');

  const sync = () => {
    const current = shell();
    backButton.hidden =
      !media.matches || !current?.classList.contains(MOBILE_THREAD_CLASS);
  };

  const openThread = () => {
    if (!media.matches) return;
    shell()?.classList.add(MOBILE_THREAD_CLASS);
    if (!pushedThreadState) {
      window.history.pushState({ agentThread: true }, '', window.location.href);
      pushedThreadState = true;
    }
    sync();
  };

  const closeThread = (fromHistory = false) => {
    shell()?.classList.remove(MOBILE_THREAD_CLASS);
    if (!fromHistory && pushedThreadState) {
      window.history.back();
      return;
    }
    pushedThreadState = false;
    sync();
    document
      .querySelector<HTMLElement>('.conversation-row.selected')
      ?.scrollIntoView({ block: 'nearest' });
  };

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.conversation-row')) openThread();
  });

  backButton.addEventListener('click', () => closeThread());
  window.addEventListener('popstate', () => {
    if (pushedThreadState) closeThread(true);
  });
  window.addEventListener('resize', sync);

  const root = document.getElementById('root');
  if (root) {
    new MutationObserver(sync).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  sync();
}
