export type AgentNotificationType = 'NEW_CONVERSATION' | 'CUSTOMER_REPLY';

export type AgentNotificationEvent = {
  type: AgentNotificationType;
  conversationId: string;
  messageId: string;
  preview: string;
};

export type AgentNotificationVariables = {
  agentNotification: AgentNotificationEvent | null;
};

type MediaCompletePayload = {
  conversationId?: string;
  messageId?: string;
  duplicate?: boolean;
  [key: string]: unknown;
};

const CLIENT_MESSAGE_PATH = /^\/client\/v1\/conversations\/([^/]+)\/messages$/u;
const CLIENT_MEDIA_COMPLETE_PATH = /^\/client\/v1\/media\/[^/]+\/complete$/u;

export function agentNotificationForConversationStart(input: {
  conversationId: string;
  message: { id: string; body: string } | null;
  newlyAssigned: boolean;
}): AgentNotificationEvent | null {
  if (!input.message) return null;
  return {
    type: input.newlyAssigned ? 'NEW_CONVERSATION' : 'CUSTOMER_REPLY',
    conversationId: input.conversationId,
    messageId: input.message.id,
    preview: input.message.body,
  };
}

export async function agentNotificationForVisitorResponse(
  pathname: string,
  response: Response,
): Promise<AgentNotificationEvent | null> {
  const messageMatch = pathname.match(CLIENT_MESSAGE_PATH);
  if (messageMatch?.[1] && response.status === 201) {
    const message = await responseMessage(response);
    return message?.id
      ? {
          type: 'CUSTOMER_REPLY',
          conversationId: decodeURIComponent(messageMatch[1]),
          messageId: message.id,
          preview: message.body ?? '',
        }
      : null;
  }
  if (CLIENT_MEDIA_COMPLETE_PATH.test(pathname)) {
    const payload = await responseMediaComplete(response);
    if (!payload?.duplicate && payload?.conversationId && payload.messageId) {
      return {
        type: 'CUSTOMER_REPLY',
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        preview: '客户发送了一张图片',
      };
    }
  }
  return null;
}

async function responseMessage(
  response: Response,
): Promise<{ id?: string; body?: string } | null> {
  try {
    const value = (await response.clone().json()) as {
      message?: { id?: string; body?: string };
    };
    return value.message ?? null;
  } catch {
    return null;
  }
}

async function responseMediaComplete(
  response: Response,
): Promise<MediaCompletePayload | null> {
  try {
    return (await response.clone().json()) as MediaCompletePayload;
  } catch {
    return null;
  }
}
