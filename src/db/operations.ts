import { getDatabase } from './database';
import {
  Conversation,
  Message,
  Diary,
  PeriodRecord,
  DailyPaper,
  DailyPaperContent,
  DailyPaperSource,
  DailyPaperStatus,
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
  CalendarTodo,
  ToolCall,
  GeneratedPicture,
  ApiUsageEvent,
  ApiUsageDailySummary,
  ApiUsageGroupSummary,
  ApiUsageStatus,
  ApiUsageSummary,
  IncomingLetter,
  IncomingLetterStatus,
  ChatGroup,
  ConversationArtifact,
  ConversationArtifactKind,
  ConversationArtifactVersion,
  LocationAttachment,
  VoiceAttachment,
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
import { REACTION_MESSAGE_PREFIX } from '../services/messageReactions';

interface MessageRow {
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_invocations: string | null;
  generated_pics: string | null;
  voice_attachment: string | null;
  location_attachment: string | null;
  image_uri: string | null;
  image_generation_reference_uris: string | null;
  created_at: number;
}

export interface ConversationMessagePage {
  messages: Message[];
  hasMore: boolean;
  hasMoreAfter?: boolean;
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

export interface FavoriteMessageResult extends ChatSearchResult {}

export async function isMessageFavorite(messageId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ is_favorite: number }>(
    'SELECT is_favorite FROM messages WHERE id = ?',
    [messageId]
  );
  return row?.is_favorite === 1;
}

export async function setMessageFavorite(messageId: string, favorite: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET is_favorite = ? WHERE id = ?', [
    favorite ? 1 : 0,
    messageId,
  ]);
}

