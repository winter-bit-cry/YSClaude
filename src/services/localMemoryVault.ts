import { randomUUID } from 'expo-crypto';
import { File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getDatabase } from '../db/database';
import type { MemoryVaultConfig } from '../stores/settings';

export interface LocalMemory {
  id: string;
  summary: string;
  original: string;
  date: string;
  embedding?: number[];
  active: boolean;
}

interface MemoryRow {
  id: string;
  summary: string;
  original: string;
  date: string;
  embedding_json: string | null;
  active: number;
}

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRow(row: MemoryRow): LocalMemory {
  return {
    id: row.id,
    summary: row.summary,
    original: row.original,
    date: row.date,
    embedding: parseJsonArray<number>(row.embedding_json),
    active: row.active === 1,
  };
}

function terms(text: string): string[] {
  const normalized = text.toLocaleLowerCase().trim();
  if (!normalized) return [];
  const latin = normalized.match(/[a-z0-9_]{2,}/g) || [];
  const cjk = normalized.match(/[\u3400-\u9fff]/g) || [];
  const cjkPairs = cjk.slice(0, -1).map((char, index) => char + cjk[index + 1]);
  return [...new Set([...latin, ...cjk, ...cjkPairs])];
}

function textScore(query: string, memory: LocalMemory): number {
  const queryTerms = terms(query);
  if (!queryTerms.length) return 0;
  const summary = memory.summary.toLocaleLowerCase();
  const original = memory.original.toLocaleLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (summary.includes(term)) score += 3;
    if (original.includes(term)) score += 1;
  }
  return score / (queryTerms.length * 4);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export async function generateMemoryEmbedding(
  text: string,
  config: MemoryVaultConfig
): Promise<number[] | undefined> {
  if (!text.trim() || !config.embeddingApiKey.trim()) return undefined;
  if (config.embeddingProvider === 'google') {
    const model = config.embeddingModel.trim() || 'gemini-embedding-001';
    const modelPath = model.startsWith('models/') ? model : `models/${model}`;
    const baseUrl = cleanBaseUrl(config.embeddingBaseUrl) || 'https://generativelanguage.googleapis.com';
    const response = await fetch(`${baseUrl}/v1beta/${modelPath}:embedContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.embeddingApiKey.trim(),
      },
      body: JSON.stringify({
        model: modelPath,
        content: { parts: [{ text }] },
      }),
    });
    if (!response.ok) throw new Error(`Google Embedding 调用失败：HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data?.embedding?.values) ? data.embedding.values : undefined;
  }
  const baseUrl = cleanBaseUrl(config.embeddingBaseUrl);
  if (!baseUrl) throw new Error('请配置 Embedding API 地址');
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.embeddingApiKey.trim()}`,
    },
    body: JSON.stringify({ input: [text], model: config.embeddingModel.trim() }),
  });
  if (!response.ok) throw new Error(`OpenAI Embedding 调用失败：HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.data?.[0]?.embedding) ? data.data[0].embedding : undefined;
}

export async function saveLocalMemory(input: {
  id?: string;
  summary: string;
  original?: string;
  date?: string;
  embedding?: number[];
  embeddingModel?: string;
  active?: boolean;
}): Promise<string> {
  const database = await getDatabase();
  const id = input.id || randomUUID();
  const now = Date.now();
  await database.runAsync(
    `INSERT INTO memory_items
       (id, summary, original, date, embedding_json, embedding_model, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       summary = excluded.summary, original = excluded.original, date = excluded.date,
       embedding_json = excluded.embedding_json,
       embedding_model = excluded.embedding_model, active = excluded.active, updated_at = excluded.updated_at`,
    [
      id,
      input.summary.trim(),
      (input.original || input.summary).trim(),
      input.date || new Date().toISOString().slice(0, 10),
      input.embedding?.length ? JSON.stringify(input.embedding) : null,
      input.embeddingModel || null,
      input.active === false ? 0 : 1,
      now,
      now,
    ]
  );
  return id;
}

