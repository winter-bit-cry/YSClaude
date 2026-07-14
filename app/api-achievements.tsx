import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { Award, BookOpen, Flower2, Gem, Heart, Leaf, MessageCircle, Radio, Snowflake, Sparkles, Sun, Zap } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  getApiUsageDailySummaries,
  getApiUsageSummary,
  getCompanionActiveDateKeys,
} from '../src/db/operations';
import {
  getApiAchievementDefinitions,
  type ApiAchievementBadgeColor,
  type ApiAchievementBadgePattern,
  type ApiAchievementCategory,
  type ApiAchievementDefinition,
  type ApiAchievementMetric,
  type ApiAchievementSeason,
  useApiAchievementsStore,
} from '../src/stores/api-achievements';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';
import type { ApiUsageDailySummary, ApiUsageSummary } from '../src/types';
import { copyFileFromUri } from '../src/utils/fileSystem';

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

const COLOR_OPTIONS: Array<{ key: ApiAchievementBadgeColor; label: string; colors: [string, string] }> = [
  { key: 'amber', label: '琥珀', colors: ['#F59E0B', '#B45309'] },
  { key: 'green', label: '翠绿', colors: ['#22C55E', '#15803D'] },
  { key: 'blue', label: '蓝色', colors: ['#38BDF8', '#2563EB'] },
  { key: 'rose', label: '玫瑰', colors: ['#FB7185', '#BE123C'] },
  { key: 'violet', label: '紫罗兰', colors: ['#A78BFA', '#6D28D9'] },
  { key: 'cyan', label: '青色', colors: ['#22D3EE', '#0E7490'] },
];

const BADGE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function badgeImageExtension(asset: ImagePicker.ImagePickerAsset): string {
  const mimeType = asset.mimeType?.toLowerCase();
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/png') return '.png';
  const cleanUri = asset.uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.jpg') || cleanUri.endsWith('.jpeg')) return '.jpg';
  if (cleanUri.endsWith('.webp')) return '.webp';
  return '.png';
}

function validateBadgeImageAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  const mimeType = asset.mimeType?.toLowerCase();
  const extension = badgeImageExtension(asset);
  const isAllowedType =
    mimeType === 'image/png' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg' ||
    mimeType === 'image/webp' ||
    ['.png', '.jpg', '.webp'].includes(extension);

  if (!isAllowedType) return '只支持 PNG、JPG 或 WebP 图片';
  if (asset.fileSize && asset.fileSize > BADGE_IMAGE_MAX_BYTES) return '图片不能超过 8MB';
  return null;
}