export async function getFavoriteMessages(keyword = ''): Promise<FavoriteMessageResult[]> {
  const db = await getDatabase();
  const normalized = keyword.trim();
  const params = normalized ? [`%${normalized}%`, `%${normalized}%`] : [];
  const rows = await db.getAllAsync<{
    message_id: string; conversation_id: string; conversation_title: string;
    role: Message['role']; content: string; created_at: number;
  }>(
    `SELECT m.id AS message_id, m.conversation_id, c.title AS conversation_title,
            m.role, m.content, m.created_at
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'assistant' AND m.is_favorite = 1
        ${normalized ? 'AND (m.content LIKE ? OR c.title LIKE ?)' : ''}
      ORDER BY m.created_at DESC`,
    params
  );
  return rows.map((row) => ({
    messageId: row.message_id,
    conversationId: row.conversation_id,
    conversationTitle: row.conversation_title,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

export interface ConversationGlobalSearchResult {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  floorNumber: number;
}

export interface ConversationGlobalSearchPage {
  totalMatches: number;
  results: ConversationGlobalSearchResult[];
  hasMore: boolean;
}

export interface GeneratedPictureGalleryItem {
  id: string;
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  tokenIndex: number;
  prompt: string;
  finalPrompt: string;
  imageUri: string;
  createdAt: number;
  updatedAt: number;
  referenceImageUris?: string[];
}

export interface VoiceAttachmentMessageRecord {
  conversationId: string;
  messageId: string;
  voiceAttachment: VoiceAttachment;
  createdAt: number;
}

interface IncomingLetterRow {
  id: string;
  occasion_id: string;
  occasion_title: string;
  date_key: string;
  title: string;
  content: string;
  status: string;
  generated_at: number | null;
  shown_at: number | null;
  created_at: number;
  updated_at: number;
  error_message: string | null;
  tool_invocations: string | null;
}

interface ConversationArtifactRow {
  id: string;
  conversation_id: string;
  name: string;
  mime_type: string;
  kind: string;
  current_version_id: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  size: number;
}

interface ConversationArtifactVersionRow {
  id: string;
  artifact_id: string;
  version: number;
  content: string;
  created_by: string;
  created_at: number;
  size: number;
}

interface ChatGroupRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

interface ConversationRow {
  id: string;
  title: string;
  system_prompt: string;
  model: string;
  created_at: number;
  updated_at: number;
  archived_from_recents: number | null;
  hidden_ranges: string | null;
  hidden_message_ids: string | null;
}

export interface ChatGroupWithConversations extends ChatGroup {
  conversations: Conversation[];
}

export interface ConversationArtifactListItem extends ConversationArtifact {
  conversationTitle: string;
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

interface ChatDiagnosticsDuplicateGroup {
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

export async function importConversation(
  conv: Conversation,
  messages: Message[]
): Promise<void> {
  const db = await getDatabase();
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      // 使用主连接上的普通事务。独占事务会额外打开连接，容易与后台同步、
      // 小组件等数据库使用者互相抢锁。
      await db.withTransactionAsync(async () => {
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

        for (const msg of messages) {
          await db.runAsync(
            `INSERT INTO messages (id, conversation_id, role, content, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [msg.id, conv.id, msg.role, msg.content, msg.createdAt]
          );
        }
      });
      return;
    } catch (error: any) {
      const isLocked = /database\s+is\s+locked|sqlite_busy/i.test(String(error?.message || error));
      if (!isLocked || attempt === maxAttempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
}

export async function updateConversation(
  id: string,
  updates: Partial<Pick<Conversation, 'title' | 'updatedAt' | 'archivedFromRecents'>>
): Promise<void> {
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
  if (updates.archivedFromRecents !== undefined) {
    sets.push('archived_from_recents = ?');
    values.push(updates.archivedFromRecents ? 1 : 0);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM chat_group_members WHERE conversation_id = ?', [id]);
  await db.runAsync('DELETE FROM conversation_artifact_versions WHERE artifact_id IN (SELECT id FROM conversation_artifacts WHERE conversation_id = ?)', [id]);
  await db.runAsync('DELETE FROM conversation_artifacts WHERE conversation_id = ?', [id]);
  await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', [id]);
  await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
}

export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ConversationRow>('SELECT * FROM conversations ORDER BY created_at DESC');

  return rows.map(mapConversationRow);
}

export async function createChatGroup(group: ChatGroup): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO chat_groups (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [group.id, group.name, group.createdAt, group.updatedAt]
  );
}

export async function updateChatGroup(
  id: string,
  updates: Partial<Pick<ChatGroup, 'name' | 'updatedAt'>>
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE chat_groups SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteChatGroup(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM chat_group_members WHERE group_id = ?', [id]);
  await db.runAsync('DELETE FROM chat_groups WHERE id = ?', [id]);
}

export async function addConversationToChatGroup(
  groupId: string,
  conversationId: string,
  addedAt = Date.now()
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO chat_group_members (group_id, conversation_id, added_at)
     VALUES (?, ?, ?)`,
    [groupId, conversationId, addedAt]
  );
  await db.runAsync('UPDATE chat_groups SET updated_at = ? WHERE id = ?', [addedAt, groupId]);
}

export async function removeConversationFromChatGroup(
  groupId: string,
  conversationId: string
): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync(
    'DELETE FROM chat_group_members WHERE group_id = ? AND conversation_id = ?',
    [groupId, conversationId]
  );
  await db.runAsync('UPDATE chat_groups SET updated_at = ? WHERE id = ?', [now, groupId]);
}

export async function getChatGroupsWithConversations(): Promise<ChatGroupWithConversations[]> {
  const db = await getDatabase();
  const groupRows = await db.getAllAsync<ChatGroupRow>(
    'SELECT * FROM chat_groups ORDER BY updated_at DESC, created_at DESC'
  );
  const groups = groupRows.map(mapChatGroupRow);
  if (groups.length === 0) return [];

  const rows = await db.getAllAsync<{
    group_id: string;
    conversation_id: string;
    title: string | null;
    system_prompt: string | null;
    model: string | null;
    created_at: number;
    updated_at: number;
    archived_from_recents: number | null;
    hidden_ranges: string | null;
    hidden_message_ids: string | null;
  }>(
    `SELECT
        gm.group_id,
        c.id as conversation_id,
        c.title,
        c.system_prompt,
        c.model,
        c.created_at,
        c.updated_at,
        c.archived_from_recents,
        c.hidden_ranges,
        c.hidden_message_ids
       FROM chat_group_members gm
       JOIN conversations c ON c.id = gm.conversation_id
      ORDER BY gm.added_at DESC`
  );

  const conversationsByGroup = new Map<string, Conversation[]>();
  groups.forEach((group) => conversationsByGroup.set(group.id, []));
  rows.forEach((row) => {
    conversationsByGroup.get(row.group_id)?.push(mapConversationRow({
      id: row.conversation_id,
      title: row.title || '',
      system_prompt: row.system_prompt || '',
      model: row.model || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
      archived_from_recents: row.archived_from_recents,
      hidden_ranges: row.hidden_ranges,
      hidden_message_ids: row.hidden_message_ids,
    }));
  });

  return groups.map((group) => ({
    ...group,
    conversations: conversationsByGroup.get(group.id) || [],
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

function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    systemPrompt: row.system_prompt,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedFromRecents: row.archived_from_recents === 1,
    hiddenRanges: parseHiddenRanges(row.hidden_ranges),
    hiddenMessageIds: parseStringArray(row.hidden_message_ids),
  };
}

function mapChatGroupRow(row: ChatGroupRow): ChatGroup {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, tool_invocations, generated_pics, voice_attachment, location_attachment, image_uri, image_generation_reference_uris, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      conversationId,
      msg.role,
      msg.content,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.toolCallId || null,
      msg.toolInvocations && msg.toolInvocations.length > 0 ? JSON.stringify(msg.toolInvocations) : null,
      msg.generatedPics && msg.generatedPics.length > 0 ? JSON.stringify(msg.generatedPics) : null,
      msg.voiceAttachment ? JSON.stringify(msg.voiceAttachment) : null,
      msg.locationAttachment ? JSON.stringify(msg.locationAttachment) : null,
      msg.imageUri || null,
      msg.imageGenerationReferenceUris && msg.imageGenerationReferenceUris.length > 0
        ? JSON.stringify(msg.imageGenerationReferenceUris)
        : null,
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

export async function updateMessageVoiceAttachment(
  id: string,
  voiceAttachment: VoiceAttachment | undefined
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE messages SET voice_attachment = ? WHERE id = ?', [
    voiceAttachment ? JSON.stringify(voiceAttachment) : null,
    id,
  ]);
}

export async function getVoiceAttachmentMessages(): Promise<VoiceAttachmentMessageRecord[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    conversation_id: string;
    voice_attachment: string | null;
    created_at: number;
  }>(
    `SELECT id, conversation_id, voice_attachment, created_at
       FROM messages
      WHERE voice_attachment IS NOT NULL
      ORDER BY created_at ASC`
  );

  return rows
    .map((row) => {
      const voiceAttachment = parseJsonObject<VoiceAttachment>(row.voice_attachment);
      if (!voiceAttachment) return null;
      return {
        conversationId: row.conversation_id,
        messageId: row.id,
        voiceAttachment,
        createdAt: row.created_at,
      };
    })
    .filter((item): item is VoiceAttachmentMessageRecord => !!item);
}

export async function insertIncomingLetter(letter: IncomingLetter): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO incoming_letters
      (id, occasion_id, occasion_title, date_key, title, content, status, generated_at,
       shown_at, created_at, updated_at, error_message, tool_invocations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      letter.id,
      letter.occasionId,
      letter.occasionTitle,
      letter.dateKey,
      letter.title,
      letter.content,
      letter.status,
      letter.generatedAt,
      letter.shownAt,
      letter.createdAt,
      letter.updatedAt,
      letter.errorMessage || null,
      letter.toolInvocations && letter.toolInvocations.length > 0
        ? JSON.stringify(letter.toolInvocations)
        : null,
    ]
  );
}

export async function updateIncomingLetter(
  id: string,
  updates: Partial<Pick<IncomingLetter, 'title' | 'content' | 'status' | 'generatedAt' | 'shownAt' | 'updatedAt' | 'errorMessage' | 'toolInvocations'>>
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
  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.generatedAt !== undefined) {
    sets.push('generated_at = ?');
    values.push(updates.generatedAt);
  }
  if (updates.shownAt !== undefined) {
    sets.push('shown_at = ?');
    values.push(updates.shownAt);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }
  if (updates.errorMessage !== undefined) {
    sets.push('error_message = ?');
    values.push(updates.errorMessage || null);
  }
  if (updates.toolInvocations !== undefined) {
    sets.push('tool_invocations = ?');
    values.push(
      updates.toolInvocations && updates.toolInvocations.length > 0
        ? JSON.stringify(updates.toolInvocations)
        : null
    );
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE incoming_letters SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function getIncomingLetterByOccasionDate(
  occasionId: string,
  dateKey: string
): Promise<IncomingLetter | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<IncomingLetterRow>(
    'SELECT * FROM incoming_letters WHERE occasion_id = ? AND date_key = ? LIMIT 1',
    [occasionId, dateKey]
  );
  return row ? mapIncomingLetterRow(row) : null;
}

export async function getAllIncomingLetters(): Promise<IncomingLetter[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<IncomingLetterRow>(
    'SELECT * FROM incoming_letters ORDER BY date_key DESC, created_at DESC'
  );
  return rows.map(mapIncomingLetterRow);
}

export async function getUnshownIncomingLettersByDate(dateKey: string): Promise<IncomingLetter[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<IncomingLetterRow>(
    `SELECT *
       FROM incoming_letters
      WHERE date_key = ?
        AND status = 'ready'
        AND shown_at IS NULL
      ORDER BY generated_at ASC, created_at ASC`,
    [dateKey]
  );
  return rows.map(mapIncomingLetterRow);
}

export async function markIncomingLetterShown(id: string, shownAt = Date.now()): Promise<void> {
  await updateIncomingLetter(id, { shownAt, updatedAt: shownAt });
}

function normalizeArtifactKind(value: string): ConversationArtifactKind {
  if (
    value === 'markdown' ||
    value === 'html' ||
    value === 'css' ||
    value === 'javascript' ||
    value === 'typescript' ||
    value === 'json' ||
    value === 'csv'
  ) {
    return value;
  }
  return 'text';
}

function normalizeArtifactCreator(value: string): 'user' | 'assistant' {
  return value === 'assistant' ? 'assistant' : 'user';
}

function mapConversationArtifactRow(row: ConversationArtifactRow): ConversationArtifact {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    mimeType: row.mime_type,
    kind: normalizeArtifactKind(row.kind),
    currentVersionId: row.current_version_id,
    createdBy: normalizeArtifactCreator(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    size: row.size,
  };
}

export async function insertConversationArtifact(
  artifact: ConversationArtifact,
  version: ConversationArtifactVersion
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO conversation_artifacts
      (id, conversation_id, name, mime_type, kind, current_version_id, created_by, created_at, updated_at, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      artifact.id,
      artifact.conversationId,
      artifact.name,
      artifact.mimeType,
      artifact.kind,
      artifact.currentVersionId,
      artifact.createdBy,
      artifact.createdAt,
      artifact.updatedAt,
      artifact.size,
    ]
  );
  await db.runAsync(
    `INSERT OR REPLACE INTO conversation_artifact_versions
      (id, artifact_id, version, content, created_by, created_at, size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      version.id,
      version.artifactId,
      version.version,
      version.content,
      version.createdBy,
      version.createdAt,
      version.size,
    ]
  );
}

export async function getConversationArtifacts(conversationId: string): Promise<ConversationArtifact[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ConversationArtifactRow>(
    'SELECT * FROM conversation_artifacts WHERE conversation_id = ? ORDER BY updated_at DESC',
    [conversationId]
  );
  return rows.map(mapConversationArtifactRow);
}

export async function getAllConversationArtifacts(): Promise<ConversationArtifactListItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ConversationArtifactRow & { conversation_title: string | null }>(
    `SELECT
        a.*,
        c.title as conversation_title
       FROM conversation_artifacts a
       LEFT JOIN conversations c ON c.id = a.conversation_id
      ORDER BY a.updated_at DESC, a.created_at DESC`
  );
  return rows.map((row) => ({
    ...mapConversationArtifactRow(row),
    conversationTitle: row.conversation_title || '',
  }));
}

export async function getConversationArtifact(
  conversationId: string,
  artifactId: string
): Promise<ConversationArtifact | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ConversationArtifactRow>(
    'SELECT * FROM conversation_artifacts WHERE conversation_id = ? AND id = ? LIMIT 1',
    [conversationId, artifactId]
  );
  return row ? mapConversationArtifactRow(row) : null;
}

export async function getConversationArtifactCurrentVersion(
  conversationId: string,
  artifactId: string
): Promise<{ artifact: ConversationArtifact; version: ConversationArtifactVersion } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ConversationArtifactRow & ConversationArtifactVersionRow>(
    `SELECT
        a.id, a.conversation_id, a.name, a.mime_type, a.kind, a.current_version_id,
        a.created_by, a.created_at, a.updated_at, a.size,
        v.id as version_id, v.artifact_id, v.version, v.content,
        v.created_by as version_created_by, v.created_at as version_created_at, v.size as version_size
       FROM conversation_artifacts a
       JOIN conversation_artifact_versions v ON v.id = a.current_version_id
      WHERE a.conversation_id = ? AND a.id = ?
      LIMIT 1`,
    [conversationId, artifactId]
  ) as any;
  if (!row) return null;
  return {
    artifact: mapConversationArtifactRow(row),
    version: {
      id: row.version_id,
      artifactId: row.artifact_id,
      version: row.version,
      content: row.content,
      createdBy: normalizeArtifactCreator(row.version_created_by),
      createdAt: row.version_created_at,
      size: row.version_size,
    },
  };
}

export async function insertConversationArtifactVersion(
  conversationId: string,
  artifactId: string,
  version: Omit<ConversationArtifactVersion, 'version'> & { version?: number }
): Promise<ConversationArtifactVersion> {
  const db = await getDatabase();
  const current = await getConversationArtifact(conversationId, artifactId);
  if (!current) {
    throw new Error('找不到当前对话中的文件');
  }
  const latestRow = await db.getFirstAsync<{ latest: number | null }>(
    'SELECT MAX(version) as latest FROM conversation_artifact_versions WHERE artifact_id = ?',
    [artifactId]
  );
  const nextVersionNumber = version.version ?? ((latestRow?.latest || 0) + 1);
  const next: ConversationArtifactVersion = {
    ...version,
    version: nextVersionNumber,
  };
  await db.runAsync(
    `INSERT OR REPLACE INTO conversation_artifact_versions
      (id, artifact_id, version, content, created_by, created_at, size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      next.id,
      next.artifactId,
      next.version,
      next.content,
      next.createdBy,
      next.createdAt,
      next.size,
    ]
  );
  await db.runAsync(
    'UPDATE conversation_artifacts SET current_version_id = ?, updated_at = ?, size = ? WHERE conversation_id = ? AND id = ?',
    [next.id, next.createdAt, next.size, conversationId, artifactId]
  );
  await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', [next.createdAt, conversationId]);
  return next;
}

export async function deleteConversationArtifact(
  conversationId: string,
  artifactId: string
): Promise<ConversationArtifact | null> {
  const db = await getDatabase();
  const artifact = await getConversationArtifact(conversationId, artifactId);
  if (!artifact) return null;
  await db.runAsync('DELETE FROM conversation_artifact_versions WHERE artifact_id = ?', [artifactId]);
  await db.runAsync('DELETE FROM conversation_artifacts WHERE conversation_id = ? AND id = ?', [
    conversationId,
    artifactId,
  ]);
  await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', [Date.now(), conversationId]);
  return artifact;
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

export async function clearChatDiagnosticsEmptyAssistantIssues(
  conversationId?: string
): Promise<number> {
  const db = await getDatabase();
  let deletedCount = 0;

  await db.withExclusiveTransactionAsync(async (txn) => {
    const conversationWhere = conversationId ? 'AND m.conversation_id = ?' : '';
    const targets = await txn.getAllAsync<{
      id: string;
      conversation_id: string;
      floor_number: number;
    }>(
      `SELECT
          m.id,
          m.conversation_id,
          (
            SELECT COUNT(*)
              FROM messages fm
             WHERE fm.conversation_id = m.conversation_id
               AND fm.role IN ('user', 'assistant')
               AND (fm.created_at < m.created_at OR (fm.created_at = m.created_at AND fm.id <= m.id))
          ) as floor_number
         FROM messages m
        WHERE m.role = 'assistant'
          AND TRIM(COALESCE(m.content, '')) = ''
          AND (m.tool_invocations IS NULL OR m.tool_invocations = '' OR m.tool_invocations = '[]')
          ${conversationWhere}
        ORDER BY m.conversation_id ASC, m.created_at ASC, m.id ASC`,
      conversationId ? [conversationId] : []
    );

    if (targets.length === 0) return;

    const targetsByConversation = new Map<string, typeof targets>();
    for (const target of targets) {
      const list = targetsByConversation.get(target.conversation_id);
      if (list) {
        list.push(target);
      } else {
        targetsByConversation.set(target.conversation_id, [target]);
      }
    }

    const now = Date.now();
    for (const [targetConversationId, conversationTargets] of targetsByConversation) {
      const conversation = await txn.getFirstAsync<{
        hidden_ranges: string | null;
        hidden_message_ids: string | null;
        pending_response_boundary_message_id: string | null;
      }>(
        'SELECT hidden_ranges, hidden_message_ids, pending_response_boundary_message_id FROM conversations WHERE id = ?',
        [targetConversationId]
      );

      const targetIds = new Set(conversationTargets.map((target) => target.id));
      let nextHiddenRanges = parseHiddenRanges(conversation?.hidden_ranges);
      for (const target of [...conversationTargets].sort((a, b) => b.floor_number - a.floor_number)) {
        nextHiddenRanges = shiftHiddenRangesAfterDeletedFloor(nextHiddenRanges, target.floor_number);
      }

      const nextHiddenMessageIds = parseStringArray(conversation?.hidden_message_ids).filter(
        (id) => !targetIds.has(id)
      );
      const nextPendingBoundary = targetIds.has(conversation?.pending_response_boundary_message_id || '')
        ? null
        : conversation?.pending_response_boundary_message_id ?? null;

      for (const target of conversationTargets) {
        await txn.runAsync('DELETE FROM messages WHERE conversation_id = ? AND id = ?', [
          targetConversationId,
          target.id,
        ]);
      }

      await txn.runAsync(
        `UPDATE conversations
            SET hidden_ranges = ?,
                hidden_message_ids = ?,
                pending_response_boundary_message_id = ?,
                updated_at = ?
          WHERE id = ?`,
        [
          JSON.stringify(nextHiddenRanges),
          JSON.stringify(nextHiddenMessageIds),
          nextPendingBoundary,
          now,
          targetConversationId,
        ]
      );
    }

    deletedCount = targets.length;
  });

  return deletedCount;
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

function parseJsonObject<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : undefined;
  } catch {
    return undefined;
  }
}

function normalizeIncomingLetterStatus(value: string): IncomingLetterStatus {
  if (value === 'ready' || value === 'failed') return value;
  return 'generating';
}

function mapIncomingLetterRow(row: IncomingLetterRow): IncomingLetter {
  return {
    id: row.id,
    occasionId: row.occasion_id,
    occasionTitle: row.occasion_title,
    dateKey: row.date_key,
    title: row.title,
    content: row.content,
    status: normalizeIncomingLetterStatus(row.status),
    generatedAt: row.generated_at,
    shownAt: row.shown_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    errorMessage: row.error_message || undefined,
    toolInvocations: parseJsonArray<ToolInvocation>(row.tool_invocations),
  };
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
    voiceAttachment: parseJsonObject<VoiceAttachment>(row.voice_attachment),
    locationAttachment: parseJsonObject<LocationAttachment>(row.location_attachment),
    imageUri: row.image_uri || undefined,
    imageGenerationReferenceUris: parseStringArray(row.image_generation_reference_uris),
    createdAt: row.created_at,
  };
}

export async function getMessagesByConversation(conversationId: string): Promise<Message[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<MessageRow>(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC',
    [conversationId]
  );

  return rows.map(mapMessageRow);
}

export async function getMessageByConversationAndId(
  conversationId: string,
  messageId: string
): Promise<Message | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<MessageRow>(
    'SELECT * FROM messages WHERE conversation_id = ? AND id = ? LIMIT 1',
    [conversationId, messageId]
  );

  return row ? mapMessageRow(row) : null;
}

export async function getConversationMessagePage(
  conversationId: string,
  options: { limit: number; beforeCreatedAt?: number; beforeId?: string }
): Promise<ConversationMessagePage> {
  const db = await getDatabase();
  const pageLimit = Math.max(1, options.limit);
  const params: any[] = [conversationId];
  let where = 'conversation_id = ?';

  if (options.beforeCreatedAt !== undefined) {
    where += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
    params.push(options.beforeCreatedAt, options.beforeCreatedAt, options.beforeId || '');
  }

  params.push(pageLimit + 1);
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT * FROM messages WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    params
  );
  const visibleRows = rows.slice(0, pageLimit).reverse();
  const messages = visibleRows.map(mapMessageRow);
  const firstMessage = messages[0];

  return {
    messages,
    hasMore: rows.length > pageLimit,
    floorOffset:
      firstMessage === undefined
        ? 0
        : await getConversationFloorOffset(conversationId, firstMessage.createdAt, firstMessage.id),
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
          WHERE conversation_id = ?
            AND (created_at < ? OR (created_at = ? AND id < ?))
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
        [conversationId, target.created_at, target.created_at, target.id, beforeLimit]
      )
    : [];
  const afterRows = afterLimit > 0
    ? await db.getAllAsync<MessageRow>(
        `SELECT * FROM messages
          WHERE conversation_id = ?
            AND (created_at > ? OR (created_at = ? AND id > ?))
          ORDER BY created_at ASC, id ASC
          LIMIT ?`,
        [conversationId, target.created_at, target.created_at, target.id, afterLimit + 1]
      )
    : [];
  const visibleAfterRows = afterRows.slice(0, afterLimit);
  const messages = [...beforeRows.reverse(), target, ...visibleAfterRows].map(mapMessageRow);
  const firstMessage = messages[0];

  return {
    messages,
    hasMore:
      firstMessage === undefined
        ? false
        : (await getConversationFloorOffset(conversationId, firstMessage.createdAt, firstMessage.id)) > 0,
    hasMoreAfter: afterRows.length > afterLimit,
    floorOffset:
      firstMessage === undefined
        ? 0
        : await getConversationFloorOffset(conversationId, firstMessage.createdAt, firstMessage.id),
  };
}

export async function getConversationNewerMessagePage(
  conversationId: string,
  options: { limit: number; afterCreatedAt: number; afterId?: string }
): Promise<ConversationMessagePage> {
  const db = await getDatabase();
  const pageLimit = Math.max(1, options.limit);
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT * FROM messages
      WHERE conversation_id = ?
        AND (created_at > ? OR (created_at = ? AND id > ?))
      ORDER BY created_at ASC, id ASC
      LIMIT ?`,
    [conversationId, options.afterCreatedAt, options.afterCreatedAt, options.afterId || '', pageLimit + 1]
  );
  const visibleRows = rows.slice(0, pageLimit);
  const messages = visibleRows.map(mapMessageRow);
  const firstMessage = messages[0];

  return {
    messages,
    hasMore: rows.length > pageLimit,
    floorOffset:
      firstMessage === undefined
        ? 0
        : await getConversationFloorOffset(conversationId, firstMessage.createdAt, firstMessage.id),
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

export async function searchConversationFloorsGlobally(
  query: string,
  options: { limit: number; beforeCreatedAt?: number; beforeMessageId?: string }
): Promise<ConversationGlobalSearchPage> {
  const keyword = query.trim();
  if (!keyword) return { totalMatches: 0, results: [], hasMore: false };
  return searchConversationFloorsByKeywordsGlobally([keyword], 'intersection', options);
}

export async function searchConversationFloorsByKeywordsGlobally(
  keywords: string[],
  mode: 'intersection' | 'union',
  options: { limit: number; beforeCreatedAt?: number; beforeMessageId?: string }
): Promise<ConversationGlobalSearchPage> {
  const normalizedKeywords = keywords.map((item) => item.trim()).filter(Boolean);
  if (normalizedKeywords.length === 0) {
    return { totalMatches: 0, results: [], hasMore: false };
  }
  const db = await getDatabase();
  const patterns = normalizedKeywords.map(likePattern);
  const keywordOperator = mode === 'union' ? ' OR ' : ' AND ';
  const countKeywordWhere = patterns.map(() => `m.content LIKE ? ESCAPE '\\'`).join(keywordOperator);
  const countRow = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.archived_from_recents = 0
        AND m.role IN ('user', 'assistant')
        AND (${countKeywordWhere})`,
    patterns
  );

  const searchKeywordWhere = patterns.map(() => `m.content LIKE ? ESCAPE '\\'`).join(keywordOperator);
  const params: any[] = [...patterns];
  let cursorWhere = '';
  if (options.beforeCreatedAt !== undefined && options.beforeMessageId) {
    cursorWhere = 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))';
    params.push(options.beforeCreatedAt, options.beforeCreatedAt, options.beforeMessageId);
  }
  const limit = Math.max(1, options.limit);
  params.push(limit + 1);

  const rows = await db.getAllAsync<{
    message_id: string;
    conversation_id: string;
    conversation_title: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
    floor_number: number;
  }>(
    `SELECT
        m.id AS message_id,
        m.conversation_id AS conversation_id,
        c.title AS conversation_title,
        m.role AS role,
        m.content AS content,
        m.created_at AS created_at,
        (
          SELECT COUNT(*)
            FROM messages prior
           WHERE prior.conversation_id = m.conversation_id
             AND prior.role IN ('user', 'assistant')
             AND (
               prior.created_at < m.created_at
               OR (prior.created_at = m.created_at AND prior.id <= m.id)
             )
        ) AS floor_number
       FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.archived_from_recents = 0
        AND m.role IN ('user', 'assistant')
        AND (${searchKeywordWhere})
        ${cursorWhere}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?`,
    params
  );

  return {
    totalMatches: countRow?.count ?? 0,
    hasMore: rows.length > limit,
    results: rows.slice(0, limit).map((row) => ({
      messageId: row.message_id,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      floorNumber: row.floor_number,
    })),
  };
}