export async function searchLocalMemories(
  query: string,
  topK = 5,
  queryEmbedding?: number[]
): Promise<Array<LocalMemory & { score: number }>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<MemoryRow>(
    'SELECT id, summary, original, date, embedding_json, active FROM memory_items WHERE active = 1'
  );
  return rows
    .map(mapRow)
    .map((memory) => {
      const vectorScore =
        queryEmbedding?.length && memory.embedding?.length
          ? cosineSimilarity(queryEmbedding, memory.embedding)
          : 0;
      return { ...memory, score: Math.max(vectorScore, textScore(query, memory)) };
    })
    .filter((memory) => memory.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));
}

export async function searchLocalMemoriesWithConfig(
  query: string,
  config: MemoryVaultConfig
): Promise<Array<LocalMemory & { score: number }>> {
  const embedding = await generateMemoryEmbedding(query, config);
  return searchLocalMemories(query, config.topK || 5, embedding);
}

export async function keywordSearchLocalMemories(
  keywords: string,
  topK = 5
): Promise<Array<LocalMemory & { score: number }>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<MemoryRow>(
    'SELECT id, summary, original, date, embedding_json, active FROM memory_items WHERE active = 1'
  );
  const needles = keywords.toLocaleLowerCase().split(/[\s,，]+/).filter(Boolean);
  return rows
    .map(mapRow)
    .filter((memory) => {
      const haystack = `${memory.summary}\n${memory.original}`.toLocaleLowerCase();
      return needles.some((needle) => haystack.includes(needle));
    })
    .slice(0, Math.max(1, topK))
    .map((memory) => ({ ...memory, score: 1 }));
}

export async function listLocalMemories(): Promise<LocalMemory[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<MemoryRow>(
    `SELECT id, summary, original, date, embedding_json, active
       FROM memory_items ORDER BY date DESC, updated_at DESC`
  );
  return rows.map(mapRow);
}

export async function updateLocalMemory(
  id: string,
  updates: Partial<Pick<LocalMemory, 'summary' | 'original' | 'date' | 'active'>>,
  config?: MemoryVaultConfig
): Promise<void> {
  const current = (await listLocalMemories()).find((item) => item.id === id);
  if (!current) throw new Error('记忆不存在');
  const summary = updates.summary ?? current.summary;
  const summaryChanged = summary !== current.summary;
  const embedding = summaryChanged && config
    ? await generateMemoryEmbedding(summary, config)
    : current.embedding;
  await saveLocalMemory({
    id,
    summary,
    original: updates.original ?? current.original,
    date: updates.date ?? current.date,
    active: updates.active ?? current.active,
    embedding,
    embeddingModel: config?.embeddingModel,
  });
}

export async function deleteLocalMemory(id: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM memory_items WHERE id = ?', [id]);
}

export async function getLocalDiaryByDate(date: string): Promise<string | null> {
  const database = await getDatabase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const rows = await database.getAllAsync<{ title: string; content: string }>(
    `SELECT title, content FROM diaries
      WHERE date_key = ?
      ORDER BY created_at ASC`,
    [date]
  );
  if (!rows.length) return null;
  return rows.map((row) => [row.title, row.content].filter(Boolean).join('\n')).join('\n\n');
}

