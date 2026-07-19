import { Message } from '../types';

export const REACTION_MESSAGE_PREFIX = '[YS_REACTION]';

export type MessageReactionActor = 'user' | 'assistant';

export interface MessageReactionEvent {
  targetMessageId: string;
  reactor: MessageReactionActor;
  emoji: string;
}

export function buildReactionSystemContent(event: MessageReactionEvent): string {
  const readable = event.reactor === 'user'
    ? `用户对你的上一条回复贴了${event.emoji}`
    : `你给用户的消息贴了${event.emoji}`;
  return `${REACTION_MESSAGE_PREFIX}${JSON.stringify(event)}\n${readable}`;
}

export function parseReactionSystemMessage(message: Message): MessageReactionEvent | null {
  if (message.role !== 'system' || !message.content.startsWith(REACTION_MESSAGE_PREFIX)) {
    return null;
  }
  const firstLine = message.content.split('\n', 1)[0];
  try {
    const parsed = JSON.parse(firstLine.slice(REACTION_MESSAGE_PREFIX.length));
    if (
      typeof parsed?.targetMessageId !== 'string' ||
      (parsed?.reactor !== 'user' && parsed?.reactor !== 'assistant') ||
      typeof parsed?.emoji !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isReactionSystemMessage(message: Message): boolean {
  return parseReactionSystemMessage(message) !== null;
}

export function getReactionContextContent(message: Message): string {
  if (!isReactionSystemMessage(message)) return message.content;
  return message.content.split('\n').slice(1).join('\n').trim();
}

export function getReactionContextRole(
  message: Message
): 'user' | 'assistant' | null {
  const event = parseReactionSystemMessage(message);
  if (!event) return null;
  return event.reactor === 'user' ? 'user' : 'assistant';
}

export function buildReactionMap(messages: Message[]): Map<string, MessageReactionEvent> {
  const map = new Map<string, MessageReactionEvent>();
  for (const message of messages) {
    const event = parseReactionSystemMessage(message);
    if (!event) continue;
    const key = `${event.targetMessageId}:${event.reactor}`;
    if (event.emoji) map.set(key, event);
    else map.delete(key);
  }
  return map;
}

export function getLatestUserMessageGroup(messages: Message[]): Message[] {
  const conversationMessages = messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  );
  let lastAssistantIndex = -1;
  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    if (conversationMessages[i].role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }
  return conversationMessages
    .slice(lastAssistantIndex + 1)
    .filter((message) => message.role === 'user');
}
