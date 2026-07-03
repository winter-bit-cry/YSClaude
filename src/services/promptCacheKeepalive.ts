import { AppState, type AppStateStatus } from 'react-native';
import { ChatMessage } from './api';
import { useSettingsStore, type PromptCacheCompatibility, type PromptCacheTtl, type ThinkingCompatibility, type ThinkingEffort } from '../stores/settings';

const KEEPALIVE_SYNC_TIMEOUT_MS = 10000;
const SNAPSHOT_SYNC_DEBOUNCE_MS = 5 * 60 * 1000;
const SNAPSHOT_SYNC_QUEUE_LIMIT = 5;
const SNAPSHOT_PREVIEW_TAIL_CHARS = 90;

export interface PromptCacheRemoteSnapshot {
  conversationId: string;
  request: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    generateThinking?: boolean;
    thinkingEffort: ThinkingEffort;
    thinkingCompatibility: ThinkingCompatibility;
    returnNativeThinking?: boolean;
    sessionId: string;
    promptCache: {
      enabled: boolean;
      ttl: PromptCacheTtl;
      compatibility?: PromptCacheCompatibility;
    };
  };
}

export interface PromptCacheRemoteSnapshotStatus {
  state: 'empty' | 'pending' | 'synced';
  queueCount: number;
  conversationId: string | null;
  model: string | null;
  messageCount: number;
  lastMessageRole: string | null;
  lastMessageTail: string | null;
  queuedAt: number | null;
  nextSyncAt: number | null;
  syncedAt: number | null;
}

interface SnapshotPreview {
  conversationId: string;
  model: string;
  messageCount: number;
  lastMessageRole: string | null;
  lastMessageTail: string | null;
}

let pendingSnapshots: PromptCacheRemoteSnapshot[] = [];
let snapshotSyncTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotSyncDueAt: number | null = null;
let snapshotFlushAppState: AppStateStatus = AppState.currentState;
let latestSnapshotPreview: SnapshotPreview | null = null;
let latestSnapshotQueuedAt: number | null = null;
let latestSnapshotSyncedAt: number | null = null;
const snapshotStatusListeners = new Set<() => void>();

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function getRemoteConfig(): { serverUrl: string; token: string } | null {
  const config = useSettingsStore.getState().promptCacheConfig;
  if (config?.keepaliveMode !== 'remote') return null;
  const serverUrl = normalizeServerUrl(config.remoteServerUrl || '');
  if (!serverUrl) return null;
  return { serverUrl, token: config.remoteAuthToken || '' };
}

async function postRemote(path: string, body: unknown): Promise<boolean> {
  const remote = getRemoteConfig();
  if (!remote) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KEEPALIVE_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(`${remote.serverUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(remote.token.trim() ? { Authorization: `Bearer ${remote.token.trim()}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePreviewText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= SNAPSHOT_PREVIEW_TAIL_CHARS) return normalized;
  return normalized.slice(-SNAPSHOT_PREVIEW_TAIL_CHARS);
}

function extractMessageText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      if (typeof part.input_text === 'string') return part.input_text;
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function buildSnapshotPreview(snapshot: PromptCacheRemoteSnapshot): SnapshotPreview {
  const messages = snapshot.request.messages || [];
  const lastTextMessage = [...messages].reverse().find((message) => normalizePreviewText(extractMessageText(message.content)));
  const fallbackMessage = messages[messages.length - 1] ?? null;
  const lastMessageText = lastTextMessage ? normalizePreviewText(extractMessageText(lastTextMessage.content)) : '';
  return {
    conversationId: snapshot.conversationId,
    model: snapshot.request.model,
    messageCount: messages.length,
    lastMessageRole: lastTextMessage?.role ?? fallbackMessage?.role ?? null,
    lastMessageTail: lastMessageText || (fallbackMessage?.tool_calls?.length ? '[工具调用]' : null),
  };
}

function buildSnapshotPayload(snapshot: PromptCacheRemoteSnapshot): unknown {
  const config = useSettingsStore.getState().promptCacheConfig;
  return {
    conversationId: snapshot.conversationId,
    updatedAt: Date.now(),
    quietHours: {
      enabled: !!config?.quietHoursEnabled,
      startMinutes: config?.quietStartMinutes ?? 23 * 60,
      endMinutes: config?.quietEndMinutes ?? 7 * 60,
    },
    request: snapshot.request,
  };
}

function clearSnapshotSyncTimer(): void {
  if (!snapshotSyncTimer) return;
  clearTimeout(snapshotSyncTimer);
  snapshotSyncTimer = null;
  snapshotSyncDueAt = null;
}

function notifySnapshotStatusListeners(): void {
  snapshotStatusListeners.forEach((listener) => listener());
}

