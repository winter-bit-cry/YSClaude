import {
  getAllConversations,
  getMessagesByConversation,
  searchConversationFloorsByKeywordsGlobally,
  searchConversationFloorsGlobally,
} from '../../db/operations';
import type { Conversation, Message } from '../../types';
import type { ToolDefinition, ToolModule } from './types';

const LIST_WINDOWS: ToolDefinition = {
  type: 'function',
  function: {
    name: 'conversation_windows_list',
    description: '分页列出对话窗口的总数、名称和 ID。需要查看其他窗口时先调用此工具；如 has_more 为 true，使用 next_page 继续获取。隐藏楼层不会影响结果。',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1, description: '页码，从 1 开始，默认 1' },
        page_size: { type: 'integer', minimum: 1, maximum: 50, description: '每页窗口数，默认 20，最大 50' },
      },
      required: [],
    },
  },
};

const COUNT_FLOORS: ToolDefinition = {
  type: 'function',
  function: {
    name: 'conversation_window_floor_count',
    description: '查看指定名称的对话窗口共有多少楼。楼层只统计 user 和 assistant 消息，隐藏楼层仍会统计。',
    parameters: {
      type: 'object',
      properties: {
        window_name: { type: 'string', description: '对话窗口的完整名称，来自 conversation_windows_list' },
      },
      required: ['window_name'],
    },
  },
};

const READ_FLOORS: ToolDefinition = {
  type: 'function',
  function: {
    name: 'conversation_window_read_floors',
    description: '读取指定名称窗口中从第 x 楼到第 y 楼的完整内容（包含首尾）。隐藏楼层也会返回。',
    parameters: {
      type: 'object',
      properties: {
        window_name: { type: 'string', description: '对话窗口的完整名称，来自 conversation_windows_list' },
        from_floor: { type: 'integer', minimum: 1, description: '起始楼层 x，从 1 开始' },
        to_floor: { type: 'integer', minimum: 1, description: '结束楼层 y，包含该楼层' },
      },
      required: ['window_name', 'from_floor', 'to_floor'],
    },
  },
};

const SEARCH_WINDOW: ToolDefinition = {
  type: 'function',
  function: {
    name: 'conversation_window_search',
    description: '在指定名称的对话窗口内搜索关键词，返回匹配楼层及内容。搜索不受隐藏楼层影响。',
    parameters: {
      type: 'object',
      properties: {
        window_name: { type: 'string', description: '对话窗口的完整名称，来自 conversation_windows_list' },
        keyword: { type: 'string', description: '要搜索的关键词，不区分大小写' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回的匹配数，默认 50，最大 100' },
      },
      required: ['window_name', 'keyword'],
    },
  },
};

const SEARCH_ALL_WINDOWS: ToolDefinition = {
  type: 'function',
  function: {
    name: 'conversation_windows_search_all',
    description: '在所有对话窗口的全部楼层内搜索关键词。总命中数不超过 10 时直接返回全部完整正文；超过 10 时分页返回短摘要。隐藏楼层仍参与搜索，继续搜索时原样传回 next_cursor。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '要搜索的关键词，不区分大小写' },
        page_size: { type: 'integer', minimum: 1, maximum: 50, description: '每页结果数，默认 20，最大 50' },
        cursor: { type: 'string', description: '上一页返回的 next_cursor；第一页不要传' },
      },
      required: ['keyword'],
    },
  },
};

const READ_SEARCH_RESULT: ToolDefinition = {
  type: 'function',
  function: {
    name: 'conversation_search_result_read',
    description: '读取全窗口搜索结果中的某一条完整楼层内容。参数来自 conversation_windows_search_all 的结果。',
    parameters: {
      type: 'object',
      properties: {
        result_id: { type: 'string', description: 'conversation_windows_search_all 返回的 result_id' },
      },
      required: ['result_id'],
    },
  },
};

