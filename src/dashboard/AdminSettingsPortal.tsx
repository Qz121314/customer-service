import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { adminLogin, adminLogout, getAdminSession } from './api';
import {
  getAdminSiteSettings,
  updateAdminSiteSettings,
} from './admin-settings-api';
import { message } from './dashboard-runtime';
import { AdminLogin, AdminSetup, Startup } from './dashboard-ui';
import { UiIcon } from './icons';
import { Button, Textarea } from './ui';

type LoadState = 'loading' | 'not-configured' | 'signed-out' | 'authenticated';

export function AdminSettingsPortal() {
  const [state, setState] = useState<LoadState>('loading');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    getAdminSession()
      .then((session) => {
        if (!session.configured) setState('not-configured');
        else setState(session.authenticated ? 'authenticated' : 'signed-out');
      })
      .catch(() => setState('signed-out'));
  }, []);

  if (state === 'loading') return <Startup label="正在加载访客提示设置…" />;
  if (state === 'not-configured') return <AdminSetup />;
  if (state === 'signed-out') {
    return (
      <AdminLogin
        password={password}
        error={loginError}
        onChange={setPassword}
        onSubmit={async (event) => {
          event.preventDefault();
          setLoginError('');
          try {
            await adminLogin(password);
            setPassword('');
            setState('authenticated');
          } catch (reason) {
            setLoginError(message(reason, '登录失败'));
          }
        }}
      />
    );
  }

  return (
    <SettingsWorkspace
      onLogout={async () => {
        await adminLogout();
        setState('signed-out');
      }}
    />
  );
}

function SettingsWorkspace({ onLogout }: { onLogout: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    getAdminSiteSettings()
      .then((settings) => {
        if (!active) return;
        setValue(settings.noAgentMessage);
        setSavedValue(settings.noAgentMessage);
      })
      .catch((reason) => {
        if (active) setError(message(reason, '无法加载访客提示'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const noAgentMessage = value.trim();
    if (!noAgentMessage || noAgentMessage.length > 300 || saving) return;

    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const settings = await updateAdminSiteSettings({ noAgentMessage });
      setValue(settings.noAgentMessage);
      setSavedValue(settings.noAgentMessage);
      setSaved(true);
    } catch (reason) {
      setError(message(reason, '保存访客提示失败'));
    } finally {
      setSaving(false);
    }
  }

  const trimmed = value.trim();
  const dirty = trimmed !== savedValue;
  const valid = trimmed.length > 0 && trimmed.length <= 300;

  return (
    <div className="admin-settings-page">
      <header className="admin-settings-header">
        <a className="admin-settings-back" href="/">
          <UiIcon name="back" />
          <span>返回客服管理</span>
        </a>
        <button
          type="button"
          className="admin-settings-logout"
          onClick={() => void onLogout()}
        >
          <UiIcon name="logout" />
          <span>退出管理</span>
        </button>
      </header>

      <main className="admin-settings-main">
        <div className="admin-settings-heading">
          <span className="admin-settings-icon" aria-hidden="true">
            <UiIcon name="settings" />
          </span>
          <div>
            <span className="eyebrow">VISITOR MESSAGE</span>
            <h1>无客服提示</h1>
            <p>
              当前产品没有可分配客服时，不创建等待会话，访客端直接显示这里的提示语。
            </p>
          </div>
        </div>

        <form className="admin-settings-card" onSubmit={save}>
          <div className="admin-settings-card-head">
            <div>
              <strong>访客提示语</strong>
              <span>可填写营业时间、稍后再试或其他运营说明。</span>
            </div>
            <small>{value.length} / 300</small>
          </div>

          {loading ? (
            <div className="admin-settings-loading">正在读取设置…</div>
          ) : (
            <>
              <label className="admin-settings-field">
                <span>无可接待客服时显示</span>
                <Textarea
                  value={value}
                  maxLength={300}
                  rows={5}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setSaved(false);
                  }}
                  placeholder="例如：当前为非营业时间，我们将在明天 9:00 后恢复在线接待。"
                />
              </label>

              <div className="admin-settings-preview" aria-live="polite">
                <span>访客端预览</span>
                <p>{trimmed || '请输入访客提示语。'}</p>
              </div>

              {error ? <div className="notice error">{error}</div> : null}
              {saved ? <div className="notice">已保存访客提示。</div> : null}

              <div className="admin-settings-actions">
                <span>
                  只有成功分配到客服的咨询才会创建会话并进入接待统计与额度计数。
                </span>
                <Button type="submit" disabled={!valid || !dirty || saving}>
                  {saving ? '保存中…' : '保存设置'}
                </Button>
              </div>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
