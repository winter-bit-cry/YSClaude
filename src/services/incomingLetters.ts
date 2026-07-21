import { randomUUID } from 'expo-crypto';
import { chatCompletion, ChatMessage } from './api';
import { executeTool, getToolDefinitions } from './tools';
import {
  getIncomingLetterByOccasionDate,
  getUnshownIncomingLettersByDate,
  insertIncomingLetter,
  updateIncomingLetter,
} from '../db/operations';
import { useSettingsStore } from '../stores/settings';
import { IncomingLetter, IncomingLetterOccasion, ToolInvocation } from '../types';

const GENERATING_STALE_MS = 15 * 60 * 1000;

function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isOccasionDueOn(occasion: IncomingLetterOccasion, dateKey: string): boolean {
  if (!occasion.enabled || !occasion.date) return false;
  if (occasion.repeatYearly) return occasion.date.slice(5) === dateKey.slice(5);
  return occasion.date === dateKey;
}

function buildLetterRequestMessages(
  occasion: IncomingLetterOccasion,
  dateKey: string
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const systemPrompt = occasion.systemPrompt.trim();
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({
    role: 'user',
    content: JSON.stringify(
      {
        occasion: {
          title: occasion.title,
          date: occasion.date,
          repeatYearly: occasion.repeatYearly,
        },
        today: dateKey,
      },
      null,
      2
    ),
  });
  return messages;
}

function getTextResult(result: Awaited<ReturnType<typeof executeTool>>): string {
  return typeof result === 'string' ? result : result.text;
}

function getDisplayResult(result: Awaited<ReturnType<typeof executeTool>>): string {
  return typeof result === 'string' ? result : result.displayContent || result.text;
}

async function generateLetterContent(
  occasion: IncomingLetterOccasion,
  dateKey: string
): Promise<{ content: string; toolInvocations: ToolInvocation[] }> {
  const settings = useSettingsStore.getState();
  const config = settings.apiConfigs[settings.activeConfigIndex];
  if (!config?.baseUrl || !config.apiKey) {
    throw new Error('请先在设置中配置 API');
  }

  const memoryEnabled = settings.memoryVaultConfig.enabled && !!settings.memoryVaultConfig.baseUrl;
  const tools = getToolDefinitions({
    memoryVault: memoryEnabled,
    memoryVaultConfig: settings.memoryVaultConfig,
    webSearch: false,
    webInteraction: false,
    conversationWindows: false,
    htmlArtifacts: false,
  });
  const maxToolCalls = memoryEnabled
    ? Math.max(1, settings.memoryVaultConfig.maxToolCalls || 3)
    : 0;
  const messages: any[] = buildLetterRequestMessages(occasion, dateKey);
  const toolInvocations: ToolInvocation[] = [];
  let toolCallCount = 0;

  while (true) {
    const response = await chatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages,
      maxTokens: settings.maxOutputTokens || undefined,
      temperature: config.temperature,
      generateThinking: config.generateThinking,
      thinkingEffort: config.thinkingEffort,
      thinkingCompatibility: config.thinkingCompatibility,
      returnNativeThinking: config.returnNativeThinking,
      tools,
      usageContext: {
        feature: 'incoming-letter',
        requestKind: toolCallCount > 0 ? 'tool-followup' : 'letter-generation',
        metadata: {
          occasionId: occasion.id,
          dateKey,
          toolCount: tools.length,
        },
      },
    });

    const message = response.choices?.[0]?.message;
    const content = message?.content || '';
    const toolCalls = message?.tool_calls || [];
    if (toolCalls.length === 0 || toolCallCount >= maxToolCalls) {
      return { content: content.trim(), toolInvocations };
    }

    const assistantToolMessage: any = {
      role: 'assistant',
      tool_calls: toolCalls,
    };
    if (content) {
      assistantToolMessage.content = content;
    }
    messages.push(assistantToolMessage);

    for (const tc of toolCalls) {
      toolCallCount++;
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }

      const runningInvocation: ToolInvocation = {
        callId: tc.id,
        name: tc.function.name,
        args: tc.function.arguments || '',
        status: 'running',
      };
      toolInvocations.push(runningInvocation);

      const result = await executeTool(tc.function.name, args, {
        memoryVaultConfig: settings.memoryVaultConfig,
        webSearchConfig: settings.webSearchConfig,
        webInteractionConfig: settings.webInteractionConfig,
        conversationArtifactToolConfig: { enabled: false, maxToolCalls: 0 },
        conversationWindowToolConfig: { enabled: false },
        htmlArtifactToolConfig: settings.htmlArtifactToolConfig,
        hotboardConfig: settings.hotboardConfig,
        runCommandConfig: settings.runCommandConfig,
        nativeToolConfig: settings.nativeToolConfig,
        mcpToolConfig: settings.mcpToolConfig,
      });

      Object.assign(runningInvocation, {
        result: getDisplayResult(result),
        status: 'done' as const,
      });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: getTextResult(result),
      });
    }
  }
}