export async function importMemoryVaultData(data: unknown): Promise<{
  importedMemories: number;
  importedDiaries: number;
}> {
  const payload = data as { memories?: any[]; diaries?: any[] };
  let importedMemories = 0;
  let importedDiaries = 0;
  for (const memory of payload?.memories || []) {
    if (!memory?.summary) continue;
    await saveLocalMemory({
      id: memory.id,
      summary: memory.summary,
      original: memory.original,
      date: memory.date,
      embedding: Array.isArray(memory.embedding) ? memory.embedding : undefined,
      active: memory.active !== false && memory.active !== 'false',
    });
    importedMemories += 1;
  }
  const database = await getDatabase();
  for (const diary of payload?.diaries || []) {
    if (!diary?.date || !diary?.content) continue;
    const timestamp = Number(diary.created_at) || new Date(`${diary.date}T12:00:00`).getTime();
    const result = await database.runAsync(
      `INSERT OR IGNORE INTO diaries (id, title, content, date_key, is_favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [
        diary.id || `memory-vault:${diary.date}`,
        diary.title || diary.date,
        diary.content,
        diary.date,
        timestamp,
        Number(diary.updated_at) || timestamp,
      ]
    );
    if (result.changes > 0) importedDiaries += 1;
  }
  return { importedMemories, importedDiaries };
}

export async function exportMemoryVaultData(): Promise<{
  version: number;
  memories_count: number;
  diaries_count: number;
  memories: Array<Record<string, unknown>>;
  diaries: Array<Record<string, unknown>>;
}> {
  const database = await getDatabase();
  const memories = (await listLocalMemories()).map((item) => ({
    id: item.id,
    summary: item.summary,
    original: item.original,
    date: item.date,
    type: 'memory',
    active: item.active ? 'true' : 'false',
    embedding: item.embedding?.length ? item.embedding : null,
  }));
  const diaryRows = await database.getAllAsync<{
    id: string;
    title: string;
    content: string;
    created_at: number;
    updated_at: number;
    date_key: string;
  }>('SELECT id, title, content, date_key, created_at, updated_at FROM diaries ORDER BY created_at DESC');
  const diaries = diaryRows.map((item) => ({
    id: item.id,
    date: item.date_key,
    title: item.title,
    content: item.content,
    preview: item.content.slice(0, 100),
    created_at: item.created_at,
    updated_at: item.updated_at,
  }));
  return {
    version: 1,
    memories_count: memories.length,
    diaries_count: diaries.length,
    memories,
    diaries,
  };
}

export async function pickAndImportMemoryVaultData(): Promise<{
  importedMemories: number;
  importedDiaries: number;
} | null> {
  const picked = await File.pickFileAsync({
    mimeTypes: ['application/json', 'text/json', '*/*'],
    multipleFiles: false,
  });
  if (picked.canceled || !picked.result) return null;
  // Android SAF providers expose content:// handles whose descriptors are not
  // reliably seekable/readable across repeated readBytes calls. Copy through
  // the native file-system layer first (streaming, without materializing the
  // whole JSON in JS), then parse the stable file:// cache copy in chunks.
  const cached = new File(Paths.cache, `memory-import-${randomUUID()}.json`);
  await picked.result.copy(cached, { overwrite: true });
  try {
    return await importMemoryVaultFileStreaming(cached);
  } finally {
    if (cached.exists) cached.delete();
  }
}

async function importMemoryVaultFileStreaming(file: File): Promise<{
  importedMemories: number;
  importedDiaries: number;
}> {
  const handle = file.open(FileMode.ReadOnly);
  const decoder = new TextDecoder('utf-8');
  const database = await getDatabase();
  let importedMemories = 0;
  let importedDiaries = 0;
  let currentArray: 'memories' | 'diaries' | null = null;
  let pendingArray: 'memories' | 'diaries' | null = null;
  let recent = '';
  let objectText = '';
  let objectDepth = 0;
  let inString = false;
  let escaped = false;

  const importObject = async (kind: 'memories' | 'diaries', raw: string) => {
    const item = JSON.parse(raw) as any;
    if (kind === 'memories') {
      if (!item?.summary) return;
      await saveLocalMemory({
        id: item.id,
        summary: item.summary,
        original: item.original,
        date: item.date,
        embedding: Array.isArray(item.embedding) ? item.embedding : undefined,
        active: item.active !== false && item.active !== 'false',
      });
      importedMemories += 1;
      return;
    }
    if (!item?.date || typeof item.content !== 'string') return;
    const timestamp = Number(item.created_at) || new Date(`${item.date}T12:00:00`).getTime();
    const result = await database.runAsync(
      `INSERT OR IGNORE INTO diaries (id, title, content, date_key, is_favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [
        item.id || `memory-vault:${item.date}`,
        item.title || item.date,
        item.content,
        item.date,
        timestamp,
        Number(item.updated_at) || timestamp,
      ]
    );
    if (result.changes > 0) importedDiaries += 1;
  };

  const consume = async (chunk: string) => {
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (!currentArray) {
        recent = (recent + char).slice(-32);
        if (recent.includes('"memories"')) pendingArray = 'memories';
        if (recent.includes('"diaries"')) pendingArray = 'diaries';
        if (pendingArray && char === '[') {
          currentArray = pendingArray;
          pendingArray = null;
          recent = '';
        }
        continue;
      }

      if (objectDepth === 0) {
        if (char === '{') {
          objectText = '{';
          objectDepth = 1;
          inString = false;
          escaped = false;
        } else if (char === ']') {
          currentArray = null;
          recent = '';
        }
        continue;
      }

      objectText += char;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        objectDepth += 1;
      } else if (char === '}') {
        objectDepth -= 1;
        if (objectDepth === 0) {
          const completed = objectText;
          objectText = '';
          await importObject(currentArray, completed);
        }
      }
    }
  };

  try {
    while (true) {
      const bytes = handle.readBytes(256 * 1024);
      if (!bytes.length) break;
      await consume(decoder.decode(bytes, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) await consume(tail);
    if (objectDepth !== 0) throw new Error('导入文件不完整：JSON 对象未正常结束');
  } finally {
    handle.close();
  }
  return { importedMemories, importedDiaries };
}

export async function exportAndShareMemoryVaultData(): Promise<string> {
  const payload = await exportMemoryVaultData();
  const file = new File(Paths.cache, `ysclaude-memory-${new Date().toISOString().slice(0, 10)}.json`);
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(payload, null, 2));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: '导出 YSClaude 记忆数据',
      mimeType: 'application/json',
      UTI: 'public.json',
    });
  }
  return file.uri;
}