export async function getGeneratedPictureGalleryItems(): Promise<GeneratedPictureGalleryItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    conversation_id: string;
    conversation_title: string;
    message_id: string;
    message_created_at: number;
    generated_pics: string | null;
  }>(
    `SELECT
        c.id as conversation_id,
        c.title as conversation_title,
        m.id as message_id,
        m.created_at as message_created_at,
        m.generated_pics as generated_pics
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.generated_pics IS NOT NULL
        AND m.generated_pics != ''
      ORDER BY m.created_at DESC`
  );

  const items: GeneratedPictureGalleryItem[] = [];
  rows.forEach((row) => {
    const pictures = parseJsonArray<GeneratedPicture>(row.generated_pics) || [];
    pictures.forEach((picture) => {
      if (picture.status !== 'done' || !picture.imageUri) return;
      const updatedAt = picture.updatedAt || row.message_created_at;
      items.push({
        id: `${row.message_id}:${picture.tokenIndex}`,
        conversationId: row.conversation_id,
        conversationTitle: row.conversation_title,
        messageId: row.message_id,
        tokenIndex: picture.tokenIndex,
        prompt: picture.prompt,
        finalPrompt: picture.finalPrompt,
        imageUri: picture.imageUri,
        createdAt: picture.createdAt || row.message_created_at,
        updatedAt,
        referenceImageUris: picture.referenceImageUris,
      });
    });
  });

  return items.sort((a, b) => b.updatedAt - a.updatedAt);
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

