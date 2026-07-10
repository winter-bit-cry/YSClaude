import { AppState, type AppStateStatus } from 'react-native';
import { ChatMessage } from './api';
import { useSettingsStore, type PromptCacheCompatibility, type PromptCacheConfig, type PromptCacheTtl, type ThinkingCompatibility, type ThinkingEffort } from '../stores/settings';

const KEEPALIVE_SYNC_TIMEOUT_MS = 10000;
const SNAPSHOT_SYNC_DEBOUNCE_MS = 5 * 60 * 1000;
const SNAPSHOT_SYNC_QUEUE_LIMIT = 5;
const SNAPSHOT_PREVIEW_TAIL_CHARS = 90;
const APP_KEEPALIVE_SUFFIX = '这是一次 Prompt 缓存保活请求。请不要输出任何内容。';
const SERVER_KEEPALIVE_PING = '[Server keepalive ping] Keep the prompt cache warm. Do not answer this message.';
const RUNTIME_CONTEXT_PREFIX = '以下是附加信息：';
const LEGACY_RUNTIME_CONTEXT_PREFIX = '以下是本轮运行时上下文和应用附加信息：';
const USER_LATEST_INPUT_MARKER = '用户最新输入：';

export interface PromptCacheRemoteSnapshot {
  conversationId: string;
  agentTools?: {
    memoryVault?: {
      enabled: boolean;
      baseUrl: string;
      topK: number;
      tokenBudget: number;
      maxToolCalls: number;
    };
    webSearch?: {
      enabled: boolean;
      tavilyApiKey: string;
      maxResults: number;
    };
  };
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
  state: 'empty' | 'pending' | 'syncing' | 'synced' | 'failed';
  source: 'local' | 'server' | null;
  queueCount: number;
  conversationId: string | null;
  model: string | null;
  messageCount: number;
  lastMessageRole: string | null;
  lastMessageTail: string | null;
  queuedAt: number | null;
  nextSyncAt: number | null;
  syncedAt: number | null;
  lastSyncAttemptAt: number | null;
  lastSyncError: string | null;
  serverNextKeepaliveAt: number | null;
  serverSnapshotHash: string | null;
  serverStatus: string | null;
  serverDisabledReason: string | null;
  serverUpdatedAt: number | null;
  serverLastTouchedAt: number | null;
  serverLastError: string | null;
  serverConversationCount: number;
  serverStatusFetchedAt: number | null;
  serverStatusError: string | null;
  serverPendingMessageCount: number;
  serverActivityCount: number;
}

interface PromptCacheRemoteToolTranscriptEntry {
  toolName: string;
  args: Record<string, any>;
  resultPreview: string;
  createdAt: number;
}

export interface PromptCacheRemoteInboxMessage {
  id: string;
  role: 'assistant';
  content: string;
  createdAt: number;
  source?: string;
  toolTranscript?: PromptCacheRemoteToolTranscriptEntry[];
}

export interface PromptCacheRemoteActivityEntry {
  id: string;
  type: string;
  summary: string;
  toolTranscript?: PromptCacheRemoteToolTranscriptEntry[];
  appendedMessages?: Array<{ role: string; content: string }>;
  createdAt: number;
}

interface SnapshotPreview {
  conversationId: string;
  model: string | null;
  messageCount: number;
  lastMessageRole: string | null;
  lastMessageTail: string | null;
}

interface PromptCacheRemoteServerConversationStatus {
  conversationId: string;
  snapshotHash: string | null;
  status: string | null;
  disabledReason: string | null;
  lastTouchedAt: number | null;
  nextKeepaliveAt: number | null;
  lastError: string | null;
  updatedAt: number | null;
  preview: {
    model?: string | null;
    messageCount?: number;
    lastMessageRole?: string | null;
    lastMessageTail?: string | null;
  } | null;
  pendingMessageCount: number;
  activityCount: number;
}

