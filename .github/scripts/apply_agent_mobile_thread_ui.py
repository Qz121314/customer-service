from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, value: str) -> None:
    (ROOT / path).write_text(value, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    source = read(path)
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old[:110]!r}')
    write(path, source.replace(old, new, 1))

# Make mobile state explicit: inbox and thread are separate app surfaces.
replace_once(
    'src/dashboard/App.tsx',
    '<div className="workspace-shell">',
    '<div className={`workspace-shell${selectedId ? \' is-thread-open\' : \'\'}`}>',
)

replace_once(
    'src/dashboard/App.tsx',
    """        <button className="ghost-button full" onClick={() => void onLogout()}>
          退出客服账号
        </button>""",
    """        <button
          type="button"
          className="ghost-button full"
          onClick={() => void onLogout()}
        >
          退出客服账号
        </button>""",
)
replace_once(
    'src/dashboard/App.tsx',
    """            <button
              key={item}
              className={filter === item ? 'filter active' : 'filter'}""",
    """            <button
              type="button"
              key={item}
              className={filter === item ? 'filter active' : 'filter'}""",
)
replace_once(
    'src/dashboard/App.tsx',
    """              <button
                key={conversation.id}
                className={[""",
    """              <button
                type="button"
                key={conversation.id}
                className={[""",
)
replace_once(
    'src/dashboard/App.tsx',
    """          <button
            className="notice error floating"
            onClick={() => setError('')}""",
    """          <button
            type="button"
            className="notice error floating"
            onClick={() => setError('')}""",
)

replace_once(
    'src/dashboard/App.tsx',
    """            <header className="thread-head">
              <div>
                <span className="eyebrow">VISITOR</span>""",
    """            <header className="thread-head">
              <button
                type="button"
                className="thread-back-button"
                aria-label="返回会话列表"
                onClick={() => setSelectedId(null)}
              >
                ‹
              </button>
              <div className="thread-head-copy">
                <span className="eyebrow">VISITOR</span>""",
)

# Replace the mobile layout with a true inbox -> thread navigation model.
write(
    'src/dashboard/agent-mobile-layout.css',
    """.thread-back-button {
  display: none;
}

@media (max-width: 760px) {
  html,
  body,
  #root {
    width: 100%;
    height: 100%;
    min-height: 100%;
    overflow: hidden;
  }

  body {
    overscroll-behavior: none;
  }

  .workspace-shell {
    position: relative;
    display: block;
    width: 100%;
    height: 100dvh;
    min-height: 0;
    padding-top: env(safe-area-inset-top);
    overflow: hidden;
    background: #f5f6f8;
  }

  .workspace-sidebar {
    display: flex;
    height: 58px;
    min-height: 58px;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-right: 0;
    border-bottom: 1px solid #e4e7eb;
    background: rgba(255, 255, 255, 0.98);
  }

  .workspace-brand,
  .workspace-metrics {
    display: none;
  }

  .agent-profile {
    display: grid;
    min-width: 0;
    flex: 1;
    grid-template-columns: auto minmax(0, 1fr) auto;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .agent-profile > div {
    display: grid;
    gap: 1px;
  }

  .agent-profile strong {
    overflow: hidden;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-profile small {
    display: none;
  }

  .workspace-sidebar .ghost-button,
  .workspace-sidebar .ghost-button.full {
    display: inline-flex;
    width: auto;
    min-height: 36px;
    flex: 0 0 auto;
    margin: 0;
    padding: 0 10px;
    font-size: 12px;
  }

  .conversation-pane {
    display: flex;
    height: calc(100dvh - 58px - env(safe-area-inset-top));
    min-height: 0;
    border: 0;
  }

  .conversation-head {
    min-height: 68px;
    padding: 12px 14px 10px;
  }

  .conversation-head h1 {
    font-size: 21px;
  }

  .conversation-head .eyebrow {
    margin-bottom: 3px;
    font-size: 10px;
  }

  .online-pill {
    padding: 5px 8px;
    font-size: 10px;
  }

  .filters {
    min-height: 48px;
    gap: 4px;
    padding: 7px 10px;
    scrollbar-width: none;
  }

  .filters::-webkit-scrollbar {
    display: none;
  }

  .filter {
    min-height: 34px;
    padding: 7px 11px;
    font-size: 13px;
  }

  .conversation-list {
    min-height: 0;
    flex: 1;
    overscroll-behavior: contain;
  }

  .conversation-row {
    min-height: 78px;
    padding: 11px 12px;
  }

  .conversation-copy > span strong {
    font-size: 15px;
  }

  .conversation-copy time,
  .conversation-copy small,
  .conversation-copy p {
    font-size: 12px;
  }

  .workspace-shell:not(.is-thread-open) .thread-pane {
    display: none;
  }

  .workspace-shell.is-thread-open {
    padding-top: env(safe-area-inset-top);
    background: #fafafa;
  }

  .workspace-shell.is-thread-open .workspace-sidebar,
  .workspace-shell.is-thread-open .conversation-pane {
    display: none;
  }

  .workspace-shell.is-thread-open .thread-pane {
    display: flex;
    width: 100%;
    height: calc(100dvh - env(safe-area-inset-top));
    min-height: 0;
  }

  .thread-head {
    position: relative;
    top: auto;
    z-index: 4;
    display: grid;
    min-height: 66px;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.98);
  }

  .thread-back-button {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 9px;
    color: #272b31;
    background: transparent;
    font-size: 30px;
    font-weight: 400;
    line-height: 1;
  }

  .thread-back-button:active {
    background: #f0f1f3;
    transform: scale(0.96);
  }

  .thread-head-copy {
    min-width: 0;
  }

  .thread-head .eyebrow {
    display: none;
  }

  .thread-head h2 {
    overflow: hidden;
    font-size: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thread-head p {
    margin-top: 2px;
    font-size: 11px;
  }

  .thread-head select {
    min-width: 88px;
    min-height: 38px;
    padding-inline: 8px;
    font-size: 12px;
  }

  .conversation-expiry {
    margin-top: 4px;
    padding: 3px 6px;
    font-size: 10px;
  }

  .messages {
    min-height: 0;
    gap: 10px;
    padding: 14px 10px 18px;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }

  .message > div {
    max-width: 86%;
  }

  .message p {
    padding: 9px 11px;
    font-size: 14px;
    line-height: 1.48;
  }

  .composer {
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
  }

  .composer textarea {
    min-height: 52px;
    max-height: 104px;
    padding: 10px 11px;
    font-size: 16px;
  }

  .composer-foot {
    margin-top: 6px;
  }

  .composer-foot > span {
    display: none;
  }

  .composer-foot .primary-button {
    min-width: 76px;
    margin-left: auto;
  }
}
""",
)

# Guard the app-like mobile state transition in CI.
write(
    'test/agent-mobile-layout-contract.test.mjs',
    """import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent mobile workspace uses separate inbox and thread surfaces', () => {
  const app = source('../src/dashboard/App.tsx');
  const css = source('../src/dashboard/agent-mobile-layout.css');

  assert.ok(app.includes("workspace-shell${selectedId ? ' is-thread-open' : ''}"));
  assert.ok(app.includes('className="thread-back-button"'));
  assert.ok(app.includes('aria-label="返回会话列表"'));
  assert.ok(css.includes('.workspace-shell:not(.is-thread-open) .thread-pane'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .conversation-pane'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .thread-pane'));
  assert.ok(css.includes('height: calc(100dvh - env(safe-area-inset-top))'));
});
""",
)

print('Agent mobile thread UI applied.')
