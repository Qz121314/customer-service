import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  createH5ConversionPool,
  createH5Page,
  deleteH5ConversionPool,
  deleteH5Page,
  duplicateH5Page,
  getH5ConversionPools,
  getH5Pages,
  getH5Settings,
  publishH5Page,
  type H5ConversionPool,
  type H5Page,
  type H5Settings,
  uploadH5PageHtml,
  updateH5ConversionPool,
  updateH5Page,
  updateH5Settings,
} from './api';
import { message } from './dashboard-runtime';
import { UiIcon } from './icons';
import { Button, Field, FieldDescription, FieldLabel, Input } from './ui';

export type H5AdminView = 'pages' | 'pools' | 'settings';

export function H5ControlPlanePage({ view }: { view: H5AdminView }) {
  const [pages, setPages] = useState<H5Page[]>([]);
  const [pools, setPools] = useState<H5ConversionPool[]>([]);
  const [settings, setSettings] = useState<H5Settings>({ publicOrigin: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [nextPages, nextPools, nextSettings] = await Promise.all([
      getH5Pages(),
      getH5ConversionPools(),
      getH5Settings(),
    ]);
    setPages(nextPages);
    setPools(nextPools);
    setSettings(nextSettings);
  }, []);

  useEffect(() => {
    setBusy(true);
    refresh()
      .catch((reason) => setError(message(reason, '无法加载 H5 配置')))
      .finally(() => setBusy(false));
  }, [refresh]);

  async function run(action: () => Promise<void>, fallback: string) {
    setError('');
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(message(reason, fallback));
    }
  }

  return (
    <div className="h5-control-plane">
      {error ? (
        <button
          type="button"
          className="notice error h5-notice"
          onClick={() => setError('')}
        >
          {error}
        </button>
      ) : null}
      {view === 'pages' ? (
        <H5PagesWorkspace
          busy={busy}
          pages={pages}
          pools={pools}
          publicOrigin={settings.publicOrigin}
          onRun={run}
        />
      ) : null}
      {view === 'pools' ? (
        <H5PoolsWorkspace busy={busy} pools={pools} pages={pages} onRun={run} />
      ) : null}
      {view === 'settings' ? (
        <H5SettingsWorkspace
          settings={settings}
          onSaved={(next) => setSettings(next)}
          onRun={run}
        />
      ) : null}
    </div>
  );
}

