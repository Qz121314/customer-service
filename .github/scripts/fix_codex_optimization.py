from pathlib import Path

path = Path('test/realtime-payload.test.mjs')
text = path.read_text(encoding='utf-8')
old = "return new Response(null, { status: 204 });"
if text.count(old) != 1:
    raise RuntimeError(f'expected one fake Response occurrence, found {text.count(old)}')
path.write_text(text.replace(old, "return { status: 204 };", 1), encoding='utf-8')
