import { MemoryVaultConfig } from '../../stores/settings';
import { randomUUID } from 'expo-crypto';
import { createDiary } from '../../db/operations';
import { formatDateOnly } from '../../utils/time';
import {
  getLocalDiaryByDate,
  keywordSearchLocalMemories,
  saveLocalMemory,
  searchLocalMemoriesWithConfig,
  splitDiaryToLocalMemories,
} from '../localMemoryVault';
import { ToolDefinition, ToolModule } from './types';

const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_memory_vault',
      description: '搜索保存在设备本地的长期记忆。需要回忆用户经历、偏好或过去信息时使用。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '语义或自然语言查询' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'keyword_search_memory_vault',
      description: '按明确名称、摘要或原文关键词搜索设备本地记忆。',
      parameters: {
        type: 'object',
        properties: { keywords: { type: 'string', description: '空格分隔的关键词' } },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_diary',
      description: '从设备本地日记中查询指定日期的内容。',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_diary',
      description: '在设备本地新增一篇日记。仅在用户明确要求记录或添加日记时使用。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '日记标题，可选' },
          content: { type: 'string', description: '日记正文' },
          date: { type: 'string', description: '日记所属日期，格式 YYYY-MM-DD；省略时使用今天' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: '把值得长期保留且用户明确提供的信息保存到设备本地记忆库。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '简洁、可独立理解的记忆摘要' },
          original: { type: 'string', description: '产生这条记忆的原始信息' },
          date: { type: 'string', description: 'YYYY-MM-DD；省略时使用今天' },
        },
        required: ['summary'],
      },
    },
  },
];

function formatMemories(items: Array<{
  date: string;
  original: string;
  summary: string;
  score: number;
}>): string {
  if (!items.length) return '未找到相关记忆。';
  return items
    .map((item) => {
      const content = item.original || item.summary;
      return `【${item.date || '未知日期'}】(相关度 ${(item.score * 100).toFixed(0)}%)\n${content}`;
    })
    .join('\n\n');
}

export const memoryVaultTool: ToolModule = {
  id: 'memory-vault',
  labels: {
    search_memory_vault: '搜索本地记忆',
    keyword_search_memory_vault: '关键词搜索本地记忆',
    query_diary: '查询本地日记',
    add_diary: '添加本地日记',
    save_memory: '保存本地记忆',
  },
  getDefinitions: (config) => {
    if (!config.memoryVault) return [];
    const memoryConfig = config.memoryVaultConfig;
    const enabledByName: Record<string, boolean> = {
      search_memory_vault: memoryConfig?.searchMemoryEnabled !== false,
      keyword_search_memory_vault: memoryConfig?.keywordSearchMemoryEnabled !== false,
      query_diary: memoryConfig?.queryDiaryEnabled !== false,
      save_memory: memoryConfig?.saveMemoryEnabled !== false,
      add_diary: memoryConfig?.addDiaryEnabled !== false,
    };
    return definitions.filter((definition) => enabledByName[definition.function.name]);
  },
  execute: async (toolName, args, context) => {
    const topK = context.memoryVaultConfig.topK || 5;
    switch (toolName) {
      case 'search_memory_vault':
        return formatMemories(
          await searchLocalMemoriesWithConfig(String(args.query || ''), {
            ...context.memoryVaultConfig,
            topK,
          })
        );
      case 'keyword_search_memory_vault':
        return formatMemories(
          await keywordSearchLocalMemories(String(args.keywords || args.query || ''), topK)
        );
      case 'query_diary': {
        const date = String(args.date || '');
        const content = await getLocalDiaryByDate(date);
        return content ? `【${date} 的日记】\n${content}` : `未找到 ${date} 的日记。`;
      }
      case 'add_diary': {
        const content = String(args.content || '').trim();
        if (!content) return '添加失败：日记正文不能为空。';
        const date = args.date ? String(args.date).trim() : formatDateOnly(Date.now());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T12:00:00`).getTime())) {
          return '添加失败：日期格式应为 YYYY-MM-DD。';
        }
        const now = Date.now();
        await createDiary({
          id: randomUUID(),
          title: String(args.title || '').trim() || `日记 ${date}`,
          content,
          date,
          isFavorite: false,
          createdAt: now,
          updatedAt: now,
        });
        return `已添加 ${date} 的本地日记。`;
      }
      case 'save_memory': {
        const summary = String(args.summary || '').trim();
        if (!summary) return '保存失败：记忆摘要不能为空。';
        const { generateMemoryEmbedding } = await import('../localMemoryVault');
        const embedding = await generateMemoryEmbedding(summary, context.memoryVaultConfig);
        await saveLocalMemory({
          summary,
          original: String(args.original || summary),
          date: args.date ? String(args.date) : undefined,
          embedding,
          embeddingModel: context.memoryVaultConfig.embeddingModel,
        });
        return '已保存到设备本地记忆库。';
      }
      default:
        return undefined;
    }
  },
};

export async function uploadDiary(
  date: string,
  content: string,
  config: MemoryVaultConfig
): ReturnType<typeof splitDiaryToLocalMemories> {
  return splitDiaryToLocalMemories(date, content, config);
}
