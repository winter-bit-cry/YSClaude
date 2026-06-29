import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ToolInvocation } from '../types';
import { useThemeColors, type ThemeColors } from '../theme/colors';
import { fonts } from '../theme/fonts';

interface FishingLogPanelProps {
  invocations?: ToolInvocation[];
}

interface FishingLogEntry {
  key: string;
  title: string;
  detail: string;
  status: 'running' | 'done';
  state?: FishingState | null;
}

interface FishingState {
  pts?: number;
  loc?: string;
  sea?: string;
  turn?: number;
  enc?: string;
  bait?: Record<string, number>;
  hold?: number;
  map_frag?: string;
  oxygen?: number;
  chest?: number;
}

const VISIBLE_ENTRY_COUNT = 4;

export function FishingLogPanel({ invocations }: FishingLogPanelProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const entries = useMemo(() => buildFishingEntries(invocations), [invocations]);

  if (entries.length === 0) return null;

  const latestState = [...entries].reverse().find((entry) => entry.state)?.state;
  const visibleEntries = expanded ? entries : entries.slice(Math.max(0, entries.length - VISIBLE_ENTRY_COUNT));
  const hiddenCount = Math.max(0, entries.length - visibleEntries.length);

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <View style={styles.headerTextBlock}>
          <Text style={styles.kicker}>钓鱼实况</Text>
          <Text style={styles.title} numberOfLines={1}>
            {formatPlace(latestState)}
          </Text>
        </View>
        <View style={styles.scorePill}>
          <Text style={styles.scoreText}>{formatPoints(latestState)}</Text>
        </View>
      </View>

      {latestState && (
        <View style={styles.statRow}>
          <Stat label="图鉴" value={latestState.enc || '-'} styles={styles} />
          <Stat label="回合" value={formatMaybeNumber(latestState.turn)} styles={styles} />
          <Stat label="渔获" value={formatMaybeNumber(latestState.hold)} styles={styles} />
          {!!latestState.map_frag && <Stat label="藏宝图" value={latestState.map_frag} styles={styles} />}
          {typeof latestState.oxygen === 'number' && <Stat label="氧气" value={String(latestState.oxygen)} styles={styles} />}
        </View>
      )}

      <ScrollView
        style={styles.timelineScroll}
        contentContainerStyle={styles.timeline}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {hiddenCount > 0 && <Text style={styles.hiddenCount}>已省略前 {hiddenCount} 步</Text>}
        {visibleEntries.map((entry) => (
          <View key={entry.key} style={styles.entryRow}>
            <View style={[styles.dot, entry.status === 'running' && styles.dotRunning]} />
            <View style={styles.entryTextBlock}>
              <Text style={styles.entryTitle} numberOfLines={1}>
                {entry.title}{entry.status === 'running' ? ' · 执行中' : ''}
              </Text>
              {!!entry.detail && (
                <Text style={styles.entryDetail}>
                  {entry.detail}
                </Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {entries.length > VISIBLE_ENTRY_COUNT && (
        <Pressable style={styles.toggleButton} onPress={() => setExpanded((value) => !value)}>
          <Text style={styles.toggleText}>{expanded ? '收起' : `展开全部 ${entries.length} 步`}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function buildFishingEntries(invocations?: ToolInvocation[]): FishingLogEntry[] {
  return (invocations || [])
    .map((invocation, index) => parseFishingInvocation(invocation, index))
    .filter((entry): entry is FishingLogEntry => !!entry);
}

function parseFishingInvocation(invocation: ToolInvocation, index: number): FishingLogEntry | null {
  const toolName = invocation.name || '';
  if (!isFishingTool(toolName)) return null;

  const args = parseJsonObject(invocation.args);
  const isNewGame = isNewFishingGameTool(toolName);
  const displayText = stripStructuredContent(invocation.result || '');
  const state = parseState(displayText);
  const title = isNewGame ? buildNewGameTitle(args) : buildActionTitle(args);
  const detail = invocation.status === 'running'
    ? buildPendingDetail(args, isNewGame)
    : summarizeFishingText(displayText, isNewGame);

  return {
    key: invocation.callId || `${toolName}-${index}`,
    title,
    detail,
    status: invocation.status === 'running' ? 'running' : 'done',
    state,
  };
}

function isFishingTool(name: string): boolean {
  return isPlayFishingTool(name) || isNewFishingGameTool(name);
}

function isPlayFishingTool(name: string): boolean {
  return name === 'play_fishing' || name.endsWith('__play_fishing');
}

function isNewFishingGameTool(name: string): boolean {
  return name === 'new_fishing_game' || name.endsWith('__new_fishing_game');
}

function parseJsonObject(raw: string): Record<string, any> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stripStructuredContent(raw: string): string {
  if (!raw.trim()) return '';
  const marker = '\n\n{';
  const index = raw.lastIndexOf(marker);
  if (index < 0) return raw.trim();

  const maybeJson = raw.slice(index + 2).trim();
  const parsed = parseJsonObject(maybeJson);
  if (parsed && typeof parsed.result === 'string' && parsed.command) {
    return raw.slice(0, index).trim();
  }
  return raw.trim();
}

function parseState(text: string): FishingState | null {
  const matches = [...text.matchAll(/📊\s*(\{[^\n]+\})/g)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const parsed = parseJsonObject(last[1]);
  return parsed && Object.keys(parsed).length > 0 ? parsed as FishingState : null;
}

function buildNewGameTitle(args: Record<string, any>): string {
  return args.seed === undefined || args.seed === null ? '重开钓鱼局' : `重开钓鱼局 · 种子 ${args.seed}`;
}

function buildActionTitle(args: Record<string, any>): string {
  const action = String(args.action || 'status');
  if (action === 'cast') return `连钓 ${formatCount(args.times, 1)} 竿`;
  if (action === 'dive') return `潜水远征 · 氧气 ${formatCount(args.times, 1)}`;
  if (action === 'buy') return `购买 ${args.bait_id || '物品'} ×${formatCount(args.qty, 1)}`;
  if (action === 'goto') return args.location_id ? `前往 ${args.location_id}` : '查看钓点';
  if (action === 'sell') return `卖出 ${args.target || '渔获'}`;
  if (action === 'choose') return args.choice ? `遗迹抉择 ${args.choice}` : '查看遗迹抉择';
  if (action === 'surface') return '结束远征上浮';
  if (action === 'inventory') return '查看渔篓';
  if (action === 'shop') return '查看商店';
  if (action === 'encyclopedia') return '查看图鉴';
  if (action === 'look') return `细看 ${args.id || '目标'}`;
  if (action === 'open') return `打开宝箱 ${args.chest_uid || ''}`.trim();
  if (action === 'batch') return `批量行动 ${Array.isArray(args.steps) ? args.steps.length : 0} 步`;
  return '查看状态';
}

function buildPendingDetail(args: Record<string, any>, isNewGame: boolean): string {
  if (isNewGame) return 'AI 正在准备一局新的钓鱼游戏。';
  const stopOn = Array.isArray(args.stop_on) && args.stop_on.length > 0
    ? `，遇到 ${args.stop_on.join(' / ')} 会停下`
    : '';
  return `AI 正在执行 ${buildActionTitle(args)}${stopOn}。`;
}

function summarizeFishingText(text: string, isNewGame: boolean): string {
  if (!text.trim()) return '工具尚未返回结果。';
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('📊'))
    .filter((line) => !line.startsWith('{') && !line.startsWith('"session_id"'));

  if (isNewGame) {
    return lines.find((line) => line.includes('已重开新局')) || lines[0] || '新局已开始。';
  }

  const priority = lines.filter((line) =>
    line.startsWith('▶') ||
    line.includes('发现新种') ||
    line.includes('遇到事件') ||
    line.includes('漂流瓶') ||
    line.includes('宝箱') ||
    line.includes('远征') ||
    line.includes('首次收录') ||
    line.includes('获得') ||
    line.includes('买了') ||
    line.includes('卖出') ||
    line.includes('前往')
  );
  const catchLine = lines.find((line) => line.includes('渔获'));
  const selected = [...priority.slice(0, 2), catchLine].filter(Boolean) as string[];
  const fallback = lines.slice(0, 2);
  return Array.from(new Set(selected.length > 0 ? selected : fallback)).join('\n');
}

function formatPlace(state?: FishingState | null): string {
  if (!state) return '等待钓鱼记录';
  return [state.loc, state.sea].filter(Boolean).join(' · ') || '钓鱼进行中';
}

function formatPoints(state?: FishingState | null): string {
  return typeof state?.pts === 'number' ? `${state.pts} 点` : '- 点';
}

function formatMaybeNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

function formatCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value)) : fallback;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  panel: {
    width: '100%',
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 10,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  scorePill: {
    minWidth: 62,
    minHeight: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 9,
    backgroundColor: colors.primaryLight,
  },
  scoreText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statItem: {
    minWidth: 58,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  statLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
  },
  statValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  timelineScroll: {
    height: 168,
  },
  timeline: {
    gap: 8,
    paddingRight: 8,
    paddingBottom: 2,
  },
  hiddenCount: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  entryRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 5,
  },
  dotRunning: {
    backgroundColor: colors.textTertiary,
  },
  entryTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  entryTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  entryDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
    fontFamily: fonts.regular,
  },
  toggleButton: {
    minHeight: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.inputBackground,
  },
  toggleText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
});
