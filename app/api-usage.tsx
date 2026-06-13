import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import { useSettingsStore, type NamedAPIConfig } from '../src/stores/settings';
import {
  getApiUsageEvents,
  getApiUsageEventsByDate,
  getApiUsageDailySummaries,
  getApiUsageSummary,
  getApiUsageSummaryByDate,
  getApiUsageSummaryByFeature,
  getApiUsageSummaryByModel,
} from '../src/db/operations';
import type { ApiUsageDailySummary, ApiUsageEvent, ApiUsageGroupSummary, ApiUsageSummary } from '../src/types';
import { formatFullTime } from '../src/utils/time';

let colors = lightColors;

const EMPTY_SUMMARY: ApiUsageSummary = {
  totalCalls: 0,
  successCalls: 0,
  errorCalls: 0,
  abortedCalls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  totalDurationMs: 0,
};

export default function ApiUsageScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const apiConfigs = useSettingsStore((state) => state.apiConfigs);
  const [summary, setSummary] = useState<ApiUsageSummary>(EMPTY_SUMMARY);
  const [daySummary, setDaySummary] = useState<ApiUsageSummary>(EMPTY_SUMMARY);
  const [dailyRows, setDailyRows] = useState<ApiUsageDailySummary[]>([]);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const selectedDateKeyRef = useRef<string | null>(null);
  const [featureRows, setFeatureRows] = useState<ApiUsageGroupSummary[]>([]);
  const [modelRows, setModelRows] = useState<ApiUsageGroupSummary[]>([]);
  const [events, setEvents] = useState<ApiUsageEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (dateKey?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextFeatureRows, nextModelRows, nextDailyRows] = await Promise.all([
        getApiUsageSummary(),
        getApiUsageSummaryByFeature(),
        getApiUsageSummaryByModel(),
        getApiUsageDailySummaries(180),
      ]);
      const nextDateKey = dateKey ?? selectedDateKeyRef.current ?? nextDailyRows[0]?.dateKey ?? null;
      const [nextDaySummary, nextEvents] = nextDateKey
        ? await Promise.all([
            getApiUsageSummaryByDate(nextDateKey),
            getApiUsageEventsByDate(nextDateKey, 200),
          ])
        : [EMPTY_SUMMARY, await getApiUsageEvents(100)] as const;
      setSummary(nextSummary);
      setDaySummary(nextDaySummary);
      setDailyRows(nextDailyRows);
      selectedDateKeyRef.current = nextDateKey;
      setSelectedDateKey(nextDateKey);
      setFeatureRows(nextFeatureRows);
      setModelRows(nextModelRows);
      setEvents(nextEvents);
    } catch (err: any) {
      setError(err?.message || '无法读取 API 使用日志');
    } finally {
      setLoading(false);
    }
  }, []);

  const selectDate = useCallback((dateKey: string) => {
    load(dateKey).catch(() => undefined);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load])
  );

  const header = (
    <View style={styles.contentHeader}>
      <View style={styles.summaryPanel}>
        <Text style={styles.sectionTitle}>总数</Text>
        <View style={styles.summaryGrid}>
          <Metric label="总 tokens" value={formatNumber(summary.totalTokens)} />
          <Metric label="Prompt" value={formatNumber(summary.promptTokens)} />
          <Metric label="Completion" value={formatNumber(summary.completionTokens)} />
          <Metric label="调用次数" value={formatNumber(summary.totalCalls)} />
          <Metric label="缓存 tokens" value={formatNumber(summary.cachedTokens)} />
          <Metric label="推理 tokens" value={formatNumber(summary.reasoningTokens)} />
        </View>
        <Text style={styles.metaLine}>
          成功 {summary.successCalls} · 失败 {summary.errorCalls} · 中断 {summary.abortedCalls} · 总耗时 {formatDuration(summary.totalDurationMs)}
        </Text>
      </View>

      <HeatmapSection
        rows={dailyRows}
        selectedDateKey={selectedDateKey}
        onSelectDate={selectDate}
      />

      <View style={styles.summaryPanel}>
        <View style={styles.dayHeader}>
          <View>
            <Text style={styles.sectionTitle}>日总数</Text>
            <Text style={styles.daySubTitle}>{selectedDateKey ? formatDateLabel(selectedDateKey) : '暂无日期'}</Text>
          </View>
          <Text style={styles.dayCallText}>{formatNumber(daySummary.totalCalls)} 次</Text>
        </View>
        <View style={styles.summaryGrid}>
          <Metric label="日 tokens" value={formatNumber(daySummary.totalTokens)} />
          <Metric label="Prompt" value={formatNumber(daySummary.promptTokens)} />
          <Metric label="Completion" value={formatNumber(daySummary.completionTokens)} />
          <Metric label="缓存 tokens" value={formatNumber(daySummary.cachedTokens)} />
          <Metric label="推理 tokens" value={formatNumber(daySummary.reasoningTokens)} />
          <Metric label="日耗时" value={formatDuration(daySummary.totalDurationMs)} />
        </View>
        <Text style={styles.metaLine}>
          成功 {daySummary.successCalls} · 失败 {daySummary.errorCalls} · 中断 {daySummary.abortedCalls}
        </Text>
      </View>

      <GroupSection title="按功能汇总" rows={featureRows} />
      <GroupSection title="按模型汇总" rows={modelRows} channelFormatter={(row) => formatModelChannels(row, apiConfigs)} />
      <Text style={styles.sectionTitle}>{selectedDateKey ? '日调用记录' : '最近调用'}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerButtonText}>返回</Text>
        </Pressable>
        <Text style={styles.title}>API 使用日志</Text>
        <Pressable style={styles.headerButton} onPress={() => load().catch(() => undefined)} disabled={loading}>
          <Text style={styles.headerButtonText}>{loading ? '...' : '刷新'}</Text>
        </Pressable>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {loading && events.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <UsageEventRow event={item} />}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={styles.emptyText}>还没有 API 调用日志。</Text>}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

