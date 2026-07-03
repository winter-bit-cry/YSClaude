import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { ToolDefinition } from './tools';
import { insertApiUsageEvent } from '../db/operations';
import { ApiTokenUsage, ApiUsageStatus, type PromptCacheCompatibility, type PromptCacheTtl, type ThinkingCompatibility, type ThinkingEffort } from '../types';

export interface ChatMessage {
  role: string;
  content: string | any[];
  tool_calls?: any[];
  tool_call_id?: string;
}

interface ChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  generateThinking?: boolean;
  thinkingEffort?: ThinkingEffort;
  thinkingCompatibility?: ThinkingCompatibility;
  returnNativeThinking?: boolean;
  sessionId?: string;
  promptCache?: PromptCacheRequestOptions;
  usageContext?: ApiUsageContext;
}

interface ChatRequestWithTools extends ChatRequest {
  tools?: ToolDefinition[];
}

interface ChatCompletionChoice {
  message: {
    role: string;
    content: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
    tool_calls?: {
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }[];
  };
  finish_reason: string;
}

export interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
  usage?: RawApiUsage;
}

export interface StreamChatCompletionResult {
  content: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }[];
  finish_reason?: string;
  usage?: ApiTokenUsage;
}

type StreamToolCall = NonNullable<StreamChatCompletionResult['tool_calls']>[number];

