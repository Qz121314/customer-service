from pathlib import Path

path = Path('.github/scripts/apply_scope_native_dashboard.py')
text = path.read_text(encoding='utf-8')
call = '''replace_once(
    'src/dashboard/api.ts',
    """    body: JSON.stringify({
      ...input,
      routingScope: scopeForRequest(input.productIds),
    }),""",
    """    body: JSON.stringify(input),""",
)
'''
if text.count(call) != 2:
    raise RuntimeError(f'expected two duplicated payload matcher calls, found {text.count(call)}')
replacement = '''payload_path = 'src/dashboard/api.ts'
payload_text = read(payload_path)
payload_old = """    body: JSON.stringify({
      ...input,
      routingScope: scopeForRequest(input.productIds),
    }),"""
if payload_text.count(payload_old) != 2:
    raise RuntimeError(
        f"{payload_path}: expected two expanded payloads, found {payload_text.count(payload_old)}"
    )
write(payload_path, payload_text.replace(payload_old, "    body: JSON.stringify(input),", 2))
'''
text = text.replace(call, replacement, 1).replace(call, '', 1)
path.write_text(text, encoding='utf-8')