async function copyBadgeImage(asset: ImagePicker.ImagePickerAsset, badgeId: string): Promise<string> {
  const dir = new Directory(Paths.document, 'achievement-badges');
  dir.create({ intermediates: true, idempotent: true });
  const safeBadgeId = badgeId.replace(/[^a-zA-Z0-9-]/g, '-');
  const destination = new File(dir, `${safeBadgeId}-${randomUUID()}${badgeImageExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

interface AchievementDraft {
  id: string;
  name: string;
  description: string;
  category: ApiAchievementCategory;
  metric: ApiAchievementMetric;
  target: number;
  year?: number;
  season?: ApiAchievementSeason;
  badgePattern: ApiAchievementBadgePattern;
  badgeColor: ApiAchievementBadgeColor;
  badgeImageUri?: string;
  createdAt: number;
  updatedAt: number;
}

interface EvaluatedAchievement {
  definition: ApiAchievementDefinition;
  current: number;
  target: number;
  progress: number;
  achieved: boolean;
  achievedAt?: string;
}

interface AchievementGroup {
  key: string;
  title: string;
  meta: string;
  rows: EvaluatedAchievement[];
}

export default function ApiAchievementsScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const achievementCustomizations = useApiAchievementsStore((state) => state.achievements);
  const anniversaryCheckIns = useApiAchievementsStore((state) => state.anniversaryCheckIns ?? []);
  const saveAchievement = useApiAchievementsStore((state) => state.saveAchievement);
  const recordAnniversaryCheckIn = useApiAchievementsStore((state) => state.recordAnniversaryCheckIn);
  const resetDefaultAchievements = useApiAchievementsStore((state) => state.resetDefaultAchievements);
  const [summary, setSummary] = useState<ApiUsageSummary>(EMPTY_SUMMARY);
  const [activeDateKeys, setActiveDateKeys] = useState<string[]>([]);
  const [dailyRows, setDailyRows] = useState<ApiUsageDailySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AchievementDraft | null>(null);
  const [activeGroup, setActiveGroup] = useState<AchievementGroup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextActiveDateKeys, nextDailyRows] = await Promise.all([
        getApiUsageSummary(),
        getCompanionActiveDateKeys(),
        getApiUsageDailySummaries(3650),
      ]);
      setSummary(nextSummary);
      setActiveDateKeys(nextActiveDateKeys);
      setDailyRows(nextDailyRows);
    } catch (err: any) {
      setError(err?.message || '无法读取 API 成就数据');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const todayKey = localDateKey(new Date());
      if (isAnniversaryDateKey(todayKey)) {
        recordAnniversaryCheckIn(todayKey);
      }
      load().catch(() => undefined);
    }, [load, recordAnniversaryCheckIn])
  );

  const achievementYears = useMemo(
    () => getAchievementYears(activeDateKeys, anniversaryCheckIns),
    [activeDateKeys, anniversaryCheckIns]
  );
  const achievements = useMemo(
    () => getApiAchievementDefinitions(achievementCustomizations, achievementYears),
    [achievementCustomizations, achievementYears]
  );
  const evaluatedRows = useMemo(
    () => achievements.map((definition) => evaluateAchievement(definition, summary, activeDateKeys, anniversaryCheckIns, dailyRows)),
    [achievements, activeDateKeys, anniversaryCheckIns, dailyRows, summary]
  );
  const companionRows = evaluatedRows.filter((row) => row.definition.category === 'companionDays');
  const tokenRows = evaluatedRows.filter((row) => row.definition.category === 'totalTokens');
  const anniversaryRows = evaluatedRows.filter((row) => row.definition.category === 'anniversary');
  const achievementGroups = useMemo(
    () => buildAchievementGroups(companionRows, tokenRows, anniversaryRows, evaluatedRows),
    [anniversaryRows, companionRows, evaluatedRows, tokenRows]
  );

  const openEdit = useCallback((definition: ApiAchievementDefinition) => {
    setDraft({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      metric: definition.metric,
      target: definition.target,
      year: definition.year,
      season: definition.season,
      badgePattern: definition.badgePattern,
      badgeColor: definition.badgeColor,
      badgeImageUri: definition.badgeImageUri,
      createdAt: definition.createdAt,
      updatedAt: definition.updatedAt,
    });
  }, []);

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const name = draft.name.trim();
    const description = draft.description.trim();
    if (!name) {
      Alert.alert('提示', '请填写成就名称');
      return;
    }
    const now = Date.now();
    saveAchievement({
      id: draft.id,
      name,
      description,
      category: draft.category,
      metric: draft.metric,
      feature: 'all',
      target: draft.target,
      year: draft.year,
      season: draft.season,
      badgePattern: draft.badgePattern,
      badgeColor: draft.badgeColor,
      badgeImageUri: draft.badgeImageUri,
      createdAt: draft.createdAt || now,
      updatedAt: now,
    });
    setDraft(null);
  }, [draft, saveAchievement]);

  const confirmReset = useCallback(() => {
    Alert.alert('恢复默认成就', '这会把徽章名称、描述和图案恢复为默认值。', [
      { text: '取消', style: 'cancel' },
      { text: '恢复', onPress: resetDefaultAchievements },
    ]);
  }, [resetDefaultAchievements]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerButtonText}>返回</Text>
        </Pressable>
        <Text style={styles.title}>成就徽章</Text>
        <Pressable style={styles.headerButton} onPress={confirmReset}>
          <Text style={styles.headerButtonText}>重置</Text>
        </Pressable>
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {error && <Text style={styles.errorText}>{error}</Text>}

        {loading && evaluatedRows.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View style={styles.badgeGrid}>
            {achievementGroups.map((group) => (
              <AchievementGroupCard key={group.key} group={group} onPress={() => setActiveGroup(group)} />
            ))}
          </View>
        )}

        {evaluatedRows.length === 0 && !loading && (
          <Text style={styles.emptyText}>还没有成就数据。</Text>
        )}
      </ScrollView>

      <AchievementEditor
        draft={draft}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={saveDraft}
      />

      <AchievementStageModal
        group={activeGroup}
        onClose={() => setActiveGroup(null)}
        onEdit={(definition) => {
          setActiveGroup(null);
          openEdit(definition);
        }}
      />
    </View>
  );
}

function AchievementGroupCard({ group, onPress }: { group: AchievementGroup; onPress: () => void }) {
  const displayRow = getGroupDisplayRow(group.rows);
  if (!displayRow) return null;
  return (
    <Pressable style={styles.badgeWallItem} onPress={onPress}>
      <BadgeMedal
        definition={displayRow.definition}
        achieved={displayRow.achieved}
        variant="wall"
      />
      <Text style={styles.badgeWallName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
        {displayRow.definition.name}
      </Text>
      <Text style={[styles.badgeWallMeta, !displayRow.achieved && styles.badgeWallMetaLocked]} numberOfLines={1}>
        {displayRow.achieved ? formatAchievementDate(displayRow.achievedAt) : formatLockedWallCondition(displayRow)}
      </Text>
    </Pressable>
  );
}

function AchievementStageModal({
  group,
  onClose,
  onEdit,
}: {
  group: AchievementGroup | null;
  onClose: () => void;
  onEdit: (definition: ApiAchievementDefinition) => void;
}) {
  const { width } = useWindowDimensions();
  if (!group) return null;
  const pageWidth = width;
  const initialIndex = Math.max(0, getGroupDisplayIndex(group.rows));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.stagePanel}>
          <View style={styles.editorHeader}>
            <View style={styles.stageTitleGroup}>
              <Text style={styles.editorTitle}>{group.title}</Text>
              <Text style={styles.stageSubtitle}>{group.meta}</Text>
            </View>
            <Pressable style={styles.editorCloseButton} onPress={onClose}>
              <Text style={styles.editorCloseText}>关闭</Text>
            </Pressable>
          </View>

          <FlatList
            horizontal
            pagingEnabled
            initialScrollIndex={initialIndex}
            data={group.rows}
            keyExtractor={(item) => item.definition.id}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
            contentContainerStyle={styles.stageListContent}
            renderItem={({ item, index }) => (
              <View style={[styles.stagePage, { width: pageWidth }]}>
                <Text style={styles.stageIndex}>{index + 1}/{group.rows.length}</Text>
                <BadgeMedal definition={item.definition} achieved={item.achieved} size="detail" />
                <Text style={styles.stageName}>{item.definition.name}</Text>
                <Text style={styles.stageDescription}>{item.definition.description}</Text>
                <View style={styles.lockedCondition}>
                  <Text style={styles.lockedConditionLabel}>达成条件</Text>
                  <Text style={styles.lockedConditionText}>{formatCondition(item.definition)}</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      item.achieved && styles.progressFillAchieved,
                      { width: `${Math.round(item.progress * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.badgeProgress}>
                  {formatMetricValue(item.current, item.definition.metric)} / {formatMetricValue(item.target, item.definition.metric)}
                </Text>
                <Pressable style={styles.editStageButton} onPress={() => onEdit(item.definition)}>
                  <Text style={styles.editStageButtonText}>编辑此徽章</Text>
                </Pressable>
              </View>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

function AchievementEditor({
  draft,
  onChange,
  onClose,
  onSave,
}: {
  draft: AchievementDraft | null;
  onChange: (draft: AchievementDraft | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!draft) return null;
  const update = (patch: Partial<AchievementDraft>) => onChange({ ...draft, ...patch });
  const pickBadgeImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const validationError = validateBadgeImageAsset(asset);
      if (validationError) {
        Alert.alert('无法使用这张图片', validationError);
        return;
      }
      const badgeImageUri = await copyBadgeImage(asset, draft.id);
      update({ badgeImageUri });
    } catch (err: any) {
      Alert.alert('上传失败', err?.message || '无法读取图片');
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.editorPanel}>
          <View style={styles.editorHeader}>
            <Text style={styles.editorTitle}>编辑徽章</Text>
            <Pressable style={styles.editorCloseButton} onPress={onClose}>
              <Text style={styles.editorCloseText}>关闭</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.editorContent}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>成就名称</Text>
              <TextInput
                style={styles.input}
                value={draft.name}
                onChangeText={(name) => update({ name })}
                placeholder="例如：夜航 100 万 tokens"
                placeholderTextColor={colors.textTertiary}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>描述</Text>
              <TextInput
                style={[styles.input, styles.descriptionInput]}
                value={draft.description}
                onChangeText={(description) => update({ description })}
                multiline
                textAlignVertical="top"
                placeholder="写一句属于这个徽章的说明"
                placeholderTextColor={colors.textTertiary}
              />
            </View>

            <View style={styles.lockedCondition}>
              <Text style={styles.lockedConditionLabel}>达成条件</Text>
              <Text style={styles.lockedConditionText}>{formatConditionFromDraft(draft)}</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>徽章图案</Text>
              <View style={styles.imagePickerPanel}>
                <BadgeMedal definition={draft} achieved size="detail" />
                <View style={styles.imagePickerActions}>
                  <Pressable style={styles.imageButton} onPress={pickBadgeImage}>
                    <Text style={styles.imageButtonText}>{draft.badgeImageUri ? '替换图片' : '上传图片'}</Text>
                  </Pressable>
                  {!!draft.badgeImageUri && (
                    <Pressable style={styles.secondaryImageButton} onPress={() => update({ badgeImageUri: undefined })}>
                      <Text style={styles.secondaryImageButtonText}>清除</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.editorActions}>
              <Pressable style={styles.saveButton} onPress={onSave}>
                <Text style={styles.saveButtonText}>保存</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BadgeMedal({
  definition,
  achieved,
  size = 'large',
  variant = 'default',
}: {
  definition: Pick<ApiAchievementDefinition, 'badgePattern' | 'badgeColor' | 'badgeImageUri'>;
  achieved: boolean;
  size?: 'large' | 'small' | 'detail';
  variant?: 'default' | 'wall';
}) {
  const palette = COLOR_OPTIONS.find((item) => item.key === definition.badgeColor)?.colors || COLOR_OPTIONS[0].colors;
  const medalSize = variant === 'wall' ? 96 : size === 'detail' ? 112 : size === 'large' ? 76 : 48;
  const iconSize = variant === 'wall' ? 46 : size === 'detail' ? 48 : size === 'large' ? 34 : 22;
  const hasCustomImage = !!definition.badgeImageUri;
  return (
    <View
      style={[
        styles.medalShell,
        variant === 'wall' && styles.medalShellWall,
        { width: medalSize, height: medalSize, opacity: achieved || hasCustomImage ? 1 : 0.38 },
      ]}
    >
      <LinearGradient colors={achieved ? palette : ['#D1D5DB', '#9CA3AF']} style={styles.medalGradient}>
        {definition.badgeImageUri ? (
          <View style={styles.badgeImageWrap}>
            <Image source={{ uri: definition.badgeImageUri }} style={styles.badgeImage} resizeMode="cover" />
            {!achieved && <View style={styles.badgeImageLockedOverlay} />}
          </View>
        ) : (
          <BadgeIcon pattern={definition.badgePattern} size={iconSize} color="#FFFFFF" />
        )}
      </LinearGradient>
    </View>
  );
}

function BadgeIcon({ pattern, size, color }: { pattern: ApiAchievementBadgePattern; size: number; color: string }) {
  const common = { size, color, strokeWidth: 2.4 };
  if (pattern === 'sparkles') return <Sparkles {...common} />;
  if (pattern === 'heart') return <Heart {...common} />;
  if (pattern === 'message') return <MessageCircle {...common} />;
  if (pattern === 'book') return <BookOpen {...common} />;
  if (pattern === 'radio') return <Radio {...common} />;
  if (pattern === 'bolt') return <Zap {...common} />;
  if (pattern === 'gem') return <Gem {...common} />;
  if (pattern === 'flower') return <Flower2 {...common} />;
  if (pattern === 'sun') return <Sun {...common} />;
  if (pattern === 'leaf') return <Leaf {...common} />;
  if (pattern === 'snowflake') return <Snowflake {...common} />;
  return <Award {...common} />;
}

function evaluateAchievement(
  definition: ApiAchievementDefinition,
  summary: ApiUsageSummary,
  activeDateKeys: string[],
  anniversaryCheckIns: string[],
  dailyRows: ApiUsageDailySummary[]
): EvaluatedAchievement {
  const current = getAchievementCurrent(definition, summary, activeDateKeys, anniversaryCheckIns);
  const target = Math.max(1, definition.target);
  const progress = Math.min(1, current / target);
  const achieved = current >= target;
  return {
    definition,
    current,
    target,
    progress,
    achieved,
    achievedAt: achieved ? getAchievementDate(definition, activeDateKeys, anniversaryCheckIns, dailyRows) : undefined,
  };
}

function getAchievementDate(
  definition: ApiAchievementDefinition,
  activeDateKeys: string[],
  anniversaryCheckIns: string[],
  dailyRows: ApiUsageDailySummary[]
): string | undefined {
  if (definition.metric === 'totalTokens') {
    return getTokenAchievementDate(dailyRows, definition.target);
  }
  if (definition.category === 'anniversary' && definition.year) {
    const dateKey = anniversaryDateKey(definition.year);
    return activeDateKeys.includes(dateKey) || anniversaryCheckIns.includes(dateKey) ? dateKey : undefined;
  }
  if (definition.category === 'season' && definition.year && definition.season) {
    return getNthDateKey(
      activeDateKeys.filter((key) => isDateKeyInSeason(key, definition.year!, definition.season!)),
      definition.target
    );
  }
  return getNthDateKey(activeDateKeys, definition.target);
}

function getNthDateKey(dateKeys: string[], target: number): string | undefined {
  const sorted = [...new Set(dateKeys)]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return sorted[Math.max(0, target - 1)];
}

function getTokenAchievementDate(dailyRows: ApiUsageDailySummary[], target: number): string | undefined {
  let total = 0;
  const sortedRows = [...dailyRows].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  for (const row of sortedRows) {
    total += row.totalTokens;
    if (total >= target) return row.dateKey;
  }
  return undefined;
}

function getAchievementCurrent(
  definition: ApiAchievementDefinition,
  summary: ApiUsageSummary,
  activeDateKeys: string[],
  anniversaryCheckIns: string[]
): number {
  if (definition.metric === 'totalTokens') return summary.totalTokens;
  if (definition.category === 'anniversary' && definition.year) {
    const dateKey = anniversaryDateKey(definition.year);
    return activeDateKeys.includes(dateKey) || anniversaryCheckIns.includes(dateKey) ? 1 : 0;
  }
  if (definition.category === 'season' && definition.year && definition.season) {
    return countSeasonDateKeys(activeDateKeys, definition.year, definition.season);
  }
  return countUniqueDateKeys(activeDateKeys);
}

function countUniqueDateKeys(dateKeys: string[]): number {
  return new Set(dateKeys.filter(Boolean)).size;
}

function countSeasonDateKeys(dateKeys: string[], year: number, season: ApiAchievementSeason): number {
  return new Set(dateKeys.filter((key) => isDateKeyInSeason(key, year, season))).size;
}

function isDateKeyInSeason(key: string, seasonYear: number, season: ApiAchievementSeason): boolean {
  const [year, month] = key.split('-').map((part) => parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return false;
  if (season === 'spring') return year === seasonYear && month >= 3 && month <= 5;
  if (season === 'summer') return year === seasonYear && month >= 6 && month <= 8;
  if (season === 'autumn') return year === seasonYear && month >= 9 && month <= 11;
  return (year === seasonYear && month === 12) || (year === seasonYear + 1 && month >= 1 && month <= 2);
}

function buildAchievementGroups(
  companionRows: EvaluatedAchievement[],
  tokenRows: EvaluatedAchievement[],
  anniversaryRows: EvaluatedAchievement[],
  allRows: EvaluatedAchievement[]
): AchievementGroup[] {
  const seasonRows = allRows.filter((row) => row.definition.category === 'season');
  return [
    {
      key: 'companion-days',
      title: '累计陪伴天数',
      meta: '30 / 100 / 365 / 520 / 999 天',
      rows: companionRows,
    },
    {
      key: 'total-tokens',
      title: '累计 Token',
      meta: '1 亿 / 10 亿 / 100 亿 / 1000 亿 / 100000 亿',
      rows: tokenRows,
    },
    {
      key: 'anniversary',
      title: '周年纪念日',
      meta: '每年 5 月 6 日登录',
      rows: anniversaryRows,
    },
    ...(['spring', 'summer', 'autumn', 'winter'] as const).map((season) => ({
      key: `season-${season}`,
      title: `${formatSeasonLabel(season)}日限定`,
      meta: '每季累计陪伴 60 天',
      rows: seasonRows.filter((row) => row.definition.season === season),
    })),
  ].filter((group) => group.rows.length > 0);
}

function getGroupDisplayIndex(rows: EvaluatedAchievement[]): number {
  const achievedIndexes = rows
    .map((row, index) => (row.achieved ? index : -1))
    .filter((index) => index >= 0);
  if (achievedIndexes.length > 0) return achievedIndexes[achievedIndexes.length - 1];
  const nextIndex = rows.findIndex((row) => !row.achieved);
  return nextIndex >= 0 ? nextIndex : 0;
}

function getGroupDisplayRow(rows: EvaluatedAchievement[]): EvaluatedAchievement | null {
  if (rows.length === 0) return null;
  return rows[getGroupDisplayIndex(rows)] ?? rows[0];
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function anniversaryDateKey(year: number): string {
  return `${year}-05-06`;
}

function isAnniversaryDateKey(dateKey: string): boolean {
  const [year, month, day] = dateKey.split('-').map((part) => parseInt(part, 10));
  return year >= 2027 && month === 5 && day === 6;
}

function getAchievementYears(dateKeys: string[], anniversaryCheckIns: string[]): number[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  let maxYear = Math.max(2027, currentYear);

  [...dateKeys, ...anniversaryCheckIns].forEach((key) => {
    const [year, month] = key.split('-').map((part) => parseInt(part, 10));
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;
    maxYear = Math.max(maxYear, month <= 2 ? year - 1 : year, year);
  });

  const years: number[] = [];
  for (let year = 2026; year <= maxYear; year += 1) {
    years.push(year);
  }
  return years;
}

function formatCondition(definition: ApiAchievementDefinition): string {
  if (definition.category === 'companionDays') {
    return `累计陪伴 ${formatNumber(definition.target)} 天`;
  }
  if (definition.category === 'season' && definition.year && definition.season) {
    return `${definition.year} ${formatSeasonLabel(definition.season)} · 累计陪伴 ${definition.target} 天`;
  }
  if (definition.category === 'anniversary' && definition.year) {
    return `${definition.year} 年 5 月 6 日登录`;
  }
  return `累计 ${formatMetricValue(definition.target, 'totalTokens')}`;
}

function formatConditionFromDraft(draft: AchievementDraft): string {
  if (draft.category === 'companionDays') return `累计陪伴 ${formatNumber(draft.target)} 天`;
  if (draft.category === 'season' && draft.year && draft.season) {
    return `${draft.year} ${formatSeasonLabel(draft.season)} · 累计陪伴 ${draft.target} 天`;
  }
  if (draft.category === 'anniversary' && draft.year) {
    return `${draft.year} 年 5 月 6 日登录`;
  }
  return `累计 ${formatMetricValue(draft.target, 'totalTokens')}`;
}

function formatSeasonLabel(season: ApiAchievementSeason): string {
  if (season === 'spring') return '春';
  if (season === 'summer') return '夏';
  if (season === 'autumn') return '秋';
  return '冬';
}

function formatMetricValue(value: number, metric: ApiAchievementMetric): string {
  if (metric === 'activeDays') return `${formatNumber(value)} 天`;
  return `${formatCompactNumber(value)} tokens`;
}

function formatAchievementDate(dateKey?: string): string {
  if (!dateKey) return '已获得';
  const [year, month, day] = dateKey.split('-').map((part) => parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dateKey;
  return `${year}.${month}.${day}`;
}

function formatLockedWallCondition(row: EvaluatedAchievement): string {
  if (row.definition.category === 'anniversary' && row.definition.year) {
    return `${row.definition.year}.5.6 登录`;
  }
  if (row.definition.category === 'season') {
    return `当前进度 ${formatNumber(row.current)}/${formatNumber(row.target)}`;
  }
  if (row.definition.metric === 'totalTokens') {
    return `当前进度 ${formatCompactNumber(row.current)}/${formatCompactNumber(row.target)}`;
  }
  return `当前进度 ${formatNumber(row.current)}/${formatNumber(row.target)}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
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
    fontWeight: '800',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 36,
    gap: 18,
  },
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 34,
  },
  badgeWallItem: {
    width: '30.5%',
    minWidth: 96,
    flexGrow: 1,
    alignItems: 'center',
  },
  badgeWallName: {
    width: '100%',
    marginTop: 12,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  badgeWallMeta: {
    width: '100%',
    marginTop: 8,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  badgeWallMetaLocked: {
    color: colors.textTertiary,
  },
  medalShell: {
    borderRadius: 999,
    padding: 5,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  medalShellWall: {
    padding: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  medalGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    overflow: 'hidden',
  },
  badgeImageWrap: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  badgeImage: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
  badgeImageLockedOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(107, 114, 128, 0.62)',
  },
  badgeName: {
    width: '100%',
    marginTop: 9,
    minHeight: 20,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  badgeCondition: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  badgeDescription: {
    width: '100%',
    marginTop: 4,
    minHeight: 30,
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    marginTop: 10,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  progressFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  progressFillAchieved: {
    backgroundColor: colors.success,
  },
  badgeProgress: {
    marginTop: 7,
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  loading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 28,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  editorPanel: {
    maxHeight: '90%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stagePanel: {
    width: '100%',
    maxHeight: '86%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  editorTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  stageTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  stageSubtitle: {
    marginTop: 3,
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
  },
  editorCloseButton: {
    minHeight: 32,
    justifyContent: 'center',
  },
  editorCloseText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  editorContent: {
    padding: 16,
    paddingBottom: 28,
    gap: 14,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  input: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 14,
  },
  descriptionInput: {
    minHeight: 82,
    paddingTop: 10,
    lineHeight: 20,
  },
  lockedCondition: {
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    padding: 12,
    gap: 4,
  },
  lockedConditionLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '800',
  },
  lockedConditionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  imagePickerPanel: {
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    padding: 14,
  },
  imagePickerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  imageButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
  },
  imageButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryImageButton: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  secondaryImageButtonText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
  },
  stageListContent: {
    paddingVertical: 18,
  },
  stagePage: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 34,
  },
  stageIndex: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  stageName: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
    textAlign: 'center',
  },
  stageDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  editStageButton: {
    width: '100%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  editStageButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  editorActions: {
    flexDirection: 'row',
    gap: 10,
  },
  saveButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});

let styles = createStyles(colors);
