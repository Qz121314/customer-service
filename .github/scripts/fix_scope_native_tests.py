from pathlib import Path

path = Path('test/admin-scope-ui-contract.test.mjs')
text = path.read_text(encoding='utf-8')
old = "assert.ok(api.includes('routingScope: scope'));"
new = "assert.ok(api.includes('routingScope: normalizeRoutingScope('));"
if text.count(old) != 1:
    raise RuntimeError(f'expected one legacy scope assertion, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
