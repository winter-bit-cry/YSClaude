import type { McpServerConfig, McpToolConfig } from '../stores/settings';
import type { Message, ToolInvocation } from '../types';

export interface FishingState {
  pts?: number;
  loc?: string;
  sea?: string;
  turn?: number;
  enc?: string;
  bait?: Record<string, number>;
  hold?: number;
  map_frag?: string;
  oxygen?: number;
  chest?: number;
}

export interface FishingLogEntry {
  id: string;
  run_id?: string;
  created_at?: number;
  source?: string;
  command: string;
  summary: string;
  state?: FishingState | null;
  status?: 'running' | 'done';
  origin?: 'server' | 'local';
}

export interface FishingLogResponse {
  session_id: string;
  run_id?: string;
  entries: FishingLogEntry[];
  state?: FishingState | null;
  max_entries?: number;
}

export interface FishingInspectResponse {
  session_id: string;
  command: string;
  result: string;
  state?: FishingState | null;
  run_id?: string;
}

export type FishingActionName =
  | 'status'
  | 'shop'
  | 'buy'
  | 'cast'
  | 'dive'
  | 'choose'
  | 'surface'
  | 'goto'
  | 'inventory'
  | 'sell'
  | 'open'
  | 'encyclopedia'
  | 'look'
  | 'batch';

export interface FishingActionRequest {
  action: FishingActionName;
  choice?: number;
  bait_id?: string;
  times?: number;
  stop_on?: Array<'new' | 'rare' | 'event'>;
  qty?: number;
  target?: string;
  location_id?: string;
  chest_uid?: string;
  id?: string;
  steps?: Array<Record<string, unknown>>;
}

export interface FishingActionResponse extends FishingInspectResponse {
  log_entry?: FishingLogEntry | null;
}

export interface FishingServerConnection {
  server: McpServerConfig;
  baseUrl: string;
  authorization: string;
}

export class FishingHttpError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'FishingHttpError';
    this.status = status;
    this.body = body;
  }
}

export function resolveFishingServer(config?: McpToolConfig): FishingServerConnection | null {
  const servers = config?.servers || [];
  const candidates = servers.filter((server) =>
    server.enabled &&
    ((server.tools || []).some((tool) => isFishingToolName(tool.name)) || /fishing/i.test(server.name + server.url))
  );
  const server = candidates[0] || null;
  if (!server) return null;
  return {
    server,
    baseUrl: normalizeFishingBaseUrl(server.url),
    authorization: server.authorization || '',
  };
}

export async function fetchFishingLog(
  connection: FishingServerConnection,
  sessionId: string,
  limit = 200
): Promise<FishingLogResponse> {
  const url = `${connection.baseUrl}/sessions/${encodeURIComponent(sessionId)}/log?limit=${Math.max(1, Math.min(500, limit))}`;
  const headers: Record<string, string> = {};
  if (connection.authorization.trim()) {
    headers.Authorization = connection.authorization.trim();
  }
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new FishingHttpError(
      `钓鱼日志读取失败：HTTP ${response.status}${text ? ` - ${text.slice(0, 160)}` : ''}`,
      response.status,
      text
    );
  }
  const parsed = JSON.parse(text || '{}') as FishingLogResponse;
  return {
    ...parsed,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  };
}

export async function inspectFishingCommand(
  connection: FishingServerConnection,
  sessionId: string,
  command: string
): Promise<FishingInspectResponse> {
  const url = `${connection.baseUrl}/sessions/${encodeURIComponent(sessionId)}/inspect`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (connection.authorization.trim()) {
    headers.Authorization = connection.authorization.trim();
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ command }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new FishingHttpError(
      `钓鱼详情读取失败：HTTP ${response.status}${text ? ` - ${text.slice(0, 160)}` : ''}`,
      response.status,
      text
    );
  }
  return JSON.parse(text || '{}') as FishingInspectResponse;
}

export async function playFishingAction(
  connection: FishingServerConnection,
  sessionId: string,
  request: FishingActionRequest
): Promise<FishingActionResponse> {
  const url = `${connection.baseUrl}/play_fishing`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (connection.authorization.trim()) {
    headers.Authorization = connection.authorization.trim();
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ session_id: sessionId, ...request }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new FishingHttpError(
      `钓鱼操作失败：HTTP ${response.status}${text ? ` - ${text.slice(0, 160)}` : ''}`,
      response.status,
      text
    );
  }
  return JSON.parse(text || '{}') as FishingActionResponse;
}

export function inferFishingSessionId(messages: Message[], fallback = 'default'): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const invocations = messages[i].toolInvocations || [];
    for (let j = invocations.length - 1; j >= 0; j--) {
      const invocation = invocations[j];
      if (!isFishingToolName(invocation.name)) continue;
      const args = parseJsonObject(invocation.args);
      const sessionId = typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : '';
      if (sessionId) return sessionId;
    }
  }
  return fallback;
}