async function getChatActiveDateKeys(limit = 3650): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ date_key: string }>(
    `SELECT date(created_at / 1000, 'unixepoch', 'localtime') as date_key
       FROM messages
      WHERE role IN ('user', 'assistant')
      GROUP BY date_key
      ORDER BY date_key DESC
      LIMIT ?`,
    [Math.max(1, limit)]
  );
  return rows.map((row) => row.date_key).filter(Boolean);
}

export async function getCompanionActiveDateKeys(limit = 3650): Promise<string[]> {
  const [chatDateKeys, apiDateKeys] = await Promise.all([
    getChatActiveDateKeys(limit),
    getApiUsageActiveDateKeysByFeature('all', limit),
  ]);
  return [...new Set([...chatDateKeys, ...apiDateKeys])]
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, Math.max(1, limit));
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
  beforeCreatedAt: number,
  beforeId: string
): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
       FROM messages
      WHERE conversation_id = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
        AND role IN ('user', 'assistant')`,
    [conversationId, beforeCreatedAt, beforeCreatedAt, beforeId]
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
    if (content.startsWith(REACTION_MESSAGE_PREFIX)) {
      return {
        status: 'runtime-context',
        label: 'Emoji reaction event sent to the AI as a system chat message',
      };
    }
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
  date_key: string;
  is_favorite: number;
  created_at: number;
  updated_at: number;
}): Diary {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    date: row.date_key,
    isFavorite: row.is_favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createDiary(diary: Diary): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO diaries (id, title, content, date_key, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      diary.id,
      diary.title,
      diary.content,
      diary.date,
      diary.isFavorite ? 1 : 0,
      diary.createdAt,
      diary.updatedAt,
    ]
  );
}

export async function updateDiary(
  id: string,
  updates: Partial<Pick<Diary, 'title' | 'content' | 'date' | 'isFavorite' | 'updatedAt'>>
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
  if (updates.date !== undefined) {
    sets.push('date_key = ?');
    values.push(updates.date);
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
    date_key: string;
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
    date_key: string;
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

/* ==================== Daily Paper CRUD ==================== */

interface DailyPaperRow {
  id: string;
  date_key: string;
  title: string;
  status: string;
  content_json: string | null;
  sources_json: string | null;
  generated_at: number | null;
  created_at: number;
  updated_at: number;
  error_message: string | null;
}

function parseDailyPaperStatus(value: string): DailyPaperStatus {
  if (value === 'generating' || value === 'ready' || value === 'failed') return value;
  return 'draft';
}

function parseDailyPaperContent(raw: string | null | undefined): DailyPaperContent | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      masthead: typeof parsed.masthead === 'string' ? parsed.masthead : 'YS Daily',
      headline: typeof parsed.headline === 'string' ? parsed.headline : '',
      dek: typeof parsed.dek === 'string' ? parsed.dek : '',
      sections: Array.isArray(parsed.sections)
        ? parsed.sections
            .map((section: any) => ({
              title: typeof section?.title === 'string' ? section.title : '',
              items: Array.isArray(section?.items)
                ? section.items.filter((item: unknown) => typeof item === 'string')
                : [],
            }))
            .filter((section: DailyPaperContent['sections'][number]) => section.title || section.items.length > 0)
        : [],
      editorial: typeof parsed.editorial === 'string' ? parsed.editorial : '',
      generatedFrom: typeof parsed.generatedFrom === 'string' ? parsed.generatedFrom : '',
    };
  } catch {
    return null;
  }
}

function parseDailyPaperSources(raw: string | null | undefined): DailyPaperSource[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((source) => ({
        title: typeof source?.title === 'string' ? source.title : '',
        url: typeof source?.url === 'string' ? source.url : '',
        sourceName: typeof source?.sourceName === 'string' ? source.sourceName : '',
        publishedAt: typeof source?.publishedAt === 'string' ? source.publishedAt : undefined,
        category: typeof source?.category === 'string' ? source.category : 'general',
      }))
      .filter((source) => source.title && source.url);
  } catch {
    return [];
  }
}

function mapDailyPaperRow(row: DailyPaperRow): DailyPaper {
  return {
    id: row.id,
    dateKey: row.date_key,
    title: row.title,
    status: parseDailyPaperStatus(row.status),
    content: parseDailyPaperContent(row.content_json),
    sources: parseDailyPaperSources(row.sources_json),
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    errorMessage: row.error_message || undefined,
  };
}

export async function upsertDailyPaper(paper: DailyPaper): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO daily_papers
      (id, date_key, title, status, content_json, sources_json, generated_at, created_at, updated_at, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paper.id,
      paper.dateKey,
      paper.title,
      paper.status,
      paper.content ? JSON.stringify(paper.content) : null,
      JSON.stringify(paper.sources || []),
      paper.generatedAt,
      paper.createdAt,
      paper.updatedAt,
      paper.errorMessage || null,
    ]
  );
}

export async function updateDailyPaper(
  dateKey: string,
  updates: Partial<Pick<DailyPaper, 'title' | 'status' | 'content' | 'sources' | 'generatedAt' | 'updatedAt' | 'errorMessage'>>
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.status !== undefined) {
    sets.push('status = ?');
    values.push(updates.status);
  }
  if (updates.content !== undefined) {
    sets.push('content_json = ?');
    values.push(updates.content ? JSON.stringify(updates.content) : null);
  }
  if (updates.sources !== undefined) {
    sets.push('sources_json = ?');
    values.push(JSON.stringify(updates.sources));
  }
  if (updates.generatedAt !== undefined) {
    sets.push('generated_at = ?');
    values.push(updates.generatedAt);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }
  if (updates.errorMessage !== undefined) {
    sets.push('error_message = ?');
    values.push(updates.errorMessage || null);
  }

  if (sets.length === 0) return;
  values.push(dateKey);
  await db.runAsync(`UPDATE daily_papers SET ${sets.join(', ')} WHERE date_key = ?`, values);
}

export async function getDailyPaperByDate(dateKey: string): Promise<DailyPaper | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DailyPaperRow>(
    'SELECT * FROM daily_papers WHERE date_key = ?',
    [dateKey]
  );
  return row ? mapDailyPaperRow(row) : null;
}

export async function getDailyPaperDateKeys(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ date_key: string }>(
    `SELECT date_key FROM daily_papers WHERE status = 'ready' ORDER BY date_key DESC`
  );
  return rows.map((row) => row.date_key);
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

async function upsertReadingBookSnapshot(snapshot: ReadingBookSnapshot): Promise<void> {
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

/* ==================== Calendar Todo CRUD ==================== */

interface CalendarTodoRow {
  id: string;
  title: string;
  date_key: string;
  scheduled_time: string | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

function mapCalendarTodoRow(row: CalendarTodoRow): CalendarTodo {
  return {
    id: row.id,
    title: row.title,
    dateKey: row.date_key,
    scheduledTime: row.scheduled_time || undefined,
    completedAt: row.completed_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createCalendarTodo(todo: CalendarTodo): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO calendar_todos
      (id, title, date_key, scheduled_time, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      todo.id,
      todo.title,
      todo.dateKey,
      todo.scheduledTime || null,
      todo.completedAt || null,
      todo.createdAt,
      todo.updatedAt,
    ]
  );
}

export async function updateCalendarTodo(
  id: string,
  updates: Partial<Pick<CalendarTodo, 'title' | 'dateKey' | 'updatedAt'>> & {
    scheduledTime?: CalendarTodo['scheduledTime'] | null;
    completedAt?: CalendarTodo['completedAt'] | null;
  }
): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    values.push(updates.title);
  }
  if (updates.dateKey !== undefined) {
    sets.push('date_key = ?');
    values.push(updates.dateKey);
  }
  if (updates.scheduledTime !== undefined) {
    sets.push('scheduled_time = ?');
    values.push(updates.scheduledTime || null);
  }
  if (updates.completedAt !== undefined) {
    sets.push('completed_at = ?');
    values.push(updates.completedAt || null);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    values.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE calendar_todos SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteCalendarTodo(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM calendar_todos WHERE id = ?', [id]);
}

export async function getCalendarTodosByDate(dateKey: string): Promise<CalendarTodo[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CalendarTodoRow>(
    `SELECT *
       FROM calendar_todos
      WHERE date_key = ?
      ORDER BY
        CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END ASC,
        CASE WHEN scheduled_time IS NULL OR scheduled_time = '' THEN 1 ELSE 0 END ASC,
        scheduled_time ASC,
        created_at ASC`,
    [dateKey]
  );
  return rows.map(mapCalendarTodoRow);
}

export async function getUnfinishedCalendarTodosBeforeDate(dateKey: string): Promise<CalendarTodo[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CalendarTodoRow>(
    `SELECT *
       FROM calendar_todos
      WHERE date_key < ?
        AND completed_at IS NULL
      ORDER BY
        date_key ASC,
        CASE WHEN scheduled_time IS NULL OR scheduled_time = '' THEN 1 ELSE 0 END ASC,
        scheduled_time ASC,
        created_at ASC`,
    [dateKey]
  );
  return rows.map(mapCalendarTodoRow);
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
  request_json: string | null;
  response_json: string | null;
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

interface ApiUsageDateKeyRow {
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
    requestJson: row.request_json || undefined,
    responseJson: row.response_json || undefined,
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

type ApiUsageEventListener = (event: ApiUsageEvent) => void;
const apiUsageEventListeners = new Set<ApiUsageEventListener>();

export function subscribeApiUsageEvents(listener: ApiUsageEventListener): () => void {
  apiUsageEventListeners.add(listener);
  return () => apiUsageEventListeners.delete(listener);
}

export async function insertApiUsageEvent(event: ApiUsageEvent): Promise<void> {
  const hasTokenUsage = [
    event.promptTokens,
    event.completionTokens,
    event.totalTokens,
    event.cachedTokens,
    event.reasoningTokens,
  ].some((value) => typeof value === 'number' && value > 0);
  if (event.status === 'error' && !hasTokenUsage) return;

  const db = await getDatabase();
  if (event.requestJson !== undefined || event.responseJson !== undefined) {
    await db.runAsync(
      `UPDATE api_usage_events
          SET request_json = NULL,
              response_json = NULL
        WHERE request_json IS NOT NULL OR response_json IS NOT NULL`
    );
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO api_usage_events
      (id, feature, request_kind, streaming, status, model, base_url, conversation_id, message_id,
       prompt_tokens, completion_tokens, total_tokens, cached_tokens, reasoning_tokens, details_json,
       started_at, ended_at, duration_ms, error_message, metadata_json, request_json, response_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      event.requestJson ?? null,
      event.responseJson ?? null,
    ]
  );

  apiUsageEventListeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // A display listener must never make a successfully persisted usage event fail.
    }
  });
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

async function getApiUsageActiveDateKeysByFeature(feature?: string, limit = 3650): Promise<string[]> {
  const db = await getDatabase();
  const featureFilter = feature && feature !== 'all';
  const rows = await db.getAllAsync<ApiUsageDateKeyRow>(
    `SELECT date(started_at / 1000, 'unixepoch', 'localtime') as date_key
       FROM api_usage_events
      WHERE status = 'success'
        ${featureFilter ? 'AND feature = ?' : ''}
      GROUP BY date_key
      ORDER BY date_key DESC
      LIMIT ?`,
    featureFilter ? [feature, Math.max(1, limit)] : [Math.max(1, limit)]
  );
  return rows.map((row) => row.date_key).filter(Boolean);
}

export async function getApiUsageSummaryByModel(): Promise<ApiUsageGroupSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ApiUsageModelSummaryRow>(
    `SELECT
        model as key_name,
        GROUP_CONCAT(DISTINCT base_url) as channels,
        ${API_USAGE_SUMMARY_SELECT}
       FROM api_usage_events
      GROUP BY model, base_url
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