const SEARCH_ALL_WINDOWS_MULTI_KEYWORD: ToolDefinition = {
  type: 'function',
  function: {
    name: 'conversation_windows_search_multi',
    description: '在所有对话窗口内搜索多个关键词。可选择交集（同一楼层包含全部关键词）或并集（包含任一关键词）；总命中数不超过 10 时直接返回全部完整正文，超过 10 时分页返回短摘要。隐藏楼层仍参与搜索。',
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 10,
          description: '要搜索的关键词列表，至少 2 个、最多 10 个；关键词不区分大小写',
        },
        mode: {
          type: 'string',
          enum: ['intersection', 'union'],
          description: 'intersection 为交集，要求同一楼层包含全部关键词；union 为并集，包含任一关键词即可',
        },
        page_size: { type: 'integer', minimum: 1, maximum: 50, description: '每页结果数，默认 20，最大 50' },
        cursor: { type: 'string', description: '上一页返回的 next_cursor；第一页不要传' },
      },
      required: ['keywords', 'mode'],
    },
  },
};

const DEFINITIONS = [
  LIST_WINDOWS,
  COUNT_FLOORS,
  READ_FLOORS,
  SEARCH_WINDOW,
  SEARCH_ALL_WINDOWS,
  SEARCH_ALL_WINDOWS_MULTI_KEYWORD,
  READ_SEARCH_RESULT,
];
const FLOOR_ROLES = new Set<Message['role']>(['user', 'assistant']);

type FloorMessage = Message & { floor: number };

async function resolveWindow(rawName: unknown): Promise<Conversation> {
  const name = String(rawName ?? '').trim();
  if (!name) throw new Error('window_name 不能为空');

  const conversations = await getAllConversations();
  const exact = conversations.filter((item) => item.title.trim() === name);
  const matches = exact.length > 0
    ? exact
    : conversations.filter((item) => item.title.trim().toLocaleLowerCase() === name.toLocaleLowerCase());

  if (matches.length === 0) {
    throw new Error(`找不到名称为“${name}”的对话窗口，请先调用 conversation_windows_list 查看名称`);
  }
  if (matches.length > 1) {
    throw new Error(`存在多个同名窗口“${name}”：${matches.map((item) => item.id).join(', ')}。请先重命名窗口以便唯一指定`);
  }
  return matches[0];
}

async function getFloors(conversationId: string): Promise<FloorMessage[]> {
  const messages = await getMessagesByConversation(conversationId);
  let floor = 0;
  return messages.flatMap((message) => {
    if (!FLOOR_ROLES.has(message.role)) return [];
    floor += 1;
    return [{ ...message, floor }];
  });
}

function serializeFloor(message: FloorMessage) {
  return {
    floor: message.floor,
    role: message.role,
    content: message.content,
    created_at: new Date(message.createdAt).toISOString(),
    message_id: message.id,
  };
}

