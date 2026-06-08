import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, Alert, Modal, FlatList, Switch, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';

import { fonts } from '../src/theme/fonts';
import { useSettingsStore, NamedAPIConfig, TTSConfig, MemoryVaultConfig, WebSearchConfig, type ChatInputIconKey, type ChatInputAppearanceStyle, type AssistantBubbleAppearanceStyle, type ShizukuFileRoot, type StickerOwner, type CustomSticker } from '../src/stores/settings';
import { TopBarIcon, TOP_BAR_ICON_ITEMS } from '../src/components/TopBarIcon';
import type { TopBarIconKey } from '../src/utils/topBarIconTypes';
import { useChatStore } from '../src/stores/chat';
import { useDiaryStore } from '../src/stores/diary';
import { playTTS, stopTTS } from '../src/services/tts';
import { streamChat } from '../src/services/api';
import { Diary, HiddenRange } from '../src/types';
import { getChatDiagnosticsConversation, getFavoriteDiaries, type ChatDiagnosticsMessage } from '../src/db/operations';
import { uploadDiary } from '../src/services/tools';
import { formatFullTime, formatDateOnly } from '../src/utils/time';
import { importMyphonePrivateChatsFromPicker } from '../src/services/myphoneImport';
import {
  createShizukuRoot,
  getShizukuStatus,
  requestShizukuPermission,
  type ShizukuStatus,
} from '../src/services/shizukuFiles';
import {
  DEFAULT_HOTBOARD_PLATFORM_TYPES,
  HOTBOARD_PLATFORMS,
  normalizeHotboardPlatformTypes,
} from '../src/utils/hotboardPlatforms';
import {
  canDrawFloatingBall,
  hideFloatingBall,
  openFloatingBallPermissionSettings,
  showFloatingBall,
  syncFloatingBallAssets,
} from '../src/services/floatingBall';
import { createAndShareBackup, pickBackupFile, restoreBackup, type PickedBackup } from '../src/services/backup';
import { useKeyboardHeight } from '../src/hooks/useKeyboardHeight';
import { buildStickerDefinitions, normalizeStickerName } from '../src/utils/stickers';
import { mergeRanges } from '../src/utils/ranges';


let colors = lightColors;
const TABS = ['API 配置', '对话设置', 'TTS 配置', 'Tool 设置', '日记', '悬浮球', '表情包', '欢迎语', '美化'] as const;
type ToastFn = (message: string) => void;
type SettingsTabProps = { showToast: ToastFn; keyboardBottomInset: number };
const CUSTOM_TOP_BAR_ICON_MAX_BYTES = 2 * 1024 * 1024;
const CUSTOM_TOP_BAR_ICON_MIN_SIDE = 48;
const CUSTOM_TOP_BAR_ICON_MAX_SIDE = 2048;
const CUSTOM_BACKGROUND_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOM_BACKGROUND_MIN_SIDE = 320;
const CUSTOM_BACKGROUND_MAX_SIDE = 6000;
const CUSTOM_STICKER_MAX_BYTES = 5 * 1024 * 1024;
const CUSTOM_STICKER_MIN_SIDE = 32;
const CUSTOM_STICKER_MAX_SIDE = 4096;
const CUSTOM_FLOATING_BALL_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOM_FLOATING_BALL_MIN_SIDE = 24;
const CUSTOM_FLOATING_BALL_MAX_SIDE = 2048;
const CUSTOM_FLOATING_BALL_SELECTION_LIMIT = 50;
const FLOATING_BALL_SIZE_DEFAULT = 64;
const FLOATING_BALL_SIZE_MIN = 32;
const FLOATING_BALL_SIZE_MAX = 160;
const CHAT_INPUT_ICON_ITEMS: Array<{ key: ChatInputIconKey; label: string }> = [
  { key: 'options', label: '左侧菜单' },
  { key: 'sticker', label: '贴纸' },
  { key: 'sendIdle', label: '发送/回复' },
  { key: 'sendFocused', label: '聚焦发送' },
  { key: 'stop', label: '停止生成' },
];
const COLOR_SWATCHES = ['#f1eee7', '#FFFFFF', '#FDE68A', '#BFDBFE', '#FBCFE8', '#DCFCE7', '#2B241D', '#141413'];

export default function SettingsScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const [activeTab, setActiveTab] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  function showToast(message: string) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1800);
  }

  return (
    <View style={[styles.container, { paddingBottom: keyboardHeight }]}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.title}>设置</Text>
        <View style={styles.backButton} />
      </View>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {TABS.map((tab, i) => (
          <Pressable
            key={tab}
            style={[styles.tab, i === activeTab && styles.tabActive]}
            onPress={() => setActiveTab(i)}
          >
            <Text style={[styles.tabText, i === activeTab && styles.tabTextActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {activeTab === 0 && <APIConfigTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 1 && <ChatSettingsTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 2 && <TTSConfigTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 3 && <ToolConfigTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 4 && <DiaryTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 5 && <FloatingBallTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 6 && <StickerTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 7 && <GreetingTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 8 && <AppearanceTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}

      {toastMessage && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
    </View>
  );
}

/* ==================== 欢迎语 Tab ==================== */

function GreetingTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const { appearanceConfig, setAppearanceConfig } = useSettingsStore();
  const customGreetings = appearanceConfig?.customGreetings || '';
  const useDefaultGreetings = !!appearanceConfig?.useDefaultGreetings;
  const defaultGreetingName = appearanceConfig?.defaultGreetingName || '';

  function handleDefaultGreetingToggle(value: boolean) {
    if (value && !defaultGreetingName.trim()) {
      Alert.alert('需要填写名字', '请先填写你的名字，用于替换内置欢迎语里的 user。');
      return;
    }
    setAppearanceConfig({ useDefaultGreetings: value });
    showToast(value ? '系统默认欢迎语已开启' : '系统默认欢迎语已关闭');
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>系统默认欢迎语</Text>
          <Text style={styles.hint}>开启后，内置欢迎语会和用户自定义欢迎语一起随机抽取。</Text>
        </View>
        <Switch
          value={useDefaultGreetings}
          onValueChange={handleDefaultGreetingToggle}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>你的名字</Text>
        <TextInput
          style={styles.input}
          value={defaultGreetingName}
          onChangeText={(value) => setAppearanceConfig({ defaultGreetingName: value })}
          placeholder="user"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
        />
        <Text style={styles.hint}>用于替换内置欢迎语里的 user，例如 Welcome,user。</Text>
      </View>

      <Text style={styles.sectionTitle}>欢迎语池</Text>
      <Text style={styles.hint}>每行一条，聊天页空状态刷新时会随机抽取一条。留空时显示 What shall we think through?</Text>
      <TextInput
        style={[styles.input, styles.multilineInput, styles.greetingInput]}
        value={customGreetings}
        onChangeText={(value) => setAppearanceConfig({ customGreetings: value })}
        multiline
        placeholder={'What shall we think through?\n今天想拆哪件事？'}
        placeholderTextColor={colors.textTertiary}
        textAlignVertical="top"
      />
    </ScrollView>
  );
}

/* ==================== 美化 Tab ==================== */

function topBarIconExtension(asset: ImagePicker.ImagePickerAsset): string {
  const mimeType = asset.mimeType?.toLowerCase();
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';

  const cleanUri = asset.uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.png')) return '.png';
  if (cleanUri.endsWith('.webp')) return '.webp';
  if (cleanUri.endsWith('.gif')) return '.gif';
  if (cleanUri.endsWith('.jpeg')) return '.jpg';
  if (cleanUri.endsWith('.jpg')) return '.jpg';
  return '.png';
}

async function copyTopBarIcon(asset: ImagePicker.ImagePickerAsset, key: TopBarIconKey): Promise<string> {
  const dir = new Directory(Paths.document, 'top-bar-icons');
  dir.create({ intermediates: true, idempotent: true });

  const source = new File(asset.uri);
  const destination = new File(dir, `${key}-${randomUUID()}${topBarIconExtension(asset)}`);
  await source.copy(destination, { overwrite: true });
  return destination.uri;
}

async function copyAppearanceImage(
  asset: ImagePicker.ImagePickerAsset,
  directoryName: string,
  prefix: string
): Promise<string> {
  const dir = new Directory(Paths.document, directoryName);
  dir.create({ intermediates: true, idempotent: true });

  const source = new File(asset.uri);
  const destination = new File(dir, `${prefix}-${randomUUID()}${topBarIconExtension(asset)}`);
  await source.copy(destination, { overwrite: true });
  return destination.uri;
}

function validateFloatingBallAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  const mimeType = asset.mimeType?.toLowerCase();
  const extension = topBarIconExtension(asset);
  const isAllowedType =
    mimeType === 'image/png' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg' ||
    mimeType === 'image/gif' ||
    ['.png', '.jpg', '.gif'].includes(extension);

  if (!isAllowedType) {
    return '只支持 PNG、JPG 或 GIF';
  }
  if (asset.fileSize && asset.fileSize > CUSTOM_FLOATING_BALL_MAX_BYTES) {
    return '图片不能超过 8MB';
  }
  if (asset.width < CUSTOM_FLOATING_BALL_MIN_SIDE || asset.height < CUSTOM_FLOATING_BALL_MIN_SIDE) {
    return `图片边长至少 ${CUSTOM_FLOATING_BALL_MIN_SIDE}px`;
  }
  if (asset.width > CUSTOM_FLOATING_BALL_MAX_SIDE || asset.height > CUSTOM_FLOATING_BALL_MAX_SIDE) {
    return `图片边长不能超过 ${CUSTOM_FLOATING_BALL_MAX_SIDE}px`;
  }
  return null;
}

async function copyFloatingBallImage(asset: ImagePicker.ImagePickerAsset, prefix: string): Promise<string> {
  return copyAppearanceImage(asset, 'floating-ball-assets', prefix);
}

function mergeUniqueUris(existing: string[], next: string[], limit?: number): string[] {
  const merged = Array.from(new Set([...existing, ...next].map((uri) => uri.trim()).filter(Boolean)));
  return typeof limit === 'number' ? merged.slice(0, limit) : merged;
}

function validateTopBarIconAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  if (asset.fileSize && asset.fileSize > CUSTOM_TOP_BAR_ICON_MAX_BYTES) {
    return '图片不能超过 2MB';
  }
  if (
    asset.width < CUSTOM_TOP_BAR_ICON_MIN_SIDE ||
    asset.height < CUSTOM_TOP_BAR_ICON_MIN_SIDE
  ) {
    return `图片边长至少 ${CUSTOM_TOP_BAR_ICON_MIN_SIDE}px`;
  }
  if (
    asset.width > CUSTOM_TOP_BAR_ICON_MAX_SIDE ||
    asset.height > CUSTOM_TOP_BAR_ICON_MAX_SIDE
  ) {
    return `图片边长不能超过 ${CUSTOM_TOP_BAR_ICON_MAX_SIDE}px`;
  }
  return null;
}

function validateBackgroundAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  if (asset.fileSize && asset.fileSize > CUSTOM_BACKGROUND_MAX_BYTES) {
    return '图片不能超过 8MB';
  }
  if (
    asset.width < CUSTOM_BACKGROUND_MIN_SIDE ||
    asset.height < CUSTOM_BACKGROUND_MIN_SIDE
  ) {
    return `图片边长至少 ${CUSTOM_BACKGROUND_MIN_SIDE}px`;
  }
  if (
    asset.width > CUSTOM_BACKGROUND_MAX_SIDE ||
    asset.height > CUSTOM_BACKGROUND_MAX_SIDE
  ) {
    return `图片边长不能超过 ${CUSTOM_BACKGROUND_MAX_SIDE}px`;
  }
  return null;
}

function validateStickerAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  if (asset.fileSize && asset.fileSize > CUSTOM_STICKER_MAX_BYTES) {
    return '图片不能超过 5MB';
  }
  if (
    asset.width < CUSTOM_STICKER_MIN_SIDE ||
    asset.height < CUSTOM_STICKER_MIN_SIDE
  ) {
    return `图片边长至少 ${CUSTOM_STICKER_MIN_SIDE}px`;
  }
  if (
    asset.width > CUSTOM_STICKER_MAX_SIDE ||
    asset.height > CUSTOM_STICKER_MAX_SIDE
  ) {
    return `图片边长不能超过 ${CUSTOM_STICKER_MAX_SIDE}px`;
  }
  return null;
}

function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}

function parseAppearanceNumber(value: string, fallback: number, min: number, max: number): number {
  const next = parseInt(value, 10);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function parseStickerImportLine(line: string): { name: string; uri: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/https?:\/\/\S+/i);
  if (!match || match.index === undefined) return null;

  const uri = match[0].replace(/[，,。；;]+$/, '');
  const rawName = trimmed.slice(0, match.index).replace(/[\s:：]+$/, '');
  const name = normalizeStickerName(rawName);
  if (!name || !uri) return null;
  return { name, uri };
}

function StickerTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const {
    stickerConfig,
    setStickerSuggestionsEnabled,
    addSticker,
    updateSticker,
    removeSticker,
  } = useSettingsStore();
  const [stickerOwner, setStickerOwner] = useState<StickerOwner>('user');
  const [stickerName, setStickerName] = useState('');
  const [bulkImportText, setBulkImportText] = useState('');
  const [pickingSticker, setPickingSticker] = useState<string | null>(null);
  const userStickers = stickerConfig?.userStickers || [];
  const assistantStickers = stickerConfig?.assistantStickers || [];
  const stickerSuggestionsEnabled = stickerConfig?.stickerSuggestionsEnabled ?? true;
  const currentStickers = stickerOwner === 'user' ? userStickers : assistantStickers;

  function getStickerList(owner: StickerOwner): CustomSticker[] {
    return owner === 'user' ? userStickers : assistantStickers;
  }

  function validateStickerName(owner: StickerOwner, name: string, ignoreId?: string): string | null {
    const normalizedName = normalizeStickerName(name);
    if (!normalizedName) return '请先填写表情包名称';
    const duplicated = getStickerList(owner).some(
      (sticker) => sticker.id !== ignoreId && normalizeStickerName(sticker.name) === normalizedName
    );
    if (duplicated) return '同一组里已经有这个名称了';
    return null;
  }

  async function pickStickerAsset(): Promise<ImagePicker.ImagePickerAsset | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]?.uri) return null;

    const asset = result.assets[0];
    const validationError = validateStickerAsset(asset);
    if (validationError) {
      Alert.alert('图片不适合作为表情包', validationError);
      return null;
    }
    return asset;
  }

  async function handleAddSticker() {
    const owner = stickerOwner;
    const normalizedName = normalizeStickerName(stickerName);
    const nameError = validateStickerName(owner, normalizedName);
    if (nameError) {
      Alert.alert('无法添加表情包', nameError);
      return;
    }

    setPickingSticker(`${owner}-new`);
    try {
      const asset = await pickStickerAsset();
      if (!asset) return;

      const uri = await copyAppearanceImage(asset, 'custom-stickers', `${owner}-sticker`);
      addSticker(owner, {
        id: `sticker-${randomUUID()}`,
        name: normalizedName,
        uri,
        createdAt: Date.now(),
      });
      setStickerName('');
      showToast(owner === 'user' ? '我的表情包已添加' : 'AI 表情包已添加');
    } catch (error: any) {
      Alert.alert('添加表情包失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingSticker(null);
    }
  }

  async function handleReplaceStickerImage(owner: StickerOwner, sticker: CustomSticker) {
    if (pickingSticker) return;
    setPickingSticker(sticker.id);
    try {
      const asset = await pickStickerAsset();
      if (!asset) return;

      const uri = await copyAppearanceImage(asset, 'custom-stickers', `${owner}-sticker`);
      updateSticker(owner, sticker.id, { uri });
      showToast('表情包图片已更新');
    } catch (error: any) {
      Alert.alert('替换表情包失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingSticker(null);
    }
  }

  function handleRenameSticker(owner: StickerOwner, sticker: CustomSticker, value: string) {
    updateSticker(owner, sticker.id, { name: value });
  }

  function handleBlurStickerName(owner: StickerOwner, sticker: CustomSticker) {
    const normalizedName = normalizeStickerName(sticker.name);
    const nameError = validateStickerName(owner, normalizedName, sticker.id);
    if (nameError) {
      Alert.alert('表情包名称不可用', nameError);
      return;
    }
    updateSticker(owner, sticker.id, { name: normalizedName });
  }

  function handleRemoveSticker(owner: StickerOwner, sticker: CustomSticker) {
    Alert.alert('删除表情包', `确定删除「${sticker.name || '未命名'}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removeSticker(owner, sticker.id);
          showToast('表情包已删除');
        },
      },
    ]);
  }

  function handleBulkImport() {
    const owner = stickerOwner;
    const existingNames = new Set(getStickerList(owner).map((sticker) => normalizeStickerName(sticker.name)));
    const importedNames = new Set<string>();
    const parsed = bulkImportText
      .split(/\r?\n/)
      .map(parseStickerImportLine)
      .filter((item): item is { name: string; uri: string } => !!item);
    let importedCount = 0;
    let skippedCount = 0;

    parsed.forEach((item) => {
      if (existingNames.has(item.name) || importedNames.has(item.name)) {
        skippedCount += 1;
        return;
      }
      importedNames.add(item.name);
      addSticker(owner, {
        id: `sticker-${randomUUID()}`,
        name: item.name,
        uri: item.uri,
        createdAt: Date.now(),
      });
      importedCount += 1;
    });

    if (importedCount === 0) {
      Alert.alert('没有可导入的表情包', '请按“名称 链接”一行一个填写，名称和链接之间可用空格、中文冒号或英文冒号。');
      return;
    }

    setBulkImportText('');
    showToast(skippedCount > 0 ? `已导入 ${importedCount} 个，跳过 ${skippedCount} 个重名` : `已导入 ${importedCount} 个表情包`);
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>表情包管理</Text>
      <Text style={styles.hint}>
        assets 里的用户/AI 表情包会作为默认配置显示，也可以改名、换图或删除。
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>输入时推荐表情包</Text>
          <Text style={styles.hint}>在聊天输入框上方显示和文字匹配的“我的表情包”。</Text>
        </View>
        <Switch
          value={stickerSuggestionsEnabled}
          onValueChange={(value) => {
            setStickerSuggestionsEnabled(value);
            showToast(value ? '表情包推荐已开启' : '表情包推荐已关闭');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <View style={styles.segmentedRow}>
        {([
          { key: 'user' as const, label: `我的表情包 ${userStickers.length}` },
          { key: 'assistant' as const, label: `AI 表情包 ${assistantStickers.length}` },
        ]).map((item) => (
          <Pressable
            key={item.key}
            style={[styles.segmentedButton, stickerOwner === item.key && styles.segmentedButtonActive]}
            onPress={() => setStickerOwner(item.key)}
          >
            <Text style={[styles.segmentedText, stickerOwner === item.key && styles.segmentedTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>上传图片</Text>
      <View style={styles.stickerAddRow}>
        <TextInput
          style={[styles.input, styles.stickerNameInput]}
          value={stickerName}
          onChangeText={setStickerName}
          placeholder="表情包名称"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
        />
        <Pressable
          style={[styles.appearanceThemeSaveButton, pickingSticker !== null && styles.smallActionButtonDisabled]}
          onPress={handleAddSticker}
          disabled={pickingSticker !== null}
        >
          {pickingSticker === `${stickerOwner}-new` ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.saveButtonText}>上传</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>链接批量导入</Text>
      <TextInput
        style={[styles.input, styles.multilineInput, styles.bulkImportInput]}
        value={bulkImportText}
        onChangeText={setBulkImportText}
        multiline
        placeholder={'好喜欢 https://example.com/a.png\n得逞：https://example.com/b.webp\n哭哭: https://example.com/c.jpg'}
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
      />
      <Pressable style={styles.importButton} onPress={handleBulkImport}>
        <Text style={styles.importButtonText}>导入链接</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>当前清单</Text>
      <View style={styles.customStickerList}>
        {currentStickers.length === 0 ? (
          <View style={styles.customStickerEmpty}>
            <Text style={styles.emptyText}>这一组已经没有表情包了。</Text>
          </View>
        ) : (
          currentStickers.map((sticker) => {
            const isPicking = pickingSticker === sticker.id;
            const definition = buildStickerDefinitions([sticker])[0];
            return (
              <View key={sticker.id} style={styles.customStickerRow}>
                <View style={styles.customStickerPreview}>
                  {definition ? (
                    <Image source={definition.image} style={styles.customStickerImage} resizeMode="contain" />
                  ) : (
                    <Text style={styles.appearanceImagePlaceholder}>ST</Text>
                  )}
                </View>
                <TextInput
                  style={[styles.input, styles.customStickerNameInput]}
                  value={sticker.name}
                  onChangeText={(value) => handleRenameSticker(stickerOwner, sticker, value)}
                  onBlur={() => handleBlurStickerName(stickerOwner, sticker)}
                  placeholder="表情包名称"
                  placeholderTextColor={colors.textTertiary}
                />
                <View style={styles.appearanceIconActions}>
                  <Pressable
                    style={[styles.smallActionButton, isPicking && styles.smallActionButtonDisabled]}
                    onPress={() => handleReplaceStickerImage(stickerOwner, sticker)}
                    disabled={pickingSticker !== null}
                  >
                    {isPicking ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>换图</Text>}
                  </Pressable>
                  <Pressable
                    style={styles.smallActionButton}
                    onPress={() => handleRemoveSticker(stickerOwner, sticker)}
                  >
                    <Text style={styles.smallActionText}>删除</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function AppearanceTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const {
    appearanceConfig,
    setAppearanceConfig,
    setTopBarIconUri,
    clearTopBarIconUri,
    resetTopBarIcons,
    setChatInputIconUri,
    clearChatInputIconUri,
    resetChatInputIcons,
    saveAppearanceTheme,
    updateAppearanceTheme,
    applyAppearanceTheme,
    removeAppearanceTheme,
    resetAppearanceConfig,
  } = useSettingsStore();
  const [pickingKey, setPickingKey] = useState<TopBarIconKey | null>(null);
  const [pickingInputIconKey, setPickingInputIconKey] = useState<ChatInputIconKey | null>(null);
  const [pickingBackground, setPickingBackground] = useState<'chat' | 'input' | null>(null);
  const [pickingAvatar, setPickingAvatar] = useState<'user' | 'assistant' | null>(null);
  const [appearanceThemeName, setAppearanceThemeName] = useState('');
  const [appearanceThemesExpanded, setAppearanceThemesExpanded] = useState(false);
  const [userBubbleColorInput, setUserBubbleColorInput] = useState(appearanceConfig?.userBubbleColor || colors.userBubble);
  const [assistantBubbleColorInput, setAssistantBubbleColorInput] = useState(appearanceConfig?.assistantBubbleColor || colors.userBubble);
  const [userTextColorInput, setUserTextColorInput] = useState(appearanceConfig?.userTextColor || colors.text);
  const [assistantTextColorInput, setAssistantTextColorInput] = useState(appearanceConfig?.assistantTextColor || colors.text);
  const [assistantTextStrokeColorInput, setAssistantTextStrokeColorInput] = useState(appearanceConfig?.assistantTextStrokeColor || colors.background);
  const [assistantFooterColorInput, setAssistantFooterColorInput] = useState(appearanceConfig?.assistantFooterColor || colors.textTertiary);
  const appearanceThemes = appearanceConfig?.appearanceThemes || [];
  const activeAppearanceThemeId = appearanceConfig?.activeAppearanceThemeId;
  const topBarIconUris = appearanceConfig?.topBarIconUris || {};
  const topBarIconsHidden = !!appearanceConfig?.topBarIconsHidden;
  const topBarFadeHidden = !!appearanceConfig?.topBarFadeHidden;
  const inputIconUris = appearanceConfig?.inputIconUris || {};
  const inputStyle = appearanceConfig?.inputStyle || 'default';
  const inputBlurIntensity = appearanceConfig?.inputBlurIntensity ?? 72;
  const inputBackgroundTransparent = !!appearanceConfig?.inputBackgroundTransparent;
  const userBubbleTransparent = !!appearanceConfig?.userBubbleTransparent;
  const userBubbleWidthPercent = appearanceConfig?.userBubbleWidthPercent ?? 75;
  const assistantBubbleStyle = appearanceConfig?.assistantBubbleStyle || 'plain';
  const assistantBubbleTransparent = !!appearanceConfig?.assistantBubbleTransparent;
  const assistantBubbleWidthPercent = appearanceConfig?.assistantBubbleWidthPercent ?? 75;
  const messageAvatarsVisible = !!appearanceConfig?.messageAvatarsVisible;
  const messageMetaVisible = appearanceConfig?.messageMetaVisible ?? true;
  const userAvatarImageUri = appearanceConfig?.userAvatarImageUri;
  const assistantAvatarImageUri = appearanceConfig?.assistantAvatarImageUri;
  const messageAvatarRadius = appearanceConfig?.messageAvatarRadius ?? 18;
  const userDisplayName = appearanceConfig?.userDisplayName ?? 'You';
  const assistantDisplayName = appearanceConfig?.assistantDisplayName ?? 'Claude';
  const assistantFooterHidden = !!appearanceConfig?.assistantFooterHidden;
  const assistantActionsHidden = !!appearanceConfig?.assistantActionsHidden;
  const userBubbleRadius = appearanceConfig?.userBubbleRadius ?? 20;
  const userBubbleBlurIntensity = appearanceConfig?.userBubbleBlurIntensity ?? 0;
  const assistantBubbleRadius = appearanceConfig?.assistantBubbleRadius ?? 20;
  const assistantBubbleBlurIntensity = appearanceConfig?.assistantBubbleBlurIntensity ?? 0;
  const userFontSize = appearanceConfig?.userFontSize ?? 16;
  const assistantFontSize = appearanceConfig?.assistantFontSize ?? 16;
  const assistantTextStrokeWidth = appearanceConfig?.assistantTextStrokeWidth ?? 0;
  useEffect(() => {
    setUserBubbleColorInput(appearanceConfig?.userBubbleColor || colors.userBubble);
    setAssistantBubbleColorInput(appearanceConfig?.assistantBubbleColor || colors.userBubble);
    setUserTextColorInput(appearanceConfig?.userTextColor || colors.text);
    setAssistantTextColorInput(appearanceConfig?.assistantTextColor || colors.text);
    setAssistantTextStrokeColorInput(appearanceConfig?.assistantTextStrokeColor || colors.background);
    setAssistantFooterColorInput(appearanceConfig?.assistantFooterColor || colors.textTertiary);
  }, [
    appearanceConfig?.assistantFooterColor,
    appearanceConfig?.assistantBubbleColor,
    appearanceConfig?.assistantTextStrokeColor,
    appearanceConfig?.assistantTextColor,
    appearanceConfig?.userBubbleColor,
    appearanceConfig?.userTextColor,
  ]);

  async function handlePickIcon(key: TopBarIconKey) {
    if (pickingKey) return;
    setPickingKey(key);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;

      const asset = result.assets[0];
      const validationError = validateTopBarIconAsset(asset);
      if (validationError) {
        Alert.alert('图片不适合用作图标', validationError);
        return;
      }

      const uri = await copyTopBarIcon(asset, key);
      setTopBarIconUri(key, uri);
      showToast('顶栏图标已更新');
    } catch (error: any) {
      Alert.alert('更换图标失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingKey(null);
    }
  }

  function handleResetAll() {
    resetTopBarIcons();
    showToast('已恢复默认顶栏图标');
  }

  async function handlePickBackground(kind: 'chat' | 'input') {
    if (pickingBackground) return;
    setPickingBackground(kind);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;

      const asset = result.assets[0];
      const validationError = validateBackgroundAsset(asset);
      if (validationError) {
        Alert.alert('图片不适合作为背景', validationError);
        return;
      }

      const uri = await copyAppearanceImage(
        asset,
        kind === 'chat' ? 'chat-backgrounds' : 'chat-input-backgrounds',
        kind === 'chat' ? 'chat-bg' : 'input-bg'
      );
      setAppearanceConfig(
        kind === 'chat'
          ? { chatBackgroundImageUri: uri }
          : { inputBackgroundImageUri: uri }
      );
      showToast(kind === 'chat' ? '聊天背景已更新' : '输入框背景已更新');
    } catch (error: any) {
      Alert.alert('选择背景失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingBackground(null);
    }
  }

  async function handlePickAvatar(kind: 'user' | 'assistant') {
    if (pickingAvatar) return;
    setPickingAvatar(kind);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;

      const asset = result.assets[0];
      const validationError = validateTopBarIconAsset(asset);
      if (validationError) {
        Alert.alert('图片不适合作为头像', validationError);
        return;
      }

      const uri = await copyAppearanceImage(asset, 'chat-avatars', `${kind}-avatar`);
      setAppearanceConfig(
        kind === 'user'
          ? { userAvatarImageUri: uri }
          : { assistantAvatarImageUri: uri }
      );
      showToast(kind === 'user' ? '用户头像已更新' : 'AI 头像已更新');
    } catch (error: any) {
      Alert.alert('选择头像失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingAvatar(null);
    }
  }

  async function handlePickInputIcon(key: ChatInputIconKey) {
    if (pickingInputIconKey) return;
    setPickingInputIconKey(key);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;

      const asset = result.assets[0];
      const validationError = validateTopBarIconAsset(asset);
      if (validationError) {
        Alert.alert('图片不适合作为按钮图标', validationError);
        return;
      }

      const uri = await copyAppearanceImage(asset, 'chat-input-icons', key);
      setChatInputIconUri(key, uri);
      showToast('输入框图标已更新');
    } catch (error: any) {
      Alert.alert('替换图标失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingInputIconKey(null);
    }
  }

  function commitColor(
    label: string,
    value: string,
    key:
      | 'userBubbleColor'
      | 'assistantBubbleColor'
      | 'userTextColor'
      | 'assistantTextColor'
      | 'assistantTextStrokeColor'
      | 'assistantFooterColor'
  ) {
    const next = value.trim();
    if (!isHexColor(next)) {
      Alert.alert('颜色格式不正确', `${label} 需要使用 #RRGGBB 格式`);
      return;
    }
    setAppearanceConfig({ [key]: next });
    showToast(`${label}已更新`);
  }

  function setInputStyle(nextStyle: ChatInputAppearanceStyle) {
    setAppearanceConfig({ inputStyle: nextStyle });
    showToast(nextStyle === 'glass' ? '输入框已切换为磨砂玻璃' : '输入框已切换为默认风格');
  }

  function setAssistantBubbleStyle(nextStyle: AssistantBubbleAppearanceStyle) {
    setAppearanceConfig({ assistantBubbleStyle: nextStyle });
    showToast(nextStyle === 'bubble' ? 'AI 气泡已切换为用户气泡样式' : 'AI 气泡已恢复原样式');
  }

  function handleSaveAppearanceTheme() {
    const name = appearanceThemeName.trim();
    if (!name) {
      Alert.alert('提示', '请先填写主题名称');
      return;
    }
    saveAppearanceTheme(name);
    setAppearanceThemeName('');
    showToast('美化主题已保存');
  }

  function handleApplyAppearanceTheme(id: string, name: string) {
    applyAppearanceTheme(id);
    showToast(`已切换到 ${name}`);
  }

  function handleUpdateAppearanceTheme(id: string, name: string) {
    updateAppearanceTheme(id);
    showToast(`${name} 已覆盖为当前美化`);
  }

  function handleRemoveAppearanceTheme(id: string, name: string) {
    Alert.alert('删除美化主题', `确定删除「${name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removeAppearanceTheme(id);
          showToast('美化主题已删除');
        },
      },
    ]);
  }

  function handleResetAppearanceConfig() {
    Alert.alert(
      '清空全部美化',
      '这会删除所有已保存主题，并将聊天页美化恢复到原始默认。确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: () => {
            resetAppearanceConfig();
            setAppearanceThemeName('');
            setAppearanceThemesExpanded(false);
            showToast('已恢复原始默认美化');
          },
        },
      ]
    );
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>美化主题</Text>
      <Text style={styles.hint}>
        保存当前美化设置为主题，之后可以一键切换。背景图和自定义图标路径会一起保存。
      </Text>
      <View style={styles.appearanceThemeSaveRow}>
        <TextInput
          style={[styles.input, styles.appearanceThemeNameInput]}
          value={appearanceThemeName}
          onChangeText={setAppearanceThemeName}
          placeholder="主题名称"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          onSubmitEditing={handleSaveAppearanceTheme}
        />
        <Pressable style={styles.appearanceThemeSaveButton} onPress={handleSaveAppearanceTheme}>
          <Text style={styles.saveButtonText}>保存</Text>
        </Pressable>
      </View>

      <Pressable style={styles.appearanceClearButton} onPress={handleResetAppearanceConfig}>
        <Text style={styles.appearanceClearText}>一键清空，恢复原始默认</Text>
      </Pressable>

      <Pressable
        style={styles.appearanceThemeToggle}
        onPress={() => setAppearanceThemesExpanded((expanded) => !expanded)}
      >
        <View style={styles.appearanceThemeToggleText}>
          <Text style={styles.label}>已保存主题</Text>
          <Text style={styles.appearanceThemeHint}>
            {appearanceThemes.length > 0
              ? `${appearanceThemes.length} 个主题`
              : '还没有保存的美化主题'}
          </Text>
        </View>
        <Text style={styles.appearanceThemeToggleAction}>
          {appearanceThemesExpanded ? '收起' : '展开'}
        </Text>
      </Pressable>

      {appearanceThemesExpanded && appearanceThemes.length > 0 && (
        <View style={styles.appearanceThemeList}>
          {appearanceThemes.map((theme) => {
            const isActive = theme.id === activeAppearanceThemeId;
            return (
              <View
                key={theme.id}
                style={[
                  styles.appearanceThemeRow,
                  isActive && styles.appearanceThemeRowActive,
                ]}
              >
                <Text
                  style={[
                    styles.appearanceThemeName,
                    isActive && styles.appearanceThemeNameActive,
                  ]}
                  numberOfLines={1}
                >
                  {theme.name}
                </Text>
                <View style={styles.appearanceThemeActions}>
                  <Pressable
                    style={[
                      styles.smallActionButton,
                      isActive && styles.smallActionButtonDisabled,
                    ]}
                    onPress={() => handleApplyAppearanceTheme(theme.id, theme.name)}
                    disabled={isActive}
                  >
                    <Text
                      style={[
                        styles.smallActionText,
                        isActive && styles.smallActionTextDisabled,
                      ]}
                    >
                      应用
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.smallActionButton}
                    onPress={() => handleUpdateAppearanceTheme(theme.id, theme.name)}
                  >
                    <Text style={styles.smallActionText}>覆盖</Text>
                  </Pressable>
                  <Pressable
                    style={styles.smallActionButton}
                    onPress={() => handleRemoveAppearanceTheme(theme.id, theme.name)}
                  >
                    <Text style={styles.smallActionText}>删除</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Text style={styles.sectionTitle}>顶栏图标</Text>
      <Text style={styles.hint}>
        默认使用统一 SVG 图标；自定义图片会复制到应用目录，显示时固定在 24px 图标框内。
      </Text>

      <View style={styles.topBarPreview}>
        {TOP_BAR_ICON_ITEMS.map((item) => (
          <View key={item.key} style={styles.topBarPreviewButton}>
            <TopBarIcon
              iconKey={item.key}
              color={colors.text}
              customUri={topBarIconUris[item.key]}
              size={22}
            />
          </View>
        ))}
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>隐藏顶栏全部图标</Text>
          <Text style={styles.hint}>只隐藏聊天页按键上的图标，顶栏和按键点击区域保持原位。</Text>
        </View>
        <Switch
          value={topBarIconsHidden}
          onValueChange={(value) => {
            setAppearanceConfig({ topBarIconsHidden: value });
            showToast(value ? '顶栏图标已隐藏' : '顶栏图标已显示');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>关闭顶栏有色遮罩</Text>
          <Text style={styles.hint}>保留聊天内容减淡，但不再用主题背景色盖住背景图。</Text>
        </View>
        <Switch
          value={topBarFadeHidden}
          onValueChange={(value) => {
            setAppearanceConfig({ topBarFadeHidden: value });
            showToast(value ? '顶栏有色遮罩已关闭' : '顶栏有色遮罩已开启');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {TOP_BAR_ICON_ITEMS.map((item) => {
        const customUri = topBarIconUris[item.key];
        const isPicking = pickingKey === item.key;
        return (
          <View key={item.key} style={styles.appearanceIconRow}>
            <View style={styles.appearanceIconPreview}>
              <TopBarIcon
                iconKey={item.key}
                color={colors.text}
                customUri={customUri}
                size={24}
              />
            </View>
            <View style={styles.appearanceIconText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.hint}>{customUri ? '已使用自定义图片' : '使用默认 SVG 图标'}</Text>
            </View>
            <View style={styles.appearanceIconActions}>
              <Pressable
                style={[styles.smallActionButton, isPicking && styles.smallActionButtonDisabled]}
                onPress={() => handlePickIcon(item.key)}
                disabled={!!pickingKey}
              >
                {isPicking ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.smallActionText}>替换</Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, !customUri && styles.smallActionButtonDisabled]}
                onPress={() => {
                  clearTopBarIconUri(item.key);
                  showToast('已恢复默认图标');
                }}
                disabled={!customUri}
              >
                <Text style={[styles.smallActionText, !customUri && styles.smallActionTextDisabled]}>
                  默认
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Text style={styles.hint}>限制：文件不超过 2MB，图片边长需在 48px 到 2048px 之间。</Text>
      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleResetAll}>
          <Text style={styles.testButtonText}>恢复全部默认</Text>
        </Pressable>
      </View>
      <Text style={styles.sectionTitle}>聊天页背景</Text>
      <View style={styles.appearanceAssetRow}>
        <View style={styles.appearanceImagePreview}>
          {appearanceConfig?.chatBackgroundImageUri ? (
            <Image source={{ uri: appearanceConfig.chatBackgroundImageUri }} style={styles.appearanceImageThumb} resizeMode="cover" />
          ) : (
            <Text style={styles.appearanceImagePlaceholder}>BG</Text>
          )}
        </View>
        <View style={styles.appearanceIconText}>
          <Text style={styles.label}>聊天页背景图</Text>
          <Text style={styles.hint}>{appearanceConfig?.chatBackgroundImageUri ? '已使用自定义背景' : '使用主题纯色背景'}</Text>
        </View>
        <View style={styles.appearanceIconActions}>
          <Pressable
            style={[styles.smallActionButton, pickingBackground === 'chat' && styles.smallActionButtonDisabled]}
            onPress={() => handlePickBackground('chat')}
            disabled={!!pickingBackground}
          >
            {pickingBackground === 'chat' ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
          </Pressable>
          <Pressable
            style={[styles.smallActionButton, !appearanceConfig?.chatBackgroundImageUri && styles.smallActionButtonDisabled]}
            onPress={() => {
              setAppearanceConfig({ chatBackgroundImageUri: undefined });
              showToast('聊天背景已恢复默认');
            }}
            disabled={!appearanceConfig?.chatBackgroundImageUri}
          >
            <Text style={[styles.smallActionText, !appearanceConfig?.chatBackgroundImageUri && styles.smallActionTextDisabled]}>默认</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.sectionTitle}>消息头像</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>显示消息头像</Text>
          <Text style={styles.hint}>开启后每条用户和 AI 消息上方都会显示头像与自定义名字。</Text>
        </View>
        <Switch
          value={messageAvatarsVisible}
          onValueChange={(value) => {
            setAppearanceConfig({ messageAvatarsVisible: value });
            showToast(value ? '消息头像已显示' : '消息头像已隐藏');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {messageAvatarsVisible && (
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.label}>显示楼层与时间</Text>
            <Text style={styles.hint}>在头像标题行里显示 #楼层 和消息时间。</Text>
          </View>
          <Switch
            value={messageMetaVisible}
            onValueChange={(value) => {
              setAppearanceConfig({ messageMetaVisible: value });
              showToast(value ? '楼层与时间已显示' : '楼层与时间已隐藏');
            }}
            trackColor={{ true: colors.primary }}
          />
        </View>
      )}

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>用户名字</Text>
          <TextInput
            style={styles.input}
            value={userDisplayName}
            onChangeText={(value) => setAppearanceConfig({ userDisplayName: value })}
            placeholder="You"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>AI 名字</Text>
          <TextInput
            style={styles.input}
            value={assistantDisplayName}
            onChangeText={(value) => setAppearanceConfig({ assistantDisplayName: value })}
            placeholder="Claude"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>头像圆角</Text>
          <TextInput
            style={styles.input}
            value={String(messageAvatarRadius)}
            onChangeText={(value) => setAppearanceConfig({ messageAvatarRadius: parseAppearanceNumber(value, 18, 0, 20) })}
            keyboardType="number-pad"
            placeholder="18"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      {([
        { kind: 'user' as const, label: '用户头像', uri: userAvatarImageUri },
        { kind: 'assistant' as const, label: 'AI 头像', uri: assistantAvatarImageUri },
      ]).map((item) => {
        const isPicking = pickingAvatar === item.kind;
        return (
          <View key={item.kind} style={styles.appearanceAssetRow}>
            <View style={[styles.appearanceImagePreview, { borderRadius: messageAvatarRadius }]}>
              {item.uri ? (
                <Image source={{ uri: item.uri }} style={styles.appearanceImageThumb} resizeMode="cover" />
              ) : (
                <Text style={styles.appearanceImagePlaceholder}>{item.kind === 'user' ? 'U' : 'AI'}</Text>
              )}
            </View>
            <View style={styles.appearanceIconText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.hint}>{item.uri ? '已使用自定义头像' : '使用默认文字占位头像'}</Text>
            </View>
            <View style={styles.appearanceIconActions}>
              <Pressable
                style={[styles.smallActionButton, isPicking && styles.smallActionButtonDisabled]}
                onPress={() => handlePickAvatar(item.kind)}
                disabled={!!pickingAvatar}
              >
                {isPicking ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, !item.uri && styles.smallActionButtonDisabled]}
                onPress={() => {
                  setAppearanceConfig(
                    item.kind === 'user'
                      ? { userAvatarImageUri: undefined }
                      : { assistantAvatarImageUri: undefined }
                  );
                  showToast(`${item.label}已恢复默认`);
                }}
                disabled={!item.uri}
              >
                <Text style={[styles.smallActionText, !item.uri && styles.smallActionTextDisabled]}>默认</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>聊天气泡与文字</Text>
      <Text style={styles.hint}>颜色使用 #RRGGBB 格式；磨砂系数为 0 时关闭玻璃效果。</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>隐藏 AI 回复尾部标识</Text>
          <Text style={styles.hint}>隐藏操作按钮下方的 Claude logo 和提示文案。</Text>
        </View>
        <Switch
          value={assistantFooterHidden}
          onValueChange={(value) => {
            setAppearanceConfig({ assistantFooterHidden: value });
            showToast(value ? 'AI 回复尾部标识已隐藏' : 'AI 回复尾部标识已显示');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>隐藏 AI 气泡功能按键</Text>
          <Text style={styles.hint}>隐藏 AI 气泡下方的编辑、删除、朗读、编辑上文、删除上文和重新生成按钮。</Text>
        </View>
        <Switch
          value={assistantActionsHidden}
          onValueChange={(value) => {
            setAppearanceConfig({ assistantActionsHidden: value });
            showToast(value ? 'AI 气泡功能按键已隐藏' : 'AI 气泡功能按键已显示');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>AI 按键/尾注颜色</Text>
        <TextInput
          style={styles.input}
          value={assistantFooterColorInput}
          onChangeText={setAssistantFooterColorInput}
          onBlur={() => commitColor('AI 按键/尾注颜色', assistantFooterColorInput, 'assistantFooterColor')}
          placeholder="#9B9B9B"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>用户气泡透明</Text>
          <Text style={styles.hint}>保留文字和磨砂效果，不叠加气泡底色。</Text>
        </View>
        <Switch
          value={userBubbleTransparent}
          onValueChange={(value) => {
            setAppearanceConfig({ userBubbleTransparent: value });
            showToast(value ? '用户气泡已设为透明' : '用户气泡已恢复底色');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>用户气泡颜色</Text>
        <View style={styles.colorSwatchRow}>
          {COLOR_SWATCHES.map((swatch) => (
            <Pressable
              key={swatch}
              style={[styles.colorSwatch, { backgroundColor: swatch }, userBubbleColorInput === swatch && styles.colorSwatchActive]}
              onPress={() => {
                setUserBubbleColorInput(swatch);
                setAppearanceConfig({ userBubbleColor: swatch });
              }}
            />
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={userBubbleColorInput}
          onChangeText={setUserBubbleColorInput}
          onBlur={() => commitColor('用户气泡颜色', userBubbleColorInput, 'userBubbleColor')}
          placeholder="#f1eee7"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>用户气泡圆角</Text>
          <TextInput
            style={styles.input}
            value={String(userBubbleRadius)}
            onChangeText={(value) => setAppearanceConfig({ userBubbleRadius: parseAppearanceNumber(value, 20, 0, 36) })}
            keyboardType="number-pad"
            placeholder="20"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>磨砂系数</Text>
          <TextInput
            style={styles.input}
            value={String(userBubbleBlurIntensity)}
            onChangeText={(value) => setAppearanceConfig({ userBubbleBlurIntensity: parseAppearanceNumber(value, 0, 0, 100) })}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>用户气泡长度</Text>
          <TextInput
            style={styles.input}
            value={String(userBubbleWidthPercent)}
            onChangeText={(value) => setAppearanceConfig({ userBubbleWidthPercent: parseAppearanceNumber(value, 75, 45, 100) })}
            keyboardType="number-pad"
            placeholder="75"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      <View style={styles.segmentedRow}>
        {(['plain', 'bubble'] as AssistantBubbleAppearanceStyle[]).map((styleKey) => (
          <Pressable
            key={styleKey}
            style={[styles.segmentedButton, assistantBubbleStyle === styleKey && styles.segmentedButtonActive]}
            onPress={() => setAssistantBubbleStyle(styleKey)}
          >
            <Text style={[styles.segmentedText, assistantBubbleStyle === styleKey && styles.segmentedTextActive]}>
              {styleKey === 'plain' ? 'AI 原样式' : 'AI 用户气泡样式'}
            </Text>
          </Pressable>
        ))}
      </View>

      {assistantBubbleStyle === 'bubble' && (
        <>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>AI 气泡透明</Text>
              <Text style={styles.hint}>保留文字和磨砂效果，不叠加 AI 气泡底色。</Text>
            </View>
            <Switch
              value={assistantBubbleTransparent}
              onValueChange={(value) => {
                setAppearanceConfig({ assistantBubbleTransparent: value });
                showToast(value ? 'AI 气泡已设为透明' : 'AI 气泡已恢复底色');
              }}
              trackColor={{ true: colors.primary }}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>AI 气泡颜色</Text>
            <View style={styles.colorSwatchRow}>
              {COLOR_SWATCHES.map((swatch) => (
                <Pressable
                  key={swatch}
                  style={[styles.colorSwatch, { backgroundColor: swatch }, assistantBubbleColorInput === swatch && styles.colorSwatchActive]}
                  onPress={() => {
                    setAssistantBubbleColorInput(swatch);
                    setAppearanceConfig({ assistantBubbleColor: swatch });
                  }}
                />
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={assistantBubbleColorInput}
              onChangeText={setAssistantBubbleColorInput}
              onBlur={() => commitColor('AI 气泡颜色', assistantBubbleColorInput, 'assistantBubbleColor')}
              placeholder="#f1eee7"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.appearanceNumberGrid}>
            <View style={styles.appearanceNumberField}>
              <Text style={styles.label}>AI 气泡圆角</Text>
              <TextInput
                style={styles.input}
                value={String(assistantBubbleRadius)}
                onChangeText={(value) => setAppearanceConfig({ assistantBubbleRadius: parseAppearanceNumber(value, 20, 0, 36) })}
                keyboardType="number-pad"
                placeholder="20"
                placeholderTextColor={colors.textTertiary}
              />
            </View>
            <View style={styles.appearanceNumberField}>
              <Text style={styles.label}>AI 磨砂系数</Text>
              <TextInput
                style={styles.input}
                value={String(assistantBubbleBlurIntensity)}
                onChangeText={(value) => setAppearanceConfig({ assistantBubbleBlurIntensity: parseAppearanceNumber(value, 0, 0, 100) })}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>

          <View style={styles.appearanceNumberGrid}>
            <View style={styles.appearanceNumberField}>
              <Text style={styles.label}>AI 气泡长度</Text>
              <TextInput
                style={styles.input}
                value={String(assistantBubbleWidthPercent)}
                onChangeText={(value) => setAppearanceConfig({ assistantBubbleWidthPercent: parseAppearanceNumber(value, 75, 45, 100) })}
                keyboardType="number-pad"
                placeholder="75"
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          </View>
        </>
      )}

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>用户字号</Text>
          <TextInput
            style={styles.input}
            value={String(userFontSize)}
            onChangeText={(value) => setAppearanceConfig({ userFontSize: parseAppearanceNumber(value, 16, 12, 24) })}
            keyboardType="number-pad"
            placeholder="16"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>AI 字号</Text>
          <TextInput
            style={styles.input}
            value={String(assistantFontSize)}
            onChangeText={(value) => setAppearanceConfig({ assistantFontSize: parseAppearanceNumber(value, 16, 12, 24) })}
            keyboardType="number-pad"
            placeholder="16"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>用户文字颜色</Text>
          <TextInput
            style={styles.input}
            value={userTextColorInput}
            onChangeText={setUserTextColorInput}
            onBlur={() => commitColor('用户文字颜色', userTextColorInput, 'userTextColor')}
            placeholder="#141413"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>AI 文字颜色</Text>
          <TextInput
            style={styles.input}
            value={assistantTextColorInput}
            onChangeText={setAssistantTextColorInput}
            onBlur={() => commitColor('AI 文字颜色', assistantTextColorInput, 'assistantTextColor')}
            placeholder="#141413"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>AI 文字描边颜色</Text>
          <TextInput
            style={styles.input}
            value={assistantTextStrokeColorInput}
            onChangeText={setAssistantTextStrokeColorInput}
            onBlur={() => commitColor('AI 文字描边颜色', assistantTextStrokeColorInput, 'assistantTextStrokeColor')}
            placeholder="#faf9f5"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>AI 文字描边粗细</Text>
          <TextInput
            style={styles.input}
            value={String(assistantTextStrokeWidth)}
            onChangeText={(value) => setAppearanceConfig({ assistantTextStrokeWidth: parseAppearanceNumber(value, 0, 0, 8) })}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>输入框自定义</Text>
      <View style={styles.segmentedRow}>
        {(['default', 'glass'] as ChatInputAppearanceStyle[]).map((styleKey) => (
          <Pressable
            key={styleKey}
            style={[styles.segmentedButton, inputStyle === styleKey && styles.segmentedButtonActive]}
            onPress={() => setInputStyle(styleKey)}
          >
            <Text style={[styles.segmentedText, inputStyle === styleKey && styles.segmentedTextActive]}>
              {styleKey === 'default' ? '默认原版' : '磨砂玻璃'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>输入框磨砂系数</Text>
          <TextInput
            style={styles.input}
            value={String(inputBlurIntensity)}
            onChangeText={(value) => setAppearanceConfig({ inputBlurIntensity: parseAppearanceNumber(value, 72, 0, 100) })}
            keyboardType="number-pad"
            placeholder="72"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>输入框背景透明</Text>
          <Text style={styles.hint}>保留输入框内容、背景图和磨砂效果，不叠加默认底色。</Text>
        </View>
        <Switch
          value={inputBackgroundTransparent}
          onValueChange={(value) => {
            setAppearanceConfig({ inputBackgroundTransparent: value });
            showToast(value ? '输入框背景已设为透明' : '输入框背景已恢复底色');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.appearanceAssetRow}>
        <View style={styles.appearanceImagePreview}>
          {appearanceConfig?.inputBackgroundImageUri ? (
            <Image source={{ uri: appearanceConfig.inputBackgroundImageUri }} style={styles.appearanceImageThumb} resizeMode="cover" />
          ) : (
            <Text style={styles.appearanceImagePlaceholder}>IN</Text>
          )}
        </View>
        <View style={styles.appearanceIconText}>
          <Text style={styles.label}>输入框背景图</Text>
          <Text style={styles.hint}>{appearanceConfig?.inputBackgroundImageUri ? '已使用自定义背景' : '使用默认输入框底色'}</Text>
        </View>
        <View style={styles.appearanceIconActions}>
          <Pressable
            style={[styles.smallActionButton, pickingBackground === 'input' && styles.smallActionButtonDisabled]}
            onPress={() => handlePickBackground('input')}
            disabled={!!pickingBackground}
          >
            {pickingBackground === 'input' ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
          </Pressable>
          <Pressable
            style={[styles.smallActionButton, !appearanceConfig?.inputBackgroundImageUri && styles.smallActionButtonDisabled]}
            onPress={() => {
              setAppearanceConfig({ inputBackgroundImageUri: undefined });
              showToast('输入框背景已恢复默认');
            }}
            disabled={!appearanceConfig?.inputBackgroundImageUri}
          >
            <Text style={[styles.smallActionText, !appearanceConfig?.inputBackgroundImageUri && styles.smallActionTextDisabled]}>默认</Text>
          </Pressable>
        </View>
      </View>

      {CHAT_INPUT_ICON_ITEMS.map((item) => {
        const customUri = inputIconUris[item.key];
        const isPicking = pickingInputIconKey === item.key;
        return (
          <View key={item.key} style={styles.appearanceIconRow}>
            <View style={styles.appearanceIconPreview}>
              {customUri ? (
                <Image source={{ uri: customUri }} style={styles.customInputIconPreview} resizeMode="contain" />
              ) : (
                <Text style={styles.appearanceImagePlaceholder}>IC</Text>
              )}
            </View>
            <View style={styles.appearanceIconText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.hint}>{customUri ? '已使用自定义图片' : '使用默认按钮图标'}</Text>
            </View>
            <View style={styles.appearanceIconActions}>
              <Pressable
                style={[styles.smallActionButton, isPicking && styles.smallActionButtonDisabled]}
                onPress={() => handlePickInputIcon(item.key)}
                disabled={!!pickingInputIconKey}
              >
                {isPicking ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, !customUri && styles.smallActionButtonDisabled]}
                onPress={() => {
                  clearChatInputIconUri(item.key);
                  showToast('已恢复默认输入框图标');
                }}
                disabled={!customUri}
              >
                <Text style={[styles.smallActionText, !customUri && styles.smallActionTextDisabled]}>默认</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <View style={styles.actions}>
        <Pressable
          style={styles.testButton}
          onPress={() => {
            resetChatInputIcons();
            showToast('已恢复全部输入框图标');
          }}
        >
          <Text style={styles.testButtonText}>恢复输入框默认图标</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* ==================== 悬浮球 Tab ==================== */

function FloatingBallTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const { floatingBallConfig, setFloatingBallConfig, ttsConfig } = useSettingsStore();
  const [busy, setBusy] = useState(false);
  const [pickingBallImage, setPickingBallImage] = useState<'normal' | 'edge' | null>(null);
  const normalImageUris = mergeUniqueUris(
    floatingBallConfig.normalImageUris || [],
    floatingBallConfig.normalImageUri ? [floatingBallConfig.normalImageUri] : []
  );
  const edgeImageUris = mergeUniqueUris(
    floatingBallConfig.edgeImageUris || [],
    floatingBallConfig.edgeImageUri ? [floatingBallConfig.edgeImageUri] : []
  );
  const assetAutoSwitchEnabled = !!floatingBallConfig.assetAutoSwitchEnabled;
  const assetAutoSwitchIntervalSeconds = floatingBallConfig.assetAutoSwitchIntervalSeconds || 8;
  const normalSizeDp = floatingBallConfig.normalSizeDp ?? FLOATING_BALL_SIZE_DEFAULT;
  const edgeSizeDp = floatingBallConfig.edgeSizeDp ?? FLOATING_BALL_SIZE_DEFAULT;

  async function handlePickFloatingBallImage(kind: 'normal' | 'edge') {
    if (pickingBallImage) return;
    const existingUris = kind === 'normal' ? normalImageUris : edgeImageUris;
    const remainingSlots = CUSTOM_FLOATING_BALL_SELECTION_LIMIT - existingUris.length;
    if (remainingSlots <= 0) {
      Alert.alert('悬浮球素材已满', `每种状态最多保存 ${CUSTOM_FLOATING_BALL_SELECTION_LIMIT} 个素材。`);
      return;
    }
    setPickingBallImage(kind);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;

      const validationError = result.assets
        .map(validateFloatingBallAsset)
        .find((error): error is string => !!error);
      if (validationError) {
        Alert.alert('悬浮球素材不可用', validationError);
        return;
      }

      const copiedUris = await Promise.all(
        result.assets.map((asset) => copyFloatingBallImage(asset, kind === 'normal' ? 'normal' : 'edge'))
      );
      const nextUris = mergeUniqueUris(existingUris, copiedUris, CUSTOM_FLOATING_BALL_SELECTION_LIMIT);
      setFloatingBallConfig(
        kind === 'normal'
          ? { normalImageUris: nextUris, normalImageUri: nextUris[0] }
          : { edgeImageUris: nextUris, edgeImageUri: nextUris[0] }
      );
      if (floatingBallConfig.enabled) {
        syncFloatingBallAssets().catch(() => undefined);
      }
      showToast(kind === 'normal' ? '正常态素材已更新' : '贴边态素材已更新');
    } catch (error: any) {
      Alert.alert('选择悬浮球素材失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingBallImage(null);
    }
  }

  function handleClearFloatingBallImage(kind: 'normal' | 'edge') {
    setFloatingBallConfig(
      kind === 'normal'
        ? { normalImageUris: [], normalImageUri: undefined }
        : { edgeImageUris: [], edgeImageUri: undefined }
    );
    if (floatingBallConfig.enabled) {
      syncFloatingBallAssets().catch(() => undefined);
    }
    showToast(kind === 'normal' ? '正常态已恢复默认球形' : '贴边态已恢复默认球形');
  }

  function handleSizeChange(kind: 'normal' | 'edge', value: string) {
    const nextSize = parseAppearanceNumber(
      value,
      FLOATING_BALL_SIZE_DEFAULT,
      FLOATING_BALL_SIZE_MIN,
      FLOATING_BALL_SIZE_MAX
    );
    setFloatingBallConfig(kind === 'normal' ? { normalSizeDp: nextSize } : { edgeSizeDp: nextSize });
    if (floatingBallConfig.enabled) {
      syncFloatingBallAssets().catch(() => undefined);
    }
  }

  async function handleToggle(value: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (!value) {
        await hideFloatingBall();
        setFloatingBallConfig({ enabled: false });
        showToast('悬浮球已关闭');
        return;
      }

      const granted = await canDrawFloatingBall();
      if (!granted) {
        setFloatingBallConfig({ enabled: false });
        Alert.alert(
          '需要悬浮窗权限',
          '请在系统设置中允许 YSClaude 显示在其他应用上层，返回后再开启悬浮球。',
          [
            { text: '取消', style: 'cancel' },
            { text: '去设置', onPress: () => openFloatingBallPermissionSettings().catch(() => undefined) },
          ]
        );
        return;
      }

      await showFloatingBall();
      setFloatingBallConfig({ enabled: true });
      showToast('悬浮球已开启');
    } catch (error: any) {
      setFloatingBallConfig({ enabled: false });
      Alert.alert('悬浮球不可用', error?.message || '请重新安装包含原生模块的新包');
    } finally {
      setBusy(false);
    }
  }

  function handleTTSToggle(value: boolean) {
    if (value && (!ttsConfig.groupId.trim() || !ttsConfig.apiKey.trim() || !ttsConfig.voiceId.trim())) {
      setFloatingBallConfig({ ttsEnabled: false });
      Alert.alert('需要 TTS 配置', '请先在 TTS 配置中填写 Group ID、API Key 和 Voice ID。');
      return;
    }
    setFloatingBallConfig({ ttsEnabled: value });
    showToast(value ? '悬浮球 TTS 已开启' : '悬浮球 TTS 已关闭');
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.switchRow}>
        <Text style={styles.label}>开启悬浮球</Text>
        <Switch
          value={floatingBallConfig.enabled}
          onValueChange={handleToggle}
          disabled={busy}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <Text style={styles.sectionTitle}>悬浮球素材</Text>
      <Text style={styles.hint}>支持 PNG、JPG、GIF。正常态用于平时显示，贴边态用于吸附屏幕边缘；每种状态最多 {CUSTOM_FLOATING_BALL_SELECTION_LIMIT} 个素材。</Text>
      <Text style={styles.hint}>正常态 {normalImageUris.length} / {CUSTOM_FLOATING_BALL_SELECTION_LIMIT} 个，贴边态 {edgeImageUris.length} / {CUSTOM_FLOATING_BALL_SELECTION_LIMIT} 个</Text>
      {([
        { kind: 'normal' as const, label: '正常态', uri: floatingBallConfig.normalImageUri },
        { kind: 'edge' as const, label: '贴边态', uri: floatingBallConfig.edgeImageUri },
      ]).map((item) => {
        const isPicking = pickingBallImage === item.kind;
        return (
          <View key={item.kind} style={styles.appearanceAssetRow}>
            <View style={styles.floatingBallPreview}>
              {item.uri ? (
                <Image source={{ uri: item.uri }} style={styles.appearanceImageThumb} resizeMode="contain" />
              ) : (
                <View style={styles.defaultFloatingBallPreview} />
              )}
            </View>
            <View style={styles.appearanceIconText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.hint}>{item.uri ? '已使用自定义素材' : '使用默认球形'}</Text>
            </View>
            <View style={styles.appearanceIconActions}>
              <Pressable
                style={[styles.smallActionButton, isPicking && styles.smallActionButtonDisabled]}
                onPress={() => handlePickFloatingBallImage(item.kind)}
                disabled={!!pickingBallImage}
              >
                {isPicking ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, !item.uri && styles.smallActionButtonDisabled]}
                onPress={() => handleClearFloatingBallImage(item.kind)}
                disabled={!item.uri}
              >
                <Text style={[styles.smallActionText, !item.uri && styles.smallActionTextDisabled]}>默认</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>悬浮球大小</Text>
      <Text style={styles.hint}>单位为 dp，正常态和贴边态可分别调整，范围 {FLOATING_BALL_SIZE_MIN}-{FLOATING_BALL_SIZE_MAX}。</Text>
      <View style={styles.floatingBallSizeRow}>
        <View style={styles.floatingBallSizeField}>
          <Text style={styles.label}>正常态大小</Text>
          <TextInput
            style={styles.input}
            value={String(normalSizeDp)}
            onChangeText={(value) => handleSizeChange('normal', value)}
            keyboardType="number-pad"
            placeholder={String(FLOATING_BALL_SIZE_DEFAULT)}
            placeholderTextColor={colors.textTertiary}
          />
        </View>
        <View style={styles.floatingBallSizeField}>
          <Text style={styles.label}>贴边态大小</Text>
          <TextInput
            style={styles.input}
            value={String(edgeSizeDp)}
            onChangeText={(value) => handleSizeChange('edge', value)}
            keyboardType="number-pad"
            placeholder={String(FLOATING_BALL_SIZE_DEFAULT)}
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>

      <View style={styles.switchRow}>
        <View style={styles.nativeToolText}>
          <Text style={styles.label}>素材自动切换</Text>
          <Text style={styles.hint}>开启后按当前状态，从正常态或贴边态素材池随机切换。</Text>
        </View>
        <Switch
          value={assetAutoSwitchEnabled}
          onValueChange={(value) => {
            setFloatingBallConfig({ assetAutoSwitchEnabled: value });
            showToast(value ? '素材自动切换已开启' : '素材自动切换已关闭');
          }}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>切换间隔（秒）</Text>
        <TextInput
          style={styles.input}
          value={String(assetAutoSwitchIntervalSeconds)}
          onChangeText={(value) => {
            setFloatingBallConfig({
              assetAutoSwitchIntervalSeconds: parseAppearanceNumber(value, 8, 1, 3600),
            });
          }}
          keyboardType="number-pad"
          placeholder="8"
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.nativeToolText}>
          <Text style={styles.label}>悬浮球 TTS</Text>
          <Text style={styles.hint}>使用 TTS 配置中的 MiniMax 语音参数朗读悬浮球气泡文字</Text>
        </View>
        <Switch
          value={!!floatingBallConfig.ttsEnabled}
          onValueChange={handleTTSToggle}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.switchRow}>
        <View style={styles.nativeToolText}>
          <Text style={styles.label}>截图后自动获取回复</Text>
          <Text style={styles.hint}>仅影响点按截图共享；长按截图+节点树模式仍等待手动获取回复</Text>
        </View>
        <Switch
          value={!!floatingBallConfig.autoReplyOnScreenshotShare}
          onValueChange={(value) => {
            setFloatingBallConfig({ autoReplyOnScreenshotShare: value });
            showToast(value ? '截图自动回复已开启' : '截图自动回复已关闭');
          }}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
    </ScrollView>
  );
}

/* ==================== API 配置 Tab ==================== */

function APIConfigTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const router = useRouter();
  const { _hydrated, apiConfigs, activeConfigIndex, saveAPIConfig, removeAPIConfig, setActiveConfig } = useSettingsStore();

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);

  useEffect(() => {
    if (_hydrated && apiConfigs.length > 0) {
      loadConfig(activeConfigIndex);
    }
  }, [_hydrated]);

  function loadConfig(index: number) {
    const config = apiConfigs[index];
    if (config) {
      setName(config.name);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setModel(config.model);
    }
  }

  function handleNew() {
    setName(''); setBaseUrl(''); setApiKey(''); setModel(''); setModels([]);
  }

  async function handleFetchModels() {
    if (!baseUrl || !apiKey) {
      Alert.alert('提示', '请先填写 Base URL 和 API Key');
      return;
    }
    setFetching(true);
    try {
      const url = `${baseUrl.trim().replace(/\/$/, '')}/models`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const ids: string[] = (data.data || []).map((m: any) => m.id).sort();
      if (ids.length === 0) {
        Alert.alert('提示', '未获取到模型列表');
      } else {
        setModels(ids);
        setShowModels(true);
      }
    } catch (e: any) {
      Alert.alert('获取失败', e.message);
    } finally {
      setFetching(false);
    }
  }

  async function handleTest() {
    if (!baseUrl || !apiKey || !model) {
      Alert.alert('提示', '请填写完整配置');
      return;
    }
    setTesting(true);
    try {
      const url = `${baseUrl.trim().replace(/\/$/, '')}/chat/completions`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: model.trim(),
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
      }
      showToast('API 配置有效');
    } catch (e: any) {
      Alert.alert('连接失败', e.message);
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) { Alert.alert('提示', '请输入配置名称'); return; }
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      Alert.alert('提示', '请填写完整配置'); return;
    }
    const config: NamedAPIConfig = {
      name: trimmedName, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(),
    };
    saveAPIConfig(config);
    const newIndex = useSettingsStore.getState().apiConfigs.findIndex((c) => c.name === trimmedName);
    if (newIndex >= 0) setActiveConfig(newIndex);
    showToast(`配置「${trimmedName}」已保存`);
  }

  function handleSelectConfig(index: number) {
    setActiveConfig(index);
    loadConfig(index);
  }

  function handleDeleteConfig(index: number) {
    const config = apiConfigs[index];
    Alert.alert('删除配置', `确定删除「${config.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: () => {
          removeAPIConfig(index);
          if (apiConfigs.length > 1) loadConfig(0);
          else handleNew();
        },
      },
    ]);
  }

  async function handleCreateBackup() {
    if (creatingBackup || restoringBackup) return;
    setCreatingBackup(true);
    try {
      const result = await createAndShareBackup();
      showToast(result.shared ? '备份包已创建，请选择 Google Drive 保存' : '备份包已创建');
      if (!result.shared) {
        Alert.alert('备份已创建', `文件已保存到本机：\n${result.uri}`);
      }
    } catch (error: any) {
      Alert.alert('创建备份失败', error?.message || '无法创建备份包');
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handlePickRestoreBackup() {
    if (creatingBackup || restoringBackup) return;
    setRestoringBackup(true);
    try {
      const backup = await pickBackupFile();
      if (!backup) {
        setRestoringBackup(false);
        return;
      }
      Alert.alert(
        '覆盖恢复备份',
        [
          `文件：${backup.fileName}`,
          `创建时间：${formatBackupTime(backup.manifest.createdAt)}`,
          `App 版本：${backup.manifest.appVersion}`,
          '',
          '恢复会覆盖当前本地数据。继续前会自动保存一份恢复前快照。',
        ].join('\n'),
        [
          {
            text: '取消',
            style: 'cancel',
            onPress: () => setRestoringBackup(false),
          },
          {
            text: '覆盖恢复',
            style: 'destructive',
            onPress: () => confirmRestoreBackup(backup),
          },
        ]
      );
    } catch (error: any) {
      setRestoringBackup(false);
      Alert.alert('读取备份失败', error?.message || '无法读取备份包');
    }
  }

  async function confirmRestoreBackup(backup: PickedBackup) {
    try {
      const result = await restoreBackup(backup);
      Alert.alert(
        '恢复完成',
        [
          `已恢复 ${formatBackupTime(result.manifest.createdAt)} 创建的备份。`,
          `恢复前快照已保存在：\n${result.localSnapshotUri}`,
          '',
          '请完全关闭并重新打开 App，让设置和数据库重新加载。',
        ].join('\n')
      );
    } catch (error: any) {
      Alert.alert('恢复失败', error?.message || '无法覆盖恢复备份');
    } finally {
      setRestoringBackup(false);
    }
  }

  function formatBackupTime(value: string): string {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? formatFullTime(timestamp) : value;
  }

  if (!_hydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {apiConfigs.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>已保存配置</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
            {apiConfigs.map((c, i) => (
              <Pressable
                key={i}
                style={[styles.configChip, i === activeConfigIndex && styles.configChipActive]}
                onPress={() => handleSelectConfig(i)}
                onLongPress={() => handleDeleteConfig(i)}
              >
                <Text style={[styles.configChipText, i === activeConfigIndex && styles.configChipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.configChip} onPress={handleNew}>
              <Text style={styles.configChipText}>＋ 新建</Text>
            </Pressable>
          </ScrollView>
        </>
      )}

      <Text style={styles.sectionTitle}>API 配置</Text>
      <View style={styles.field}>
        <Text style={styles.label}>配置名称</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName}
          placeholder="例如：Claude 中转" placeholderTextColor={colors.textTertiary} />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Base URL</Text>
        <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl}
          placeholder="https://api.openai.com/v1" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey}
          placeholder="sk-..." placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Model</Text>
        <View style={styles.modelRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={model} onChangeText={setModel}
            placeholder="claude-sonnet-4-6" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
          <Pressable style={styles.fetchButton} onPress={handleFetchModels} disabled={fetching}>
            {fetching ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.fetchButtonText}>拉取</Text>}
          </Pressable>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>数据备份</Text>
      <View style={styles.backupPanel}>
        <Text style={styles.hint}>
          创建完整备份包后可分享到 Google Drive；恢复时从 Google Drive 选择备份 zip，并覆盖当前本地数据。
        </Text>
        <View style={styles.backupActions}>
          <Pressable
            style={[styles.backupPrimaryButton, (creatingBackup || restoringBackup) && styles.importButtonDisabled]}
            onPress={handleCreateBackup}
            disabled={creatingBackup || restoringBackup}
          >
            {creatingBackup ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>创建备份并分享</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.backupDangerButton, (creatingBackup || restoringBackup) && styles.importButtonDisabled]}
            onPress={handlePickRestoreBackup}
            disabled={creatingBackup || restoringBackup}
          >
            {restoringBackup ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Text style={styles.backupDangerText}>从备份恢复</Text>
            )}
          </Pressable>
        </View>
        <Pressable
          style={styles.diagnosticsButton}
          onPress={() => router.push('/chat-diagnostics')}
        >
          <Text style={styles.diagnosticsButtonText}>打开聊天数据库诊断</Text>
        </Pressable>
      </View>

      {/* Model picker modal */}
      <Modal visible={showModels} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowModels(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>选择模型</Text>
            <FlatList
              data={models}
              keyExtractor={(item) => item}
              style={styles.modelList}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.modelItem, item === model && styles.modelItemActive]}
                  onPress={() => { setModel(item); setShowModels(false); }}
                >
                  <Text style={[styles.modelItemText, item === model && styles.modelItemTextActive]}>{item}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

/* ==================== 对话设置 Tab ==================== */

function ChatSettingsTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const {
    maxOutputTokens,
    systemPrompt,
    stripThinking,
    periodConfig,
    promptCacheConfig,
    setSystemPrompt,
    setMaxOutputTokens,
    setStripThinking,
    setPeriodConfig,
    setPromptCacheConfig,
  } = useSettingsStore();
  // 隐藏楼层现在按对话独立存储，数据源改为 chat store
  const {
    messages,
    conversationId,
    hiddenRanges,
    hiddenMessageIds,
    messageFloorOffset,
    addHiddenRange,
    restoreHiddenRange,
    setMessageHidden,
    loadConversation,
  } = useChatStore();
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [tokensStr, setTokensStr] = useState(maxOutputTokens ? String(maxOutputTokens) : '');
  const [promptText, setPromptText] = useState(systemPrompt);
  const [importingMyphone, setImportingMyphone] = useState(false);
  const [hiddenDiagnosticMessages, setHiddenDiagnosticMessages] = useState<ChatDiagnosticsMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!conversationId || hiddenMessageIds.length === 0) {
      setHiddenDiagnosticMessages([]);
      return () => {
        cancelled = true;
      };
    }

    getChatDiagnosticsConversation(conversationId)
      .then((detail) => {
        if (cancelled) return;
        const hiddenIdSet = new Set(hiddenMessageIds);
        setHiddenDiagnosticMessages(
          detail?.messages.filter((message) => hiddenIdSet.has(message.id)) ?? []
        );
      })
      .catch(() => {
        if (!cancelled) setHiddenDiagnosticMessages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, hiddenMessageIds]);

  // 仅取 user/assistant 消息作为「楼层」序列（1-based）
  const floorMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const hiddenDiagnosticById = new Map(hiddenDiagnosticMessages.map((message) => [message.id, message]));
  type HiddenMessageRow = {
    id: string;
    role: string | null;
    content: string | null;
    floor: number | null;
  };
  const hiddenMessageRows: HiddenMessageRow[] = hiddenMessageIds.map((id) => {
    const message = messages.find((item) => item.id === id) ?? null;
    const diagnosticMessage = hiddenDiagnosticById.get(id) ?? null;
    const localFloorIndex = message
      ? floorMessages.findIndex((item) => item.id === id)
      : -1;
    return {
      id,
      role: message?.role ?? diagnosticMessage?.role ?? null,
      content: message?.content ?? diagnosticMessage?.content ?? null,
      floor: localFloorIndex >= 0
        ? messageFloorOffset + localFloorIndex + 1
        : diagnosticMessage?.floorNumber ?? null,
    };
  });
  const hiddenMessageFloorRanges = hiddenMessageRows
    .filter((row): row is HiddenMessageRow & { floor: number } => row.floor !== null)
    .map((row) => ({ from: row.floor, to: row.floor }));
  const mergedHiddenRanges = mergeRanges([...hiddenRanges, ...hiddenMessageFloorRanges]);
  const hiddenContextRows = hiddenMessageRows.filter((row) => row.floor === null);
  const hasHiddenMessages = mergedHiddenRanges.length > 0 || hiddenContextRows.length > 0;

  function handleAddRange() {
    const range = parseInputRange();
    if (!range) return;
    addHiddenRange(range);
    clearRangeInputs();
  }

  function handleRestoreRange() {
    const range = parseInputRange();
    if (!range) return;
    restoreHiddenRange(range);
    clearRangeInputs();
  }

  function parseInputRange() {
    const from = parseInt(fromStr, 10);
    const to = parseInt(toStr, 10);
    if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
      Alert.alert('提示', '请输入有效的范围（起始 ≤ 结束，且 ≥ 1）');
      return null;
    }
    return { from, to };
  }

  function clearRangeInputs() {
    setFromStr('');
    setToStr('');
  }

  async function handleRestoreMergedRange(range: HiddenRange) {
    await restoreHiddenRange(range);
    const idsToRestore = hiddenMessageRows
      .filter((row) => row.floor !== null && row.floor >= range.from && row.floor <= range.to)
      .map((row) => row.id);
    await Promise.all(idsToRestore.map((id) => setMessageHidden(id, false)));
  }

  function formatHiddenRange(range: HiddenRange) {
    return range.from === range.to
      ? `第 ${range.from} 条`
      : `第 ${range.from} 条 ~ 第 ${range.to} 条`;
  }

  // 预览：两个输入都为有效数字时，给出该范围首尾两条消息的摘要
  const preview = (() => {
    const from = parseInt(fromStr, 10);
    const to = parseInt(toStr, 10);
    if (isNaN(from) || isNaN(to) || from < 1 || to < from) return null;
    const firstMsg = floorMessages[from - messageFloorOffset - 1] ?? null;
    const lastMsg = floorMessages[to - messageFloorOffset - 1] ?? null;
    if (!firstMsg && !lastMsg) return null;
    return {
      from,
      to,
      first: firstMsg,
      last: from === to ? null : lastMsg,
    };
  })();

  function roleLabel(role: string) {
    if (role === 'user') return '你';
    if (role === 'assistant') return 'AI';
    if (role === 'system') return '系统';
    return '工具';
  }

  function snippet(text: string) {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }

  function handleSaveTokens() {
    const val = tokensStr.trim();
    if (!val) {
      setMaxOutputTokens(null);
      showToast('输出字数不限制');
      return;
    }
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      Alert.alert('提示', '请输入有效的正整数');
      return;
    }
    setMaxOutputTokens(num);
    showToast(`AI 最大输出 ${num} tokens`);
  }

  async function handleImportMyphone() {
    if (importingMyphone) return;
    setImportingMyphone(true);
    try {
      const result = await importMyphonePrivateChatsFromPicker();
      if (result.cancelled) return;
      if (result.firstConversationId) {
        await loadConversation(result.firstConversationId);
      }
      showToast(`已导入 ${result.importedMessages} 条消息`);
      Alert.alert(
        '导入完成',
        `已导入 ${result.importedConversations} 个单聊，共 ${result.importedMessages} 条消息。` +
          (result.skippedCharacters > 0 ? `\n跳过 ${result.skippedCharacters} 个空角色。` : '')
      );
    } catch (error: any) {
      Alert.alert('导入失败', error?.message || '无法读取 myphone 单聊备份');
    } finally {
      setImportingMyphone(false);
    }
  }

  const messageCount = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
  const loadedFloorFrom = messageCount > 0 ? messageFloorOffset + 1 : 0;
  const loadedFloorTo = messageFloorOffset + messageCount;

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* System Prompt */}
      <Text style={styles.sectionTitle}>System Prompt</Text>
      <Text style={styles.hint}>此内容会放在所有消息最前面发送给 AI</Text>
      <TextInput
        style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
        value={promptText}
        onChangeText={setPromptText}
        onBlur={() => setSystemPrompt(promptText.trim())}
        multiline
        placeholder="You are a helpful assistant."
        placeholderTextColor={colors.textTertiary}
      />

      {/* 消息条数 */}
      <Text style={styles.sectionTitle}>当前对话</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>已加载消息</Text>
        <Text style={styles.infoValue}>
          {messageCount > 0 ? `${loadedFloorFrom}-${loadedFloorTo}` : '0'} 条
        </Text>
      </View>

      <Text style={styles.sectionTitle}>myphone 导入</Text>
      <Text style={styles.hint}>选择 myphone 导出的 .ee 或 JSON 单聊备份；只导入角色单聊，群聊会被跳过。</Text>
      <Pressable
        style={[styles.importButton, importingMyphone && styles.importButtonDisabled]}
        onPress={handleImportMyphone}
        disabled={importingMyphone}
      >
        {importingMyphone ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.importButtonText}>导入 myphone 单聊</Text>
        )}
      </Pressable>

      {/* 隐藏消息 */}
      <Text style={styles.sectionTitle}>隐藏消息</Text>
      <Text style={styles.hint}>隐藏的消息不会发送给 AI，可用于节省 token。隐藏范围按对话独立保存，可添加隐藏，也可按范围恢复。</Text>

      {!conversationId ? (
        <Text style={styles.hint}>请先打开一个对话后再设置隐藏范围。</Text>
      ) : (
        <>
          {hasHiddenMessages && (
            <View style={styles.rangeList}>
              <Text style={styles.previewHint}>已隐藏消息</Text>
              {mergedHiddenRanges.map((range) => (
                <View key={`${range.from}-${range.to}`} style={styles.rangeItem}>
                  <Text style={styles.rangeText}>{formatHiddenRange(range)}</Text>
                  <Pressable onPress={() => handleRestoreMergedRange(range)}>
                    <Text style={styles.rangeDelete}>恢复</Text>
                  </Pressable>
                </View>
              ))}
              {hiddenContextRows.length > 0 && (
                <Text style={[styles.previewHint, styles.hiddenContextTitle]}>上下文消息</Text>
              )}
              {hiddenContextRows.map((row) => (
                <View key={row.id} style={styles.rangeItem}>
                  <View style={styles.hiddenMessageText}>
                    <Text style={styles.rangeText}>
                      {row.role ? roleLabel(row.role) : '未加载消息'}
                    </Text>
                    <Text style={styles.previewText} numberOfLines={2}>
                      {row.role !== null && row.content !== null
                        ? `${roleLabel(row.role)}：${snippet(row.content) || '（空消息）'}`
                        : row.id}
                    </Text>
                  </View>
                  <Pressable onPress={() => setMessageHidden(row.id, false)}>
                    <Text style={styles.rangeDelete}>恢复</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={styles.rangeInputRow}>
            <Text style={styles.rangeLabel}>从第</Text>
            <TextInput style={styles.rangeInput} value={fromStr} onChangeText={setFromStr}
              keyboardType="number-pad" placeholder="X" placeholderTextColor={colors.textTertiary} />
            <Text style={styles.rangeLabel}>条到第</Text>
            <TextInput style={styles.rangeInput} value={toStr} onChangeText={setToStr}
              keyboardType="number-pad" placeholder="Y" placeholderTextColor={colors.textTertiary} />
            <Text style={styles.rangeLabel}>条</Text>
            <Pressable style={styles.rangeAddButton} onPress={handleAddRange}>
              <Text style={styles.rangeAddText}>添加</Text>
            </Pressable>
            <Pressable style={styles.rangeRestoreButton} onPress={handleRestoreRange}>
              <Text style={styles.rangeRestoreText}>恢复</Text>
            </Pressable>
          </View>

          {/* 预览：选定范围的首尾两条消息 */}
          {preview && (
            <View style={styles.previewBox}>
              <Text style={styles.previewHint}>预览所选范围</Text>
              {preview.first ? (
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>
                    第 {preview.from} 条（{roleLabel(preview.first.role)}）
                  </Text>
                  <Text style={styles.previewText} numberOfLines={2}>
                    {snippet(preview.first.content) || '（空消息）'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.previewText}>第 {preview.from} 条超出当前消息范围</Text>
              )}
              {preview.last !== null && (
                preview.last ? (
                  <View style={[styles.previewItem, { marginTop: 8 }]}>
                    <Text style={styles.previewLabel}>
                      第 {preview.to} 条（{roleLabel(preview.last.role)}）
                    </Text>
                    <Text style={styles.previewText} numberOfLines={2}>
                      {snippet(preview.last.content) || '（空消息）'}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.previewText, { marginTop: 8 }]}>
                    第 {preview.to} 条超出当前消息范围
                  </Text>
                )
              )}
            </View>
          )}
        </>
      )}

      {/* AI 输出字数限制 */}
      <Text style={styles.sectionTitle}>AI 输出限制</Text>
      <Text style={styles.hint}>限制 AI 单次回复的最大 token 数，留空则不限制</Text>
      <View style={styles.modelRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={tokensStr} onChangeText={setTokensStr}
          keyboardType="number-pad" placeholder="不限制" placeholderTextColor={colors.textTertiary} />
        <Pressable style={styles.fetchButton} onPress={handleSaveTokens}>
          <Text style={styles.fetchButtonText}>保存</Text>
        </Pressable>
      </View>

      {/* 不发送思维链 */}
      <Text style={styles.sectionTitle}>思维链</Text>
      <Text style={styles.hint}>开启后，AI 历史消息中的思维链内容不会发送给 AI，但仍会正常存储和显示，可节省 token</Text>
      <View style={styles.switchRow}>
        <Text style={styles.label}>不发送思维链</Text>
        <Switch
          value={stripThinking}
          onValueChange={setStripThinking}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <Text style={styles.sectionTitle}>Prompt 缓存</Text>
      <Text style={styles.hint}>开启后，请求会透传 session_id，并在稳定的 system prompt 与历史对话末尾添加 cache_control。仅在你的 API 中转支持该字段时开启。</Text>
      <View style={styles.switchRow}>
        <Text style={styles.label}>启用 cache_control</Text>
        <Switch
          value={!!promptCacheConfig?.enabled}
          onValueChange={(value) => {
            setPromptCacheConfig({ enabled: value });
            showToast(value ? 'Prompt 缓存已开启' : 'Prompt 缓存已关闭');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <Text style={styles.sectionTitle}>生理信息</Text>
      <Text style={styles.hint}>开启后，仅在预计生理期前两天或经期内，把本地记录推算出的简短提醒附带给 AI。默认关闭。</Text>
      <View style={styles.switchRow}>
        <Text style={styles.label}>发送生理提醒给 AI</Text>
        <Switch
          value={!!periodConfig?.sendToAI}
          onValueChange={(value) => {
            setPeriodConfig({ sendToAI: value });
            showToast(value ? '生理提醒会按条件发送给 AI' : '生理提醒已停止发送给 AI');
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
    </ScrollView>
  );
}

/* ==================== TTS 配置 Tab ==================== */

const TTS_MODELS = ['speech-02-hd', 'speech-02-turbo', 'speech-2.8-hd'];

function TTSConfigTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const { ttsConfig, setTTSConfig } = useSettingsStore();
  const [groupId, setGroupId] = useState(ttsConfig.groupId);
  const [apiKey, setApiKey] = useState(ttsConfig.apiKey);
  const [model, setModel] = useState(ttsConfig.model);
  const [voiceId, setVoiceId] = useState(ttsConfig.voiceId);
  const [speed, setSpeed] = useState(String(ttsConfig.speed));
  const [vol, setVol] = useState(String(ttsConfig.vol));
  const [pitch, setPitch] = useState(String(ttsConfig.pitch));
  const [testing, setTesting] = useState(false);

  function handleSave() {
    if (!groupId.trim() || !apiKey.trim()) {
      Alert.alert('提示', '请填写 Group ID 和 API Key');
      return;
    }
    if (!voiceId.trim()) {
      Alert.alert('提示', '请填写 Voice ID');
      return;
    }
    const s = parseFloat(speed) || 1;
    const v = parseFloat(vol) || 1;
    const p = parseFloat(pitch) || 0;
    setTTSConfig({ groupId: groupId.trim(), apiKey: apiKey.trim(), model, voiceId: voiceId.trim(), speed: s, vol: v, pitch: p });
    showToast('TTS 配置已保存');
  }

  async function handleTest() {
    if (!groupId.trim() || !apiKey.trim() || !voiceId.trim()) {
      Alert.alert('提示', '请先填写 Group ID、API Key 和 Voice ID');
      return;
    }
    setTesting(true);
    try {
      const testConfig: TTSConfig = {
        groupId: groupId.trim(),
        apiKey: apiKey.trim(),
        model,
        voiceId: voiceId.trim(),
        speed: parseFloat(speed) || 1,
        vol: parseFloat(vol) || 1,
        pitch: parseFloat(pitch) || 0,
      };
      await playTTS('你好，这是一段语音合成测试。', testConfig);
      showToast('TTS 配置有效');
    } catch (e: any) {
      Alert.alert('播放失败', e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>MiniMax TTS</Text>
      <Text style={styles.hint}>使用 MiniMax 语音合成服务，需要 Group ID 和 API Key</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Group ID</Text>
        <TextInput style={styles.input} value={groupId} onChangeText={setGroupId}
          placeholder="MiniMax Group ID" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey}
          placeholder="MiniMax API Key" placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Voice ID</Text>
        <TextInput style={styles.input} value={voiceId} onChangeText={setVoiceId}
          placeholder="例如：male-qn-qingse" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>模型</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
          {TTS_MODELS.map((m) => (
            <Pressable key={m}
              style={[styles.configChip, m === model && styles.configChipActive]}
              onPress={() => setModel(m)}
            >
              <Text style={[styles.configChipText, m === model && styles.configChipTextActive]}>{m}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>语速（0.5 ~ 2.0）</Text>
        <TextInput style={styles.input} value={speed} onChangeText={setSpeed}
          keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>音量（0.1 ~ 10）</Text>
        <TextInput style={styles.input} value={vol} onChangeText={setVol}
          keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>音调（-12 ~ 12）</Text>
        <TextInput style={styles.input} value={pitch} onChangeText={setPitch}
          keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试播放</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* ==================== Tool 设置 Tab ==================== */

function ToolConfigTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const {
    memoryVaultConfig,
    webSearchConfig,
    webPageReaderConfig,
    webInteractionConfig,
    hotboardConfig,
    nativeToolConfig,
    shizukuFileConfig,
    setMemoryVaultConfig,
    setWebSearchConfig,
    setWebPageReaderConfig,
    setWebInteractionConfig,
    setHotboardConfig,
    setNativeToolConfig,
    setShizukuFileConfig,
  } = useSettingsStore();

  // 记忆库本地 state
  const [mvEnabled, setMvEnabled] = useState(memoryVaultConfig.enabled);
  const [mvBaseUrl, setMvBaseUrl] = useState(memoryVaultConfig.baseUrl);
  const [mvTopK, setMvTopK] = useState(String(memoryVaultConfig.topK));
  const [mvTokenBudget, setMvTokenBudget] = useState(String(memoryVaultConfig.tokenBudget));
  const [mvMaxCalls, setMvMaxCalls] = useState(String(memoryVaultConfig.maxToolCalls));
  const [mvAdminToken, setMvAdminToken] = useState(memoryVaultConfig.adminToken);
  const [mvTesting, setMvTesting] = useState(false);

  // 联网搜索本地 state
  const [wsEnabled, setWsEnabled] = useState(webSearchConfig.enabled);
  const [wsApiKey, setWsApiKey] = useState(webSearchConfig.tavilyApiKey);
  const [wsMaxResults, setWsMaxResults] = useState(String(webSearchConfig.maxResults));

  // 网页读取本地 state
  const [wprEnabled, setWprEnabled] = useState(!!webPageReaderConfig?.enabled);
  const [wprRenderServiceUrl, setWprRenderServiceUrl] = useState(webPageReaderConfig?.renderServiceUrl || '');

  // 网页交互本地 state
  const [wiEnabled, setWiEnabled] = useState(!!webInteractionConfig?.enabled);
  const [wiMaxCalls, setWiMaxCalls] = useState(String(webInteractionConfig?.maxToolCalls || 8));

  const [hbEnabled, setHbEnabled] = useState(!!hotboardConfig?.enabled);
  const [hbApiKey, setHbApiKey] = useState(hotboardConfig?.apiKey || '');
  const [hbPlatformTypes, setHbPlatformTypes] = useState<string[]>(
    normalizeHotboardPlatformTypes(hotboardConfig?.platforms || DEFAULT_HOTBOARD_PLATFORM_TYPES.join(','))
  );
  const [hbPlatformsExpanded, setHbPlatformsExpanded] = useState(false);

  // Shizuku 文件访问本地 state
  const [shizukuEnabled, setShizukuEnabled] = useState(!!shizukuFileConfig?.enabled);
  const [shizukuRoots, setShizukuRoots] = useState<ShizukuFileRoot[]>(shizukuFileConfig?.roots || []);
  const [shizukuPathInput, setShizukuPathInput] = useState('');
  const [shizukuStatus, setShizukuStatus] = useState<ShizukuStatus | null>(null);
  const [shizukuChecking, setShizukuChecking] = useState(false);

  // 设备原生工具本地 state
  const [deviceInfoEnabled, setDeviceInfoEnabled] = useState(!!nativeToolConfig?.deviceInfoEnabled);
  const [batteryStatusEnabled, setBatteryStatusEnabled] = useState(!!nativeToolConfig?.batteryStatusEnabled);
  const [appUsageStatsEnabled, setAppUsageStatsEnabled] = useState(!!nativeToolConfig?.appUsageStatsEnabled);
  const [calendarEnabled, setCalendarEnabled] = useState(!!nativeToolConfig?.calendarEnabled);

  function handleSaveMemory() {
    const topK = parseInt(mvTopK, 10);
    const tokenBudget = parseInt(mvTokenBudget, 10);
    const maxToolCalls = parseInt(mvMaxCalls, 10);
    if (mvEnabled && !mvBaseUrl.trim()) {
      Alert.alert('提示', '启用记忆库时请填写记忆库地址');
      return;
    }
    setMemoryVaultConfig({
      enabled: mvEnabled,
      baseUrl: mvBaseUrl.trim(),
      adminToken: mvAdminToken.trim(),
      topK: isNaN(topK) || topK <= 0 ? 5 : topK,
      tokenBudget: isNaN(tokenBudget) || tokenBudget <= 0 ? 2000 : tokenBudget,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 3 : maxToolCalls,
    });
    showToast('记忆库配置已保存');
  }

  async function handleTestMemory() {
    if (!mvBaseUrl.trim()) {
      Alert.alert('提示', '请先填写记忆库地址');
      return;
    }
    setMvTesting(true);
    try {
      const url = `${mvBaseUrl.trim().replace(/\/$/, '')}/health`;
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      showToast('记忆库服务正常');
    } catch (e: any) {
      Alert.alert('连接失败', e.message);
    } finally {
      setMvTesting(false);
    }
  }

  function handleSaveWebSearch() {
    const maxResults = parseInt(wsMaxResults, 10);
    if (wsEnabled && !wsApiKey.trim()) {
      Alert.alert('提示', '启用联网搜索时请填写 Tavily API Key');
      return;
    }
    setWebSearchConfig({
      enabled: wsEnabled,
      tavilyApiKey: wsApiKey.trim(),
      maxResults: isNaN(maxResults) || maxResults <= 0 ? 5 : maxResults,
    });
    showToast('联网搜索配置已保存');
  }

  function handleSaveWebPageReader() {
    const trimmedUrl = wprRenderServiceUrl.trim();
    if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
      Alert.alert('提示', '渲染读取服务地址必须以 http:// 或 https:// 开头');
      return;
    }
    setWebPageReaderConfig({
      enabled: wprEnabled,
      renderServiceUrl: trimmedUrl,
    });
    showToast(wprEnabled ? '网页读取配置已保存' : '网页读取已关闭');
  }

  function handleSaveWebInteraction() {
    const maxToolCalls = parseInt(wiMaxCalls, 10);
    setWebInteractionConfig({
      enabled: wiEnabled,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 8 : maxToolCalls,
    });
    showToast(wiEnabled ? '网页交互配置已保存' : '网页交互已关闭');
  }

  function handleSaveHotboard() {
    if (hbEnabled && !hbApiKey.trim()) {
      Alert.alert('提示', '启用 AI 网页巡游热榜时请填写 UAPI API Key');
      return;
    }
    if (hbEnabled && hbPlatformTypes.length === 0) {
      Alert.alert('提示', '请至少填写一个可查询平台 type');
      return;
    }
    setHotboardConfig({
      enabled: hbEnabled,
      apiKey: hbApiKey.trim(),
      platforms: hbPlatformTypes.join(','),
    });
    showToast(hbEnabled ? 'AI 网页巡游热榜配置已保存' : 'AI 网页巡游热榜已关闭');
  }

  function toggleHotboardPlatform(type: string) {
    setHbPlatformTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type]
    );
  }

  function selectDefaultHotboardPlatforms() {
    setHbPlatformTypes(DEFAULT_HOTBOARD_PLATFORM_TYPES);
  }

  function selectAllHotboardPlatforms() {
    setHbPlatformTypes(HOTBOARD_PLATFORMS.map((platform) => platform.type));
  }

  function clearHotboardPlatforms() {
    setHbPlatformTypes([]);
  }

  async function handleCheckShizukuStatus() {
    setShizukuChecking(true);
    try {
      const status = await getShizukuStatus();
      setShizukuStatus(status);
      if (!status.running) {
        showToast('Shizuku 未运行');
      } else if (!status.permissionGranted) {
        showToast('Shizuku 已运行，尚未授权');
      } else {
        showToast('Shizuku 已运行且已授权');
      }
    } catch (e: any) {
      Alert.alert('检测失败', e?.message || '无法检测 Shizuku 状态');
    } finally {
      setShizukuChecking(false);
    }
  }

  async function handleRequestShizukuPermission() {
    setShizukuChecking(true);
    try {
      const status = await requestShizukuPermission();
      setShizukuStatus(status);
      showToast(status.permissionGranted ? 'Shizuku 授权成功' : 'Shizuku 未授权');
    } catch (e: any) {
      Alert.alert('授权失败', e?.message || '无法请求 Shizuku 授权');
    } finally {
      setShizukuChecking(false);
    }
  }

  function handleAddShizukuRoot() {
    try {
      const root = createShizukuRoot(shizukuPathInput);
      if (shizukuRoots.some((item) => item.path === root.path)) {
        showToast('该路径已经添加过');
        return;
      }
      setShizukuRoots((current) => [...current, root]);
      setShizukuPathInput('');
      showToast('已添加 Shizuku 读写路径，记得保存配置');
    } catch (e: any) {
      Alert.alert('路径无效', e?.message || '请填写有效的绝对路径');
    }
  }

  function handleRemoveShizukuRoot(rootId: string) {
    setShizukuRoots((current) => current.filter((root) => root.id !== rootId));
  }

  function handleSaveShizukuFile() {
    if (shizukuEnabled && shizukuRoots.length === 0) {
      Alert.alert('提示', '启用 Shizuku 文件访问时，请至少添加一个允许访问的路径');
      return;
    }

    setShizukuFileConfig({
      enabled: shizukuEnabled,
      roots: shizukuRoots,
      maxToolCalls: shizukuFileConfig?.maxToolCalls || 6,
    });
    showToast(shizukuEnabled ? 'Shizuku 文件访问已保存' : 'Shizuku 文件访问已关闭');
  }

  function handleSaveNativeTools() {
    setNativeToolConfig({
      deviceInfoEnabled,
      batteryStatusEnabled,
      appUsageStatsEnabled,
      calendarEnabled,
    });
    showToast('设备原生 Tool 开关已保存');
  }

  const nativeToolRows = [
    {
      label: '用户设备信息读取',
      hint: '品牌、型号、系统版本、设备类型、内存等',
      value: deviceInfoEnabled,
      onValueChange: setDeviceInfoEnabled,
    },
    {
      label: '电池状态读取',
      hint: '电量、充电状态、低电量模式等',
      value: batteryStatusEnabled,
      onValueChange: setBatteryStatusEnabled,
    },
    {
      label: '应用使用时间统计读取',
      hint: 'Android 使用情况访问权限；首次调用会提示去系统设置授权',
      value: appUsageStatsEnabled,
      onValueChange: setAppUsageStatsEnabled,
    },
    {
      label: '日历日程管理',
      hint: '读取、创建、修改、删除系统日历日程，需要授权',
      value: calendarEnabled,
      onValueChange: setCalendarEnabled,
    },
  ];

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* ===== 记忆库 Memory Vault ===== */}
      <Text style={styles.sectionTitle}>记忆库 Memory Vault</Text>
      <Text style={styles.hint}>AI 可自主调用记忆库进行语义搜索和日记查询</Text>

      <View style={styles.switchRow}>
        <Text style={styles.label}>启用记忆库</Text>
        <Switch
          value={mvEnabled}
          onValueChange={setMvEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>记忆库地址</Text>
        <TextInput style={styles.input} value={mvBaseUrl} onChangeText={setMvBaseUrl}
          placeholder="https://your-memory-vault.com" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>管理员 Token（上传日记用）</Text>
        <TextInput style={styles.input} value={mvAdminToken} onChangeText={setMvAdminToken}
          placeholder="ADMIN_TOKEN" placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>返回条数 (top_k)</Text>
        <TextInput style={styles.input} value={mvTopK} onChangeText={setMvTopK}
          keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Token 预算</Text>
        <TextInput style={styles.input} value={mvTokenBudget} onChangeText={setMvTokenBudget}
          keyboardType="number-pad" placeholder="2000" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>最大查询次数（每轮）</Text>
        <TextInput style={styles.input} value={mvMaxCalls} onChangeText={setMvMaxCalls}
          keyboardType="number-pad" placeholder="3" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTestMemory} disabled={mvTesting}>
          {mvTesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSaveMemory}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      {/* ===== 联网搜索 Web Search ===== */}
      <Text style={styles.sectionTitle}>联网搜索 Web Search</Text>
      <Text style={styles.hint}>AI 可自主调用 Tavily 搜索互联网获取实时信息</Text>

      <View style={styles.switchRow}>
        <Text style={styles.label}>启用联网搜索</Text>
        <Switch
          value={wsEnabled}
          onValueChange={setWsEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Tavily API Key</Text>
        <TextInput style={styles.input} value={wsApiKey} onChangeText={setWsApiKey}
          placeholder="tvly-..." placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>搜索结果数量</Text>
        <TextInput style={styles.input} value={wsMaxResults} onChangeText={setWsMaxResults}
          keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.saveButton} onPress={handleSaveWebSearch}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      {/* ===== 网页读取 Web Page Reader ===== */}
      <Text style={styles.sectionTitle}>网页读取 Web Page Reader</Text>
      <Text style={styles.hint}>开启后，AI 收到链接时可调用 read_web_page 抓取页面正文；如页面依赖 JS 渲染，可配置 Playwright 后端服务作为兜底</Text>

      <View style={styles.switchRow}>
        <Text style={styles.label}>启用网页读取</Text>
        <Switch
          value={wprEnabled}
          onValueChange={setWprEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>渲染读取服务地址（可选）</Text>
        <TextInput style={styles.input} value={wprRenderServiceUrl} onChangeText={setWprRenderServiceUrl}
          placeholder="http://localhost:8787/read" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.saveButton} onPress={handleSaveWebPageReader}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      {/* ===== AI 网页巡游 Hotboard ===== */}
      <Text style={styles.sectionTitle}>AI 网页巡游 Hotboard</Text>
      <Text style={styles.hint}>调用 UAPI 查询热榜：type 为必填参数，API Key 使用 Authorization: Bearer 你的密钥。平台 type 只会从下面列表中选择。</Text>

      <View style={styles.switchRow}>
        <Text style={styles.label}>启用 AI 网页巡游热榜</Text>
        <Switch
          value={hbEnabled}
          onValueChange={setHbEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>UAPI API Key</Text>
        <TextInput style={styles.input} value={hbApiKey} onChangeText={setHbApiKey}
          placeholder="Bearer token" placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Pressable
          style={styles.platformToggle}
          onPress={() => setHbPlatformsExpanded((value) => !value)}
        >
          <View>
            <Text style={styles.label}>可查询平台</Text>
            <Text style={styles.hint}>{hbPlatformTypes.length} / {HOTBOARD_PLATFORMS.length} 已勾选</Text>
          </View>
          <Text style={styles.platformToggleIcon}>{hbPlatformsExpanded ? '⌃' : '⌄'}</Text>
        </Pressable>
        {hbPlatformsExpanded && (
          <>
            <View style={styles.platformActions}>
              <Pressable style={styles.platformActionButton} onPress={selectDefaultHotboardPlatforms}>
                <Text style={styles.platformActionText}>默认</Text>
              </Pressable>
              <Pressable style={styles.platformActionButton} onPress={selectAllHotboardPlatforms}>
                <Text style={styles.platformActionText}>全选</Text>
              </Pressable>
              <Pressable style={styles.platformActionButton} onPress={clearHotboardPlatforms}>
                <Text style={styles.platformActionText}>清空</Text>
              </Pressable>
            </View>
            <View style={styles.platformGrid}>
              {HOTBOARD_PLATFORMS.map((platform) => {
                const selected = hbPlatformTypes.includes(platform.type);
                return (
                  <Pressable
                    key={platform.type}
                    style={[styles.platformChip, selected && styles.platformChipSelected]}
                    onPress={() => toggleHotboardPlatform(platform.type)}
                  >
                    <Text style={[styles.platformChipLabel, selected && styles.platformChipLabelSelected]}>{platform.label}</Text>
                    <Text style={[styles.platformChipType, selected && styles.platformChipTypeSelected]}>{platform.type}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
        <Text style={styles.hint}>AI 只能从已勾选的平台 type 中调用 hotboard，用户指定未勾选平台时会自动跳过。</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.saveButton} onPress={handleSaveHotboard}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      {/* ===== 网页交互 Web Interaction ===== */}
      <Text style={styles.sectionTitle}>网页交互 Web Interaction</Text>
      <Text style={styles.hint}>开启后，AI 可在用户端显示网页面板，并进行打开、观察、点击和等待等简单操作</Text>

      <View style={styles.switchRow}>
        <Text style={styles.label}>启用网页交互</Text>
        <Switch
          value={wiEnabled}
          onValueChange={setWiEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>最大操作次数（每轮）</Text>
        <TextInput style={styles.input} value={wiMaxCalls} onChangeText={setWiMaxCalls}
          keyboardType="number-pad" placeholder="8" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.saveButton} onPress={handleSaveWebInteraction}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      {/* ===== Shizuku 文件访问 ===== */}
      <Text style={styles.sectionTitle}>Shizuku 文件访问（读写）</Text>
      <Text style={styles.hint}>个人高级模式：通过 Shizuku 以 shell 身份读写你手动添加的绝对路径。AI 仍只能访问这些路径根内的相对路径。</Text>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>启用 Shizuku 文件访问</Text>
          <Text style={styles.hint}>适合访问 Android/data 下普通权限无法访问的目录；写入和修改只会在你添加的路径根内执行</Text>
        </View>
        <Switch
          value={shizukuEnabled}
          onValueChange={setShizukuEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Shizuku 状态</Text>
        <Text style={styles.hint}>
          {shizukuStatus
            ? `运行：${shizukuStatus.running ? '是' : '否'} · 授权：${shizukuStatus.permissionGranted ? '是' : '否'}${shizukuStatus.uid != null && shizukuStatus.uid >= 0 ? ` · uid ${shizukuStatus.uid}` : ''}`
            : '尚未检测'}
        </Text>
        <View style={styles.platformActions}>
          <Pressable style={styles.platformActionButton} onPress={handleCheckShizukuStatus} disabled={shizukuChecking}>
            <Text style={styles.platformActionText}>{shizukuChecking ? '检测中' : '检测状态'}</Text>
          </Pressable>
          <Pressable style={styles.platformActionButton} onPress={handleRequestShizukuPermission} disabled={shizukuChecking}>
            <Text style={styles.platformActionText}>请求授权</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>允许访问的路径</Text>
        <TextInput
          style={styles.input}
          value={shizukuPathInput}
          onChangeText={setShizukuPathInput}
          placeholder="/storage/emulated/0/Android/data/com.tencent.mobileqq"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
        <Pressable style={styles.addPathButton} onPress={handleAddShizukuRoot}>
          <Text style={styles.addPathButtonText}>添加路径</Text>
        </Pressable>
        {shizukuRoots.length === 0 ? (
          <Text style={styles.emptyText}>尚未添加 Shizuku 路径</Text>
        ) : (
          shizukuRoots.map((root) => (
            <View key={root.id} style={styles.fileRootRow}>
              <View style={styles.nativeToolText}>
                <Text style={styles.label}>{root.name}</Text>
                <Text style={styles.hint}>{root.path}</Text>
              </View>
              <Pressable style={styles.removeSmallButton} onPress={() => handleRemoveShizukuRoot(root.id)}>
                <Text style={styles.removeSmallButtonText}>移除</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.saveButton} onPress={handleSaveShizukuFile}>
          <Text style={styles.saveButtonText}>保存 Shizuku 配置</Text>
        </Pressable>
      </View>

      {/* ===== 设备原生 Tools ===== */}
      <Text style={styles.sectionTitle}>设备原生 Tools</Text>
      <Text style={styles.hint}>这些工具会直接访问用户设备能力；日历会触发系统权限请求，其他受限能力会先返回实现限制说明</Text>

      {nativeToolRows.map((row) => (
        <View key={row.label} style={styles.nativeToolRow}>
          <View style={styles.nativeToolText}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.hint}>{row.hint}</Text>
          </View>
          <Switch
            value={row.value}
            onValueChange={row.onValueChange}
            trackColor={{ true: colors.primary }}
          />
        </View>
      ))}

      <View style={styles.actions}>
        <Pressable style={styles.saveButton} onPress={handleSaveNativeTools}>
          <Text style={styles.saveButtonText}>保存设备 Tool 开关</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* ==================== 日记 Tab ==================== */

function DiaryTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const { diaries, loadDiaries, addDiary, editDiary, toggleFavorite, removeDiary } = useDiaryStore();
  // 隐藏楼层随对话独立，与待总结的消息同源，统一从 chat store 取
  const { messages, hiddenRanges } = useChatStore();
  const { apiConfigs, activeConfigIndex, systemPrompt, maxOutputTokens, memoryVaultConfig } = useSettingsStore();

  // AI 总结相关 state
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [summaryTitle, setSummaryTitle] = useState('');
  const summaryAbort = useRef<AbortController | null>(null);

  // 编辑日记 Modal state
  const [editing, setEditing] = useState<Diary | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // 新建日记 Modal state
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createContent, setCreateContent] = useState('');

  // 上传到云端记忆库 Modal state
  const [uploadTarget, setUploadTarget] = useState<Diary | null>(null);
  const [uploadDate, setUploadDate] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadDiaries();
  }, []);

  async function handleSummarize() {
    const config = apiConfigs[activeConfigIndex];
    if (!config || !config.baseUrl || !config.apiKey) {
      Alert.alert('提示', '请先在设置中配置 API');
      return;
    }

    // 取当前对话的 user/assistant 消息
    const chatMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (chatMessages.length === 0) {
      Alert.alert('提示', '当前对话没有可总结的消息');
      return;
    }

    const total = chatMessages.length;
    let from = parseInt(fromStr, 10);
    let to = parseInt(toStr, 10);
    if (isNaN(from)) from = 1;
    if (isNaN(to)) to = total;
    if (from < 1) from = 1;
    if (to > total) to = total;
    if (from > to) {
      Alert.alert('提示', '请输入有效的范围（起始 ≤ 结束）');
      return;
    }

    // 按 1-based index 取范围内、且未被隐藏的消息
    const selected = chatMessages.filter((_, index) => {
      const msgNum = index + 1;
      if (msgNum < from || msgNum > to) return false;
      const hidden = hiddenRanges.some((r) => msgNum >= r.from && msgNum <= r.to);
      return !hidden;
    });

    if (selected.length === 0) {
      Alert.alert('提示', '所选范围内没有未隐藏的消息');
      return;
    }

    // 拼接对话内容
    const conversationText = selected
      .map((m) => `${m.role === 'user' ? '用户' : '我'}：${m.content}`)
      .join('\n\n');

    // 已收藏日记作为近期日记
    const favorites = await getFavoriteDiaries();
    const memoryMessages: { role: string; content: string }[] = [];
    if (favorites.length > 0) {
      const memoryContent = favorites
        .map((d) => `${d.title}\n${d.content}`)
        .join('\n\n---\n\n');
      memoryMessages.push({ role: 'system', content: `以下是你的近期日记：\n\n${memoryContent}` });
    }

    const summaryPrompt =
      '请你以第一人称、流水账的形式，把下面这段对话总结成一篇今天的日记。' +
      '只输出日记正文，不要加任何额外说明或标题。';

    setSummarizing(true);
    setSummaryText('');
    summaryAbort.current = new AbortController();

    try {
      await streamChat(
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...memoryMessages,
            { role: 'user', content: `${summaryPrompt}\n\n以下是对话内容：\n\n${conversationText}` },
          ],
          maxTokens: maxOutputTokens || undefined,
        },
        (token: string) => setSummaryText((prev) => prev + token),
        summaryAbort.current.signal
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        Alert.alert('总结失败', e.message || '请求失败');
      }
    } finally {
      setSummarizing(false);
      summaryAbort.current = null;
    }
  }

  function handleStopSummarize() {
    summaryAbort.current?.abort();
    setSummarizing(false);
  }

  async function handleSaveSummary() {
    const content = summaryText.trim();
    if (!content) {
      Alert.alert('提示', '没有可保存的内容');
      return;
    }
    const title = summaryTitle.trim() || `日记 ${formatFullTime(Date.now())}`;
    await addDiary(title, content);
    setSummaryText('');
    setSummaryTitle('');
    setFromStr('');
    setToStr('');
    showToast('日记已保存');
  }

  function handleOpenCreate() {
    setCreateTitle('');
    setCreateContent('');
    setCreating(true);
  }

  async function handleSaveCreate() {
    const content = createContent.trim();
    const title = createTitle.trim();
    if (!content && !title) {
      Alert.alert('提示', '请输入日记内容');
      return;
    }
    await addDiary(title || `日记 ${formatFullTime(Date.now())}`, content);
    setCreating(false);
    setCreateTitle('');
    setCreateContent('');
  }

  function handleOpenUpload(d: Diary) {
    setUploadTarget(d);
    setUploadDate(formatDateOnly(d.createdAt));
  }

  async function handleConfirmUpload() {
    if (!uploadTarget) return;
    const date = uploadDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('提示', '请输入正确的日期格式：YYYY-MM-DD');
      return;
    }
    // 标题并入正文：标题\n正文
    const title = uploadTarget.title.trim();
    const body = uploadTarget.content.trim();
    const content = title ? `${title}\n${body}` : body;
    if (!content) {
      Alert.alert('提示', '该日记内容为空，无法上传');
      return;
    }
    setUploading(true);
    try {
      await uploadDiary(date, content, memoryVaultConfig);
      setUploadTarget(null);
      Alert.alert('上传成功', `日记已上传到云端记忆库（${date}）`);
    } catch (e: any) {
      Alert.alert('上传失败', e.message || '请求失败');
    } finally {
      setUploading(false);
    }
  }

  function handleOpenEdit(d: Diary) {
    setEditing(d);
    setEditTitle(d.title);
    setEditContent(d.content);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    await editDiary(editing.id, { title: editTitle.trim(), content: editContent.trim() });
    setEditing(null);
  }

  function handleDeleteDiary(d: Diary) {
    Alert.alert('删除日记', `确定删除「${d.title || '无标题'}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => removeDiary(d.id) },
    ]);
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      {/* AI 日记总结 */}
      <Text style={styles.sectionTitle}>AI 日记总结</Text>
      <Text style={styles.hint}>选择消息范围，让 AI 以第一人称流水账总结为日记（自动排除已隐藏消息，留空则全部）</Text>

      <View style={styles.rangeInputRow}>
        <Text style={styles.rangeLabel}>从第</Text>
        <TextInput style={styles.rangeInput} value={fromStr} onChangeText={setFromStr}
          keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
        <Text style={styles.rangeLabel}>条到第</Text>
        <TextInput style={styles.rangeInput} value={toStr} onChangeText={setToStr}
          keyboardType="number-pad" placeholder="末" placeholderTextColor={colors.textTertiary} />
        <Text style={styles.rangeLabel}>条</Text>
        {summarizing ? (
          <Pressable style={styles.rangeAddButton} onPress={handleStopSummarize}>
            <Text style={styles.rangeAddText}>停止</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.rangeAddButton} onPress={handleSummarize}>
            <Text style={styles.rangeAddText}>总结</Text>
          </Pressable>
        )}
      </View>

      {(summaryText.length > 0 || summarizing) && (
        <View style={styles.summaryBox}>
          <TextInput
            style={styles.summaryTitleInput}
            value={summaryTitle}
            onChangeText={setSummaryTitle}
            placeholder="日记标题（留空自动生成）"
            placeholderTextColor={colors.textTertiary}
          />
          <TextInput
            style={styles.summaryContentInput}
            value={summaryText}
            onChangeText={setSummaryText}
            multiline
            scrollEnabled
            placeholder="AI 总结内容将显示在这里..."
            placeholderTextColor={colors.textTertiary}
          />
          {summarizing ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : (
            <Pressable style={styles.saveButton} onPress={handleSaveSummary}>
              <Text style={styles.saveButtonText}>保存为日记</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* 我的日记 */}
      <View style={styles.diaryHeaderRow}>
        <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>我的日记</Text>
        <Pressable style={styles.diaryAddButton} onPress={handleOpenCreate}>
          <Text style={styles.diaryAddText}>+ 新建</Text>
        </Pressable>
      </View>
      {diaries.length === 0 ? (
        <Text style={styles.hint}>暂无日记</Text>
      ) : (
        diaries.map((d) => (
          <Pressable
            key={d.id}
            style={styles.diaryItem}
            onPress={() => handleOpenEdit(d)}
            onLongPress={() => handleDeleteDiary(d)}
          >
            <Pressable style={styles.diaryStar} onPress={() => toggleFavorite(d.id)} hitSlop={8}>
              <Text style={[styles.diaryStarText, d.isFavorite && styles.diaryStarActive]}>
                {d.isFavorite ? '★' : '☆'}
              </Text>
            </Pressable>
            <View style={styles.diaryContent}>
              <Text style={styles.diaryTitle} numberOfLines={1}>{d.title || '无标题'}</Text>
              <Text style={styles.diaryPreview} numberOfLines={1}>{d.content}</Text>
              <Text style={styles.diaryDate}>{formatFullTime(d.createdAt)}</Text>
            </View>
            <Pressable style={styles.diaryUpload} onPress={() => handleOpenUpload(d)} hitSlop={8}>
              <Text style={styles.diaryUploadText}>上传</Text>
            </Pressable>
          </Pressable>
        ))
      )}

      <View style={{ height: 40 }} />

      {/* 编辑日记 Modal */}
      <Modal visible={!!editing} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setEditing(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>编辑日记</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="日记标题"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={[styles.summaryContentInput, styles.diaryModalContentInput]}
              value={editContent}
              onChangeText={setEditContent}
              multiline
              scrollEnabled
              placeholder="日记内容"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setEditing(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveEdit}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* 新建日记 Modal */}
      <Modal visible={creating} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setCreating(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>新建日记</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={createTitle}
              onChangeText={setCreateTitle}
              placeholder="日记标题（留空自动生成）"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={[styles.summaryContentInput, styles.diaryModalContentInput]}
              value={createContent}
              onChangeText={setCreateContent}
              multiline
              scrollEnabled
              placeholder="日记内容"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setCreating(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveCreate}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* 上传日记到云端 Modal */}
      <Modal visible={!!uploadTarget} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => !uploading && setUploadTarget(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>上传到云端记忆库</Text>
            <Text style={styles.hint}>标题将并入正文上传。请确认日期（一个日期对应一篇云端日记，重复日期可能覆盖）</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={uploadDate}
              onChangeText={setUploadDate}
              placeholder="日期 YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => !uploading && setUploadTarget(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleConfirmUpload} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>上传</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

/* ==================== Styles ==================== */

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 34,
    alignItems: 'center',
    zIndex: 20,
  },
  toastText: {
    maxWidth: '100%',
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backButton: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  backIcon: { fontSize: 22, color: colors.text },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center' },
  tabBar: {
    flexGrow: 0, paddingTop: 12,
  },
  tabBarContent: {
    paddingHorizontal: 16, gap: 4,
  },
  tab: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  tabTextActive: { color: '#FFFFFF' },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
  },
  switchText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  nativeToolRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  },
  nativeToolText: { flex: 1 },
  fileRootRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginTop: 8,
  },
  removeSmallButton: {
    borderWidth: 1, borderColor: colors.danger, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  removeSmallButtonText: { fontSize: 13, fontWeight: '600', color: colors.danger },
  emptyText: { fontSize: 13, color: colors.textTertiary, marginTop: 8 },
  addPathButton: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPathButtonText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  content: { flex: 1, padding: 20 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    marginBottom: 10, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  diaryHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10, marginTop: 8,
  },
  diaryAddButton: {
    backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6,
  },
  diaryAddText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
  configList: { marginBottom: 16 },
  configChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface, marginRight: 8,
  },
  configChipActive: { backgroundColor: colors.primary },
  configChipText: { fontSize: 13, fontWeight: '500', color: colors.text },
  configChipTextActive: { color: '#FFFFFF' },
  field: { marginBottom: 14 },
  floatingBallSizeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  floatingBallSizeField: {
    flex: 1,
    minWidth: 0,
  },
  label: { fontSize: 14, color: colors.text, marginBottom: 6, fontWeight: '500' },
  input: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 12, padding: 14, fontSize: 14, color: colors.text,
  },
  multilineInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  platformToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  platformToggleIcon: {
    fontSize: 18,
    color: colors.textSecondary,
    marginLeft: 12,
  },
  platformActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  platformActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  platformActionText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  platformGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  platformChip: {
    width: '48%',
    minHeight: 54,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  platformChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  platformChipLabel: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '600',
  },
  platformChipLabelSelected: {
    color: colors.primary,
  },
  platformChipType: {
    marginTop: 3,
    fontSize: 11,
    color: colors.textTertiary,
  },
  platformChipTypeSelected: {
    color: colors.textSecondary,
  },
  modelRow: { flexDirection: 'row', gap: 8 },
  fetchButton: {
    backgroundColor: colors.primary, borderRadius: 12,
    paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center',
  },
  fetchButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 32 },
  backupPanel: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 28,
  },
  backupActions: {
    gap: 10,
  },
  backupPrimaryButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backupDangerButton: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backupDangerText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.danger,
  },
  diagnosticsButton: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  diagnosticsButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  testButton: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  testButtonText: { fontSize: 15, fontWeight: '500', color: colors.primary },
  saveButton: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  saveButtonText: { fontSize: 15, fontWeight: '500', color: '#FFFFFF' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: colors.background, borderRadius: 16, padding: 20, width: '85%', maxHeight: '60%' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 12 },
  modelList: { maxHeight: 300 },
  modelItem: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, marginBottom: 2 },
  modelItemActive: { backgroundColor: colors.surface },
  modelItemText: { fontSize: 14, color: colors.text },
  modelItemTextActive: { color: colors.primary, fontWeight: '500' },
  // Chat settings styles
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 12,
  },
  infoLabel: { fontSize: 14, color: colors.text, fontWeight: '500' },
  infoValue: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.textTertiary, marginBottom: 12 },
  appearanceThemeSaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  appearanceThemeNameInput: {
    flex: 1,
    minWidth: 0,
  },
  appearanceThemeSaveButton: {
    minWidth: 72,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  stickerAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  stickerNameInput: {
    flex: 1,
    minWidth: 0,
  },
  customStickerList: {
    marginBottom: 18,
  },
  customStickerEmpty: {
    minHeight: 54,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  customStickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 10,
  },
  customStickerPreview: {
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  customStickerImage: {
    width: '100%',
    height: '100%',
  },
  customStickerNameInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bulkImportInput: {
    minHeight: 110,
    marginBottom: 12,
  },
  greetingInput: {
    minHeight: 116,
    marginBottom: 14,
  },
  appearanceClearButton: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  appearanceClearText: {
    fontSize: 13,
    color: colors.danger,
    fontWeight: '600',
  },
  appearanceThemeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  appearanceThemeToggleText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  appearanceThemeHint: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  appearanceThemeToggleAction: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  appearanceThemeList: {
    marginBottom: 14,
  },
  appearanceThemeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  appearanceThemeRowActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  appearanceThemeName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  appearanceThemeNameActive: {
    color: colors.primary,
  },
  appearanceThemeActions: {
    flexDirection: 'row',
    flexShrink: 0,
    gap: 6,
  },
  topBarPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 14,
  },
  topBarPreviewButton: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  appearanceIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  appearanceAssetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  appearanceIconPreview: {
    width: 42,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  appearanceImagePreview: {
    width: 58,
    height: 58,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  floatingBallPreview: {
    width: 58,
    height: 58,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 29,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  defaultFloatingBallPreview: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.78)',
  },
  appearanceImageThumb: {
    width: '100%',
    height: '100%',
  },
  appearanceImagePlaceholder: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  customInputIconPreview: {
    width: 26,
    height: 26,
  },
  appearanceIconText: {
    flex: 1,
    minWidth: 0,
  },
  appearanceIconActions: {
    flexDirection: 'row',
    gap: 8,
  },
  smallActionButton: {
    minWidth: 48,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  smallActionButtonDisabled: {
    opacity: 0.45,
  },
  smallActionText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600',
  },
  smallActionTextDisabled: {
    color: colors.textTertiary,
  },
  colorSwatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorSwatchActive: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  appearanceNumberGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  appearanceNumberField: {
    flex: 1,
    minWidth: 0,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  segmentedButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentedButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  segmentedText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  segmentedTextActive: {
    color: colors.primary,
  },
  importButton: {
    minHeight: 46,
    backgroundColor: colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  importButtonDisabled: {
    opacity: 0.7,
  },
  importButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  rangeList: { marginBottom: 12 },
  rangeItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6,
  },
  rangeText: { fontSize: 14, color: colors.text },
  rangeDelete: { fontSize: 14, color: colors.primary, fontWeight: '600', paddingHorizontal: 8 },
  hiddenMessageText: { flex: 1, minWidth: 0, paddingRight: 10 },
  rangeInputRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 20,
  },
  rangeLabel: { fontSize: 14, color: colors.text },
  rangeInput: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.text,
    width: 50, textAlign: 'center',
  },
  rangeAddButton: {
    backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  rangeAddText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  rangeRestoreButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rangeRestoreText: { color: colors.primary, fontSize: 14, fontWeight: '500' },
  previewBox: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 20,
  },
  previewHint: {
    fontSize: 11, color: colors.textTertiary, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  hiddenContextTitle: {
    marginTop: 6,
  },
  previewItem: { gap: 3 },
  previewLabel: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  previewText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  // Diary styles
  summaryBox: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20,
  },
  summaryTitleInput: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 10, padding: 12, fontSize: 15, fontWeight: '500', color: colors.text, marginBottom: 10,
  },
  summaryContentInput: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 10, padding: 12, fontSize: 14, color: colors.text,
    minHeight: 140, maxHeight: 220, textAlignVertical: 'top', marginBottom: 10,
  },
  diaryModalContentInput: {
    height: 180,
    flexShrink: 1,
  },
  diaryItem: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8,
  },
  diaryStar: { paddingRight: 12, paddingTop: 1 },
  diaryStarText: { fontSize: 20, color: colors.textTertiary },
  diaryStarActive: { color: colors.primary },
  diaryContent: { flex: 1, gap: 3 },
  diaryTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  diaryPreview: { fontSize: 13, color: colors.textSecondary },
  diaryDate: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  diaryUpload: {
    alignSelf: 'center', marginLeft: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: colors.primaryLight,
    borderWidth: 0.5, borderColor: colors.border,
  },
  diaryUploadText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  modalCancelText: { fontSize: 15, color: colors.textSecondary },
  modalConfirm: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary },
  modalConfirmText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
});

let styles = createStyles(colors);
