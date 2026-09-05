import type { AgentReminderType } from './dashboard-runtime-core.ts';

export async function resumeAgentAudio(
  context: AudioContext,
): Promise<boolean> {
  if (context.state === 'running') return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      context.resume().then(() => context.state === 'running'),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 1_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type AgentReminder = {
  type: AgentReminderType;
  messageId: string;
  conversationId: string;
};

type PendingReminder = {
  reminder: AgentReminder;
  sound: boolean;
  vibration: boolean;
  running: boolean;
};

// Delivery acknowledgements are capability-specific. A failed attempt never
// consumes the message, and a retry must not repeat a capability that succeeded.
export function createAgentReminderDelivery(runtime: {
  system: (reminder: AgentReminder) => Promise<boolean>;
  sound: (type: AgentReminderType) => Promise<boolean>;
  vibrate: (type: AgentReminderType) => boolean;
  vibrationSupported: boolean;
  changed?: (pending: boolean) => void;
}) {
  const messages = new Map<string, PendingReminder>();
  let active = true;
  async function attempt(item: PendingReminder) {
    if (!active || item.running || (item.sound && item.vibration)) return;
    item.running = true;
    try {
      // A partially delivered local reminder retries only its missing channel.
      if (!item.sound && (!runtime.vibrationSupported || !item.vibration)) {
        let delivered = false;
        try {
          delivered = await runtime.system(item.reminder);
        } catch {
          /* Fall back to browser capabilities. */
        }
        if (!active) return;
        if (delivered) {
          item.sound = true;
          item.vibration = true;
          return;
        }
      }
      if (!active) return;
      if (!item.vibration) {
        try {
          item.vibration = runtime.vibrate(item.reminder.type);
        } catch {
          /* Retry on interaction. */
        }
      }
      if (!item.sound) {
        try {
          item.sound = await runtime.sound(item.reminder.type);
        } catch {
          /* Retry on interaction. */
        }
      }
    } finally {
      item.running = false;
      if (active)
        runtime.changed?.(
          [...messages.values()].some(
            (value) => !value.sound || !value.vibration,
          ),
        );
    }
  }
  return {
    receive(reminder: AgentReminder) {
      if (!active || !reminder.messageId || !reminder.conversationId) return;
      let item = messages.get(reminder.messageId);
      if (!item) {
        item = {
          reminder,
          sound: false,
          vibration: !runtime.vibrationSupported,
          running: false,
        };
        messages.set(reminder.messageId, item);
        // Successful entries are only a bounded duplicate cache. Pending work
        // remains available for an explicit interaction/visibility retry.
        if (messages.size > 500) {
          for (const [id, previous] of messages) {
            if (previous.sound && previous.vibration && !previous.running) {
              messages.delete(id);
              if (messages.size <= 500) break;
            }
          }
        }
      }
      void attempt(item);
    },
    retry() {
      for (const item of messages.values()) void attempt(item);
    },
    dispose() {
      active = false;
      messages.clear();
    },
  };
}
