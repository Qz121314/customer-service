export type MessageReceiptState = {
  sender_type: 'visitor' | 'agent' | 'system';
  read_by_visitor_at: string | null;
  read_by_agent_at: string | null;
};

export function messageDelivery(
  message: MessageReceiptState,
): 'sent' | 'read' {
  if (message.sender_type === 'visitor') {
    return message.read_by_agent_at ? 'read' : 'sent';
  }
  return message.read_by_visitor_at ? 'read' : 'sent';
}
