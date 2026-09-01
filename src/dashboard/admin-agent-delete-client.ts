export async function deleteAgentAccount(agentId: string): Promise<void> {
  const response = await fetch(
    `/api/admin/agents/${encodeURIComponent(agentId)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    },
  );
  if (response.ok) return;

  let code = '';
  try {
    const payload = (await response.json()) as { error?: string };
    code = payload.error ?? '';
  } catch {
    // Fall through to the generic error when the response is not JSON.
  }

  if (code === 'UNAUTHORIZED') {
    throw new Error('登录已失效，请重新登录');
  }
  if (code === 'NOT_FOUND') {
    throw new Error('客服账号不存在或已删除');
  }
  throw new Error('删除客服失败，请重试');
}
