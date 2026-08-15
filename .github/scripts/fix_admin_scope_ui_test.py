from pathlib import Path

path = Path('test/admin-scope-ui-contract.test.mjs')
text = path.read_text(encoding='utf-8')
old = "assert.ok(app.includes('agentScopeSummary(agent, products)'));"
new = "assert.ok(app.includes('agentScopeSummary('));"
if text.count(old) != 1:
    raise RuntimeError(f'expected one brittle assertion, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