export interface BotChannelMessage {
  id: string;
  platform: 'qq' | 'wechat';
  direction: 'incoming' | 'outgoing';
  content: string;
  senderId?: string;
  platformMessageId?: string;
  route?: Record<string, any>;
  createdAt: number;
}

export async function insertBotChannelMessage(message: BotChannelMessage): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO bot_channel_messages
      (id, platform, direction, content, sender_id, platform_message_id, route_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.platform,
      message.direction,
      message.content,
      message.senderId || null,
      message.platformMessageId || null,
      message.route ? JSON.stringify(message.route) : null,
      message.createdAt,
    ]
  );
  return result.changes > 0;
}

export async function getBotChannelMessages(
  platform: 'qq' | 'wechat',
  limit: number,
  contactId?: string
): Promise<BotChannelMessage[]> {
  const db = await getDatabase();
  const rows = contactId
    ? await db.getAllAsync<any>(
      `SELECT * FROM bot_channel_messages
        WHERE platform = ? AND json_extract(route_json, '$.contactId') = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [platform, contactId, Math.max(1, limit)]
    )
    : await db.getAllAsync<any>(
      `SELECT * FROM bot_channel_messages
        WHERE platform = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [platform, Math.max(1, limit)]
    );
  return rows.reverse().map((row) => ({
    id: row.id,
    platform: row.platform,
    direction: row.direction,
    content: row.content,
    senderId: row.sender_id || undefined,
    platformMessageId: row.platform_message_id || undefined,
    route: row.route_json ? JSON.parse(row.route_json) : undefined,
    createdAt: row.created_at,
  }));
}