function HeatmapSection({
  rows,
  selectedDateKey,
  onSelectDate,
}: {
  rows: ApiUsageDailySummary[];
  selectedDateKey: string | null;
  onSelectDate: (dateKey: string) => void;
}) {
  if (rows.length === 0) return null;
  const cells = buildHeatmapCells(rows);
  const maxTokens = Math.max(...rows.map((row) => row.totalTokens), 0);
  const recentRows = rows.slice(0, 14);

  return (
    <View style={styles.heatmapPanel}>
      <View style={styles.dayHeader}>
        <View>
          <Text style={styles.sectionTitle}>Token 热力图</Text>
          <Text style={styles.daySubTitle}>点击日期查看当天调用</Text>
        </View>
        <Text style={styles.dayCallText}>近 {rows.length} 天</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heatmapScroll}>
        <View style={styles.heatmapGrid}>
          {cells.map((cell, index) => {
            const isSelected = !!cell.dateKey && cell.dateKey === selectedDateKey;
            return (
              <Pressable
                key={`${cell.dateKey || 'empty'}-${index}`}
                disabled={!cell.dateKey}
                onPress={() => cell.dateKey && onSelectDate(cell.dateKey)}
                style={[
                  styles.heatmapCell,
                  {
                    backgroundColor: heatColor(cell.totalTokens, maxTokens),
                    opacity: cell.dateKey ? 1 : 0,
                  },
                  isSelected && styles.heatmapCellSelected,
                ]}
              />
            );
          })}
        </View>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateChipRow}>
        {recentRows.map((row) => (
          <Pressable
            key={row.dateKey}
            style={[styles.dateChip, row.dateKey === selectedDateKey && styles.dateChipActive]}
            onPress={() => onSelectDate(row.dateKey)}
          >
            <Text style={[styles.dateChipText, row.dateKey === selectedDateKey && styles.dateChipTextActive]}>
              {formatShortDate(row.dateKey)}
            </Text>
            <Text style={[styles.dateChipMeta, row.dateKey === selectedDateKey && styles.dateChipTextActive]}>
              {formatCompactNumber(row.totalTokens)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function GroupSection({
  title,
  rows,
  channelFormatter,
}: {
  title: string;
  rows: ApiUsageGroupSummary[];
  channelFormatter?: (row: ApiUsageGroupSummary) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.groupPanel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupScroll}>
        {rows.map((row) => {
          const channelText = channelFormatter?.(row);
          return (
            <View key={row.key} style={styles.groupCard}>
              <Text style={styles.groupKey} numberOfLines={1}>{formatGroupKey(row.key)}</Text>
              {!!channelText && <Text style={styles.groupChannel} numberOfLines={2}>渠道：{channelText}</Text>}
              <Text style={styles.groupValue}>{formatNumber(row.totalTokens)}</Text>
              <Text style={styles.groupMeta}>
                {row.totalCalls} 次 · {formatNumber(row.promptTokens)}/{formatNumber(row.completionTokens)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function UsageEventRow({ event }: { event: ApiUsageEvent }) {
  return (
    <View style={styles.eventRow}>
      <View style={styles.eventTop}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {formatGroupKey(event.feature)} · {event.requestKind}
        </Text>
        <Text style={[styles.statusPill, statusStyle(event.status)]}>{formatStatus(event.status)}</Text>
      </View>
      <Text style={styles.modelText} numberOfLines={1}>{event.model || 'unknown model'}</Text>
      <View style={styles.tokenRow}>
        <TokenChip label="total" value={event.totalTokens} />
        <TokenChip label="prompt" value={event.promptTokens} />
        <TokenChip label="completion" value={event.completionTokens} />
        {!!event.cachedTokens && <TokenChip label="cached" value={event.cachedTokens} />}
        {!!event.reasoningTokens && <TokenChip label="reasoning" value={event.reasoningTokens} />}
      </View>
      <Text style={styles.metaLine}>
        {formatFullTime(event.startedAt)} · {event.streaming ? 'stream' : 'non-stream'} · {formatDuration(event.durationMs)}
      </Text>
      {event.conversationId && (
        <Text style={styles.idText} numberOfLines={1}>conversation: {event.conversationId}</Text>
      )}
      {event.messageId && (
        <Text style={styles.idText} numberOfLines={1}>message: {event.messageId}</Text>
      )}
      {event.errorMessage && <Text style={styles.errorInline} numberOfLines={3}>{event.errorMessage}</Text>}
    </View>
  );
}

function TokenChip({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Text style={styles.tokenChip}>
      {label} {value === undefined ? '-' : formatNumber(value)}
    </Text>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function formatDateLabel(key: string): string {
  const date = dateFromKey(key);
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  return `${key} 周${week}`;
}

function formatShortDate(key: string): string {
  const [, month, day] = key.split('-');
  return `${month}/${day}`;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value || '').trim().replace(/\/+$/, '');
}

function formatChannelFallback(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return '未知渠道';
  try {
    return new URL(normalized).host || normalized;
  } catch {
    return normalized.replace(/^https?:\/\//, '');
  }
}

function formatModelChannels(row: ApiUsageGroupSummary, apiConfigs: NamedAPIConfig[]): string {
  const channels = row.channels && row.channels.length > 0 ? row.channels : [];
  if (channels.length === 0) return '未知渠道';
  const labels = channels.map((channel) => {
    const normalizedChannel = normalizeBaseUrl(channel);
    const config = apiConfigs.find((item) => (
      item.model === row.key &&
      normalizeBaseUrl(item.baseUrl) === normalizedChannel
    ));
    return config?.name?.trim() || formatChannelFallback(normalizedChannel);
  });
  return [...new Set(labels)].join('、');
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function buildHeatmapCells(rows: ApiUsageDailySummary[]): Array<{ dateKey: string | null; totalTokens: number }> {
  const byDate = new Map(rows.map((row) => [row.dateKey, row.totalTokens]));
  const latestDate = dateFromKey(rows[0].dateKey);
  const earliestDate = addDays(latestDate, -125);
  const leadingEmpty = earliestDate.getDay();
  const cells: Array<{ dateKey: string | null; totalTokens: number }> = [];

  for (let i = 0; i < leadingEmpty; i += 1) {
    cells.push({ dateKey: null, totalTokens: 0 });
  }
  for (let offset = 0; offset < 126; offset += 1) {
    const dateKey = localDateKey(addDays(earliestDate, offset).getTime());
    cells.push({ dateKey, totalTokens: byDate.get(dateKey) ?? 0 });
  }
  return cells;
}

function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return colors.inputBackground;
  const ratio = value / max;
  if (ratio >= 0.75) return '#166534';
  if (ratio >= 0.45) return '#22C55E';
  if (ratio >= 0.2) return '#86EFAC';
  return '#DCFCE7';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatStatus(status: ApiUsageEvent['status']): string {
  if (status === 'error') return '失败';
  if (status === 'aborted') return '中断';
  return '成功';
}

function statusStyle(status: ApiUsageEvent['status']) {
  if (status === 'error') return styles.statusError;
  if (status === 'aborted') return styles.statusAborted;
  return styles.statusSuccess;
}

function formatGroupKey(key: string): string {
  const labels: Record<string, string> = {
    chat: '主聊天',
    reading: '共读',
    radio: 'AI 电台',
    game: '副本',
    unknown: '未分类',
  };
  return labels[key] ?? key;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 76,
    minHeight: 36,
    justifyContent: 'center',
  },
  headerButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  contentHeader: {
    gap: 12,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryPanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metric: {
    minWidth: '31%',
    flexGrow: 1,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  metricValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  metricLabel: {
    marginTop: 2,
    color: colors.textTertiary,
    fontSize: 11,
  },
  groupPanel: {
    gap: 8,
  },
  heatmapPanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  daySubTitle: {
    marginTop: 3,
    color: colors.textTertiary,
    fontSize: 12,
  },
  dayCallText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  heatmapScroll: {
    paddingVertical: 2,
    paddingRight: 4,
  },
  heatmapGrid: {
    height: 118,
    flexDirection: 'column',
    flexWrap: 'wrap',
    gap: 4,
  },
  heatmapCell: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heatmapCellSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  dateChipRow: {
    gap: 8,
    paddingRight: 4,
  },
  dateChip: {
    minWidth: 68,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dateChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  dateChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  dateChipMeta: {
    marginTop: 2,
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
  },
  dateChipTextActive: {
    color: colors.primary,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  groupScroll: {
    gap: 8,
    paddingRight: 4,
  },
  groupCard: {
    width: 160,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  groupKey: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  groupChannel: {
    marginTop: 4,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
  },
  groupValue: {
    marginTop: 6,
    color: colors.primary,
    fontSize: 18,
    fontWeight: '800',
  },
  groupMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 11,
  },
  eventRow: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 7,
  },
  eventTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  statusPill: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '800',
  },
  statusSuccess: {
    backgroundColor: colors.inputBackground,
    color: colors.success,
  },
  statusError: {
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
  },
  statusAborted: {
    backgroundColor: colors.inputBackground,
    color: colors.textTertiary,
  },
  modelText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  tokenRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tokenChip: {
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.inputBackground,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  metaLine: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  idText: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 16,
  },
  errorText: {
    margin: 16,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  errorInline: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 28,
  },
});

let styles = createStyles(colors);
