from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old[:100]!r}')
    target.write_text(source.replace(old, new, 1), encoding='utf-8')

replace_once(
    'src/dashboard/App.tsx',
    """          <button
            className={section === 'agents' ? 'active' : ''}""",
    """          <button
            type="button"
            className={section === 'agents' ? 'active' : ''}""",
)
replace_once(
    'src/dashboard/App.tsx',
    """          <button
            className={section === 'workspace' ? 'active' : ''}""",
    """          <button
            type="button"
            className={section === 'workspace' ? 'active' : ''}""",
)
replace_once(
    'src/dashboard/App.tsx',
    '<button onClick={() => void onLogout()}>退出管理</button>',
    '<button type="button" onClick={() => void onLogout()}>退出管理</button>',
)
replace_once(
    'src/dashboard/App.tsx',
    '<button className="primary-button" onClick={createNewAgent}>\n              新增客服\n            </button>',
    '<button type="button" className="primary-button" onClick={createNewAgent}>\n              新增客服\n            </button>',
)
replace_once(
    'src/dashboard/App.tsx',
    '<button className="notice error" onClick={() => setError(\'\')}>',
    '<button type="button" className="notice error" onClick={() => setError(\'\')}>',
)
replace_once(
    'src/dashboard/App.tsx',
    '<span>创建第一个客服账号后，由管理员给它分配负责产品。</span>',
    '<span>创建第一个客服账号后，再配置它的分流负责范围。</span>',
)
replace_once(
    'src/dashboard/App.tsx',
    '<button className="primary-button" onClick={createNewAgent}>\n                    新增客服\n                  </button>',
    '<button type="button" className="primary-button" onClick={createNewAgent}>\n                    新增客服\n                  </button>',
)
replace_once(
    'src/dashboard/App.tsx',
    """                            <button
                              className="table-action""" ,
    """                            <button
                              type="button"
                              className="table-action""",
)
replace_once(
    'src/dashboard/App.tsx',
    """                <button
                  className="secondary-button"
                  onClick={() => void copyWorkspaceUrl()}""",
    """                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void copyWorkspaceUrl()}""",
)
replace_once(
    'src/dashboard/ProductAssignmentPicker.tsx',
    '<span>搜索和筛选只在浏览器本地执行</span>',
    '<span>可按分区和分类缩小查找范围</span>',
)

# Keep this semantics/copy cleanup guarded against regression.
path = ROOT / 'test/admin-scope-ui-contract.test.mjs'
source = path.read_text(encoding='utf-8')
source = source.replace(
    "  assert.ok(app.includes('aria-modal=\"true\"'));\n",
    "  assert.ok(app.includes('aria-modal=\"true\"'));\n  assert.ok(app.includes('再配置它的分流负责范围'));\n  assert.ok(!app.includes('分配负责产品'));\n",
)
path.write_text(source, encoding='utf-8')

print('Admin copy/a11y cleanup applied.')
