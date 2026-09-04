export type AgentNotificationType = 'NEW_CONVERSATION' | 'CUSTOMER_REPLY';

export type AgentNotificationEvent = {
  type: AgentNotificationType;
  conversationId: string;
  messageId: string;
  preview: string;
};

type MediaCompletePayload = {
  conversationId?: string;
  messageId?: string;
  duplicate?: boolean;
  [key: string]: unknown;
};

const CLIENT_CONVERSATION_CREATE_PATH = /^\/client\/v1\/conversations$/u;
const CLIENT_MESSAGE_PATH = /^\/client\/v1\/conversations\/([^/]+)\/messages$/u;
const CLIENT_MEDIA_COMPLETE_PATH = /^\/client\/v1\/media\/[^/]+\/complete$/u;

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
  if (
    CLIENT_CONVERSATION_CREATE_PATH.test(pathname) &&
    response.status === 201
  ) {
    return responseNewConversation(response);
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

async function responseNewConversation(
  response: Response,
): Promise<AgentNotificationEvent | null> {
  try {
    const value = (await response.clone().json()) as {
      conversation?: {
        id?: string;
        messages?: Array<{ id?: string; direction?: string; body?: string }>;
      };
    };
    const conversationId = value.conversation?.id;
    if (typeof conversationId !== 'string' || !conversationId) return null;
    const message = value.conversation?.messages
      ?.slice()
      .reverse()
      .find((item) => item.direction === 'customer' && item.id);
    return {
      type: 'NEW_CONVERSATION',
      conversationId,
      messageId: message?.id || conversationId,
      preview: message?.body ?? '',
    };
  } catch {
    return null;
  }
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
