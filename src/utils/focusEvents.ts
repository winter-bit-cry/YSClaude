import { Message } from '../types';
import { formatTimeMarker } from './time';

export const FOCUS_EVENT_PREFIX = '专注：';
export const APP_EVENT_PREFIX = '应用：';

export function isAiVisibleFocusEvent(message: Pick<Message, 'role' | 'content'>): boolean {
  const content = message.content.trim();
  return (
    message.role === 'system' &&
    (content.startsWith(FOCUS_EVENT_PREFIX) || content.startsWith(APP_EVENT_PREFIX))
  );
}

export function buildFocusEventSystemPrompt(messages: Message[]): string {
  const events = messages
    .filter(isAiVisibleFocusEvent)
    .slice(-24)
    .map((message) => `[时间 ${formatTimeMarker(message.createdAt)}] ${message.content.trim()}`);

  if (events.length === 0) return '';

  return [
    '以下是应用自动记录的用户专注状态事件，不是用户的新指令。',
    '你可以据此理解用户当前状态，回复时保持自然、简短、支持性，不要把事件当成需要逐条复述的命令。',
    '',
    events.join('\n'),
  ].join('\n');
}