export async function getQqBotMessageList(limit: number): Promise<BotChannelMessage[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM bot_channel_messages AS message
      WHERE platform = 'qq'
        AND json_extract(route_json, '$.contactId') IS NOT NULL
        AND created_at = (
          SELECT MAX(latest.created_at)
          FROM bot_channel_messages AS latest
          WHERE latest.platform = 'qq'
            AND json_extract(latest.route_json, '$.contactId') = json_extract(message.route_json, '$.contactId')
        )
      ORDER BY created_at DESC
      LIMIT ?`,
    [Math.max(1, limit)]
  );
  return rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    direction: row.direction,
    content: row.content,
    senderId: row.sender_id || undefined,
    platformMessageId: row.platform_message_id || undefined,
    route: row.route_json ? JSON.parse(row.route_json) : undefined,
    createdAt: row.created_at,
  }));
}

export async function getLatestBotChannelMessage(
  platform: 'qq' | 'wechat',
  direction?: 'incoming' | 'outgoing'
): Promise<BotChannelMessage | null> {
  const db = await getDatabase();
  const row = direction
    ? await db.getFirstAsync<any>(
        `SELECT * FROM bot_channel_messages
          WHERE platform = ? AND direction = ?
          ORDER BY created_at DESC LIMIT 1`,
        [platform, direction]
      )
    : await db.getFirstAsync<any>(
        `SELECT * FROM bot_channel_messages
          WHERE platform = ?
          ORDER BY created_at DESC LIMIT 1`,
        [platform]
      );
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    direction: row.direction,
    content: row.content,
    senderId: row.sender_id || undefined,
    platformMessageId: row.platform_message_id || undefined,
    route: row.route_json ? JSON.parse(row.route_json) : undefined,
    createdAt: row.created_at,
  };
}
