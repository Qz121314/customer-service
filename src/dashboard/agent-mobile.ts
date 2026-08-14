export function setupAgentMobileNavigation() {
  if (!window.location.pathname.startsWith('/agent')) return;

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'agent-mobile-back';
  backButton.setAttribute('aria-label', '返回会话列表');
  backButton.textContent = '‹';
  backButton.hidden = true;
  document.body.append(backButton);

  const showThread = () => {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    document
      .querySelector<HTMLElement>('.workspace-shell')
      ?.classList.add('mobile-thread-open');
    backButton.hidden = false;
  };

  const showList = () => {
    document
      .querySelector<HTMLElement>('.workspace-shell')
      ?.classList.remove('mobile-thread-open');
    backButton.hidden = true;
  };

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('.conversation-row')) {
      showThread();
    }
  });

  backButton.addEventListener('click', showList);
  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width: 760px)').matches) showList();
  });
}
