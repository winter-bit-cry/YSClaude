import { getDatabase } from './database';
import {
  Conversation,
  Message,
  Diary,
  PeriodRecord,
  HiddenRange,
  ToolInvocation,
  ReadingBook,
  ReadingChapter,
  ReadingMessage,
  ReadingNote,
  ReadingHighlight,
  ReadingBookSnapshot,
  FocusTask,
  FocusSession,
  FocusTimerMode,
  FocusSessionStatus,
  ToolCall,
  GeneratedPicture,
  ApiUsageEvent,
  ApiUsageDailySummary,
  ApiUsageGroupSummary,
  ApiUsageStatus,
  ApiUsageSummary,
} from '../types';
import {
  ANDROID_ACCESSIBILITY_CAPTURE_NOTICE_PREFIX,
  ANDROID_SCREENSHOT_CAPTURE_NOTICE_PREFIX,
} from '../utils/androidAccessibilityControl';
import {
  APP_EVENT_PREFIX,
  FOCUS_EVENT_PREFIX,
} from '../utils/focusEvents';
import {
  RADIO_CALL_IN_MARKER,
  RADIO_CONTINUE_MARKER,
  RADIO_END_MARKER,
  RADIO_START_MARKER,
} from '../utils/radioMarkers';
import { WEB_CRUISE_NOTICE_TEXT } from '../utils/webCruise';

interface MessageRow {
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_invocations: string | null;
  generated_pics: string | null;
  image_uri: string | null;
  created_at: number;
}

export interface ConversationMessagePage {
  messages: Message[];
  hasMore: boolean;
  floorOffset: number;
}

export interface ChatSearchResult {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: Message['role'];
  content: string;
  createdAt: number;
}

export interface ChatDiagnosticsConversation {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  hiddenRanges: HiddenRange[];
  hiddenMessageIds: string[];
  pendingResponseBoundaryMessageId: string | null | undefined;
  totalMessageCount: number;
  floorMessageCount: number;
  systemMessageCount: number;
  toolMessageCount: number;
  emptyAssistantCount: number;
  duplicateTimestampGroupCount: number;
  duplicateTimestampMessageCount: number;
  latestMessageRole: Message['role'] | null;
  latestMessageCreatedAt: number | null;
  issueCount: number;
}

export interface ChatDiagnosticsMessage {
  id: string;
  role: Message['role'];
  content: string;
  toolCallsRaw: string | null;
  toolCallId: string | null;
  toolInvocationsRaw: string | null;
  imageUri: string | null;
  createdAt: number;
  databaseIndex: number;
  floorNumber: number | null;
  isHidden: boolean;
  isHiddenByMessageId: boolean;
  isHiddenFromAi: boolean;
  duplicateTimestampCount: number;
  isPendingResponseBoundary: boolean;
  aiVisibility: 'history' | 'runtime-context' | 'ui-only';
  aiVisibilityLabel: string;
  issues: string[];
}

export interface ChatDiagnosticsDuplicateGroup {
  createdAt: number;
  count: number;
  ids: string[];
}

export interface ChatDiagnosticsDetail extends ChatDiagnosticsConversation {
  duplicateTimestampGroups: ChatDiagnosticsDuplicateGroup[];
  messages: ChatDiagnosticsMessage[];
}

export async function createConversation(conv: Conversation): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO conversations (id, title, system_prompt, model, created_at, updated_at, hidden_ranges, hidden_message_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conv.id,
      conv.title,
      conv.systemPrompt,
      conv.model,
      conv.createdAt,
      conv.updatedAt,
      JSON.stringify(conv.hiddenRanges ?? []),
      JSON.stringify(conv.hiddenMessageIds ?? []),
    ]
  );
}

export async function updateConversation(id: string, updates: Partial<Pick<Conversation, 'title' | 'updatedAt'>>): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', [id]);
  await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
}

export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    system_prompt: string;
    model: string;
    created_at: number;
    updated_at: number;
    hidden_ranges: string | null;
    hidden_message_ids: string | null;
  }>('SELECT * FROM conversations ORDER BY created_at DESC');

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    systemPrompt: row.system_prompt,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hiddenRanges: parseHiddenRanges(row.hidden_ranges),
    hiddenMessageIds: parseStringArray(row.hidden_message_ids),
  }));
}

/* ==================== 隐藏楼层范围 CRUD ==================== */

// 容错解析：损坏或非数组的 JSON 一律退回空数组
function parseHiddenRanges(raw: string | null | undefined): HiddenRange[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) => r && typeof r.from === 'number' && typeof r.to === 'number'
    );
  } catch {
    return [];
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value) => typeof value === 'string' && value.trim()))];
  } catch {
    return [];
  }
}

export async function getHiddenRanges(conversationId: string): Promise<HiddenRange[]> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ hidden_ranges: string | null }>(
    'SELECT hidden_ranges FROM conversations WHERE id = ?',
    [conversationId]
  );
  return parseHiddenRanges(row?.hidden_ranges);
}

export async function updateHiddenRanges(
  conversationId: string,
  ranges: HiddenRange[]
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE conversations SET hidden_ranges = ? WHERE id = ?', [
    JSON.stringify(ranges),
    conversationId,
  ]);
}

export async function getHiddenMessageIds(conversationId: string): Promise<string[]> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ hidden_message_ids: string | null }>(
    'SELECT hidden_message_ids FROM conversations WHERE id = ?',
    [conversationId]
  );
  return parseStringArray(row?.hidden_message_ids);
}

export async function updateHiddenMessageIds(
  conversationId: string,
  messageIds: string[]
): Promise<void> {
  const db = await getDatabase();
  const normalized = [...new Set(messageIds.filter((id) => id.trim()))];
  await db.runAsync('UPDATE conversations SET hidden_message_ids = ? WHERE id = ?', [
    JSON.stringify(normalized),
    conversationId,
  ]);
}

export async function setChatDiagnosticsMessageHidden(
  conversationId: string,
  messageId: string,
  hidden: boolean
): Promise<void> {
  const db = await getDatabase();
  const conversation = await db.getFirstAsync<{ hidden_message_ids: string | null }>(
    'SELECT hidden_message_ids FROM conversations WHERE id = ?',
    [conversationId]
  );
  if (!conversation) return;
  const current = new Set(parseStringArray(conversation.hidden_message_ids));
  if (hidden) {
    current.add(messageId);
  } else {
    current.delete(messageId);
  }
  await db.runAsync('UPDATE conversations SET hidden_message_ids = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify([...current]),
    Date.now(),
    conversationId,
  ]);
}

export async function getPendingResponseBoundaryMessageId(
  conversationId: string
): Promise<string | null | undefined> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ pending_response_boundary_message_id: string | null }>(
    'SELECT pending_response_boundary_message_id FROM conversations WHERE id = ?',
    [conversationId]
  );
  if (!row || row.pending_response_boundary_message_id === null) return undefined;
  return row.pending_response_boundary_message_id || null;
}

