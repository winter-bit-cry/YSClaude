import { getDatabase } from './database';
import {
  Conversation,
  Message,
  Diary,
  HiddenRange,
  ToolInvocation,
  ReadingBook,
  ReadingChapter,
  ReadingMessage,
  FocusTask,
  FocusSession,
  FocusTimerMode,
  FocusSessionStatus,
} from '../types';

interface MessageRow {
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_invocations: string | null;
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

export async function createConversation(conv: Conversation): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO conversations (id, title, system_prompt, model, created_at, updated_at, hidden_ranges)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      conv.id,
      conv.title,
      conv.systemPrompt,
      conv.model,
      conv.createdAt,
      conv.updatedAt,
      JSON.stringify(conv.hiddenRanges ?? []),
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
  }>('SELECT * FROM conversations ORDER BY created_at DESC');

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    systemPrompt: row.system_prompt,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hiddenRanges: parseHiddenRanges(row.hidden_ranges),
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

export async function insertMessage(conversationId: string, msg: Message): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tool_invocations, image_uri, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      conversationId,
      msg.role,
      msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolCallId || null,
      msg.toolInvocations && msg.toolInvocations.length > 0 ? JSON.stringify(msg.toolInvocations) : null,
      msg.imageUri || null,
      msg.createdAt,
    ]
  );
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET content = ? WHERE id = ?', [content, id]);
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

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM messages WHERE id = ?', [id]);
}

function mapMessageRow(row: MessageRow): Message {
  return {
    id: row.id,
    role: row.role as Message['role'],
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    toolCallId: row.tool_call_id || undefined,
    toolInvocations: row.tool_invocations ? JSON.parse(row.tool_invocations) : undefined,
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
  await db.runAsync('DELETE FROM reading_messages WHERE book_id = ?', [id]);
  await db.runAsync('DELETE FROM reading_books WHERE id = ?', [id]);
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
