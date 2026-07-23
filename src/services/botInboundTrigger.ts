import { randomUUID } from 'expo-crypto';
import { createConversation, getAllConversations } from '../db/operations';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { Conversation } from '../types';

let inboundQueue: Promise<unknown> = Promise.resolve();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChatIdle(): Promise<void> {
  while (useChatStore.getState().isStreaming) await delay(400);
}

async function ensureConversation(): Promise<Conversation> {
  const latest = (await getAllConversations())[0];
  if (latest) return latest;
  const settings = useSettingsStore.getState();
  const api = settings.apiConfigs[settings.activeConfigIndex];
  const now = Date.now();
  const conversation: Conversation = {
    id: randomUUID(),
    title: 'Bot 消息',
    systemPrompt: settings.systemPrompt,
    model: api?.model || '',
    createdAt: now,
    updatedAt: now,
  };
  await createConversation(conversation);
  return conversation;
}

async function triggerNow(
  platform: 'qq' | 'wechat',
  source?: { contactId: string; contactName?: string }
): Promise<void> {
  await waitForChatIdle();
  const conversation = await ensureConversation();
  const chat = useChatStore.getState();
  if (chat.conversationId !== conversation.id) await chat.loadConversation(conversation.id);

  const platformName = platform === 'qq' ? 'QQ Bot' : '微信 ClawBot';
  const toolName = platform === 'qq' ? 'qq_bot_send_message' : 'wechat_clawbot_send_message';
  const sourceText = source
    ? `来源联系人（群聊）：${source.contactName || '名称未知'}；contact_id：${source.contactId}。`
    : '';
  await useChatStore.getState().triggerResponse({
    additionalRuntimeSections: [
      `这是一次性平台事件：用户刚刚从 ${platformName} 发来一条新消息。${sourceText}消息正文没有写入 YSClaude 对话，也不会直接提供在本提示中。`,
    ],
    ephemeralUserMessage: `请先调用 ${platform === 'qq' ? 'qq_bot_read_messages' : 'wechat_clawbot_read_messages'} 工具查看用户刚发来的消息${source ? `（contact_id=${source.contactId}）` : ''}，再根据消息内容作出回复，并调用 ${toolName} 工具把回复发送回 ${platformName}${source ? ` 的同一联系人（contact_id=${source.contactId}）` : ''}。不要询问 YSClaude 当前对话中的用户，也不要假设消息正文。`,
  });
}

export function triggerBotInboundMessage(
  platform: 'qq' | 'wechat',
  _content: string,
  source?: { contactId: string; contactName?: string }
): Promise<void> {
  const next = inboundQueue.catch(() => undefined).then(() => triggerNow(platform, source));
  inboundQueue = next.catch(() => undefined);
  return next;
}
