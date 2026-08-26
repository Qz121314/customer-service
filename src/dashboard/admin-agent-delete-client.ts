export type DeleteAgentResult = {
  releasedConversationCount: number;
  reassignedCount: number;
};

export async function deleteAgentAccount(id: string): Promise<DeleteAgentResult> {
  const response = await fetch(`/api/admin/agents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const body = (await response.json().catch(() => ({}))) as Partial<DeleteAgentResult> & {
    error?: string;
  };
  if (!response.ok) {
    if (body.error === 'UNAUTHORIZED') throw new Error('登录已失效，请重新登录');
    if (body.error === 'NOT_FOUND') throw new Error('客服账号不存在或已被删除');
    throw new Error('删除客服失败，请稍后重试');
  }
  return {
    releasedConversationCount: Number(body.releasedConversationCount ?? 0),
    reassignedCount: Number(body.reassignedCount ?? 0),
  };
}