interface ApiUsageContext {
  feature?: string;
  requestKind?: string;
  conversationId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

interface PromptCacheRequestOptions {
  enabled: boolean;
  ttl: PromptCacheTtl;
  compatibility?: PromptCacheCompatibility;
}

interface RawApiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    [key: string]: unknown;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function createEmptyToolCall(): StreamToolCall {
  return {
    id: '',
    type: 'function',
    function: { name: '', arguments: '' },
  };
}

function resolveToolCallIndex(
  toolCallParts: StreamToolCall[],
  partial: any,
  position: number,
  batchLength: number,
  lastToolCallIndex: number
): number {
  const partialId = typeof partial.id === 'string' ? partial.id : '';
  if (partialId) {
    const existingById = toolCallParts.findIndex((tc) => tc?.id === partialId);
    if (existingById >= 0) return existingById;
  }

  if (typeof partial.index === 'number') {
    const existing = toolCallParts[partial.index];
    if (!existing || !existing.id || !partialId || existing.id === partialId) {
      return partial.index;
    }
    return toolCallParts.length;
  }

  if (batchLength > 1) {
    const existing = toolCallParts[position];
    if (!existing || !existing.id || !partialId || existing.id === partialId) {
      return position;
    }
  }

  return lastToolCallIndex >= 0 ? lastToolCallIndex : toolCallParts.length;
}

function mergeToolName(current: string, incoming: string): string {
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  return current + incoming;
}

function splitKnownToolNames(name: string, knownToolNames: Set<string>): string[] {
  if (knownToolNames.has(name)) return [name];

  const namesByLength = [...knownToolNames].sort((a, b) => b.length - a.length);
  const result: string[] = [];
  let remaining = name;

  while (remaining) {
    const nextName = namesByLength.find((toolName) => remaining.startsWith(toolName));
    if (!nextName) return [name];
    result.push(nextName);
    remaining = remaining.slice(nextName.length);
  }

  return result.length > 0 ? result : [name];
}

function expandConcatenatedToolNames(
  toolCalls: StreamToolCall[],
  knownToolNames: Set<string>
): StreamToolCall[] {
  const expanded: StreamToolCall[] = [];

  toolCalls.forEach((tc, index) => {
    const names = splitKnownToolNames(tc.function.name, knownToolNames);
    if (names.length <= 1) {
      expanded.push({ ...tc, id: tc.id || `call_${index}` });
      return;
    }

    names.forEach((name, nameIndex) => {
      expanded.push({
        ...tc,
        id: nameIndex === 0 ? tc.id || `call_${index}` : `${tc.id || `call_${index}`}_${nameIndex}`,
        function: {
          name,
          arguments: nameIndex === names.length - 1 ? tc.function.arguments : '{}',
        },
      });
    });
  });

  return expanded;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeNativeThinking(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function wrapNativeThinking(thinking: string, content: string): string {
  const trimmedThinking = thinking.trim();
  if (!trimmedThinking) return content;
  return `<thinking>${trimmedThinking}</thinking>${content}`;
}

export function applyThinkingConfig(
  body: Record<string, any>,
  enabled: boolean | undefined,
  compatibility: ThinkingCompatibility = 'standard',
  effort: ThinkingEffort = 'high'
): void {
  if (!enabled) return;

  body.reasoning = { effort };
  if (compatibility === 'nanogpt') {
    body.reasoning_effort = effort;
  }
}

function buildChatHeaders(apiKey: string, promptCache?: PromptCacheRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey.trim()}`,
  };

  if (
    promptCache?.enabled &&
    promptCache.ttl === '1h' &&
    promptCache.compatibility === 'nanogpt'
  ) {
    headers['anthropic-beta'] = 'prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11';
  }

  return headers;
}

function applyPromptCacheCompatibility(body: Record<string, any>, promptCache?: PromptCacheRequestOptions): void {
  if (!promptCache?.enabled) return;

  if (promptCache.compatibility === 'nanogpt') {
    body.promptCaching = {
      enabled: true,
      ttl: promptCache.ttl,
      explicitCacheControl: true,
    };
  }
}

function normalizeUsage(raw: RawApiUsage | null | undefined): ApiTokenUsage | undefined {
  if (!raw) return undefined;
  return {
    promptTokens: numberOrUndefined(raw.prompt_tokens),
    completionTokens: numberOrUndefined(raw.completion_tokens),
    totalTokens: numberOrUndefined(raw.total_tokens),
    cachedTokens: numberOrUndefined(raw.prompt_tokens_details?.cached_tokens),
    reasoningTokens: numberOrUndefined(raw.completion_tokens_details?.reasoning_tokens),
    detailsJson: JSON.stringify(raw),
  };
}

function statusForError(error: unknown): ApiUsageStatus {
  const name = String((error as any)?.name || '').toLowerCase();
  const message = String((error as any)?.message || '').toLowerCase();
  if (name === 'aborterror' || message.includes('abort') || message.includes('cancel')) {
    return 'aborted';
  }
  return 'error';
}

function consumeSseBuffer(
  buffer: string,
  flush: boolean,
  onJson: (json: any) => void
): string {
  const lines = buffer.split(/\r?\n/);
  const pending = flush ? '' : lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: ')) continue;

    const data = trimmed.slice(6).trim();
    if (!data || data === '[DONE]') continue;

    try {
      onJson(JSON.parse(data));
    } catch {
      // skip malformed JSON
    }
  }

  return pending;
}

async function recordApiUsage({
  request,
  streaming,
  startedAt,
  endedAt,
  status,
  usage,
  errorMessage,
}: {
  request: ChatRequest;
  streaming: boolean;
  startedAt: number;
  endedAt: number;
  status: ApiUsageStatus;
  usage?: ApiTokenUsage;
  errorMessage?: string;
}): Promise<void> {
  const context = request.usageContext;
  try {
    await insertApiUsageEvent({
      id: randomUUID(),
      feature: context?.feature || 'unknown',
      requestKind: context?.requestKind || 'chat',
      streaming,
      status,
      model: request.model,
      baseUrl: request.baseUrl.trim().replace(/\/$/, ''),
      conversationId: context?.conversationId,
      messageId: context?.messageId,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      totalTokens: usage?.totalTokens,
      cachedTokens: usage?.cachedTokens,
      reasoningTokens: usage?.reasoningTokens,
      detailsJson: usage?.detailsJson,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      errorMessage,
      metadataJson: context?.metadata ? JSON.stringify(context.metadata) : undefined,
    });
  } catch (error) {
    console.warn('[API usage] failed to record usage event:', error);
  }
}

/**
 * 非流式 chat completions（Tool Use 阶段使用）
 */
export async function chatCompletion(
  request: ChatRequestWithTools
): Promise<ChatCompletionResponse> {
  const { baseUrl, apiKey, model, messages, maxTokens, temperature, generateThinking, thinkingEffort, thinkingCompatibility, tools, sessionId, promptCache } = request;
  const startedAt = Date.now();

  const url = `${baseUrl.trim().replace(/\/$/, '')}/chat/completions`;

  const body: Record<string, any> = {
    model,
    messages,
    stream: false,
  };
  if (typeof maxTokens === 'number') {
    body.max_tokens = maxTokens;
  }
  if (typeof temperature === 'number') {
    body.temperature = temperature;
  }
  applyThinkingConfig(body, generateThinking, thinkingCompatibility, thinkingEffort);
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  if (sessionId) {
    body.session_id = sessionId;
  }
  applyPromptCacheCompatibility(body, promptCache);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildChatHeaders(apiKey, promptCache),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const json = await response.json();
    if (request.returnNativeThinking) {
      for (const choice of json.choices || []) {
        const message = choice?.message;
        if (!message) continue;
        const thinking =
          normalizeNativeThinking(message.reasoning_content) ||
          normalizeNativeThinking(message.reasoning);
        if (thinking) {
          message.content = wrapNativeThinking(thinking, message.content || '');
        }
      }
    }
    await recordApiUsage({
      request,
      streaming: false,
      startedAt,
      endedAt: Date.now(),
      status: 'success',
      usage: normalizeUsage(json.usage),
    });
    return json;
  } catch (error: any) {
    await recordApiUsage({
      request,
      streaming: false,
      startedAt,
      endedAt: Date.now(),
      status: statusForError(error),
      errorMessage: error?.message || String(error),
    });
    throw error;
  }
}

export async function streamChatCompletion(
  request: ChatRequestWithTools,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<StreamChatCompletionResult> {
  const { baseUrl, apiKey, model, messages, maxTokens, temperature, generateThinking, thinkingEffort, thinkingCompatibility, returnNativeThinking, tools, sessionId, promptCache } = request;
  const startedAt = Date.now();

  const url = `${baseUrl.trim().replace(/\/$/, '')}/chat/completions`;

  const body: Record<string, any> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (typeof maxTokens === 'number') {
    body.max_tokens = maxTokens;
  }
  if (typeof temperature === 'number') {
    body.temperature = temperature;
  }
  applyThinkingConfig(body, generateThinking, thinkingCompatibility, thinkingEffort);
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  if (sessionId) {
    body.session_id = sessionId;
  }
  applyPromptCacheCompatibility(body, promptCache);

  let rawUsage: RawApiUsage | undefined;

  try {
    const response = await expoFetch(url, {
      method: 'POST',
      headers: buildChatHeaders(apiKey, promptCache),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let nativeThinking = '';
    let nativeThinkingOpened = false;
    let nativeThinkingClosed = false;
    let finishReason: string | undefined;
    const toolCallParts: StreamToolCall[] = [];
    const knownToolNames = new Set((tools || []).map((tool) => tool.function.name));
    let lastToolCallIndex = -1;

    const handleJson = (json: any) => {
      if (json.usage) {
        rawUsage = json.usage;
      }
      const choice = json.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta || {};
      const thinkingDelta =
        returnNativeThinking
          ? normalizeNativeThinking(delta.reasoning_content) || normalizeNativeThinking(delta.reasoning)
          : '';
      if (thinkingDelta) {
        if (!nativeThinkingOpened) {
          nativeThinkingOpened = true;
          onToken('<thinking>');
        }
        nativeThinking += thinkingDelta;
        onToken(thinkingDelta);
      }

      if (delta.content) {
        if (nativeThinkingOpened && !nativeThinkingClosed) {
          nativeThinkingClosed = true;
          onToken('</thinking>');
        }
        content += delta.content;
        onToken(delta.content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (let position = 0; position < delta.tool_calls.length; position++) {
          const partial = delta.tool_calls[position];
          let index = resolveToolCallIndex(
            toolCallParts,
            partial,
            position,
            delta.tool_calls.length,
            lastToolCallIndex
          );
          if (!toolCallParts[index]) {
            toolCallParts[index] = createEmptyToolCall();
          }

          let target = toolCallParts[index];
          if (partial.id) target.id = partial.id;
          if (partial.type) target.type = partial.type;
          if (partial.function?.name) {
            const incomingName = partial.function.name;
            if (
              knownToolNames.has(target.function.name) &&
              knownToolNames.has(incomingName) &&
              target.function.name !== incomingName
            ) {
              index = toolCallParts.length;
              toolCallParts[index] = {
                ...createEmptyToolCall(),
                id:
                  partial.id && partial.id !== target.id
                    ? partial.id
                    : `${target.id || `call_${index - 1}`}_${index}`,
                type: partial.type || target.type,
              };
              target = toolCallParts[index];
            }
            target.function.name = mergeToolName(target.function.name, incomingName);
          }
          if (partial.function?.arguments) {
            target.function.arguments += partial.function.arguments;
          }
          lastToolCallIndex = index;
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSseBuffer(buffer, false, handleJson);
    }
    buffer += decoder.decode();
    consumeSseBuffer(buffer, true, handleJson);

    if (nativeThinkingOpened && !nativeThinkingClosed) {
      nativeThinkingClosed = true;
      onToken('</thinking>');
    }

    const toolCalls = expandConcatenatedToolNames(
      toolCallParts.filter((tc) => tc.function.name),
      knownToolNames
    );
    const usage = normalizeUsage(rawUsage);
    await recordApiUsage({
      request,
      streaming: true,
      startedAt,
      endedAt: Date.now(),
      status: 'success',
      usage,
    });

    return {
      content: wrapNativeThinking(nativeThinking, content),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: finishReason,
      usage,
    };
  } catch (error: any) {
    await recordApiUsage({
      request,
      streaming: true,
      startedAt,
      endedAt: Date.now(),
      status: statusForError(error),
      usage: normalizeUsage(rawUsage),
      errorMessage: error?.message || String(error),
    });
    throw error;
  }
}

export async function streamChat(
  request: ChatRequest,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<ApiTokenUsage | undefined> {
  const { baseUrl, apiKey, model, messages, maxTokens, temperature, generateThinking, thinkingEffort, thinkingCompatibility, returnNativeThinking, sessionId, promptCache } = request;
  const startedAt = Date.now();

  const url = `${baseUrl.trim().replace(/\/$/, '')}/chat/completions`;

  const body: Record<string, any> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (typeof maxTokens === 'number') {
    body.max_tokens = maxTokens;
  }
  if (typeof temperature === 'number') {
    body.temperature = temperature;
  }
  applyThinkingConfig(body, generateThinking, thinkingCompatibility, thinkingEffort);
  if (sessionId) {
    body.session_id = sessionId;
  }
  applyPromptCacheCompatibility(body, promptCache);

  let rawUsage: RawApiUsage | undefined;

  try {
    const response = await expoFetch(url, {
      method: 'POST',
      headers: buildChatHeaders(apiKey, promptCache),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let nativeThinkingOpened = false;
    let nativeThinkingClosed = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSseBuffer(buffer, false, (json) => {
          if (json.usage) {
            rawUsage = json.usage;
          }
          const rawDelta = json.choices?.[0]?.delta || {};
          const thinkingDelta =
            returnNativeThinking
              ? normalizeNativeThinking(rawDelta.reasoning_content) || normalizeNativeThinking(rawDelta.reasoning)
              : '';
          if (thinkingDelta) {
            if (!nativeThinkingOpened) {
              nativeThinkingOpened = true;
              onToken('<thinking>');
            }
            onToken(thinkingDelta);
          }
          const delta = rawDelta.content;
          if (delta) {
            if (nativeThinkingOpened && !nativeThinkingClosed) {
              nativeThinkingClosed = true;
              onToken('</thinking>');
            }
            onToken(delta);
          }
      });
    }
    buffer += decoder.decode();
    consumeSseBuffer(buffer, true, (json) => {
      if (json.usage) {
        rawUsage = json.usage;
      }
      const rawDelta = json.choices?.[0]?.delta || {};
      const thinkingDelta =
        returnNativeThinking
          ? normalizeNativeThinking(rawDelta.reasoning_content) || normalizeNativeThinking(rawDelta.reasoning)
          : '';
      if (thinkingDelta) {
        if (!nativeThinkingOpened) {
          nativeThinkingOpened = true;
          onToken('<thinking>');
        }
        onToken(thinkingDelta);
      }
      const delta = rawDelta.content;
      if (delta) {
        if (nativeThinkingOpened && !nativeThinkingClosed) {
          nativeThinkingClosed = true;
          onToken('</thinking>');
        }
        onToken(delta);
      }
    });

    if (nativeThinkingOpened && !nativeThinkingClosed) {
      onToken('</thinking>');
    }

    const usage = normalizeUsage(rawUsage);
    await recordApiUsage({
      request,
      streaming: true,
      startedAt,
      endedAt: Date.now(),
      status: 'success',
      usage,
    });
    return usage;
  } catch (error: any) {
    await recordApiUsage({
      request,
      streaming: true,
      startedAt,
      endedAt: Date.now(),
      status: statusForError(error),
      usage: normalizeUsage(rawUsage),
      errorMessage: error?.message || String(error),
    });
    throw error;
  }
}
