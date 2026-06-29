import { DailyPaper, DailyPaperContent, DailyPaperSource } from '../types';

const DAILY_PAPER_CARD_PREFIX = '[YS_DAILY_PAPER_CARD]';
const DAILY_PAPER_CARD_SUFFIX = '[/YS_DAILY_PAPER_CARD]';

export interface DailyPaperCardPayload {
  kind: 'daily-paper';
  dateKey: string;
  title: string;
  summary: string;
  body: string;
  sourceCount: number;
  sources: Array<Pick<DailyPaperSource, 'title' | 'url' | 'sourceName' | 'category'>>;
}

function formatDailyPaperContent(content: DailyPaperContent): string {
  const lines = [
    content.masthead,
    content.headline,
    content.dek,
    '',
    ...content.sections.flatMap((section) => [
      `## ${section.title}`,
      ...section.items.map((item) => `- ${item}`),
      '',
    ]),
    content.editorial ? `今日短评：${content.editorial}` : '',
  ];
  return lines.filter((line, index, all) => line.trim() || all[index - 1]?.trim()).join('\n').trim();
}

function summarizeContent(content: DailyPaperContent): string {
  if (content.dek?.trim()) return content.dek.trim();
  const firstItem = content.sections.flatMap((section) => section.items)[0];
  return firstItem || content.headline || '点击查看完整日报';
}

export function buildDailyPaperCardPayload(paper: DailyPaper): DailyPaperCardPayload | null {
  if (!paper.content) return null;
  const body = formatDailyPaperContent(paper.content);
  return {
    kind: 'daily-paper',
    dateKey: paper.dateKey,
    title: paper.content.headline || paper.title || `${paper.dateKey} 日报`,
    summary: summarizeContent(paper.content),
    body,
    sourceCount: paper.sources.length,
    sources: paper.sources.slice(0, 80).map((source) => ({
      title: source.title,
      url: source.url,
      sourceName: source.sourceName,
      category: source.category,
    })),
  };
}

export function buildDailyPaperCardMessage(paper: DailyPaper): string {
  const payload = buildDailyPaperCardPayload(paper);
  if (!payload) {
    throw new Error('日报还没有可转发的正文');
  }
  return `${DAILY_PAPER_CARD_PREFIX}\n${JSON.stringify(payload)}\n${DAILY_PAPER_CARD_SUFFIX}`;
}

export function parseDailyPaperCardMessage(content: string): DailyPaperCardPayload | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith(DAILY_PAPER_CARD_PREFIX) || !trimmed.endsWith(DAILY_PAPER_CARD_SUFFIX)) {
    return null;
  }
  const raw = trimmed
    .slice(DAILY_PAPER_CARD_PREFIX.length, trimmed.length - DAILY_PAPER_CARD_SUFFIX.length)
    .trim();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.kind !== 'daily-paper' || typeof parsed.body !== 'string') return null;
    return {
      kind: 'daily-paper',
      dateKey: typeof parsed.dateKey === 'string' ? parsed.dateKey : '',
      title: typeof parsed.title === 'string' ? parsed.title : '每日日报',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      body: parsed.body,
      sourceCount: typeof parsed.sourceCount === 'number' ? parsed.sourceCount : 0,
      sources: Array.isArray(parsed.sources)
        ? parsed.sources
            .map((source: any) => ({
              title: typeof source?.title === 'string' ? source.title : '',
              url: typeof source?.url === 'string' ? source.url : '',
              sourceName: typeof source?.sourceName === 'string' ? source.sourceName : '',
              category: typeof source?.category === 'string' ? source.category : '',
            }))
            .filter((source: DailyPaperCardPayload['sources'][number]) => source.title || source.url)
        : [],
    };
  } catch {
    return null;
  }
}

export function formatDailyPaperCardForAi(content: string): string {
  const payload = parseDailyPaperCardMessage(content);
  if (!payload) return content;
  const sourceLines = payload.sources.map((source, index) =>
    `${index + 1}. ${source.title}${source.sourceName ? ` (${source.sourceName})` : ''}${source.url ? `\n   ${source.url}` : ''}`
  );
  return [
    `用户转发了一份每日日报：${payload.title}`,
    `日期：${payload.dateKey}`,
    '',
    '全文：',
    payload.body,
    '',
    sourceLines.length > 0 ? '来源：' : '',
    ...sourceLines,
  ].filter(Boolean).join('\n');
}
