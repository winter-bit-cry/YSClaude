import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DailyPaper } from '../../src/types';
import { getDailyPaperByDate } from '../../src/db/operations';
import { ensureDailyPaperDraft, generateDailyPaper } from '../../src/services/dailyPaper';
import { useSettingsStore } from '../../src/stores/settings';
import { useChatStore } from '../../src/stores/chat';
import { lightColors, useThemeColors, type ThemeColors } from '../../src/theme/colors';
import { fonts } from '../../src/theme/fonts';

let colors = lightColors;

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

function shiftDateKey(key: string, days: number): string {
  const date = dateFromKey(key);
  return dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

function normalizeDateParam(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return dateKey(new Date());
}

function formatDateTitle(key: string): string {
  const date = dateFromKey(key);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export default function DailyPaperScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string }>();
  const routeDateKey = normalizeDateParam(params.date);
  const routeDateKeyRef = useRef(routeDateKey);
  routeDateKeyRef.current = routeDateKey;
  const apiConfigs = useSettingsStore((state) => state.apiConfigs);
  const activeConfigIndex = useSettingsStore((state) => state.activeConfigIndex);
  const maxOutputTokens = useSettingsStore((state) => state.maxOutputTokens);
  const dailyPaperConfig = useSettingsStore((state) => state.dailyPaperConfig);
  const addDailyPaperToLatestConversation = useChatStore((state) => state.addDailyPaperToLatestConversation);
  const activeApiConfig = apiConfigs[activeConfigIndex];
  const [paper, setPaper] = useState<DailyPaper | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [forwarding, setForwarding] = useState(false);

  const loadPaper = useCallback(async () => {
    const requestDateKey = routeDateKey;
    setLoading(true);
    try {
      const nextPaper = await ensureDailyPaperDraft(requestDateKey);
      if (routeDateKeyRef.current === requestDateKey) {
        setPaper(nextPaper);
      }
    } finally {
      if (routeDateKeyRef.current === requestDateKey) {
        setLoading(false);
      }
    }
  }, [routeDateKey]);

  useEffect(() => {
    setPaper(null);
    setGenerating(false);
    setForwarding(false);
    loadPaper().catch((error) => {
      if (routeDateKeyRef.current === routeDateKey) {
        setLoading(false);
      }
      Alert.alert('读取失败', error?.message || '无法读取日报');
    });
  }, [loadPaper]);

  const openDate = useCallback((dateKey: string) => {
    router.replace(`/daily-paper/${dateKey}`);
  }, [router]);

  const handleGenerate = useCallback(async () => {
    const requestDateKey = routeDateKey;
    if (!activeApiConfig?.baseUrl || !activeApiConfig.apiKey || !activeApiConfig.model) {
      Alert.alert('缺少 API 配置', '请先在设置里配置当前聊天 API。');
      return;
    }
    setGenerating(true);
    try {
      const current = await getDailyPaperByDate(requestDateKey);
      if (routeDateKeyRef.current === requestDateKey) {
        setPaper(current || paper);
      }
      const next = await generateDailyPaper(requestDateKey, activeApiConfig, maxOutputTokens, dailyPaperConfig);
      if (routeDateKeyRef.current === requestDateKey) {
        setPaper(next);
      }
    } catch (error: any) {
      const failedPaper = await getDailyPaperByDate(requestDateKey);
      if (routeDateKeyRef.current === requestDateKey) {
        setPaper(failedPaper);
        Alert.alert('生成失败', error?.message || '日报生成失败');
      }
    } finally {
      if (routeDateKeyRef.current === requestDateKey) {
        setGenerating(false);
      }
    }
  }, [activeApiConfig, dailyPaperConfig, maxOutputTokens, paper, routeDateKey]);

  const handleForward = useCallback(async () => {
    const currentPaper = paper;
    if (!currentPaper?.content) {
      Alert.alert('无法转发', '请先生成日报。');
      return;
    }
    setForwarding(true);
    try {
      await addDailyPaperToLatestConversation(currentPaper);
      Alert.alert('已转发', '日报已转发到最新创建的对话窗口。');
    } catch (error: any) {
      Alert.alert('转发失败', error?.message || '无法转发日报');
    } finally {
      setForwarding(false);
    }
  }, [addDailyPaperToLatestConversation, paper]);

  const content = paper?.content;
  const isBusy = loading || generating || paper?.status === 'generating';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>‹</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title}>每日日报</Text>
          <Text style={styles.subtitle}>{formatDateTitle(routeDateKey)}</Text>
        </View>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.dateNav}>
        <Pressable style={styles.dateButton} onPress={() => openDate(shiftDateKey(routeDateKey, -1))}>
          <Text style={styles.dateButtonText}>‹</Text>
        </Pressable>
        <Pressable style={styles.todayButton} onPress={() => openDate(dateKey(new Date()))}>
          <Text style={styles.todayButtonText}>今天</Text>
        </Pressable>
        <Pressable style={styles.dateButton} onPress={() => openDate(shiftDateKey(routeDateKey, 1))}>
          <Text style={styles.dateButtonText}>›</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.stateText}>正在读取日报</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {!content ? (
            <View style={styles.emptyPanel}>
              <Text style={styles.emptyTitle}>
                {paper?.status === 'failed' ? '上次生成失败' : '这一天还没有日报'}
              </Text>
              {!!paper?.errorMessage && <Text style={styles.errorText}>{paper.errorMessage}</Text>}
              <Pressable style={[styles.primaryButton, isBusy && styles.buttonDisabled]} onPress={handleGenerate} disabled={isBusy}>
                {generating ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>生成日报</Text>}
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.paperHeader}>
                <Text style={styles.masthead}>{content.masthead || 'YS Daily'}</Text>
                <Text style={styles.paperDate}>{formatDateTitle(routeDateKey)}</Text>
                <Text style={styles.headline}>{content.headline}</Text>
                {!!content.dek && <Text style={styles.dek}>{content.dek}</Text>}
              </View>

              <View style={styles.actionRow}>
                <Pressable style={[styles.secondaryButton, isBusy && styles.buttonDisabled]} onPress={handleGenerate} disabled={isBusy}>
                  {generating ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.secondaryButtonText}>重新生成</Text>}
                </Pressable>
                <Pressable style={[styles.secondaryButton, (isBusy || forwarding) && styles.buttonDisabled]} onPress={handleForward} disabled={isBusy || forwarding}>
                  {forwarding ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.secondaryButtonText}>转发到最新对话</Text>}
                </Pressable>
              </View>

              {content.sections.map((section, index) => (
                <View key={`${section.title}-${index}`} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {section.items.map((item, itemIndex) => (
                    <View key={`${index}-${itemIndex}`} style={styles.bulletRow}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.bulletText}>{item}</Text>
                    </View>
                  ))}
                </View>
              ))}

              {!!content.editorial && (
                <View style={styles.editorial}>
                  <Text style={styles.editorialLabel}>今日短评</Text>
                  <Text style={styles.editorialText}>{content.editorial}</Text>
                </View>
              )}

              <View style={styles.sources}>
                <Text style={styles.sourcesTitle}>来源</Text>
                {(paper?.sources || []).map((source, index) => (
                  <Pressable
                    key={`${source.url}-${index}`}
                    style={styles.sourceRow}
                    onPress={() => Linking.openURL(source.url).catch(() => undefined)}
                  >
                    <Text style={styles.sourceTitle} numberOfLines={2}>{source.title}</Text>
                    <Text style={styles.sourceMeta} numberOfLines={1}>
                      {source.sourceName} · {source.category}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIcon: {
    fontSize: 34,
    lineHeight: 36,
    color: colors.text,
  },
  headerTitleBlock: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textTertiary,
  },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  dateButton: {
    width: 42,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateButtonText: {
    fontSize: 28,
    color: colors.text,
  },
  todayButton: {
    minHeight: 38,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todayButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  stateText: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  emptyPanel: {
    minHeight: 320,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: 14,
  },
  primaryButton: {
    minHeight: 42,
    minWidth: 118,
    borderRadius: 8,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.62,
  },
  paperHeader: {
    borderTopWidth: 2,
    borderBottomWidth: 1,
    borderColor: colors.text,
    paddingVertical: 18,
    marginBottom: 12,
  },
  masthead: {
    fontSize: 34,
    lineHeight: 40,
    fontFamily: fonts.serifBold,
    color: colors.text,
    textAlign: 'center',
  },
  paperDate: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textTertiary,
    fontWeight: '700',
  },
  headline: {
    marginTop: 16,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  dek: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  secondaryButton: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 7,
    marginBottom: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 9,
  },
  bullet: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.primary,
  },
  bulletText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  editorial: {
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: 22,
  },
  editorialLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.primary,
    marginBottom: 7,
  },
  editorialText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  sources: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
  },
  sourcesTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    marginBottom: 8,
  },
  sourceRow: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sourceTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  sourceMeta: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textTertiary,
  },
});

let styles = createStyles(colors);