export async function setPendingResponseBoundaryMessageId(
  conversationId: string,
  messageId: string | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE conversations SET pending_response_boundary_message_id = ? WHERE id = ?',
    [messageId ?? '', conversationId]
  );
}

export async function clearPendingResponseBoundaryMessageId(
  conversationId: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE conversations SET pending_response_boundary_message_id = NULL WHERE id = ?',
    [conversationId]
  );
}

export async function insertMessage(conversationId: string, msg: Message): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tool_invocations, generated_pics, image_uri, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      conversationId,
      msg.role,
      msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolCallId || null,
      msg.toolInvocations && msg.toolInvocations.length > 0 ? JSON.stringify(msg.toolInvocations) : null,
      msg.generatedPics && msg.generatedPics.length > 0 ? JSON.stringify(msg.generatedPics) : null,
      msg.imageUri || null,
      msg.createdAt,
    ]
  );
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET content = ? WHERE id = ?', [content, id]);
}

export async function updateChatDiagnosticsMessageContent(
  conversationId: string,
  messageId: string,
  content: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE messages SET content = ? WHERE conversation_id = ? AND id = ?',
    [content, conversationId, messageId]
  );
  await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', [
    Date.now(),
    conversationId,
  ]);
}

// 把某条消息的工具调用记录落库（流式收尾时调用）。空数组写 null。
export async function updateMessageToolInvocations(
  id: string,
  invocations: ToolInvocation[] | undefined
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET tool_invocations = ? WHERE id = ?', [
    invocations && invocations.length > 0 ? JSON.stringify(invocations) : null,
    id,
  ]);
}

export async function updateMessageGeneratedPics(
  id: string,
  generatedPics: GeneratedPicture[] | undefined
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET generated_pics = ? WHERE id = ?', [
    generatedPics && generatedPics.length > 0 ? JSON.stringify(generatedPics) : null,
    id,
  ]);
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM messages WHERE id = ?', [id]);
}

export async function deleteChatDiagnosticsMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  const db = await getDatabase();
  const target = await db.getFirstAsync<{
    id: string;
    role: string;
    created_at: number;
  }>(
    'SELECT id, role, created_at FROM messages WHERE conversation_id = ? AND id = ?',
    [conversationId, messageId]
  );
  if (!target) return;

  const isFloorMessage = target.role === 'user' || target.role === 'assistant';
  let nextHiddenRanges: HiddenRange[] | null = null;
  if (isFloorMessage) {
    const floorRow = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count
         FROM messages
        WHERE conversation_id = ?
          AND role IN ('user', 'assistant')
          AND (created_at < ? OR (created_at = ? AND id <= ?))`,
      [conversationId, target.created_at, target.created_at, target.id]
    );
    const deletedFloor = floorRow?.count ?? 0;
    const conversation = await db.getFirstAsync<{ hidden_ranges: string | null }>(
      'SELECT hidden_ranges FROM conversations WHERE id = ?',
      [conversationId]
    );
    nextHiddenRanges = shiftHiddenRangesAfterDeletedFloor(
      parseHiddenRanges(conversation?.hidden_ranges),
      deletedFloor
    );
  }

  await db.runAsync('DELETE FROM messages WHERE conversation_id = ? AND id = ?', [
    conversationId,
    messageId,
  ]);

  const hiddenIdsRow = await db.getFirstAsync<{ hidden_message_ids: string | null }>(
    'SELECT hidden_message_ids FROM conversations WHERE id = ?',
    [conversationId]
  );
  const nextHiddenMessageIds = parseStringArray(hiddenIdsRow?.hidden_message_ids).filter(
    (id) => id !== messageId
  );

  if (nextHiddenRanges) {
    await db.runAsync('UPDATE conversations SET hidden_ranges = ?, hidden_message_ids = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(nextHiddenRanges),
      JSON.stringify(nextHiddenMessageIds),
      Date.now(),
      conversationId,
    ]);
  } else {
    await db.runAsync('UPDATE conversations SET hidden_message_ids = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(nextHiddenMessageIds),
      Date.now(),
      conversationId,
    ]);
  }
}

function parseJsonArray<T>(raw: string | null | undefined): T[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : undefined;
  } catch {
    return undefined;
  }
}

function mapMessageRow(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role as Message['role'],
    content: row.content,
    toolCalls: parseJsonArray<ToolCall>(row.tool_calls),
    toolCallId: row.tool_call_id || undefined,
    toolInvocations: parseJsonArray<ToolInvocation>(row.tool_invocations),
    generatedPics: parseJsonArray<GeneratedPicture>(row.generated_pics),
    imageUri: row.image_uri || undefined,
    createdAt: row.created_at,
  };
}

export async function getMessagesByConversation(conversationId: string): Promise<Message[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MessageRow>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId]
  );

  return rows.map(mapMessageRow);
}

export async function getConversationMessagePage(
  conversationId: string,
  options: { limit: number; beforeCreatedAt?: number }
): Promise<ConversationMessagePage> {
  const db = await getDatabase();
  const pageLimit = Math.max(1, options.limit);
  const params: any[] = [conversationId];
  let where = 'conversation_id = ?';

  if (options.beforeCreatedAt !== undefined) {
    where += ' AND created_at < ?';
    params.push(options.beforeCreatedAt);
  }

  params.push(pageLimit + 1);
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT * FROM messages WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    params
  );
  const visibleRows = rows.slice(0, pageLimit).reverse();
  const messages = visibleRows.map(mapMessageRow);
  const firstCreatedAt = messages[0]?.createdAt;

  return {
    messages,
    hasMore: rows.length > pageLimit,
    floorOffset:
      firstCreatedAt === undefined
        ? 0
        : await getConversationFloorOffset(conversationId, firstCreatedAt),
  };
}

export async function getConversationMessagePageAroundMessage(
  conversationId: string,
  messageId: string,
  limit = 20
): Promise<ConversationMessagePage> {
  const db = await getDatabase();
  const target = await db.getFirstAsync<MessageRow>(
    'SELECT * FROM messages WHERE conversation_id = ? AND id = ?',
    [conversationId, messageId]
  );

  if (!target) {
    return getConversationMessagePage(conversationId, { limit });
  }

  const pageLimit = Math.max(1, limit);
  const beforeLimit = Math.floor((pageLimit - 1) / 2);
  const afterLimit = pageLimit - 1 - beforeLimit;
  const beforeRows = beforeLimit > 0
    ? await db.getAllAsync<MessageRow>(
        `SELECT * FROM messages
          WHERE conversation_id = ? AND created_at < ?
          ORDER BY created_at DESC
          LIMIT ?`,
        [conversationId, target.created_at, beforeLimit]
      )
    : [];
  const afterRows = afterLimit > 0
    ? await db.getAllAsync<MessageRow>(
        `SELECT * FROM messages
          WHERE conversation_id = ? AND created_at > ?
          ORDER BY created_at ASC
          LIMIT ?`,
        [conversationId, target.created_at, afterLimit]
      )
    : [];
  const messages = [...beforeRows.reverse(), target, ...afterRows].map(mapMessageRow);
  const firstCreatedAt = messages[0]?.createdAt;

  return {
    messages,
    hasMore:
      firstCreatedAt === undefined
        ? false
        : (await getConversationFloorOffset(conversationId, firstCreatedAt)) > 0,
    floorOffset:
      firstCreatedAt === undefined
        ? 0
        : await getConversationFloorOffset(conversationId, firstCreatedAt),
  };
}

export async function searchMessages(
  query: string,
  options: { conversationId?: string; limit?: number } = {}
): Promise<ChatSearchResult[]> {
  const keyword = query.trim();
  if (!keyword) return [];

  const db = await getDatabase();
  const params: any[] = [likePattern(keyword)];
  let where = `m.content LIKE ? ESCAPE '\\'`;

  if (options.conversationId) {
    where += ' AND m.conversation_id = ?';
    params.push(options.conversationId);
  }

  params.push(Math.max(1, options.limit ?? 50));
  const rows = await db.getAllAsync<{
    message_id: string;
    conversation_id: string;
    conversation_title: string;
    role: string;
    content: string;
    created_at: number;
  }>(
    `SELECT
        m.id as message_id,
        m.conversation_id as conversation_id,
        c.title as conversation_title,
        m.role as role,
        m.content as content,
        m.created_at as created_at
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE ${where}
      ORDER BY m.created_at DESC
      LIMIT ?`,
    params
  );

  return rows.map((row) => ({
    messageId: row.message_id,
    conversationId: row.conversation_id,
    conversationTitle: row.conversation_title,
    role: row.role as Message['role'],
    content: row.content,
    createdAt: row.created_at,
  }));
}

export async function getConversationMessageCount(conversationId: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
    [conversationId]
  );
  return row?.count ?? 0;
}

export async function getConversationMessageDates(conversationId: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ created_at: number }>(
    `SELECT created_at
       FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC`,
    [conversationId]
  );
  const dates = new Set<string>();
  rows.forEach((row) => dates.add(localDateKey(row.created_at)));
  return [...dates];
}

export async function getChatDiagnosticsConversations(): Promise<ChatDiagnosticsConversation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    model: string;
    created_at: number;
    updated_at: number;
    hidden_ranges: string | null;
    hidden_message_ids: string | null;
    pending_response_boundary_message_id: string | null;
    total_message_count: number | null;
    floor_message_count: number | null;
    system_message_count: number | null;
    tool_message_count: number | null;
    empty_assistant_count: number | null;
    latest_message_role: string | null;
    latest_message_created_at: number | null;
  }>(`
    SELECT
      c.id,
      c.title,
      c.model,
      c.created_at,
      c.updated_at,
      c.hidden_ranges,
      c.hidden_message_ids,
      c.pending_response_boundary_message_id,
      COUNT(m.id) as total_message_count,
      SUM(CASE WHEN m.role IN ('user', 'assistant') THEN 1 ELSE 0 END) as floor_message_count,
      SUM(CASE WHEN m.role = 'system' THEN 1 ELSE 0 END) as system_message_count,
      SUM(CASE WHEN m.role = 'tool' THEN 1 ELSE 0 END) as tool_message_count,
      SUM(
        CASE
          WHEN m.role = 'assistant'
            AND TRIM(COALESCE(m.content, '')) = ''
            AND (m.tool_invocations IS NULL OR m.tool_invocations = '' OR m.tool_invocations = '[]')
          THEN 1 ELSE 0
        END
      ) as empty_assistant_count,
      (
        SELECT lm.role
          FROM messages lm
         WHERE lm.conversation_id = c.id
         ORDER BY lm.created_at DESC, lm.id DESC
         LIMIT 1
      ) as latest_message_role,
      (
        SELECT lm.created_at
          FROM messages lm
         WHERE lm.conversation_id = c.id
         ORDER BY lm.created_at DESC, lm.id DESC
         LIMIT 1
      ) as latest_message_created_at
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
     GROUP BY c.id
     ORDER BY c.updated_at DESC
  `);
  const duplicateStats = await getDuplicateTimestampStats();

  return rows.map((row) => {
    const duplicate = duplicateStats.get(row.id);
    return buildChatDiagnosticsConversation(row, {
      duplicateTimestampGroupCount: duplicate?.groupCount ?? 0,
      duplicateTimestampMessageCount: duplicate?.messageCount ?? 0,
    });
  });
}

export async function getChatDiagnosticsConversation(
  conversationId: string
): Promise<ChatDiagnosticsDetail | null> {
  const conversations = await getChatDiagnosticsConversations();
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) return null;

  const db = await getDatabase();
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT *
       FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );
  const duplicateTimestampGroups = await getDuplicateTimestampGroups(conversationId);
  const duplicateCounts = new Map<number, number>();
  duplicateTimestampGroups.forEach((group) => {
    duplicateCounts.set(group.createdAt, group.count);
  });

  let floorNumber = 0;
  const hiddenFloorSet = hiddenRangesToSet(conversation.hiddenRanges);
  const hiddenMessageIdSet = new Set(conversation.hiddenMessageIds);
  const messages = rows.map((row, index) => {
    const role = row.role as Message['role'];
    const isFloorMessage = role === 'user' || role === 'assistant';
    const nextFloorNumber = isFloorMessage ? ++floorNumber : null;
    const duplicateTimestampCount = duplicateCounts.get(row.created_at) ?? 1;
    const aiVisibility = getMessageAiVisibility(row);
    const issues = getChatMessageIssues(row, {
      duplicateTimestampCount,
      floorNumber: nextFloorNumber,
      hiddenFloorSet,
    });

    return {
      id: row.id,
      role,
      content: row.content,
      toolCallsRaw: row.tool_calls,
      toolCallId: row.tool_call_id,
      toolInvocationsRaw: row.tool_invocations,
      imageUri: row.image_uri,
      createdAt: row.created_at,
      databaseIndex: index + 1,
      floorNumber: nextFloorNumber,
      isHidden: nextFloorNumber !== null && hiddenFloorSet.has(nextFloorNumber),
      isHiddenByMessageId: hiddenMessageIdSet.has(row.id),
      isHiddenFromAi:
        hiddenMessageIdSet.has(row.id) ||
        (nextFloorNumber !== null && hiddenFloorSet.has(nextFloorNumber)),
      duplicateTimestampCount,
      isPendingResponseBoundary:
        conversation.pendingResponseBoundaryMessageId === row.id,
      aiVisibility: aiVisibility.status,
      aiVisibilityLabel: aiVisibility.label,
      issues,
    };
  });

  return {
    ...conversation,
    duplicateTimestampGroups,
    messages,
  };
}

export async function getFirstMessageInDateRange(
  conversationId: string,
  startAt: number,
  endAt: number
): Promise<Message | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MessageRow>(
    `SELECT *
       FROM messages
      WHERE conversation_id = ?
        AND created_at >= ?
        AND created_at < ?
      ORDER BY created_at ASC
      LIMIT 1`,
    [conversationId, startAt, endAt]
  );
  return row ? mapMessageRow(row) : null;
}

async function getConversationFloorOffset(
  conversationId: string,
  beforeCreatedAt: number
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
       FROM messages
      WHERE conversation_id = ?
        AND created_at < ?
        AND role IN ('user', 'assistant')`,
    [conversationId, beforeCreatedAt]
  );
  return row?.count ?? 0;
}