let pendingSnapshots: PromptCacheRemoteSnapshot[] = [];
let snapshotSyncTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotSyncDueAt: number | null = null;
let snapshotFlushAppState: AppStateStatus = AppState.currentState;
let snapshotSyncInFlight = false;
let snapshotFlushRequested = false;
let latestSnapshotPreview: SnapshotPreview | null = null;
let latestSnapshotPreviewSource: 'local' | 'server' | null = null;
let latestSnapshotQueuedAt: number | null = null;
let latestSnapshotSyncedAt: number | null = null;
let latestSnapshotSyncAttemptAt: number | null = null;
let latestSnapshotSyncError: string | null = null;
let latestServerNextKeepaliveAt: number | null = null;
let latestServerSnapshotHash: string | null = null;
let latestServerStatus: string | null = null;
let latestServerDisabledReason: string | null = null;
let latestServerUpdatedAt: number | null = null;
let latestServerLastTouchedAt: number | null = null;
let latestServerLastError: string | null = null;
let latestServerConversationCount = 0;
let latestServerStatusFetchedAt: number | null = null;
let latestServerStatusError: string | null = null;
let latestServerPendingMessageCount = 0;
let latestServerActivityCount = 0;
const snapshotStatusListeners = new Set<() => void>();

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function getRemoteConfig(): { serverUrl: string; token: string } | null {
  const config = useSettingsStore.getState().promptCacheConfig;
  const serverUrl = normalizeServerUrl(config.remoteServerUrl || '');
  if (!serverUrl) return null;
  return { serverUrl, token: config.remoteAuthToken || '' };
}

