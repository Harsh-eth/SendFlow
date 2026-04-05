export interface ConversationContext {
  userId: string;
  lastRecipient?: string;
  lastRecipientLabel?: string;
  lastAmount?: number;
  lastAction?: string;
  sessionStarted: number;
  messageCount: number;
}

const contexts = new Map<string, ConversationContext>();

export function updateContext(userId: string, updates: Partial<ConversationContext>): void {
  const cur = contexts.get(userId) ?? {
    userId,
    sessionStarted: Date.now(),
    messageCount: 0,
  };
  Object.assign(cur, updates, { messageCount: cur.messageCount + 1 });
  contexts.set(userId, cur);
}

export function getContext(userId: string): ConversationContext {
  return (
    contexts.get(userId) ?? {
      userId,
      sessionStarted: Date.now(),
      messageCount: 0,
    }
  );
}

export function clearContext(userId: string): void {
  contexts.delete(userId);
}

export function bumpMessageCount(userId: string): void {
  const c = getContext(userId);
  c.messageCount += 1;
  contexts.set(userId, c);
}
