export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  // AI 回复过程中实际发生的工具调用记录，用于在气泡上方展示「调用了什么工具」。
  // 每次调用一行；随消息一起持久化。
  toolInvocations?: ToolInvocation[];
  imageUri?: string;
  createdAt: number;
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
}

export interface Diary {
  id: string;
  title: string;
  content: string;
  isFavorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface APIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
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