const DIARY_SPLIT_PROMPT = `你是一个记忆整理助手。请把日记拆分成独立、有意义的长期记忆条目。
每个条目包含 summary（简洁摘要）、original（对应原文）和 date（YYYY-MM-DD）。
不要遗漏重要信息，合并相近内容，总数不超过 15 条。只返回 JSON 数组，不要返回解释或 Markdown。`;

export interface LocalMemoryDraft {
  summary: string;
  original: string;
  date: string;
}

function extractJsonArray(raw: string): unknown[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('日记拆分 API 没有返回 JSON 数组');
  return parsed;
}

export async function splitDiaryToLocalMemories(
  date: string,
  content: string,
  config: MemoryVaultConfig
): Promise<LocalMemoryDraft[]> {
  if (!config.splitApiKey.trim()) throw new Error('请先配置日记拆分 API Key');
  const baseUrl = cleanBaseUrl(config.splitBaseUrl);
  if (!baseUrl || !config.splitModel.trim()) throw new Error('日记拆分 API 配置不完整');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.splitApiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.splitModel.trim(),
      temperature: 0.3,
      messages: [
        { role: 'system', content: DIARY_SPLIT_PROMPT },
        { role: 'user', content: `日记日期：${date}\n\n日记内容：\n${content}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`日记拆分 API 调用失败：HTTP ${response.status}`);
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') throw new Error('日记拆分 API 返回内容为空');
  return extractJsonArray(raw).slice(0, 15).flatMap((value) => {
    const item = value as Record<string, unknown>;
    const summary = String(item.summary || '').trim();
    if (!summary) return [];
    return [{
      summary,
      original: String(item.original || summary).trim(),
      date: String(item.date || date).trim(),
    }];
  });
}

export async function saveLocalMemoryDrafts(
  drafts: LocalMemoryDraft[],
  config: MemoryVaultConfig
): Promise<number> {
  let saved = 0;
  for (const draft of drafts) {
    const summary = draft.summary.trim();
    if (!summary) continue;
    const embedding = await generateMemoryEmbedding(summary, config);
    await saveLocalMemory({
      summary,
      original: draft.original.trim() || summary,
      date: draft.date.trim(),
      embedding,
      embeddingModel: config.embeddingModel,
    });
    saved += 1;
  }
  return saved;
}