function buildChatDiagnosticsConversation(
  row: {
    id: string;
    title: string;
    model: string;
    created_at: number;
    updated_at: number;
    hidden_ranges: string | null;
    hidden_message_ids: string | null;
    pending_response_boundary_message_id: string | null;
    total_message_count: number | null;
    floor_message_count: number | null;
    system_message_count: number | null;
    tool_message_count: number | null;
    empty_assistant_count: number | null;
    latest_message_role: string | null;
    latest_message_created_at: number | null;
  },
  stats: {
    duplicateTimestampGroupCount: number;
    duplicateTimestampMessageCount: number;
  }
): ChatDiagnosticsConversation {
  const emptyAssistantCount = row.empty_assistant_count ?? 0;
  const issueCount = emptyAssistantCount + stats.duplicateTimestampGroupCount;

  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hiddenRanges: parseHiddenRanges(row.hidden_ranges),
    hiddenMessageIds: parseStringArray(row.hidden_message_ids),
    pendingResponseBoundaryMessageId:
      row.pending_response_boundary_message_id === null
        ? undefined
        : row.pending_response_boundary_message_id || null,
    totalMessageCount: row.total_message_count ?? 0,
    floorMessageCount: row.floor_message_count ?? 0,
    systemMessageCount: row.system_message_count ?? 0,
    toolMessageCount: row.tool_message_count ?? 0,
    emptyAssistantCount,
    duplicateTimestampGroupCount: stats.duplicateTimestampGroupCount,
    duplicateTimestampMessageCount: stats.duplicateTimestampMessageCount,
    latestMessageRole: row.latest_message_role as Message['role'] | null,
    latestMessageCreatedAt: row.latest_message_created_at ?? null,
    issueCount,
  };
}

async function getDuplicateTimestampStats(): Promise<Map<string, { groupCount: number; messageCount: number }>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    conversation_id: string;
    duplicate_timestamp_group_count: number;
    duplicate_timestamp_message_count: number;
  }>(`
    SELECT
      conversation_id,
      COUNT(*) as duplicate_timestamp_group_count,
      SUM(timestamp_count) as duplicate_timestamp_message_count
      FROM (
        SELECT conversation_id, created_at, COUNT(*) as timestamp_count
          FROM messages
         GROUP BY conversation_id, created_at
        HAVING COUNT(*) > 1
      )
     GROUP BY conversation_id
  `);

  return new Map(
    rows.map((row) => [
      row.conversation_id,
      {
        groupCount: row.duplicate_timestamp_group_count,
        messageCount: row.duplicate_timestamp_message_count,
      },
    ])
  );
}

async function getDuplicateTimestampGroups(
  conversationId: string
): Promise<ChatDiagnosticsDuplicateGroup[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    created_at: number;
    count: number;
    ids: string | null;
  }>(
    `SELECT created_at, COUNT(*) as count, GROUP_CONCAT(id, ',') as ids
       FROM messages
      WHERE conversation_id = ?
      GROUP BY created_at
     HAVING COUNT(*) > 1
      ORDER BY created_at ASC`,
    [conversationId]
  );

  return rows.map((row) => ({
    createdAt: row.created_at,
    count: row.count,
    ids: row.ids ? row.ids.split(',') : [],
  }));
}

function hiddenRangesToSet(ranges: HiddenRange[]): Set<number> {
  const set = new Set<number>();
  for (const range of ranges) {
    for (let floor = range.from; floor <= range.to; floor++) {
      set.add(floor);
    }
  }
  return set;
}

function shiftHiddenRangesAfterDeletedFloor(
  ranges: HiddenRange[],
  deletedFloor: number
): HiddenRange[] {
  const next: HiddenRange[] = [];

  for (const range of ranges) {
    if (deletedFloor < range.from) {
      next.push({ from: range.from - 1, to: range.to - 1 });
      continue;
    }

    if (deletedFloor > range.to) {
      next.push({ ...range });
      continue;
    }

    if (range.from <= deletedFloor - 1) {
      next.push({ from: range.from, to: deletedFloor - 1 });
    }
    if (deletedFloor + 1 <= range.to) {
      next.push({ from: deletedFloor, to: range.to - 1 });
    }
  }

  return normalizeHiddenRanges(next);
}

function normalizeHiddenRanges(ranges: HiddenRange[]): HiddenRange[] {
  const sorted = ranges
    .filter((range) => range.from > 0 && range.from <= range.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: HiddenRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.from > last.to + 1) {
      merged.push({ ...range });
    } else {
      last.to = Math.max(last.to, range.to);
    }
  }

  return merged;
}

function getMessageAiVisibility(row: MessageRow): {
  status: ChatDiagnosticsMessage['aiVisibility'];
  label: string;
} {
  if (row.role === 'user' || row.role === 'assistant') {
    return {
      status: 'history',
      label: 'Sent as chat history unless hidden by hidden_ranges',
    };
  }

  if (row.role === 'system') {
    const content = row.content.trim();
    if (content === WEB_CRUISE_NOTICE_TEXT) {
      return {
        status: 'runtime-context',
        label: 'Triggers AI web cruise runtime context on the next reply',
      };
    }
    if (
      content.startsWith(ANDROID_ACCESSIBILITY_CAPTURE_NOTICE_PREFIX) ||
      content.startsWith(ANDROID_SCREENSHOT_CAPTURE_NOTICE_PREFIX)
    ) {
      return {
        status: 'runtime-context',
        label: 'Android capture marker; screen context is sent for that reply when available',
      };
    }
    if (
      content.includes(RADIO_START_MARKER) ||
      content.includes(RADIO_CALL_IN_MARKER) ||
      content.includes(RADIO_CONTINUE_MARKER) ||
      content.includes(RADIO_END_MARKER)
    ) {
      return {
        status: 'runtime-context',
        label: 'AI radio marker included in runtime context',
      };
    }
    if (content.startsWith(FOCUS_EVENT_PREFIX) || content.startsWith(APP_EVENT_PREFIX)) {
      return {
        status: 'runtime-context',
        label: 'Focus/app event included in runtime context',
      };
    }
    if (content.startsWith('已附带当前网页：')) {
      return {
        status: 'runtime-context',
        label: 'Current WebView notice; page context is sent for the same reply',
      };
    }
    return {
      status: 'ui-only',
      label: 'Stored system message; not sent as chat history',
    };
  }

  return {
    status: 'ui-only',
    label: 'Tool-role rows are not sent by the normal chat history filter',
  };
}

