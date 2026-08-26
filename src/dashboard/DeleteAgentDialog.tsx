import { useEffect } from 'react';
import type { AgentAccount } from './api';
import { Button } from './ui';

export function DeleteAgentDialog({
  agent,
  deleting,
  onCancel,
  onConfirm,
}: {
  agent: AgentAccount;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (deleting) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleting, onCancel]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => {
        if (!deleting) onCancel();
      }}
    >
      <section
        className="w-[min(460px,calc(100vw-32px))] rounded-[var(--radius-panel)] border border-border bg-card p-5 shadow-[var(--shadow-float)]"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-agent-title"
        aria-describedby="delete-agent-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="space-y-2">
          <span className="text-xs font-semibold text-destructive">删除客服账号</span>
          <h2 id="delete-agent-title" className="text-xl font-semibold text-foreground">
            删除“{agent.name}”？
          </h2>
          <p
            id="delete-agent-description"
            className="text-sm leading-6 text-muted-foreground"
          >
            此操作不可撤销。账号登录、负责范围、推送订阅、额度配置和头像会被删除；未结束会话会释放并重新分配。历史会话与流量统计继续保留。
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={deleting}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting ? '删除中…' : '确认删除'}
          </Button>
        </div>
      </section>
    </div>
  );
}
