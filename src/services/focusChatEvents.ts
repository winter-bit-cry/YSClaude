import { randomUUID } from 'expo-crypto';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { Conversation, Message } from '../types';
import {
  createConversation,
  getAllConversations,
  insertMessage,
  updateConversation,
} from '../db/operations';

let focusEventQueue: Promise<unknown> = Promise.resolve();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChatIdle(): Promise<void> {
  while (useChatStore.getState().isStreaming) {
    await delay(500);
  }
}

async function getLatestCreatedConversation(): Promise<Conversation | null> {
  const conversations = await getAllConversations();
  return conversations[0] ?? null;
}

async function ensureLatestCreatedConversation(): Promise<Conversation> {
  const latest = await getLatestCreatedConversation();
  if (latest) return latest;

  const settings = useSettingsStore.getState();
  const config = settings.apiConfigs[settings.activeConfigIndex];
  const now = Date.now();
  const conversation: Conversation = {
    id: randomUUID(),
    title: '专注事件',
    systemPrompt: settings.systemPrompt,
    model: config?.model || '',
    createdAt: now,
    updatedAt: now,
  };
  await createConversation(conversation);
  return conversation;
}

async function sendFocusSystemEventNow(content: string): Promise<Message> {
  await waitForChatIdle();

  const conversation = await ensureLatestCreatedConversation();
  const now = Date.now();
  const message: Message = {
    id: randomUUID(),
    role: 'system',
    content,
    createdAt: now,
  };

  await insertMessage(conversation.id, message);
  await updateConversation(conversation.id, { updatedAt: now });

  const chat = useChatStore.getState();
  await chat.loadConversation(conversation.id);
  await useChatStore.getState().triggerResponse();

  return message;
}

export function sendFocusSystemEvent(content: string): Promise<Message> {
  const next = focusEventQueue
    .catch(() => undefined)
    .then(() => sendFocusSystemEventNow(content));
  focusEventQueue = next.catch(() => undefined);
  return next;
}