function isRemoteKeepaliveEnabled(): boolean {
  return !!useSettingsStore.getState().promptCacheConfig?.remoteKeepaliveEnabled;
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

async function getRemoteJson(path: string): Promise<any | null> {
  const remote = getRemoteConfig();
  if (!remote) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KEEPALIVE_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(`${remote.serverUrl}${path}`, {
      headers: remote.token.trim() ? { Authorization: `Bearer ${remote.token.trim()}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

async function postRemoteJson(path: string, body: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
  const remote = getRemoteConfig();
  if (!remote) return { ok: false, error: '远程保活未配置' };

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
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok,
      data,
      error: response.ok ? undefined : data?.error || `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return { ok: false, error: error?.message || '远程保活请求失败' };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePreviewText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= SNAPSHOT_PREVIEW_TAIL_CHARS) return normalized;
  return normalized.slice(-SNAPSHOT_PREVIEW_TAIL_CHARS);
}

function splitPushList(value?: string): string[] {
  return (value || '')
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildRemotePushConfig(config?: PromptCacheConfig): Record<string, unknown> | undefined {
  const channel = config?.pushChannel === 'wxpusher' ? 'wxpusher' : 'dingtalk';
  const wxPusherAppToken = config?.wxPusherAppToken?.trim() || '';
  const wxPusherUids = splitPushList(config?.wxPusherUid);
  const wxPusherTopicIds = splitPushList(config?.wxPusherTopicIds)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0);
  const dingTalkWebhook = config?.dingTalkWebhook?.trim() || '';
  const dingTalkSecret = config?.dingTalkSecret?.trim() || '';
  const dingTalkAtMobiles = splitPushList(config?.dingTalkAtMobiles);
  const push: Record<string, unknown> = {};
  push.provider = channel;
  if (channel === 'wxpusher' && wxPusherAppToken && (wxPusherUids.length > 0 || wxPusherTopicIds.length > 0)) {
    push.wxPusher = {
      appToken: wxPusherAppToken,
      uids: wxPusherUids,
      topicIds: wxPusherTopicIds,
    };
  }
  if (channel === 'dingtalk' && dingTalkWebhook) {
    push.dingTalk = {
      webhook: dingTalkWebhook,
      secret: dingTalkSecret,
      atMobiles: dingTalkAtMobiles,
    };
  }
  return Object.keys(push).length > 1 ? push : undefined;
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

function stripRuntimeLatestInputWrapper(content: ChatMessage['content']): ChatMessage['content'] {
  if (typeof content === 'string') {
    if (!content.includes(RUNTIME_CONTEXT_PREFIX) && !content.includes(LEGACY_RUNTIME_CONTEXT_PREFIX)) return content;
    const markerIndex = content.indexOf(USER_LATEST_INPUT_MARKER);
    if (markerIndex < 0) return content;
    return content.slice(markerIndex + USER_LATEST_INPUT_MARKER.length).replace(/^\s+/, '') || content;
  }

  if (!Array.isArray(content) || content.length === 0) return content;
  const first = content[0];
  if (!first || typeof first !== 'object' || typeof first.text !== 'string') return content;
  if (!first.text.includes(RUNTIME_CONTEXT_PREFIX) && !first.text.includes(LEGACY_RUNTIME_CONTEXT_PREFIX)) return content;

  const markerIndex = first.text.indexOf(USER_LATEST_INPUT_MARKER);
  if (markerIndex < 0) return content;

  const latestInputPrefix = first.text.slice(markerIndex + USER_LATEST_INPUT_MARKER.length).replace(/^\s+/, '');
  if (latestInputPrefix) {
    return [
      { ...first, text: latestInputPrefix },
      ...content.slice(1),
    ];
  }
  return content.slice(1);
}

function isKeepaliveSuffixMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') return false;
  const text = extractMessageText(message.content).replace(/\s+/g, ' ').trim();
  return text === APP_KEEPALIVE_SUFFIX || text === SERVER_KEEPALIVE_PING;
}

function normalizeSnapshotPreviewMessages(messages: ChatMessage[]): ChatMessage[] {
  const normalized = messages.map((message) =>
    message.role === 'user'
      ? { ...message, content: stripRuntimeLatestInputWrapper(message.content) }
      : message
  );
  while (normalized.length > 0 && isKeepaliveSuffixMessage(normalized[normalized.length - 1])) {
    normalized.pop();
  }
  return normalized;
}

function buildSnapshotPreview(snapshot: PromptCacheRemoteSnapshot): SnapshotPreview {
  const messages = normalizeSnapshotPreviewMessages(snapshot.request.messages || []);
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

function normalizeServerNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeServerConversation(raw: any): PromptCacheRemoteServerConversationStatus | null {
  if (!raw || typeof raw !== 'object' || typeof raw.conversationId !== 'string' || !raw.conversationId.trim()) {
    return null;
  }
  const preview = raw.preview && typeof raw.preview === 'object' ? raw.preview : null;
  return {
    conversationId: raw.conversationId.trim(),
    snapshotHash: typeof raw.snapshotHash === 'string' ? raw.snapshotHash : null,
    status: typeof raw.status === 'string' ? raw.status : null,
    disabledReason: typeof raw.disabledReason === 'string' ? raw.disabledReason : null,
    lastTouchedAt: normalizeServerNumber(raw.lastTouchedAt),
    nextKeepaliveAt: normalizeServerNumber(raw.nextKeepaliveAt),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    updatedAt: normalizeServerNumber(raw.updatedAt),
    preview,
    pendingMessageCount: Math.max(0, Number(raw.pendingMessageCount) || 0),
    activityCount: Math.max(0, Number(raw.activityCount) || 0),
  };
}

function pickServerConversation(
  conversations: PromptCacheRemoteServerConversationStatus[],
  preferredConversationId?: string | null
): PromptCacheRemoteServerConversationStatus | null {
  if (conversations.length === 0) return null;
  const preferredId = preferredConversationId?.trim();
  const sorted = [...conversations].sort((a, b) => {
    const aPreferred = preferredId && a.conversationId === preferredId ? 1 : 0;
    const bPreferred = preferredId && b.conversationId === preferredId ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;

    const aActive = a.status === 'active' ? 1 : 0;
    const bActive = b.status === 'active' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;

    const aTime = a.updatedAt ?? a.lastTouchedAt ?? 0;
    const bTime = b.updatedAt ?? b.lastTouchedAt ?? 0;
    return bTime - aTime;
  });
  return sorted[0] ?? null;
}

function applyServerSnapshotStatus(
  conversations: PromptCacheRemoteServerConversationStatus[],
  preferredConversationId?: string | null
): void {
  latestServerConversationCount = conversations.length;
  latestServerStatusFetchedAt = Date.now();
  latestServerStatusError = null;

  const selected = pickServerConversation(conversations, preferredConversationId);
  if (!selected) {
    latestServerSnapshotHash = null;
    latestServerStatus = null;
    latestServerDisabledReason = null;
    latestServerUpdatedAt = null;
    latestServerLastTouchedAt = null;
    latestServerLastError = null;
    latestServerNextKeepaliveAt = null;
    latestServerPendingMessageCount = 0;
    latestServerActivityCount = 0;
    if (pendingSnapshots.length === 0 && latestSnapshotPreviewSource === 'server') {
      latestSnapshotPreview = null;
      latestSnapshotPreviewSource = null;
      latestSnapshotSyncedAt = null;
    }
    return;
  }

  latestServerSnapshotHash = selected.snapshotHash;
  latestServerStatus = selected.status;
  latestServerDisabledReason = selected.disabledReason;
  latestServerUpdatedAt = selected.updatedAt;
  latestServerLastTouchedAt = selected.lastTouchedAt;
  latestServerLastError = selected.lastError;
  latestServerNextKeepaliveAt = selected.nextKeepaliveAt;
  latestServerPendingMessageCount = selected.pendingMessageCount;
  latestServerActivityCount = selected.activityCount;

  if (pendingSnapshots.length === 0) {
    latestSnapshotPreview = {
      conversationId: selected.conversationId,
      model: selected.preview?.model ?? null,
      messageCount: Math.max(0, Number(selected.preview?.messageCount) || 0),
      lastMessageRole: selected.preview?.lastMessageRole ?? null,
      lastMessageTail: selected.preview?.lastMessageTail ?? null,
    };
    latestSnapshotPreviewSource = 'server';
    latestSnapshotQueuedAt = null;
    latestSnapshotSyncedAt = selected.updatedAt ?? selected.lastTouchedAt ?? latestServerStatusFetchedAt;
  }
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
    agentTools: snapshot.agentTools,
    agentTick: { enabled: config?.remoteAgentTickEnabled !== false },
    push: buildRemotePushConfig(config),
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
  const state = snapshotSyncInFlight
    ? 'syncing'
    : hasPending
      ? 'pending'
      : latestSnapshotSyncError
        ? 'failed'
        : latestSnapshotPreview
          ? 'synced'
          : 'empty';
  return {
    state,
    source: latestSnapshotPreviewSource,
    queueCount: pendingSnapshots.length,
    conversationId: latestSnapshotPreview?.conversationId ?? null,
    model: latestSnapshotPreview?.model ?? null,
    messageCount: latestSnapshotPreview?.messageCount ?? 0,
    lastMessageRole: latestSnapshotPreview?.lastMessageRole ?? null,
    lastMessageTail: latestSnapshotPreview?.lastMessageTail ?? null,
    queuedAt: hasPending ? latestSnapshotQueuedAt : null,
    nextSyncAt: hasPending ? snapshotSyncDueAt : null,
    syncedAt: hasPending ? null : latestSnapshotSyncedAt,
    lastSyncAttemptAt: latestSnapshotSyncAttemptAt,
    lastSyncError: latestSnapshotSyncError,
    serverNextKeepaliveAt: latestServerNextKeepaliveAt,
    serverSnapshotHash: latestServerSnapshotHash,
    serverStatus: latestServerStatus,
    serverDisabledReason: latestServerDisabledReason,
    serverUpdatedAt: latestServerUpdatedAt,
    serverLastTouchedAt: latestServerLastTouchedAt,
    serverLastError: latestServerLastError,
    serverConversationCount: latestServerConversationCount,
    serverStatusFetchedAt: latestServerStatusFetchedAt,
    serverStatusError: latestServerStatusError,
    serverPendingMessageCount: latestServerPendingMessageCount,
    serverActivityCount: latestServerActivityCount,
  };
}

export function subscribePromptCacheRemoteSnapshotStatus(listener: () => void): () => void {
  snapshotStatusListeners.add(listener);
  return () => {
    snapshotStatusListeners.delete(listener);
  };
}

async function flushLatestPromptCacheRemoteSnapshot(): Promise<boolean> {
  if (snapshotSyncInFlight) {
    snapshotFlushRequested = true;
    return false;
  }
  clearSnapshotSyncTimer();

  const latestSnapshot = pendingSnapshots[pendingSnapshots.length - 1];
  if (!latestSnapshot) return false;

  snapshotSyncInFlight = true;
  latestSnapshotSyncAttemptAt = Date.now();
  latestSnapshotSyncError = null;
  notifySnapshotStatusListeners();

  const result = await postRemoteJson('/v1/keepalive/snapshot', buildSnapshotPayload(latestSnapshot));
  snapshotSyncInFlight = false;
  if (result.ok) {
    const flushedIndex = pendingSnapshots.indexOf(latestSnapshot);
    if (flushedIndex >= 0) {
      pendingSnapshots = pendingSnapshots.slice(flushedIndex + 1);
    }
    latestServerNextKeepaliveAt = typeof result.data?.nextKeepaliveAt === 'number' ? result.data.nextKeepaliveAt : null;
    latestServerStatus = typeof result.data?.status === 'string' ? result.data.status : latestServerStatus;
    latestServerSnapshotHash = typeof result.data?.snapshotHash === 'string' ? result.data.snapshotHash : latestServerSnapshotHash;
    if (pendingSnapshots.length > 0) {
      latestSnapshotPreview = buildSnapshotPreview(pendingSnapshots[pendingSnapshots.length - 1]);
      latestSnapshotPreviewSource = 'local';
      latestSnapshotSyncedAt = null;
      if (snapshotFlushRequested) {
        snapshotFlushRequested = false;
        flushLatestPromptCacheRemoteSnapshot().catch((error) => {
          latestSnapshotSyncError = error?.message || '远程快照同步失败';
          scheduleSnapshotSync();
        });
      } else {
        scheduleSnapshotSync();
      }
    } else {
      snapshotFlushRequested = false;
      latestSnapshotPreview = buildSnapshotPreview(latestSnapshot);
      latestSnapshotPreviewSource = 'local';
      latestSnapshotQueuedAt = null;
      latestSnapshotSyncedAt = Date.now();
    }
  } else if (pendingSnapshots.length > 0) {
    snapshotFlushRequested = false;
    latestSnapshotSyncError = result.error || '远程快照同步失败';
    scheduleSnapshotSync();
  }
  notifySnapshotStatusListeners();
  return result.ok;
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

export async function syncPromptCacheRemoteSnapshot(
  snapshot: PromptCacheRemoteSnapshot,
  options: { flush?: boolean } = {}
): Promise<boolean> {
  if (!getRemoteConfig() || !isRemoteKeepaliveEnabled()) return false;

  const hadPendingWork = pendingSnapshots.length > 0 || snapshotSyncInFlight || !!snapshotSyncTimer;
  const shouldSyncImmediately = !hadPendingWork && latestSnapshotSyncedAt === null;
  pendingSnapshots.push(snapshot);
  if (pendingSnapshots.length > SNAPSHOT_SYNC_QUEUE_LIMIT) {
    pendingSnapshots = pendingSnapshots.slice(-SNAPSHOT_SYNC_QUEUE_LIMIT);
  }
  latestSnapshotPreview = buildSnapshotPreview(snapshot);
  latestSnapshotPreviewSource = 'local';
  latestSnapshotQueuedAt = Date.now();
  latestSnapshotSyncedAt = null;
  latestSnapshotSyncError = null;
  if (options.flush) {
    notifySnapshotStatusListeners();
    flushLatestPromptCacheRemoteSnapshot().catch((error) => {
      latestSnapshotSyncError = error?.message || '远程快照同步失败';
      scheduleSnapshotSync();
    });
  } else if (shouldSyncImmediately) {
    notifySnapshotStatusListeners();
    flushLatestPromptCacheRemoteSnapshot().catch((error) => {
      latestSnapshotSyncError = error?.message || '远程快照同步失败';
      scheduleSnapshotSync();
    });
  } else {
    scheduleSnapshotSync();
  }
  return true;
}

export async function flushPromptCacheRemoteSnapshotNow(): Promise<boolean> {
  return flushLatestPromptCacheRemoteSnapshot();
}

export async function enablePromptCacheRemoteKeepalive(conversationId?: string | null): Promise<{ ok: boolean; error?: string }> {
  if (pendingSnapshots.length > 0) {
    const ok = await flushLatestPromptCacheRemoteSnapshot();
    if (ok) return { ok: true };
  }

  const id = conversationId?.trim();
  if (!id) return { ok: false, error: '当前没有可同步的对话' };

  const result = await postRemoteJson('/v1/keepalive/enable', {
    conversationId: id,
    updatedAt: Date.now(),
  });
  if (result.ok) {
    latestServerStatus = typeof result.data?.status === 'string' ? result.data.status : 'active';
    latestServerDisabledReason = null;
    latestServerNextKeepaliveAt = typeof result.data?.nextKeepaliveAt === 'number' ? result.data.nextKeepaliveAt : latestServerNextKeepaliveAt;
    latestServerSnapshotHash = typeof result.data?.snapshotHash === 'string' ? result.data.snapshotHash : latestServerSnapshotHash;
    latestServerUpdatedAt = Date.now();
    notifySnapshotStatusListeners();
  }
  return { ok: result.ok, error: result.error };
}

export async function refreshPromptCacheRemoteServerStatus(preferredConversationId?: string | null): Promise<boolean> {
  const remote = getRemoteConfig();
  if (!remote) {
    latestServerStatusError = '远程保活未配置';
    notifySnapshotStatusListeners();
    return false;
  }

  try {
    const data = await getRemoteJson('/v1/keepalive/status');
    if (!data || !Array.isArray(data.conversations)) {
      latestServerStatusFetchedAt = Date.now();
      latestServerStatusError = '远程服务状态响应无效';
      notifySnapshotStatusListeners();
      return false;
    }

    const conversations = data.conversations
      .map(normalizeServerConversation)
      .filter((item: PromptCacheRemoteServerConversationStatus | null): item is PromptCacheRemoteServerConversationStatus => !!item);
    applyServerSnapshotStatus(conversations, preferredConversationId);
    notifySnapshotStatusListeners();
    return true;
  } catch (error: any) {
    latestServerStatusFetchedAt = Date.now();
    latestServerStatusError = error?.message || '远程服务状态读取失败';
    notifySnapshotStatusListeners();
    return false;
  }
}

export interface PromptCacheRemotePendingConversation {
  conversationId: string;
  pendingMessageCount: number;
  activityCount: number;
}

// 列出服务端所有有待消费消息/活动的会话，收件同步以此为准（不依赖 App 当前打开的会话）
export async function fetchPromptCacheRemotePendingConversations(): Promise<PromptCacheRemotePendingConversation[]> {
  const data = await getRemoteJson('/v1/keepalive/status');
  if (!data || !Array.isArray(data.conversations)) return [];
  return data.conversations
    .filter((item: any) => item && typeof item.conversationId === 'string' && item.conversationId.trim())
    .map((item: any) => ({
      conversationId: item.conversationId.trim(),
      pendingMessageCount: Math.max(0, Number(item.pendingMessageCount) || 0),
      activityCount: Math.max(0, Number(item.activityCount) || 0),
    }))
    .filter((item: PromptCacheRemotePendingConversation) => item.pendingMessageCount > 0 || item.activityCount > 0);
}

export async function fetchPromptCacheRemoteInbox(conversationId: string): Promise<PromptCacheRemoteInboxMessage[]> {
  const data = await getRemoteJson(`/v1/keepalive/inbox?conversationId=${encodeURIComponent(conversationId)}`);
  return Array.isArray(data?.messages) ? data.messages : [];
}

export async function ackPromptCacheRemoteInbox(conversationId: string, ids: string[]): Promise<boolean> {
  return postRemote('/v1/keepalive/inbox/ack', { conversationId, ids });
}

export async function fetchPromptCacheRemoteActivity(conversationId: string): Promise<PromptCacheRemoteActivityEntry[]> {
  const data = await getRemoteJson(`/v1/keepalive/activity?conversationId=${encodeURIComponent(conversationId)}`);
  return Array.isArray(data?.activity) ? data.activity : [];
}

export async function ackPromptCacheRemoteActivity(conversationId: string, ids: string[]): Promise<boolean> {
  return postRemote('/v1/keepalive/activity/ack', { conversationId, ids });
}

export async function pushRemotePushConfig(config: PromptCacheConfig): Promise<boolean> {
  const push = buildRemotePushConfig(config);
  if (!push) return false;
  return postRemote('/v1/keepalive/push-token', push);
}

export async function testRemoteWxPusherPush(config: PromptCacheConfig): Promise<{ ok: boolean; error?: string }> {
  const push = buildRemotePushConfig({
    ...config,
    pushChannel: 'wxpusher',
  });
  const result = await postRemoteJson('/v1/keepalive/push-test', push || {});
  return { ok: result.ok, error: result.error };
}

export async function testRemoteDingTalkPush(config: PromptCacheConfig): Promise<{ ok: boolean; error?: string }> {
  const push = buildRemotePushConfig({
    ...config,
    pushChannel: 'dingtalk',
  });
  const result = await postRemoteJson('/v1/keepalive/push-test', push || {});
  return { ok: result.ok, error: result.error };
}

export function startPromptCacheRemoteSnapshotFlushListener(): () => void {
  snapshotFlushAppState = AppState.currentState;
  refreshPromptCacheRemoteServerStatus(latestSnapshotPreview?.conversationId).catch((error) => {
    console.warn('[PromptCacheKeepalive] 初始化刷新远程快照状态失败:', error);
  });
  const sub = AppState.addEventListener('change', (nextState) => {
    snapshotFlushAppState = nextState;
    if (nextState === 'active') {
      refreshPromptCacheRemoteServerStatus(latestSnapshotPreview?.conversationId).catch((error) => {
        console.warn('[PromptCacheKeepalive] 前台刷新远程快照状态失败:', error);
      });
      return;
    }

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
    latestSnapshotPreviewSource = 'local';
    latestSnapshotSyncedAt = null;
  } else if (pendingSnapshots.length === 0 && latestSnapshotPreview?.conversationId === conversationId) {
    latestSnapshotPreview = null;
    latestSnapshotPreviewSource = null;
    latestSnapshotQueuedAt = null;
    latestSnapshotSyncedAt = null;
    latestSnapshotSyncAttemptAt = null;
    latestSnapshotSyncError = null;
    latestServerNextKeepaliveAt = null;
    latestServerSnapshotHash = null;
    latestServerStatus = null;
    latestServerDisabledReason = null;
    latestServerUpdatedAt = null;
    latestServerLastTouchedAt = null;
    latestServerLastError = null;
    latestServerPendingMessageCount = 0;
    latestServerActivityCount = 0;
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