function getChatMessageIssues(
  row: MessageRow,
  options: {
    duplicateTimestampCount: number;
    floorNumber: number | null;
    hiddenFloorSet: Set<number>;
  }
): string[] {
  const issues: string[] = [];
  const role = row.role as Message['role'];

  if (options.duplicateTimestampCount > 1) {
    issues.push(`same timestamp x${options.duplicateTimestampCount}`);
  }
  if (role !== 'user' && role !== 'assistant') {
    issues.push('no floor');
  }
  if (
    role === 'assistant' &&
    row.content.trim() === '' &&
    (!row.tool_invocations || row.tool_invocations === '[]')
  ) {
    issues.push('empty assistant');
  }
  if (options.floorNumber !== null && options.hiddenFloorSet.has(options.floorNumber)) {
    issues.push('hidden floor');
  }
  if (row.tool_calls && !isJsonArray(row.tool_calls)) {
    issues.push('invalid tool_calls JSON');
  }
  if (row.tool_invocations && !isJsonArray(row.tool_invocations)) {
    issues.push('invalid tool_invocations JSON');
  }
  if (!Number.isFinite(row.created_at)) {
    issues.push('invalid created_at');
  }

  return issues;
}

function isJsonArray(raw: string): boolean {
  try {
    return Array.isArray(JSON.parse(raw));
  } catch {
    return false;
  }
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/* ==================== 日记 Diary CRUD ==================== */

function mapDiaryRow(row: {
  id: string;
  title: string;
  content: string;
  is_favorite: number;
  created_at: number;
  updated_at: number;
}): Diary {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    isFavorite: row.is_favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createDiary(diary: Diary): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO diaries (id, title, content, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      diary.id,
      diary.title,
      diary.content,
      diary.isFavorite ? 1 : 0,
      diary.createdAt,
      diary.updatedAt,
    ]
  );
}

export async function updateDiary(
  id: string,
  updates: Partial<Pick<Diary, 'title' | 'content' | 'isFavorite' | 'updatedAt'>>
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.content !== undefined) {
    sets.push('content = ?');
    values.push(updates.content);
  }
  if (updates.isFavorite !== undefined) {
    sets.push('is_favorite = ?');
    values.push(updates.isFavorite ? 1 : 0);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE diaries SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteDiary(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM diaries WHERE id = ?', [id]);
}

export async function getAllDiaries(): Promise<Diary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    content: string;
    is_favorite: number;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM diaries ORDER BY updated_at DESC');
  return rows.map(mapDiaryRow);
}

export async function getFavoriteDiaries(): Promise<Diary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    content: string;
    is_favorite: number;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM diaries WHERE is_favorite = 1 ORDER BY created_at ASC');
  return rows.map(mapDiaryRow);
}

/* ==================== Period Record CRUD ==================== */

function mapPeriodRecordRow(row: {
  id: string;
  start_date: string;
  end_date: string | null;
  created_at: number;
  updated_at: number;
}): PeriodRecord {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createPeriodRecord(record: PeriodRecord): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO period_records (id, start_date, end_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [record.id, record.startDate, record.endDate, record.createdAt, record.updatedAt]
  );
}

export async function updatePeriodRecord(
  id: string,
  updates: Partial<Pick<PeriodRecord, 'startDate' | 'endDate' | 'updatedAt'>>
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.startDate !== undefined) {
    sets.push('start_date = ?');
    values.push(updates.startDate);
  }
  if (updates.endDate !== undefined) {
    sets.push('end_date = ?');
    values.push(updates.endDate);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE period_records SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deletePeriodRecord(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM period_records WHERE id = ?', [id]);
}

export async function getAllPeriodRecords(): Promise<PeriodRecord[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    start_date: string;
    end_date: string | null;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM period_records ORDER BY start_date DESC');
  return rows.map(mapPeriodRecordRow);
}

/* ==================== Reading CRUD ==================== */

function parseReadingChapters(raw: string | null | undefined): ReadingChapter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (chapter) =>
        chapter &&
        typeof chapter.id === 'string' &&
        typeof chapter.title === 'string' &&
        typeof chapter.start === 'number'
    );
  } catch {
    return [];
  }
}

function mapReadingBookRow(row: {
  id: string;
  title: string;
  author: string;
  cover_uri: string | null;
  file_uri: string | null;
  format: string;
  text: string;
  chapters: string | null;
  reading_offset: number;
  created_at: number;
  updated_at: number;
}): ReadingBook {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    coverUri: row.cover_uri || undefined,
    fileUri: row.file_uri || undefined,
    format: row.format === 'epub' ? 'epub' : 'txt',
    text: row.text,
    chapters: parseReadingChapters(row.chapters),
    readingOffset: row.reading_offset,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createReadingBook(book: ReadingBook): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO reading_books
      (id, title, author, cover_uri, file_uri, format, text, chapters, reading_offset, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      book.id,
      book.title,
      book.author,
      book.coverUri || null,
      book.fileUri || null,
      book.format,
      book.text,
      JSON.stringify(book.chapters || []),
      book.readingOffset,
      book.createdAt,
      book.updatedAt,
    ]
  );
}