function createSnippet(content: string, keyword: string, radius = 100): string {
  const index = content.toLocaleLowerCase().indexOf(keyword.toLocaleLowerCase());
  if (index < 0) return content.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + keyword.length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

function createMultiKeywordSnippet(content: string, keywords: string[], radius = 100): string {
  const normalizedContent = content.toLocaleLowerCase();
  const firstMatch = keywords
    .map((keyword) => ({ keyword, index: normalizedContent.indexOf(keyword.toLocaleLowerCase()) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0];
  return createSnippet(content, firstMatch?.keyword || keywords[0], radius);
}

function encodeCursor(createdAt: number, messageId: string): string {
  return JSON.stringify([createdAt, messageId]);
}

function decodeCursor(rawCursor: unknown): { createdAt?: number; messageId?: string } {
  if (rawCursor === undefined || rawCursor === null || rawCursor === '') return {};
  try {
    const parsed = JSON.parse(String(rawCursor));
    if (
      !Array.isArray(parsed)
      || !Number.isFinite(parsed[0])
      || typeof parsed[1] !== 'string'
      || !parsed[1]
    ) {
      throw new Error();
    }
    return { createdAt: parsed[0], messageId: parsed[1] };
  } catch {
    throw new Error('cursor 无效，请原样使用上一页返回的 next_cursor');
  }
}

function encodeResultId(conversationId: string, messageId: string): string {
  return JSON.stringify([conversationId, messageId]);
}

function decodeResultId(rawResultId: unknown): { conversationId: string; messageId: string } {
  try {
    const parsed = JSON.parse(String(rawResultId));
    if (
      !Array.isArray(parsed)
      || typeof parsed[0] !== 'string'
      || !parsed[0]
      || typeof parsed[1] !== 'string'
      || !parsed[1]
    ) {
      throw new Error();
    }
    return { conversationId: parsed[0], messageId: parsed[1] };
  } catch {
    throw new Error('result_id 无效，请原样使用搜索结果中的 result_id');
  }
}

export const conversationWindowsTool: ToolModule = {
  id: 'conversation-windows',
  labels: {
    conversation_windows_list: '查看对话窗口列表',
    conversation_window_floor_count: '查看窗口楼层数',
    conversation_window_read_floors: '读取窗口楼层',
    conversation_window_search: '搜索对话窗口',
  },
  getDefinitions: (config) => config.conversationWindows ? DEFINITIONS : [],
  execute: async (toolName, args, context) => {
    if (
      (
        toolName === 'conversation_windows_list'
        || toolName.startsWith('conversation_window_')
        || toolName.startsWith('conversation_windows_')
        || toolName === 'conversation_search_result_read'
      )
      && !context.conversationWindowToolConfig?.enabled
    ) {
      throw new Error('对话窗口查看工具未开启');
    }
    if (toolName === 'conversation_windows_list') {
      const conversations = await getAllConversations();
      const pageSize = Math.min(50, Math.max(1, Number.isInteger(args.page_size) ? args.page_size : 20));
      const requestedPage = Number.isInteger(args.page) ? args.page : 1;
      if (requestedPage < 1) throw new Error('page 必须是从 1 开始的正整数');
      const totalPages = Math.ceil(conversations.length / pageSize);
      const offset = (requestedPage - 1) * pageSize;
      const windows = conversations.slice(offset, offset + pageSize);
      const hasMore = offset + windows.length < conversations.length;
      return JSON.stringify({
        window_count: conversations.length,
        page: requestedPage,
        page_size: pageSize,
        total_pages: totalPages,
        returned_count: windows.length,
        has_more: hasMore,
        next_page: hasMore ? requestedPage + 1 : null,
        windows: windows.map((item) => ({ name: item.title, id: item.id })),
      });
    }

    if (toolName === 'conversation_windows_search_all') {
      const keyword = String(args.keyword ?? '').trim();
      if (!keyword) throw new Error('keyword 不能为空');
      const pageSize = Math.min(50, Math.max(1, Number.isInteger(args.page_size) ? args.page_size : 20));
      const cursor = decodeCursor(args.cursor);
      let page = await searchConversationFloorsGlobally(keyword, {
        limit: pageSize,
        beforeCreatedAt: cursor.createdAt,
        beforeMessageId: cursor.messageId,
      });
      if (!cursor.messageId && page.totalMatches <= 10 && page.results.length < page.totalMatches) {
        page = await searchConversationFloorsGlobally(keyword, { limit: 10 });
      }
      const returnFullContent = page.totalMatches <= 10;
      const last = page.results[page.results.length - 1];
      return JSON.stringify({
        keyword,
        total_matches: page.totalMatches,
        returned_count: page.results.length,
        has_more: page.hasMore,
        next_cursor: page.hasMore && last ? encodeCursor(last.createdAt, last.messageId) : null,
        results: page.results.map((item) => ({
          result_id: encodeResultId(item.conversationId, item.messageId),
          window_name: item.conversationTitle,
          window_id: item.conversationId,
          floor: item.floorNumber,
          role: item.role,
          created_at: new Date(item.createdAt).toISOString(),
          ...(returnFullContent
            ? { content: item.content }
            : { snippet: createSnippet(item.content, keyword) }),
        })),
      });
    }

    if (toolName === 'conversation_windows_search_multi') {
      if (!Array.isArray(args.keywords)) throw new Error('keywords 必须是字符串数组');
      const keywords = Array.from(new Set(
        args.keywords.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      ));
      if (keywords.length < 2 || keywords.length > 10) {
        throw new Error('去空和去重后，keywords 必须包含 2 至 10 个关键词');
      }
      const mode = args.mode;
      if (mode !== 'intersection' && mode !== 'union') {
        throw new Error('mode 必须是 intersection 或 union');
      }
      const pageSize = Math.min(50, Math.max(1, Number.isInteger(args.page_size) ? args.page_size : 20));
      const cursor = decodeCursor(args.cursor);
      let page = await searchConversationFloorsByKeywordsGlobally(keywords, mode, {
        limit: pageSize,
        beforeCreatedAt: cursor.createdAt,
        beforeMessageId: cursor.messageId,
      });
      if (!cursor.messageId && page.totalMatches <= 10 && page.results.length < page.totalMatches) {
        page = await searchConversationFloorsByKeywordsGlobally(keywords, mode, { limit: 10 });
      }
      const returnFullContent = page.totalMatches <= 10;
      const last = page.results[page.results.length - 1];
      return JSON.stringify({
        keywords,
        mode,
        total_matches: page.totalMatches,
        returned_count: page.results.length,
        has_more: page.hasMore,
        next_cursor: page.hasMore && last ? encodeCursor(last.createdAt, last.messageId) : null,
        results: page.results.map((item) => ({
          result_id: encodeResultId(item.conversationId, item.messageId),
          window_name: item.conversationTitle,
          window_id: item.conversationId,
          floor: item.floorNumber,
          role: item.role,
          created_at: new Date(item.createdAt).toISOString(),
          ...(returnFullContent
            ? { content: item.content }
            : { snippet: createMultiKeywordSnippet(item.content, keywords) }),
        })),
      });
    }

    if (toolName === 'conversation_search_result_read') {
      const resultId = decodeResultId(args.result_id);
      const conversations = await getAllConversations();
      const conversation = conversations.find((item) => item.id === resultId.conversationId);
      if (!conversation) throw new Error('搜索结果对应的窗口已不存在');
      const floors = await getFloors(conversation.id);
      const message = floors.find((item) => item.id === resultId.messageId);
      if (!message) throw new Error('搜索结果对应的楼层已不存在');
      return JSON.stringify({
        window_name: conversation.title,
        window_id: conversation.id,
        result: serializeFloor(message),
      });
    }

    if (
      !toolName.startsWith('conversation_window_')
    ) return undefined;
    const conversation = await resolveWindow(args.window_name);
    const floors = await getFloors(conversation.id);

    if (toolName === 'conversation_window_floor_count') {
      return JSON.stringify({
        window_name: conversation.title,
        window_id: conversation.id,
        floor_count: floors.length,
      });
    }

    if (toolName === 'conversation_window_read_floors') {
      const from = Number(args.from_floor);
      const to = Number(args.to_floor);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
        throw new Error('楼层范围无效：from_floor 和 to_floor 必须为正整数，且 to_floor 不小于 from_floor');
      }
      return JSON.stringify({
        window_name: conversation.title,
        window_id: conversation.id,
        floor_count: floors.length,
        requested_range: { from, to },
        floors: floors.filter((item) => item.floor >= from && item.floor <= to).map(serializeFloor),
      });
    }

    if (toolName === 'conversation_window_search') {
      const keyword = String(args.keyword ?? '').trim();
      if (!keyword) throw new Error('keyword 不能为空');
      const limit = Math.min(100, Math.max(1, Number.isInteger(args.limit) ? args.limit : 50));
      const normalizedKeyword = keyword.toLocaleLowerCase();
      const matchingFloors = floors.filter((item) =>
        item.content.toLocaleLowerCase().includes(normalizedKeyword)
      );
      const matches = matchingFloors.slice(0, limit).map(serializeFloor);
      return JSON.stringify({
        window_name: conversation.title,
        window_id: conversation.id,
        keyword,
        match_count: matchingFloors.length,
        returned_count: matches.length,
        truncated: matchingFloors.length > limit,
        matches,
      });
    }

    return undefined;
  },
};