function H5PagesWorkspace({
  busy,
  pages,
  pools,
  publicOrigin,
  onRun,
}: {
  busy: boolean;
  pages: H5Page[];
  pools: H5ConversionPool[];
  publicOrigin: string | null;
  onRun: (action: () => Promise<void>, fallback: string) => Promise<void>;
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [htmlEditor, setHtmlEditor] = useState<H5Page | null>(null);
  const enabledPools = useMemo(
    () => pools.filter((pool) => pool.isEnabled),
    [pools],
  );

  return (
    <>
      <WorkspaceHeading
        title="H5 页面"
        hint="每个页面对应一个 H5 Product，配置完成后再交给未来 H5 Runtime 使用。"
        action={
          <Button type="button" onClick={() => setEditor(newPageEditor())}>
            新建 H5 页面
          </Button>
        }
      />
      <section className="h5-table-card admin-table-card">
        {busy ? (
          <div className="empty-state">正在加载 H5 页面…</div>
        ) : pages.length === 0 ? (
          <div className="empty-state admin-empty">
            <strong>还没有 H5 页面</strong>
            <span>创建页面后即可绑定转化池并预览专属公网 URL。</span>
            <Button type="button" onClick={() => setEditor(newPageEditor())}>
              创建第一个页面
            </Button>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table h5-pages-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>Slug</th>
                  <th>转化池</th>
                  <th>状态</th>
                  <th>HTML 内容</th>
                  <th>Public URL</th>
                  <th>更新时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr
                    key={page.id}
                    className={!page.isEnabled ? 'is-disabled' : undefined}
                  >
                    <td>
                      <strong>{page.title}</strong>
                      <small className="h5-secondary-text">{page.id}</small>
                    </td>
                    <td>
                      <code>{page.slug}</code>
                    </td>
                    <td>{page.conversionPoolName ?? '未绑定'}</td>
                    <td>
                      <span
                        className={`h5-status ${page.isEnabled ? 'is-enabled' : ''}`}
                      >
                        {page.isEnabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`h5-status ${page.contentStatus === 'published' ? 'is-enabled' : ''}`}
                      >
                        {contentStatusLabel(page.contentStatus)}
                      </span>
                    </td>
                    <td>
                      <div className="h5-url-cell">
                        <span>{page.publicUrl ?? '未配置 H5 公网域名'}</span>
                        {page.publicUrl ? (
                          <button
                            type="button"
                            className="table-action"
                            onClick={() =>
                              void navigator.clipboard?.writeText(
                                page.publicUrl!,
                              )
                            }
                          >
                            复制
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatDate(page.updatedAt)}</td>
                    <td>
                      <div className="h5-row-actions">
                        <button
                          type="button"
                          className="table-action"
                          onClick={() => setHtmlEditor(page)}
                        >
                          {page.contentStatus === 'unuploaded'
                            ? '上传 HTML'
                            : '替换 HTML'}
                        </button>
                        <button
                          type="button"
                          className="table-action"
                          disabled={
                            page.contentStatus !== 'pending' &&
                            page.contentStatus !== 'updated'
                          }
                          onClick={() =>
                            void onRun(async () => {
                              await publishH5Page(page.id);
                            }, '发布 H5 页面失败')
                          }
                        >
                          发布
                        </button>
                        <a
                          className={`table-action ${
                            page.publicUrl &&
                            page.isEnabled &&
                            page.contentStatus === 'published'
                              ? ''
                              : 'is-disabled'
                          }`}
                          href={
                            page.publicUrl &&
                            page.isEnabled &&
                            page.contentStatus === 'published'
                              ? page.publicUrl
                              : undefined
                          }
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={
                            !(
                              page.publicUrl &&
                              page.isEnabled &&
                              page.contentStatus === 'published'
                            )
                          }
                          onClick={(event) => {
                            if (
                              !page.publicUrl ||
                              !page.isEnabled ||
                              page.contentStatus !== 'published'
                            )
                              event.preventDefault();
                          }}
                        >
                          打开公网 URL
                        </a>
                        <button
                          type="button"
                          className="table-action"
                          onClick={() => setEditor(editPageEditor(page))}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="table-action"
                          onClick={() =>
                            void onRun(async () => {
                              await duplicateH5Page(page.id);
                            }, '复制 H5 页面失败')
                          }
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          className="table-action"
                          onClick={() =>
                            void onRun(async () => {
                              await updateH5Page(page.id, {
                                isEnabled: !page.isEnabled,
                              });
                            }, '更新页面状态失败')
                          }
                        >
                          {page.isEnabled ? '停用' : '启用'}
                        </button>
                        <button
                          type="button"
                          className="table-action danger"
                          onClick={() => {
                            if (window.confirm('确认删除这个 H5 页面吗？'))
                              void onRun(async () => {
                                await deleteH5Page(page.id);
                              }, '删除 H5 页面失败');
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editor ? (
        <H5PageEditor
          editor={editor}
          pools={
            editor.id
              ? pools.filter(
                  (pool) =>
                    pool.isEnabled || pool.id === editor.conversionPoolId,
                )
              : enabledPools
          }
          publicOrigin={publicOrigin}
          onClose={() => setEditor(null)}
          onRun={onRun}
        />
      ) : null}
      {htmlEditor ? (
        <H5HtmlEditor
          page={htmlEditor}
          onClose={() => setHtmlEditor(null)}
          onRun={onRun}
        />
      ) : null}
    </>
  );
}

function H5PoolsWorkspace({
  busy,
  pools,
  pages,
  onRun,
}: {
  busy: boolean;
  pools: H5ConversionPool[];
  pages: H5Page[];
  onRun: (action: () => Promise<void>, fallback: string) => Promise<void>;
}) {
  const [editor, setEditor] = useState<PoolEditorState | null>(null);
  return (
    <>
      <WorkspaceHeading
        title="转化池"
        hint="配置 H5 CTA 行为；转化池不包含坐席，也不参与坐席分流。"
        action={
          <Button type="button" onClick={() => setEditor(newPoolEditor())}>
            新建转化池
          </Button>
        }
      />
      <section className="h5-table-card admin-table-card">
        {busy ? (
          <div className="empty-state">正在加载转化池…</div>
        ) : pools.length === 0 ? (
          <div className="empty-state admin-empty">
            <strong>还没有转化池</strong>
            <span>创建一个 Chat 或 External CTA 配置。</span>
            <Button type="button" onClick={() => setEditor(newPoolEditor())}>
              创建第一个转化池
            </Button>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table h5-pools-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>动作</th>
                  <th>CTA</th>
                  <th>目标</th>
                  <th>状态</th>
                  <th>使用页面</th>
                  <th>更新时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {pools.map((pool) => (
                  <tr
                    key={pool.id}
                    className={!pool.isEnabled ? 'is-disabled' : undefined}
                  >
                    <td>
                      <strong>{pool.name}</strong>
                      <small className="h5-secondary-text">{pool.id}</small>
                    </td>
                    <td>{pool.actionType === 'chat' ? 'Chat' : 'External'}</td>
                    <td>{pool.ctaLabel}</td>
                    <td>{pool.externalUrl ?? '未来打开 H5 Chat'}</td>
                    <td>
                      <span
                        className={`h5-status ${pool.isEnabled ? 'is-enabled' : ''}`}
                      >
                        {pool.isEnabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td>{pool.usedBy} 个页面</td>
                    <td>{formatDate(pool.updatedAt)}</td>
                    <td>
                      <div className="h5-row-actions">
                        <button
                          type="button"
                          className="table-action"
                          onClick={() => setEditor(editPoolEditor(pool))}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="table-action"
                          onClick={() =>
                            void onRun(async () => {
                              await updateH5ConversionPool(pool.id, {
                                isEnabled: !pool.isEnabled,
                              });
                            }, '更新转化池状态失败')
                          }
                        >
                          {pool.isEnabled ? '停用' : '启用'}
                        </button>
                        <button
                          type="button"
                          className="table-action danger"
                          disabled={pages.some(
                            (page) => page.conversionPoolId === pool.id,
                          )}
                          title={
                            pool.usedBy
                              ? `该转化池仍被 ${pool.usedBy} 个 H5 页面使用`
                              : undefined
                          }
                          onClick={() => {
                            if (window.confirm('确认删除这个转化池吗？'))
                              void onRun(async () => {
                                await deleteH5ConversionPool(pool.id);
                              }, '删除转化池失败');
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editor ? (
        <H5PoolEditor
          editor={editor}
          onClose={() => setEditor(null)}
          onRun={onRun}
        />
      ) : null}
    </>
  );
}

function H5SettingsWorkspace({
  settings,
  onSaved,
  onRun,
}: {
  settings: H5Settings;
  onSaved: (settings: H5Settings) => void;
  onRun: (action: () => Promise<void>, fallback: string) => Promise<void>;
}) {
  const [origin, setOrigin] = useState(settings.publicOrigin ?? '');
  useEffect(
    () => setOrigin(settings.publicOrigin ?? ''),
    [settings.publicOrigin],
  );
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onRun(async () => {
        onSaved(await updateH5Settings(origin));
      }, '保存 H5 公网域名失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <WorkspaceHeading
        title="H5 设置"
        hint="配置未来 H5 Worker 使用的默认公网 Origin。"
      />
      <section className="h5-settings-card admin-table-card">
        <form
          className="h5-settings-form"
          onSubmit={(event) => void submit(event)}
        >
          <Field>
            <FieldLabel htmlFor="h5-public-origin">H5 公网域名</FieldLabel>
            <Input
              id="h5-public-origin"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="https://h5.example.com"
              required
            />
            <FieldDescription>
              请先在 Cloudflare 中手动为 H5 Worker
              绑定自定义域名，再在此填写。只接受 HTTPS
              Origin，不接受路径、查询参数或片段。
            </FieldDescription>
          </Field>
          <div className="h5-settings-actions">
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存公网域名'}
            </Button>
            {settings.publicOrigin ? (
              <span className="h5-current-setting">
                当前：{settings.publicOrigin}
              </span>
            ) : (
              <span className="h5-secondary-text">尚未配置 H5 公网域名</span>
            )}
          </div>
        </form>
      </section>
    </>
  );
}

type EditorState = {
  id: string | null;
  title: string;
  slug: string;
  conversionPoolId: string | null;
  isEnabled: boolean;
};
type PoolEditorState = {
  id: string | null;
  name: string;
  actionType: 'chat' | 'external';
  ctaLabel: string;
  externalUrl: string;
  isEnabled: boolean;
};

function H5PageEditor({
  editor,
  pools,
  publicOrigin,
  onClose,
  onRun,
}: {
  editor: EditorState;
  pools: H5ConversionPool[];
  publicOrigin: string | null;
  onClose: () => void;
  onRun: (action: () => Promise<void>, fallback: string) => Promise<void>;
}) {
  const [state, setState] = useState(editor);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onRun(async () => {
        if (state.id) {
          const patch: Partial<EditorState> = {};
          if (state.title !== editor.title) patch.title = state.title;
          if (state.slug !== editor.slug) patch.slug = state.slug;
          if (state.conversionPoolId !== editor.conversionPoolId) {
            patch.conversionPoolId = state.conversionPoolId;
          }
          if (state.isEnabled !== editor.isEnabled) {
            patch.isEnabled = state.isEnabled;
          }
          await updateH5Page(state.id, patch);
        } else await createH5Page(state);
        onClose();
      }, '保存 H5 页面失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={state.id ? '编辑 H5 页面' : '新建 H5 页面'} onClose={onClose}>
      <form className="h5-editor-form" onSubmit={(event) => void submit(event)}>
        <Field>
          <FieldLabel htmlFor="h5-page-title">名称 / Title</FieldLabel>
          <Input
            id="h5-page-title"
            value={state.title}
            onChange={(event) =>
              setState({ ...state, title: event.target.value })
            }
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="h5-page-slug">Slug</FieldLabel>
          <Input
            id="h5-page-slug"
            value={state.slug}
            onChange={(event) =>
              setState({ ...state, slug: event.target.value })
            }
            placeholder="campaign-a"
            required
          />
          <FieldDescription>
            小写字母、数字和连字符，不能以连字符开头或结尾。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="h5-page-pool">Conversion Pool</FieldLabel>
          <select
            id="h5-page-pool"
            value={state.conversionPoolId ?? ''}
            onChange={(event) =>
              setState({
                ...state,
                conversionPoolId: event.target.value || null,
              })
            }
          >
            <option value="">未绑定</option>
            {pools.map((pool) => (
              <option value={pool.id} key={pool.id} disabled={!pool.isEnabled}>
                {pool.name} {!pool.isEnabled ? '（已停用）' : ''}
              </option>
            ))}
          </select>
        </Field>
        <label className="h5-checkbox">
          <input
            type="checkbox"
            checked={state.isEnabled}
            onChange={(event) =>
              setState({ ...state, isEnabled: event.target.checked })
            }
          />
          启用页面
        </label>
        <div className="h5-preview-url">
          Public URL：
          {publicOrigin
            ? `${publicOrigin}/${state.slug || 'slug'}/`
            : '未配置 H5 公网域名'}
        </div>
        <ModalActions saving={saving} onClose={onClose} />
      </form>
    </Modal>
  );
}

function H5HtmlEditor({
  page,
  onClose,
  onRun,
}: {
  page: H5Page;
  onClose: () => void;
  onRun: (action: () => Promise<void>, fallback: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSaving(true);
    try {
      await onRun(async () => {
        await uploadH5PageHtml(page.id, await file.text());
        onClose();
      }, '上传 H5 HTML 失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={page.contentStatus === 'unuploaded' ? '上传 HTML' : '替换 HTML'}
      onClose={onClose}
    >
      <form className="h5-editor-form" onSubmit={(event) => void submit(event)}>
        <Field>
          <FieldLabel htmlFor="h5-page-html">HTML 文件</FieldLabel>
          <Input
            id="h5-page-html"
            type="file"
            accept=".html,text/html"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
          <FieldDescription>
            只接受单个 UTF-8 HTML 文件，最大 5 MB；不允许外部脚本和追踪 SDK。
          </FieldDescription>
          {file ? (
            <span className="h5-secondary-text">已选择：{file.name}</span>
          ) : null}
        </Field>
        <div className="h5-modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? '上传中…' : '上传 HTML'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function H5PoolEditor({
  editor,
  onClose,
  onRun,
}: {
  editor: PoolEditorState;
  onClose: () => void;
  onRun: (action: () => Promise<void>, fallback: string) => Promise<void>;
}) {
  const [state, setState] = useState(editor);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onRun(async () => {
        const input = {
          ...state,
          externalUrl: state.actionType === 'chat' ? null : state.externalUrl,
        };
        if (state.id) await updateH5ConversionPool(state.id, input);
        else await createH5ConversionPool(input);
        onClose();
      }, '保存转化池失败');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={state.id ? '编辑转化池' : '新建转化池'} onClose={onClose}>
      <form className="h5-editor-form" onSubmit={(event) => void submit(event)}>
        <Field>
          <FieldLabel htmlFor="h5-pool-name">名称</FieldLabel>
          <Input
            id="h5-pool-name"
            value={state.name}
            onChange={(event) =>
              setState({ ...state, name: event.target.value })
            }
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="h5-pool-action">动作类型</FieldLabel>
          <select
            id="h5-pool-action"
            value={state.actionType}
            onChange={(event) =>
              setState({
                ...state,
                actionType: event.target.value as 'chat' | 'external',
              })
            }
          >
            <option value="chat">Chat（未来打开 H5 Chat）</option>
            <option value="external">External（跳转外部 HTTPS 地址）</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="h5-pool-cta">CTA 文案</FieldLabel>
          <Input
            id="h5-pool-cta"
            value={state.ctaLabel}
            onChange={(event) =>
              setState({ ...state, ctaLabel: event.target.value })
            }
            required
          />
        </Field>
        {state.actionType === 'external' ? (
          <Field>
            <FieldLabel htmlFor="h5-pool-url">External URL</FieldLabel>
            <Input
              id="h5-pool-url"
              type="url"
              value={state.externalUrl}
              onChange={(event) =>
                setState({ ...state, externalUrl: event.target.value })
              }
              placeholder="https://example.com/offer"
              required
            />
          </Field>
        ) : (
          <FieldDescription>
            Chat 类型不保存外部 URL，未来由 H5 Runtime 打开客服聊天。
          </FieldDescription>
        )}
        <label className="h5-checkbox">
          <input
            type="checkbox"
            checked={state.isEnabled}
            onChange={(event) =>
              setState({ ...state, isEnabled: event.target.checked })
            }
          />
          启用转化池
        </label>
        <ModalActions saving={saving} onClose={onClose} />
      </form>
    </Modal>
  );
}

function WorkspaceHeading({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <header className="h5-workspace-heading">
      <div>
        <h1>{title}</h1>
        <p>{hint}</p>
      </div>
      {action}
    </header>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="h5-modal-backdrop" role="presentation">
      <section
        className="h5-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="h5-modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <UiIcon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ModalActions({
  saving,
  onClose,
}: {
  saving: boolean;
  onClose: () => void;
}) {
  return (
    <div className="h5-modal-actions">
      <Button type="button" variant="secondary" onClick={onClose}>
        取消
      </Button>
      <Button type="submit" disabled={saving}>
        {saving ? '保存中…' : '保存'}
      </Button>
    </div>
  );
}

function newPageEditor(): EditorState {
  return {
    id: null,
    title: '',
    slug: '',
    conversionPoolId: null,
    isEnabled: true,
  };
}

function contentStatusLabel(status: H5Page['contentStatus']): string {
  return {
    unuploaded: '未上传',
    pending: '待发布',
    published: '已发布',
    updated: '有未发布更新',
  }[status];
}

function editPageEditor(page: H5Page): EditorState {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    conversionPoolId: page.conversionPoolId,
    isEnabled: page.isEnabled,
  };
}
function newPoolEditor(): PoolEditorState {
  return {
    id: null,
    name: '',
    actionType: 'chat',
    ctaLabel: '立即咨询',
    externalUrl: '',
    isEnabled: true,
  };
}
function editPoolEditor(pool: H5ConversionPool): PoolEditorState {
  return {
    id: pool.id,
    name: pool.name,
    actionType: pool.actionType,
    ctaLabel: pool.ctaLabel,
    externalUrl: pool.externalUrl ?? '',
    isEnabled: pool.isEnabled,
  };
}
function formatDate(value: string): string {
  return value ? value.replace('T', ' ').replace('Z', '').slice(0, 16) : '—';
}