async function ensureLetterForOccasion(
  occasion: IncomingLetterOccasion,
  dateKey: string,
  options?: { force?: boolean }
): Promise<void> {
  const existing = await getIncomingLetterByOccasionDate(occasion.id, dateKey);
  const now = Date.now();
  const force = !!options?.force;
  if (existing?.status === 'ready' && !force) return;
  if (
    existing?.status === 'generating' &&
    now - existing.updatedAt < GENERATING_STALE_MS &&
    !force
  ) {
    return;
  }
  if (existing?.status === 'failed' && !force) return;

  const letterId = existing?.id || randomUUID();
  if (!existing) {
    await insertIncomingLetter({
      id: letterId,
      occasionId: occasion.id,
      occasionTitle: occasion.title,
      dateKey,
      title: occasion.title,
      content: '',
      status: 'generating',
      generatedAt: null,
      shownAt: null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await updateIncomingLetter(letterId, {
      status: 'generating',
      content: force ? '' : existing.content,
      shownAt: force ? null : existing.shownAt,
      errorMessage: '',
      updatedAt: now,
    });
  }

  try {
    const result = await generateLetterContent(occasion, dateKey);
    const generatedAt = Date.now();
    await updateIncomingLetter(letterId, {
      title: occasion.title,
      content: result.content,
      status: 'ready',
      generatedAt,
      updatedAt: generatedAt,
      errorMessage: '',
      toolInvocations: result.toolInvocations,
    });
  } catch (error: any) {
    const failedAt = Date.now();
    await updateIncomingLetter(letterId, {
      status: 'failed',
      errorMessage: error?.message || '生成来信失败',
      updatedAt: failedAt,
      toolInvocations: [],
    });
  }
}

export async function generateImmediateIncomingLetter(
  occasion: IncomingLetterOccasion
): Promise<IncomingLetter> {
  const dateKey = getLocalDateKey();
  await ensureLetterForOccasion(occasion, dateKey, { force: true });
  const letter = await getIncomingLetterByOccasionDate(occasion.id, dateKey);
  if (!letter) {
    throw new Error('来信生成后未找到记录');
  }
  if (letter.status === 'failed') {
    throw new Error(letter.errorMessage || '生成来信失败');
  }
  return letter;
}

export async function ensureTodayIncomingLetters(): Promise<IncomingLetter[]> {
  const settings = useSettingsStore.getState();
  if (!settings._hydrated || !settings.incomingLetterConfig?.enabled) return [];
  const config = settings.apiConfigs[settings.activeConfigIndex];
  if (!config?.baseUrl || !config.apiKey) return [];

  const dateKey = getLocalDateKey();
  const dueOccasions = settings.incomingLetterConfig.occasions.filter((occasion) =>
    isOccasionDueOn(occasion, dateKey)
  );
  for (const occasion of dueOccasions) {
    await ensureLetterForOccasion(occasion, dateKey);
  }
  return getUnshownIncomingLettersByDate(dateKey);
}
