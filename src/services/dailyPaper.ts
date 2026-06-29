import { randomUUID } from 'expo-crypto';
import { XMLParser } from 'fast-xml-parser';
import { chatCompletion } from './api';
import {
  getDailyPaperByDate,
  updateDailyPaper,
  upsertDailyPaper,
} from '../db/operations';
import {
  DailyPaper,
  DailyPaperContent,
  DailyPaperSource,
} from '../types';
import type { DailyPaperConfig, DailyPaperSourceConfig, NamedAPIConfig } from '../stores/settings';

export interface RssSourceConfig {
  name: string;
  url: string;
  category: string;
  language: string;
}

interface RssItem {
  title: string;
  link: string;
  summary: string;
  publishedAt?: string;
  sourceName: string;
  category: string;
}

export const DAILY_PAPER_RSS_SOURCES: RssSourceConfig[] = [
  {
    name: 'BBC World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    category: 'global politics',
    language: 'en',
  },
  {
    name: 'BBC Business',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    category: 'economy',
    language: 'en',
  },
  {
    name: 'NPR World',
    url: 'https://feeds.npr.org/1004/rss.xml',
    category: 'global politics',
    language: 'en',
  },
  {
    name: 'NASA Breaking News',
    url: 'https://www.nasa.gov/news-release/feed/',
    category: 'technology',
    language: 'en',
  },
  {
    name: 'MIT News',
    url: 'https://news.mit.edu/rss/topic/artificial-intelligence2',
    category: 'technology',
    language: 'en',
  },
  {
    name: 'UN News',
    url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
    category: 'global politics',
    language: 'en',
  },
];

const RSS_TIMEOUT_MS = 12000;
const MAX_ITEMS_PER_SOURCE = 12;
const MAX_ITEMS_FOR_PROMPT = 50;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    if (typeof value['#text'] === 'string') return value['#text'].trim();
    if (typeof value._text === 'string') return value._text.trim();
  }
  return '';
}

function pickLink(item: any): string {
  const rawLink = item?.link;
  if (typeof rawLink === 'string') return rawLink.trim();
  if (Array.isArray(rawLink)) {
    const atom = rawLink.find((entry) => entry?.['@_href']);
    if (atom?.['@_href']) return String(atom['@_href']).trim();
    const text = rawLink.map(textValue).find(Boolean);
    if (text) return text;
  }
  if (rawLink?.['@_href']) return String(rawLink['@_href']).trim();
  if (item?.guid) return textValue(item.guid);
  return '';
}

function parseItemDate(item: any): string | undefined {
  const raw =
    textValue(item?.pubDate) ||
    textValue(item?.published) ||
    textValue(item?.updated) ||
    textValue(item?.['dc:date']) ||
    textValue(item?.date);
  if (!raw) return undefined;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : raw;
}

function isItemInDateWindow(item: RssItem, dateKey: string): boolean {
  if (!item.publishedAt) return dateKey === dateKeyForToday();
  const time = Date.parse(item.publishedAt);
  if (!Number.isFinite(time)) return dateKey === dateKeyForToday();
  const target = dateFromKey(dateKey);
  const start = target.getTime();
  const end = addDays(target, 1).getTime();
  return time >= start && time < end;
}

function dateKeyForToday(): string {
  return dateKey(new Date());
}

async function fetchRssSource(source: RssSourceConfig): Promise<RssItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);
  try {
    const resp = await fetch(source.url, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'YSClaude/1.0 DailyPaper RSS Reader',
      },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`${source.name} RSS HTTP ${resp.status}`);
    const text = await resp.text();
    const parsed = parser.parse(text);
    const channel = parsed?.rss?.channel || parsed?.feed || parsed;
    const items = asArray(channel?.item || channel?.entry);
    return items.slice(0, MAX_ITEMS_PER_SOURCE).map((item) => {
      const title = stripHtml(textValue(item?.title));
      const summary = stripHtml(
        textValue(item?.description) ||
        textValue(item?.summary) ||
        textValue(item?.content) ||
        textValue(item?.['content:encoded'])
      );
      return {
        title,
        link: pickLink(item),
        summary,
        publishedAt: parseItemDate(item),
        sourceName: source.name,
        category: source.category,
      };
    }).filter((item) => item.title && item.link);
  } finally {
    clearTimeout(timeout);
  }
}

