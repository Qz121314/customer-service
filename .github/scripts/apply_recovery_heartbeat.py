from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')

replace_once(
    'src/dashboard/App.tsx',
    """  getProductCatalog,
  markConversationRead,""",
    """  getProductCatalog,
  heartbeat,
  markConversationRead,""",
)

replace_once(
    'src/dashboard/App.tsx',
    """    const recover = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh().catch(() => undefined);
      if (selectedId) {""",
    """    const recover = () => {
      if (document.visibilityState !== 'visible') return;
      void heartbeat()
        .catch(() => undefined)
        .finally(() => void refresh().catch(() => undefined));
      if (selectedId) {""",
)

replace_once(
    'src/dashboard/App.tsx',
    """        setInboxConnected(true);
        if (openedOnce) void refresh().catch(() => undefined);
        openedOnce = true;""",
    """        setInboxConnected(true);
        if (openedOnce) {
          void heartbeat()
            .catch(() => undefined)
            .finally(() => void refresh().catch(() => undefined));
        }
        openedOnce = true;""",
)

replace_once(
    'test/realtime-contract.test.mjs',
    """  assert.ok(dashboard.includes('setMediaItems('));
});""",
    """  assert.ok(dashboard.includes('setMediaItems('));
  assert.ok(!dashboard.includes('setInterval(beat, 30_000)'));
  assert.ok(dashboard.includes('void heartbeat()'));
});""",
)

print('Recovery heartbeat patch applied.')