export function getPromptCacheRemoteSnapshotStatus(): PromptCacheRemoteSnapshotStatus {
  const hasPending = pendingSnapshots.length > 0;
  return {
    state: hasPending ? 'pending' : latestSnapshotPreview ? 'synced' : 'empty',
    queueCount: pendingSnapshots.length,
    conversationId: latestSnapshotPreview?.conversationId ?? null,
    model: latestSnapshotPreview?.model ?? null,
    messageCount: latestSnapshotPreview?.messageCount ?? 0,
    lastMessageRole: latestSnapshotPreview?.lastMessageRole ?? null,
    lastMessageTail: latestSnapshotPreview?.lastMessageTail ?? null,
    queuedAt: hasPending ? latestSnapshotQueuedAt : null,
    nextSyncAt: hasPending ? snapshotSyncDueAt : null,
    syncedAt: hasPending ? null : latestSnapshotSyncedAt,
  };
}

export function subscribePromptCacheRemoteSnapshotStatus(listener: () => void): () => void {
  snapshotStatusListeners.add(listener);
  return () => {
    snapshotStatusListeners.delete(listener);
  };
}

async function flushLatestPromptCacheRemoteSnapshot(): Promise<boolean> {
  clearSnapshotSyncTimer();

  const latestSnapshot = pendingSnapshots[pendingSnapshots.length - 1];
  if (!latestSnapshot) return false;

  const ok = await postRemote('/v1/keepalive/snapshot', buildSnapshotPayload(latestSnapshot));
  if (ok) {
    const flushedIndex = pendingSnapshots.indexOf(latestSnapshot);
    if (flushedIndex >= 0) {
      pendingSnapshots = pendingSnapshots.slice(flushedIndex + 1);
    }
    if (pendingSnapshots.length > 0) {
      latestSnapshotPreview = buildSnapshotPreview(pendingSnapshots[pendingSnapshots.length - 1]);
      latestSnapshotSyncedAt = null;
      scheduleSnapshotSync();
    } else {
      latestSnapshotPreview = buildSnapshotPreview(latestSnapshot);
      latestSnapshotQueuedAt = null;
      latestSnapshotSyncedAt = Date.now();
    }
  } else if (pendingSnapshots.length > 0) {
    scheduleSnapshotSync();
  }
  notifySnapshotStatusListeners();
  return ok;
}

function scheduleSnapshotSync(): void {
  clearSnapshotSyncTimer();
  snapshotSyncDueAt = Date.now() + SNAPSHOT_SYNC_DEBOUNCE_MS;
  snapshotSyncTimer = setTimeout(() => {
    flushLatestPromptCacheRemoteSnapshot().catch((error) => {
      console.warn('[PromptCacheKeepalive] 同步远程快照失败:', error);
    });
  }, SNAPSHOT_SYNC_DEBOUNCE_MS);
  notifySnapshotStatusListeners();
}

export async function syncPromptCacheRemoteSnapshot(snapshot: PromptCacheRemoteSnapshot): Promise<boolean> {
  if (!getRemoteConfig()) return false;

  pendingSnapshots.push(snapshot);
  if (pendingSnapshots.length > SNAPSHOT_SYNC_QUEUE_LIMIT) {
    pendingSnapshots = pendingSnapshots.slice(-SNAPSHOT_SYNC_QUEUE_LIMIT);
  }
  latestSnapshotPreview = buildSnapshotPreview(snapshot);
  latestSnapshotQueuedAt = Date.now();
  latestSnapshotSyncedAt = null;
  scheduleSnapshotSync();
  return true;
}

export function startPromptCacheRemoteSnapshotFlushListener(): () => void {
  snapshotFlushAppState = AppState.currentState;
  const sub = AppState.addEventListener('change', (nextState) => {
    const wasActive = snapshotFlushAppState === 'active';
    snapshotFlushAppState = nextState;
    if (!wasActive || nextState === 'active') return;

    flushLatestPromptCacheRemoteSnapshot().catch((error) => {
      console.warn('[PromptCacheKeepalive] 退后台同步远程快照失败:', error);
    });
  });

  return () => sub.remove();
}

export async function disablePromptCacheRemoteKeepalive(conversationId: string): Promise<boolean> {
  pendingSnapshots = pendingSnapshots.filter((snapshot) => snapshot.conversationId !== conversationId);
  if (pendingSnapshots.length === 0) {
    clearSnapshotSyncTimer();
  }
  if (pendingSnapshots.length > 0 && latestSnapshotPreview?.conversationId === conversationId) {
    latestSnapshotPreview = buildSnapshotPreview(pendingSnapshots[pendingSnapshots.length - 1]);
    latestSnapshotSyncedAt = null;
  } else if (pendingSnapshots.length === 0 && latestSnapshotPreview?.conversationId === conversationId) {
    latestSnapshotPreview = null;
    latestSnapshotQueuedAt = null;
    latestSnapshotSyncedAt = null;
  }
  notifySnapshotStatusListeners();

  return postRemote('/v1/keepalive/disable', {
    conversationId,
    updatedAt: Date.now(),
  });
}

export async function checkPromptCacheRemoteServer(): Promise<boolean> {
  const remote = getRemoteConfig();
  if (!remote) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KEEPALIVE_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(`${remote.serverUrl}/health`, {
      headers: remote.token.trim() ? { Authorization: `Bearer ${remote.token.trim()}` } : undefined,
      signal: controller.signal,
    });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
}
