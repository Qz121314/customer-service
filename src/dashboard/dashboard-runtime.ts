import type { AgentReminderType } from './dashboard-runtime-core.ts';

export async function playAgentNativeAlert(
  type: AgentReminderType,
): Promise<boolean | null> {
  const internals = (window as Window & { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__;
  if (!internals) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('play_agent_alert', { alertType: type });
    return true;
  } catch {
    return false;
  }
}

export * from './dashboard-runtime-core.ts';