export function buildLocalFishingEntries(messages: Message[]): FishingLogEntry[] {
  const entries: FishingLogEntry[] = [];
  const startIndex = findLatestFishingResetMessageIndex(messages);
  for (const message of messages.slice(startIndex)) {
    for (const invocation of message.toolInvocations || []) {
      const entry = parseInvocationEntry(invocation, message.createdAt);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

export function parseFishingState(text: string): FishingState | null {
  const matches = [...text.matchAll(/📊\s*(\{[^\n]+\})/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const parsed = parseJsonObject(last[1]);
  return Object.keys(parsed).length > 0 ? parsed as FishingState : null;
}

export function isFishingToolName(name: string): boolean {
  return (
    name === 'play_fishing' ||
    name === 'new_fishing_game' ||
    name.endsWith('__play_fishing') ||
    name.endsWith('__new_fishing_game')
  );
}

function isNewFishingToolName(name: string): boolean {
  return name === 'new_fishing_game' || name.endsWith('__new_fishing_game');
}

function findLatestFishingResetMessageIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i].toolInvocations || []).some((invocation) => isNewFishingToolName(invocation.name))) {
      return i;
    }
  }
  return 0;
}

export function parseJsonObject(raw: string): Record<string, any> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function stripStructuredContent(raw: string): string {
  if (!raw.trim()) return '';
  const marker = '\n\n{';
  const index = raw.lastIndexOf(marker);
  if (index < 0) return raw.trim();
  const maybeJson = raw.slice(index + 2).trim();
  const parsed = parseJsonObject(maybeJson);
  if (parsed && typeof parsed.result === 'string' && parsed.command) {
    return raw.slice(0, index).trim();
  }
  return raw.trim();
}

function parseInvocationEntry(invocation: ToolInvocation, createdAt: number): FishingLogEntry | null {
  if (!isFishingToolName(invocation.name)) return null;
  const args = parseJsonObject(invocation.args);
  const result = stripStructuredContent(invocation.result || '');
  return {
    id: invocation.callId || `local_${createdAt}_${invocation.name}`,
    created_at: createdAt / 1000,
    origin: 'local',
    source: isNewFishingToolName(invocation.name)
      ? 'new_fishing_game'
      : 'play_fishing',
    command: buildCommandLabel(args, invocation.name),
    summary: invocation.status === 'running'
      ? buildPendingSummary(args, invocation.name)
      : summarizeFishingText(result, invocation.name),
    state: parseFishingState(result),
    status: invocation.status === 'running' ? 'running' : 'done',
  };
}

function buildCommandLabel(args: Record<string, any>, toolName: string): string {
  if (toolName === 'new_fishing_game' || toolName.endsWith('__new_fishing_game')) {
    return args.seed === undefined || args.seed === null ? 'new_game()' : `new_game(${args.seed})`;
  }
  const action = String(args.action || 'status');
  if (action === 'batch' && Array.isArray(args.steps)) return `batch ${args.steps.length}`;
  if (action === 'cast') return `cast ${args.times || 1}${formatStopOn(args.stop_on)}`;
  if (action === 'dive') return `dive ${args.times || 1}${formatStopOn(args.stop_on)}`;
  if (action === 'buy') return `buy ${args.bait_id || ''} ${args.qty || 1}`.trim();
  if (action === 'goto') return args.location_id ? `goto ${args.location_id}` : 'goto';
  if (action === 'sell') return `sell ${args.target || ''}`.trim();
  if (action === 'choose') return args.choice ? `choose ${args.choice}` : 'choose';
  if (action === 'open') return `open ${args.chest_uid || ''}`.trim();
  if (action === 'look') return `look ${args.id || ''}`.trim();
  return action;
}

function formatStopOn(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? ` stop=${value.join(',')}` : '';
}

function buildPendingSummary(args: Record<string, any>, toolName: string): string {
  if (toolName === 'new_fishing_game' || toolName.endsWith('__new_fishing_game')) {
    return 'AI 正在重开钓鱼局。';
  }
  return `AI 正在执行 ${buildCommandLabel(args, toolName)}。`;
}

function summarizeFishingText(text: string, toolName: string): string {
  if (!text.trim()) return '工具尚未返回结果。';
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('📊'));

  if (toolName === 'new_fishing_game' || toolName.endsWith('__new_fishing_game')) {
    return lines.find((line) => line.includes('已重开新局')) || lines[0] || '新局已开始。';
  }

  const priority = lines.filter((line) =>
    line.startsWith('▶') ||
    line.includes('发现新种') ||
    line.includes('遇到事件') ||
    line.includes('漂流瓶') ||
    line.includes('宝箱') ||
    line.includes('远征') ||
    line.includes('首次收录') ||
    line.includes('获得') ||
    line.includes('买了') ||
    line.includes('卖出') ||
    line.includes('前往') ||
    line.includes('渔获')
  );
  return (priority.length > 0 ? priority : lines).slice(0, 4).join('\n');
}

function normalizeFishingBaseUrl(rawUrl: string): string {
  const url = rawUrl.trim().replace(/\/+$/, '');
  return url.endsWith('/mcp') ? url.slice(0, -4) : url;
}