async function collectRssItems(dateKey: string, sources: RssSourceConfig[]): Promise<RssItem[]> {
  const settled = await Promise.allSettled(sources.map(fetchRssSource));
  const seen = new Set<string>();
  const items: RssItem[] = [];

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      if (!isItemInDateWindow(item, dateKey)) continue;
      const key = item.link.toLowerCase().replace(/[?#].*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  return items.slice(0, MAX_ITEMS_FOR_PROMPT);
}

function customSourceToRssSource(source: DailyPaperSourceConfig): RssSourceConfig {
  return {
    name: source.name,
    url: source.url,
    category: source.category || 'general',
    language: source.language || 'zh',
  };
}

function getDailyPaperRssSources(config?: DailyPaperConfig): RssSourceConfig[] {
  const sources = config?.useDefaultSources === false ? [] : [...DAILY_PAPER_RSS_SOURCES];
  const customSources = (config?.customSources || [])
    .filter((source) => source.enabled !== false && source.url.trim())
    .map(customSourceToRssSource);
  return [...sources, ...customSources];
}

function fallbackContent(dateKey: string, items: RssItem[]): DailyPaperContent {
  const groups = new Map<string, RssItem[]>();
  for (const item of items) {
    const current = groups.get(item.category) || [];
    current.push(item);
    groups.set(item.category, current);
  }
  return {
    masthead: 'YS Daily',
    headline: `${dateKey} 日报`,
    dek: '基于个人 RSS 新闻源生成的新闻速览。',
    sections: [...groups.entries()].map(([title, group]) => ({
      title,
      items: group.slice(0, 5).map((item) => `${item.title}${item.summary ? `：${item.summary}` : ''}`),
    })),
    editorial: '这份日报仅用于个人阅读，重点保留来源链接，避免替代原始报道。',
    generatedFrom: 'RSS',
  };
}

function sourcesFromItems(items: RssItem[]): DailyPaperSource[] {
  return items.map((item) => ({
    title: item.title,
    url: item.link,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    category: item.category,
  }));
}

function extractJsonObject(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeGeneratedContent(raw: any, dateKey: string, items: RssItem[]): DailyPaperContent {
  const fallback = fallbackContent(dateKey, items);
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    masthead: typeof raw.masthead === 'string' && raw.masthead.trim() ? raw.masthead.trim() : fallback.masthead,
    headline: typeof raw.headline === 'string' && raw.headline.trim() ? raw.headline.trim() : fallback.headline,
    dek: typeof raw.dek === 'string' ? raw.dek.trim() : fallback.dek,
    sections: Array.isArray(raw.sections)
      ? raw.sections
          .map((section: any) => ({
            title: typeof section?.title === 'string' ? section.title.trim() : '',
            items: Array.isArray(section?.items)
              ? section.items.map((item: unknown) => String(item).trim()).filter(Boolean)
              : [],
          }))
          .filter((section: DailyPaperContent['sections'][number]) => section.title && section.items.length > 0)
      : fallback.sections,
    editorial: typeof raw.editorial === 'string' ? raw.editorial.trim() : fallback.editorial,
    generatedFrom: 'RSS + AI',
  };
}

async function generateContentWithAi(
  dateKey: string,
  items: RssItem[],
  apiConfig: NamedAPIConfig,
  maxOutputTokens: number | null
): Promise<DailyPaperContent> {
  const itemText = items.map((item, index) => [
    `${index + 1}. ${item.title}`,
    `source: ${item.sourceName}`,
    `category: ${item.category}`,
    item.publishedAt ? `publishedAt: ${item.publishedAt}` : '',
    `url: ${item.link}`,
    item.summary ? `summary: ${item.summary}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  const response = await chatCompletion({
    baseUrl: apiConfig.baseUrl,
    apiKey: apiConfig.apiKey,
    model: apiConfig.model,
    temperature: apiConfig.temperature ?? 0.4,
    maxTokens: maxOutputTokens ?? 1800,
    usageContext: {
      feature: 'daily-paper',
      requestKind: 'daily-paper-generate',
      metadata: { dateKey, rssItemCount: items.length },
    },
    messages: [
      {
        role: 'system',
        content:
          '你是一个谨慎的日报编辑。只能根据用户提供的 RSS 条目写作，不得编造未出现的事实。输出必须是 JSON 对象，不要 Markdown，不要代码块。',
      },
      {
        role: 'user',
        content: [
          `为 ${dateKey} 生成一份个人阅读用日报。`,
          '方向以全球政治、经济、军事/地缘、科技为主。',
          '要求：',
          '1. 用中文写作。',
          '2. 不复刻原文，不写长篇转载，只做摘要和编辑整理。',
          '3. 每个要点尽量保留来源名。',
          '4. 如果军事信息不足，就写成“军事与地缘”。',
          '5. 输出 JSON，结构为：{"masthead":"","headline":"","dek":"","sections":[{"title":"","items":[""]}],"editorial":"","generatedFrom":"RSS + AI"}',
          '',
          'RSS 条目：',
          itemText,
        ].join('\n'),
      },
    ],
  });

  const content = response.choices?.[0]?.message?.content || '';
  return normalizeGeneratedContent(extractJsonObject(content), dateKey, items);
}

export async function ensureDailyPaperDraft(dateKey: string): Promise<DailyPaper> {
  const existing = await getDailyPaperByDate(dateKey);
  if (existing) return existing;
  const now = Date.now();
  const paper: DailyPaper = {
    id: randomUUID(),
    dateKey,
    title: `${dateKey} 日报`,
    status: 'draft',
    content: null,
    sources: [],
    generatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await upsertDailyPaper(paper);
  return paper;
}

export async function generateDailyPaper(
  dateKey: string,
  apiConfig: NamedAPIConfig,
  maxOutputTokens: number | null,
  dailyPaperConfig?: DailyPaperConfig
): Promise<DailyPaper> {
  const draft = await ensureDailyPaperDraft(dateKey);
  await updateDailyPaper(dateKey, {
    status: 'generating',
    updatedAt: Date.now(),
    errorMessage: '',
  });

  try {
    const sources = getDailyPaperRssSources(dailyPaperConfig);
    if (sources.length === 0) {
      throw new Error('请先在设置中启用至少一个日报新闻来源。');
    }
    const items = await collectRssItems(dateKey, sources);
    if (items.length === 0) {
      throw new Error('没有从 RSS 源获取到可用于生成日报的新闻条目。');
    }
    const content = await generateContentWithAi(dateKey, items, apiConfig, maxOutputTokens);
    const now = Date.now();
    await updateDailyPaper(dateKey, {
      title: content.headline || `${dateKey} 日报`,
      status: 'ready',
      content,
      sources: sourcesFromItems(items),
      generatedAt: now,
      updatedAt: now,
      errorMessage: '',
    });
    return (await getDailyPaperByDate(dateKey)) || {
      ...draft,
      title: content.headline,
      status: 'ready',
      content,
      sources: sourcesFromItems(items),
      generatedAt: now,
      updatedAt: now,
    };
  } catch (error: any) {
    await updateDailyPaper(dateKey, {
      status: 'failed',
      updatedAt: Date.now(),
      errorMessage: error?.message || String(error),
    });
    throw error;
  }
}
