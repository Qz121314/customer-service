import { useState } from 'react';
import { deleteAgentAccount } from './admin-agent-delete-client';
import { Button } from './ui';

export function AgentDeleteButton({
  agentId,
  disabled,
}: {
  agentId: string;
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      setError('');
      return;
    }

    setDeleting(true);
    setError('');
    try {
      await deleteAgentAccount(agentId);
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除客服失败，请重试');
      setConfirming(false);
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error ? (
        <span role="alert" className="text-sm font-medium text-destructive">
          {error}
        </span>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        disabled={disabled || deleting}
        onClick={() => void handleDelete()}
        onBlur={() => !deleting && setConfirming(false)}
      >
        {deleting
          ? '删除中…'
          : confirming
            ? '确认删除该客服'
            : '删除客服'}
      </Button>
    </div>
  );
}
