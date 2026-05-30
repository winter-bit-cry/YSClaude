import { MemoryVaultConfig, WebSearchConfig } from '../stores/settings';

/* ====== Tool 定义（OpenAI function calling 格式） ====== */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

const MEMORY_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_memory_vault',
    description:
      '语义搜索记忆库。当用户提到过去的经历、回忆、或你需要回忆与用户相关的信息时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词或语义查询',
        },
      },
      required: ['query'],
    },
  },
};

const DIARY_QUERY_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'query_diary',
    description:
      '查询指定日期的日记内容。当用户询问某一天发生了什么、或需要查看特定日期的记录时使用。',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: '日期，格式为 YYYY-MM-DD',
        },
      },
      required: ['date'],
    },
  },
};

const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '搜索互联网获取最新信息。当用户询问新闻、实时信息、或你不确定的事实时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询词',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * 根据启用状态返回 tool 定义列表
 */
export function getToolDefinitions(config: {
  memoryVault: boolean;
  webSearch: boolean;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (config.memoryVault) {
    tools.push(MEMORY_SEARCH_TOOL, DIARY_QUERY_TOOL);
  }
  if (config.webSearch) {
    tools.push(WEB_SEARCH_TOOL);
  }
  return tools;
}

/* ====== Tool 执行 ====== */

/**
 * 执行指定工具并返回结果文本
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  settings: {
    memoryVaultConfig: MemoryVaultConfig;
    webSearchConfig: WebSearchConfig;
  }
): Promise<string> {
  try {
    switch (toolName) {
      case 'search_memory_vault':
        return await executeMemorySearch(args.query, settings.memoryVaultConfig);
      case 'query_diary':
        return await executeDiaryQuery(args.date, settings.memoryVaultConfig);
      case 'web_search':
        return await executeWebSearch(args.query, settings.webSearchConfig);
      default:
        return `未知工具: ${toolName}`;
    }
  } catch (err: any) {
    return `工具执行失败: ${err.message || '未知错误'}`;
  }
}

/* ------ 记忆库：语义搜索 ------ */

async function executeMemorySearch(
  query: string,
  config: MemoryVaultConfig
): Promise<string> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams({
    query,
    top_k: String(config.topK),
    token_budget: String(config.tokenBudget),
  });

  const resp = await fetch(`${baseUrl}/api/search?${params}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!resp.ok) {
    throw new Error(`记忆库搜索失败: HTTP ${resp.status}`);
  }

  const data = await resp.json();

  // 格式化结果（记忆库返回 { items: [...], used_tokens }）
  const items = data.items || [];
  if (items.length === 0) {
    return '未找到相关记忆。';
  }

  const lines: string[] = [`找到 ${items.length} 条相关记忆：\n`];
  for (const item of items) {
    const date = item.date || '未知日期';
    // 优先使用原文，回退到摘要
    const content = item.original || item.summary || '';
    const tags = Array.isArray(item.tags) && item.tags.length > 0 ? ` #${item.tags.join(' #')}` : '';
    const score = item.score != null ? ` (相关度: ${(item.score * 100).toFixed(0)}%)` : '';
    lines.push(`【${date}】${score}${tags}\n${content}\n`);
  }
  return lines.join('\n');
}

/* ------ 记忆库：日记查询 ------ */

async function executeDiaryQuery(
  date: string,
  config: MemoryVaultConfig
): Promise<string> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');

  const resp = await fetch(`${baseUrl}/api/diary/${date}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!resp.ok) {
    if (resp.status === 404) {
      return `未找到 ${date} 的日记。`;
    }
    throw new Error(`日记查询失败: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const content =
    data.content || data.text || data.diary || data.body || JSON.stringify(data);
  return `【${date} 的日记】\n${content}`;
}

/* ------ 记忆库：上传日记（管理接口，需 adminToken） ------ */

/**
 * 上传一篇日记到云端记忆库。
 * 调用管理接口 POST /api/diary，需 Authorization: Bearer <adminToken>。
 * 仅保存原文，不自动 LLM 拆分。
 */
export async function uploadDiary(
  date: string,
  content: string,
  config: MemoryVaultConfig
): Promise<void> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('未配置记忆库地址');
  }
  if (!config.adminToken) {
    throw new Error('未配置管理员 Token，请在「Tool 设置」中填写');
  }

  const resp = await fetch(`${baseUrl}/api/diary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.adminToken}`,
    },
    body: JSON.stringify({ date, content }),
  });

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('认证失败：管理员 Token 不正确');
    }
    const text = await resp.text().catch(() => '');
    throw new Error(`上传失败: HTTP ${resp.status}${text ? ` - ${text.slice(0, 200)}` : ''}`);
  }
}

/* ------ 联网搜索：Tavily ------ */

async function executeWebSearch(
  query: string,
  config: WebSearchConfig
): Promise<string> {
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      max_results: config.maxResults,
      api_key: config.tavilyApiKey,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Tavily 搜索失败: HTTP ${resp.status} - ${text.slice(0, 200)}`);
  }

  const data = await resp.json();

  if (!data.results || data.results.length === 0) {
    return '未找到相关搜索结果。';
  }

  const lines: string[] = [`搜索到 ${data.results.length} 条结果：\n`];
  for (const item of data.results) {
    const title = item.title || '无标题';
    const url = item.url || '';
    const content = item.content || '';
    lines.push(`### ${title}\n${url}\n${content}\n`);
  }
  return lines.join('\n');
}