export async function updateReadingBook(
  id: string,
  updates: Partial<Pick<ReadingBook, 'title' | 'author' | 'coverUri' | 'fileUri' | 'text' | 'chapters' | 'readingOffset' | 'updatedAt'>>
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.author !== undefined) {
    sets.push('author = ?');
    values.push(updates.author);
  }
  if (updates.coverUri !== undefined) {
    sets.push('cover_uri = ?');
    values.push(updates.coverUri || null);
  }
  if (updates.fileUri !== undefined) {
    sets.push('file_uri = ?');
    values.push(updates.fileUri || null);
  }
  if (updates.text !== undefined) {
    sets.push('text = ?');
    values.push(updates.text);
  }
  if (updates.chapters !== undefined) {
    sets.push('chapters = ?');
    values.push(JSON.stringify(updates.chapters));
  }
  if (updates.readingOffset !== undefined) {
    sets.push('reading_offset = ?');
    values.push(updates.readingOffset);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE reading_books SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteReadingBook(id: string): Promise<void> {
  const db = await getDatabase();
  const book = await getReadingBook(id);
  if (book) {
    await upsertReadingBookSnapshot({
      bookId: book.id,
      title: book.title,
      author: book.author,
      updatedAt: Date.now(),
    });
  }
  const foreignKeyRow = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
  const shouldRestoreForeignKeys = foreignKeyRow?.foreign_keys === 1;
  if (shouldRestoreForeignKeys) {
    await db.execAsync('PRAGMA foreign_keys = OFF;');
  }
  try {
    await db.runAsync('DELETE FROM reading_messages WHERE book_id = ?', [id]);
    await db.runAsync('DELETE FROM reading_books WHERE id = ?', [id]);
  } finally {
    if (shouldRestoreForeignKeys) {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
  }
}

async function ensureReadingBookSnapshotTable() {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS reading_book_snapshots (
      book_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

export async function upsertReadingBookSnapshot(snapshot: ReadingBookSnapshot): Promise<void> {
  const db = await ensureReadingBookSnapshotTable();
  await db.runAsync(
    `INSERT OR REPLACE INTO reading_book_snapshots (book_id, title, author, updated_at)
     VALUES (?, ?, ?, ?)`,
    [snapshot.bookId, snapshot.title, snapshot.author, snapshot.updatedAt]
  );
}

export async function getAllReadingBookSnapshots(): Promise<ReadingBookSnapshot[]> {
  const db = await ensureReadingBookSnapshotTable();
  const rows = await db.getAllAsync<{
    book_id: string;
    title: string;
    author: string;
    updated_at: number;
  }>('SELECT * FROM reading_book_snapshots');
  return rows.map((row) => ({
    bookId: row.book_id,
    title: row.title,
    author: row.author,
    updatedAt: row.updated_at,
  }));
}

export async function getAllReadingBooks(): Promise<ReadingBook[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    author: string;
    cover_uri: string | null;
    file_uri: string | null;
    format: string;
    text: string;
    chapters: string | null;
    reading_offset: number;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM reading_books ORDER BY updated_at DESC');
  return rows.map(mapReadingBookRow);
}

export async function getReadingBook(id: string): Promise<ReadingBook | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    id: string;
    title: string;
    author: string;
    cover_uri: string | null;
    file_uri: string | null;
    format: string;
    text: string;
    chapters: string | null;
    reading_offset: number;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM reading_books WHERE id = ?', [id]);
  return row ? mapReadingBookRow(row) : null;
}

function mapReadingMessageRow(row: {
  id: string;
  book_id: string;
  role: string;
  content: string;
  created_at: number;
}): ReadingMessage {
  return {
    id: row.id,
    bookId: row.book_id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function insertReadingMessage(message: ReadingMessage): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO reading_messages (id, book_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [message.id, message.bookId, message.role, message.content, message.createdAt]
  );
}

export async function updateReadingMessageContent(id: string, content: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE reading_messages SET content = ? WHERE id = ?', [content, id]);
}

export async function deleteReadingMessage(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM reading_messages WHERE id = ?', [id]);
}

export async function getReadingMessages(bookId: string): Promise<ReadingMessage[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    book_id: string;
    role: string;
    content: string;
    created_at: number;
  }>('SELECT * FROM reading_messages WHERE book_id = ? ORDER BY created_at ASC', [bookId]);
  return rows.map(mapReadingMessageRow);
}

async function ensureReadingAnnotationTables() {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS reading_notes (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reading_notes_book ON reading_notes(book_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS reading_highlights (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reading_highlights_book ON reading_highlights(book_id, start_offset ASC);
  `);
  return db;
}

function mapReadingNoteRow(row: {
  id: string;
  book_id: string;
  kind: string;
  content: string;
  created_at: number;
  updated_at: number;
}): ReadingNote {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind === 'reflection' ? 'reflection' : 'summary',
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertReadingNote(note: ReadingNote): Promise<void> {
  const db = await ensureReadingAnnotationTables();
  await db.runAsync(
    `INSERT OR REPLACE INTO reading_notes (id, book_id, kind, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [note.id, note.bookId, note.kind, note.content, note.createdAt, note.updatedAt]
  );
}

export async function updateReadingNoteContent(id: string, content: string): Promise<void> {
  const db = await ensureReadingAnnotationTables();
  await db.runAsync(
    'UPDATE reading_notes SET content = ?, updated_at = ? WHERE id = ?',
    [content, Date.now(), id]
  );
}

export async function deleteReadingNote(id: string): Promise<void> {
  const db = await ensureReadingAnnotationTables();
  await db.runAsync('DELETE FROM reading_notes WHERE id = ?', [id]);
}

export async function getReadingNotes(bookId: string): Promise<ReadingNote[]> {
  const db = await ensureReadingAnnotationTables();
  const rows = await db.getAllAsync<{
    id: string;
    book_id: string;
    kind: string;
    content: string;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM reading_notes WHERE book_id = ? ORDER BY created_at ASC', [bookId]);
  return rows.map(mapReadingNoteRow);
}

export async function getAllReadingNotes(): Promise<ReadingNote[]> {
  const db = await ensureReadingAnnotationTables();
  const rows = await db.getAllAsync<{
    id: string;
    book_id: string;
    kind: string;
    content: string;
    created_at: number;
    updated_at: number;
  }>('SELECT * FROM reading_notes ORDER BY created_at ASC');
  return rows.map(mapReadingNoteRow);
}

function mapReadingHighlightRow(row: {
  id: string;
  book_id: string;
  content: string;
  start_offset: number;
  end_offset: number;
  created_at: number;
}): ReadingHighlight {
  return {
    id: row.id,
    bookId: row.book_id,
    content: row.content,
    start: row.start_offset,
    end: row.end_offset,
    createdAt: row.created_at,
  };
}

export async function insertReadingHighlight(highlight: ReadingHighlight): Promise<void> {
  const db = await ensureReadingAnnotationTables();
  await db.runAsync(
    `INSERT OR REPLACE INTO reading_highlights
      (id, book_id, content, start_offset, end_offset, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [highlight.id, highlight.bookId, highlight.content, highlight.start, highlight.end, highlight.createdAt]
  );
}

export async function deleteReadingHighlight(id: string): Promise<void> {
  const db = await ensureReadingAnnotationTables();
  await db.runAsync('DELETE FROM reading_highlights WHERE id = ?', [id]);
}

export async function getReadingHighlights(bookId: string): Promise<ReadingHighlight[]> {
  const db = await ensureReadingAnnotationTables();
  const rows = await db.getAllAsync<{
    id: string;
    book_id: string;
    content: string;
    start_offset: number;
    end_offset: number;
    created_at: number;
  }>('SELECT * FROM reading_highlights WHERE book_id = ? ORDER BY start_offset ASC', [bookId]);
  return rows.map(mapReadingHighlightRow);
}

export async function getAllReadingHighlights(): Promise<ReadingHighlight[]> {
  const db = await ensureReadingAnnotationTables();
  const rows = await db.getAllAsync<{
    id: string;
    book_id: string;
    content: string;
    start_offset: number;
    end_offset: number;
    created_at: number;
  }>('SELECT * FROM reading_highlights ORDER BY created_at ASC');
  return rows.map(mapReadingHighlightRow);
}

/* ==================== Focus CRUD ==================== */

interface FocusTaskRow {
  id: string;
  title: string;
  timer_mode: string;
  duration_ms: number;
  target_count: number;
  completed_count: number;
  created_at: number;
  updated_at: number;
}

interface FocusSessionRow {
  id: string;
  task_id: string;
  task_title: string;
  timer_mode: string;
  planned_duration_ms: number;
  started_at: number;
  ended_at: number | null;
  paused_duration_ms: number;
  pause_started_at: number | null;
  status: string;
  end_reason: string | null;
  created_at: number;
  updated_at: number;
}

function normalizeFocusTimerMode(value: string): FocusTimerMode {
  return value === 'countup' ? 'countup' : 'countdown';
}

function normalizeFocusSessionStatus(value: string): FocusSessionStatus {
  if (value === 'paused' || value === 'completed' || value === 'abandoned') return value;
  return 'running';
}

function mapFocusTaskRow(row: FocusTaskRow): FocusTask {
  return {
    id: row.id,
    title: row.title,
    timerMode: normalizeFocusTimerMode(row.timer_mode),
    durationMs: row.duration_ms,
    targetCount: Math.max(1, row.target_count),
    completedCount: Math.max(0, row.completed_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFocusSessionRow(row: FocusSessionRow): FocusSession {
  const endReason =
    row.end_reason === 'completed' || row.end_reason === 'abandoned'
      ? row.end_reason
      : undefined;
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    timerMode: normalizeFocusTimerMode(row.timer_mode),
    plannedDurationMs: row.planned_duration_ms,
    startedAt: row.started_at,
    endedAt: row.ended_at || undefined,
    pausedDurationMs: Math.max(0, row.paused_duration_ms),
    pauseStartedAt: row.pause_started_at || undefined,
    status: normalizeFocusSessionStatus(row.status),
    endReason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dateRangeForLocalKey(key: string): { startAt: number; endAt: number } {
  const [year, month, day] = key.split('-').map((part) => parseInt(part, 10));
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

export async function createFocusTask(task: FocusTask): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO focus_tasks
      (id, title, timer_mode, duration_ms, target_count, completed_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.title,
      task.timerMode,
      task.durationMs,
      Math.max(1, task.targetCount),
      Math.max(0, task.completedCount),
      task.createdAt,
      task.updatedAt,
    ]
  );
}

export async function updateFocusTask(
  id: string,
  updates: Partial<Pick<FocusTask, 'title' | 'timerMode' | 'durationMs' | 'targetCount' | 'completedCount' | 'updatedAt'>>
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.timerMode !== undefined) {
    sets.push('timer_mode = ?');
    values.push(updates.timerMode);
  }
  if (updates.durationMs !== undefined) {
    sets.push('duration_ms = ?');
    values.push(updates.durationMs);
  }
  if (updates.targetCount !== undefined) {
    sets.push('target_count = ?');
    values.push(Math.max(1, updates.targetCount));
  }
  if (updates.completedCount !== undefined) {
    sets.push('completed_count = ?');
    values.push(Math.max(0, updates.completedCount));
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE focus_tasks SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteFocusTask(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM focus_sessions WHERE task_id = ?', [id]);
  await db.runAsync('DELETE FROM focus_tasks WHERE id = ?', [id]);
}

export async function getFocusTask(id: string): Promise<FocusTask | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<FocusTaskRow>(
    'SELECT * FROM focus_tasks WHERE id = ?',
    [id]
  );
  return row ? mapFocusTaskRow(row) : null;
}

export async function getFocusTasksByDate(dateKey: string): Promise<FocusTask[]> {
  const db = await getDatabase();
  const { startAt, endAt } = dateRangeForLocalKey(dateKey);
  const rows = await db.getAllAsync<FocusTaskRow>(
    `SELECT *
       FROM focus_tasks
      WHERE created_at >= ? AND created_at < ?
      ORDER BY
        CASE
          WHEN timer_mode = 'countup' AND completed_count >= 1 THEN 1
          WHEN completed_count >= target_count THEN 1
          ELSE 0
        END ASC,
        created_at ASC`,
    [startAt, endAt]
  );
  return rows.map(mapFocusTaskRow);
}

export async function insertFocusSession(session: FocusSession): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO focus_sessions
      (id, task_id, task_title, timer_mode, planned_duration_ms, started_at, ended_at,
       paused_duration_ms, pause_started_at, status, end_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.taskId,
      session.taskTitle,
      session.timerMode,
      session.plannedDurationMs,
      session.startedAt,
      session.endedAt || null,
      session.pausedDurationMs,
      session.pauseStartedAt || null,
      session.status,
      session.endReason || null,
      session.createdAt,
      session.updatedAt,
    ]
  );
}

export async function updateFocusSession(
  id: string,
  updates: Partial<Pick<FocusSession, 'endedAt' | 'pausedDurationMs' | 'status' | 'endReason' | 'updatedAt'>> & {
    pauseStartedAt?: number | null;
  }
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.endedAt !== undefined) {
    sets.push('ended_at = ?');
    values.push(updates.endedAt || null);
  }
  if (updates.pausedDurationMs !== undefined) {
    sets.push('paused_duration_ms = ?');
    values.push(Math.max(0, updates.pausedDurationMs));
  }
  if (updates.pauseStartedAt !== undefined) {
    sets.push('pause_started_at = ?');
    values.push(updates.pauseStartedAt || null);
  }
  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.endReason !== undefined) {
    sets.push('end_reason = ?');
    values.push(updates.endReason || null);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE focus_sessions SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function getActiveFocusSession(): Promise<FocusSession | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<FocusSessionRow>(
    `SELECT *
       FROM focus_sessions
      WHERE status IN ('running', 'paused')
      ORDER BY started_at DESC
      LIMIT 1`
  );
  return row ? mapFocusSessionRow(row) : null;
}

export async function getFocusSessionsByDate(dateKey: string): Promise<FocusSession[]> {
  const db = await getDatabase();
  const { startAt, endAt } = dateRangeForLocalKey(dateKey);
  const rows = await db.getAllAsync<FocusSessionRow>(
    `SELECT *
       FROM focus_sessions
      WHERE started_at >= ? AND started_at < ?
      ORDER BY started_at ASC`,
    [startAt, endAt]
  );
  return rows.map(mapFocusSessionRow);
}

export async function incrementFocusTaskCompletedCount(taskId: string, updatedAt: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE focus_tasks
        SET completed_count = completed_count + 1,
            updated_at = ?
      WHERE id = ?`,
    [updatedAt, taskId]
  );
}

/* ==================== API usage logs ==================== */

interface ApiUsageEventRow {
  id: string;
  feature: string;
  request_kind: string;
  streaming: number;
  status: string;
  model: string;
  base_url: string;
  conversation_id: string | null;
  message_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  details_json: string | null;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  error_message: string | null;
  metadata_json: string | null;
}

interface ApiUsageSummaryRow {
  total_calls: number | null;
  success_calls: number | null;
  error_calls: number | null;
  aborted_calls: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  total_duration_ms: number | null;
}

interface ApiUsageDailySummaryRow extends ApiUsageSummaryRow {
  date_key: string;
}

interface ApiUsageModelSummaryRow extends ApiUsageSummaryRow {
  key_name: string;
  channels: string | null;
}

function normalizeApiUsageStatus(value: string): ApiUsageStatus {
  if (value === 'error' || value === 'aborted') return value;
  return 'success';
}

function mapApiUsageEventRow(row: ApiUsageEventRow): ApiUsageEvent {
  return {
    id: row.id,
    feature: row.feature,
    requestKind: row.request_kind,
    streaming: row.streaming === 1,
    status: normalizeApiUsageStatus(row.status),
    model: row.model,
    baseUrl: row.base_url,
    conversationId: row.conversation_id || undefined,
    messageId: row.message_id || undefined,
    promptTokens: row.prompt_tokens ?? undefined,
    completionTokens: row.completion_tokens ?? undefined,
    totalTokens: row.total_tokens ?? undefined,
    cachedTokens: row.cached_tokens ?? undefined,
    reasoningTokens: row.reasoning_tokens ?? undefined,
    detailsJson: row.details_json || undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    errorMessage: row.error_message || undefined,
    metadataJson: row.metadata_json || undefined,
  };
}

function mapApiUsageSummaryRow(row: ApiUsageSummaryRow | null | undefined): ApiUsageSummary {
  return {
    totalCalls: row?.total_calls ?? 0,
    successCalls: row?.success_calls ?? 0,
    errorCalls: row?.error_calls ?? 0,
    abortedCalls: row?.aborted_calls ?? 0,
    promptTokens: row?.prompt_tokens ?? 0,
    completionTokens: row?.completion_tokens ?? 0,
    totalTokens: row?.total_tokens ?? 0,
    cachedTokens: row?.cached_tokens ?? 0,
    reasoningTokens: row?.reasoning_tokens ?? 0,
    totalDurationMs: row?.total_duration_ms ?? 0,
  };
}

const API_USAGE_SUMMARY_SELECT = `
  COUNT(*) as total_calls,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_calls,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_calls,
  SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) as aborted_calls,
  COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
  COALESCE(SUM(completion_tokens), 0) as completion_tokens,
  COALESCE(SUM(total_tokens), 0) as total_tokens,
  COALESCE(SUM(cached_tokens), 0) as cached_tokens,
  COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
  COALESCE(SUM(duration_ms), 0) as total_duration_ms
`;

export async function insertApiUsageEvent(event: ApiUsageEvent): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO api_usage_events
      (id, feature, request_kind, streaming, status, model, base_url, conversation_id, message_id,
       prompt_tokens, completion_tokens, total_tokens, cached_tokens, reasoning_tokens, details_json,
       started_at, ended_at, duration_ms, error_message, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.id,
      event.feature || 'unknown',
      event.requestKind || 'chat',
      event.streaming ? 1 : 0,
      event.status,
      event.model,
      event.baseUrl,
      event.conversationId || null,
      event.messageId || null,
      event.promptTokens ?? null,
      event.completionTokens ?? null,
      event.totalTokens ?? null,
      event.cachedTokens ?? null,
      event.reasoningTokens ?? null,
      event.detailsJson || null,
      event.startedAt,
      event.endedAt,
      event.durationMs,
      event.errorMessage || null,
      event.metadataJson || null,
    ]
  );
}

export async function getApiUsageEvents(limit = 100): Promise<ApiUsageEvent[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ApiUsageEventRow>(
    `SELECT *
       FROM api_usage_events
      ORDER BY started_at DESC
      LIMIT ?`,
    [Math.max(1, limit)]
  );
  return rows.map(mapApiUsageEventRow);
}

export async function getApiUsageEventsByDate(dateKey: string, limit = 200): Promise<ApiUsageEvent[]> {
  const db = await getDatabase();
  const { startAt, endAt } = dateRangeForLocalKey(dateKey);
  const rows = await db.getAllAsync<ApiUsageEventRow>(
    `SELECT *
       FROM api_usage_events
      WHERE started_at >= ? AND started_at < ?
      ORDER BY started_at DESC
      LIMIT ?`,
    [startAt, endAt, Math.max(1, limit)]
  );
  return rows.map(mapApiUsageEventRow);
}

export async function getApiUsageSummary(): Promise<ApiUsageSummary> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ApiUsageSummaryRow>(
    `SELECT ${API_USAGE_SUMMARY_SELECT} FROM api_usage_events`
  );
  return mapApiUsageSummaryRow(row);
}

export async function getApiUsageSummaryByDate(dateKey: string): Promise<ApiUsageSummary> {
  const db = await getDatabase();
  const { startAt, endAt } = dateRangeForLocalKey(dateKey);
  const row = await db.getFirstAsync<ApiUsageSummaryRow>(
    `SELECT ${API_USAGE_SUMMARY_SELECT}
       FROM api_usage_events
      WHERE started_at >= ? AND started_at < ?`,
    [startAt, endAt]
  );
  return mapApiUsageSummaryRow(row);
}

export async function getApiUsageDailySummaries(limit = 180): Promise<ApiUsageDailySummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ApiUsageDailySummaryRow>(
    `SELECT
        date(started_at / 1000, 'unixepoch', 'localtime') as date_key,
        ${API_USAGE_SUMMARY_SELECT}
       FROM api_usage_events
      GROUP BY date_key
      ORDER BY date_key DESC
      LIMIT ?`,
    [Math.max(1, limit)]
  );
  return rows.map((row) => ({
    dateKey: row.date_key,
    ...mapApiUsageSummaryRow(row),
  }));
}

export async function getApiUsageSummaryByFeature(): Promise<ApiUsageGroupSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ApiUsageSummaryRow & { key_name: string }>(
    `SELECT feature as key_name, ${API_USAGE_SUMMARY_SELECT}
       FROM api_usage_events
      GROUP BY feature
      ORDER BY total_tokens DESC, total_calls DESC`
  );
  return rows.map((row) => ({
    key: row.key_name || 'unknown',
    ...mapApiUsageSummaryRow(row),
  }));
}

export async function getApiUsageSummaryByModel(): Promise<ApiUsageGroupSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ApiUsageModelSummaryRow>(
    `SELECT
        model as key_name,
        GROUP_CONCAT(DISTINCT base_url) as channels,
        ${API_USAGE_SUMMARY_SELECT}
       FROM api_usage_events
      GROUP BY model
      ORDER BY total_tokens DESC, total_calls DESC`
  );
  return rows.map((row) => ({
    key: row.key_name || 'unknown',
    channels: (row.channels || '')
      .split(',')
      .map((channel) => channel.trim())
      .filter(Boolean),
    ...mapApiUsageSummaryRow(row),
  }));
}
