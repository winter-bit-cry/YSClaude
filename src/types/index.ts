export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  // AI 回复过程中实际发生的工具调用记录，用于在气泡上方展示「调用了什么工具」。
  // 每次调用一行；随消息一起持久化。
  toolInvocations?: ToolInvocation[];
  // AI 回复中 [Pic:...] token 对应的本地生成图状态。
  // 真实图片仅用于客户端展示，不会自动作为 image_url 发回给 AI。
  generatedPics?: GeneratedPicture[];
  imageUri?: string;
  createdAt: number;
}

export type GeneratedPictureStatus = 'pending' | 'done' | 'failed' | 'deleted';

export interface GeneratedPicture {
  tokenIndex: number;
  prompt: string;
  finalPrompt: string;
  status: GeneratedPictureStatus;
  imageUri?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

// 单次工具调用的展示记录（已发生的事实，区别于请求模型用的 ToolCall）
export interface ToolInvocation {
  callId?: string;     // 模型返回的 tool_call id，用于把调用结果回填到同一条记录
  name: string;        // 工具名，如 web_search
  args: string;        // 原始参数 JSON 字符串
  result?: string;     // 工具执行结果或错误文本，供展开调试查看
  status?: 'running' | 'done';
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface HiddenRange {
  from: number;
  to: number;
}

export interface Conversation {
  id: string;
  title: string;
  systemPrompt: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  hiddenRanges?: HiddenRange[];
  hiddenMessageIds?: string[];
}

export interface Diary {
  id: string;
  title: string;
  content: string;
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PeriodRecord {
  id: string;
  startDate: string;
  endDate: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface APIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  returnNativeThinking?: boolean;
}

export type ReadingBookFormat = 'txt' | 'epub';

export interface ReadingChapter {
  id: string;
  title: string;
  start: number;
}

export interface ReadingBook {
  id: string;
  title: string;
  author: string;
  coverUri?: string;
  fileUri?: string;
  format: ReadingBookFormat;
  text: string;
  chapters: ReadingChapter[];
  readingOffset: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReadingMessage {
  id: string;
  bookId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface ReadingNote {
  id: string;
  bookId: string;
  kind: 'summary' | 'reflection';
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReadingHighlight {
  id: string;
  bookId: string;
  content: string;
  start: number;
  end: number;
  createdAt: number;
}

export interface ReadingBookSnapshot {
  bookId: string;
  title: string;
  author: string;
  updatedAt: number;
}

export type FocusTimerMode = 'countdown' | 'countup';

export interface FocusTask {
  id: string;
  title: string;
  timerMode: FocusTimerMode;
  durationMs: number;
  targetCount: number;
  completedCount: number;
  createdAt: number;
  updatedAt: number;
}

export type FocusSessionStatus = 'running' | 'paused' | 'completed' | 'abandoned';

export interface FocusSession {
  id: string;
  taskId: string;
  taskTitle: string;
  timerMode: FocusTimerMode;
  plannedDurationMs: number;
  startedAt: number;
  endedAt?: number;
  pausedDurationMs: number;
  pauseStartedAt?: number;
  status: FocusSessionStatus;
  endReason?: 'completed' | 'abandoned';
  createdAt: number;
  updatedAt: number;
}

export interface ModelOption {
  id: string;
  name: string;
  apiConfigIndex: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
      }>;
      required: string[];
    };
  };
}

export interface ApiTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  detailsJson?: string;
}

export type ApiUsageStatus = 'success' | 'error' | 'aborted';

export interface ApiUsageEvent extends ApiTokenUsage {
  id: string;
  feature: string;
  requestKind: string;
  streaming: boolean;
  status: ApiUsageStatus;
  model: string;
  baseUrl: string;
  conversationId?: string;
  messageId?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  errorMessage?: string;
  metadataJson?: string;
}

export interface ApiUsageSummary {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  abortedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalDurationMs: number;
}

export interface ApiUsageGroupSummary extends ApiUsageSummary {
  key: string;
  channels?: string[];
}

export interface ApiUsageDailySummary extends ApiUsageSummary {
  dateKey: string;
}
