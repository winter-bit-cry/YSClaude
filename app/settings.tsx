import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, Alert, Modal, FlatList, Switch, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';

import { fonts } from '../src/theme/fonts';
import { useSettingsStore, NamedAPIConfig, TTSConfig, MemoryVaultConfig, WebSearchConfig, type BubbleTextureConfig, type ChatInputIconKey, type ChatInputAppearanceStyle, type AssistantBubbleAppearanceStyle, type ShizukuFileRoot, type StickerOwner, type CustomSticker, type QQBotConfig, type ImageGenerationFaceReference, type DailyPaperSourceConfig } from '../src/stores/settings';
import { TopBarIcon, TOP_BAR_ICON_ITEMS } from '../src/components/TopBarIcon';
import type { TopBarIconKey } from '../src/utils/topBarIconTypes';
import { useChatStore } from '../src/stores/chat';
import { useDiaryStore } from '../src/stores/diary';
import { playTTS, stopTTS } from '../src/services/tts';
import { streamChat } from '../src/services/api';
import { Diary, HiddenRange, IncomingLetterOccasion } from '../src/types';
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
import { formatMcpPromptResult, getMcpPrompt, listMcpCapabilities } from '../src/services/mcpHttpClient';
import { sanitizeMcpServerId } from '../src/services/toolModules/mcpRemote';
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
import { generateImmediateIncomingLetter } from '../src/services/incomingLetters';
import { useKeyboardHeight } from '../src/hooks/useKeyboardHeight';
import { buildStickerDefinitions, normalizeStickerName } from '../src/utils/stickers';
import { mergeRanges } from '../src/utils/ranges';


let colors = lightColors;
const TABS = ['API 配置', '对话设置', 'TTS 配置', '工具设置', '日记', '来信', '悬浮球', '表情包', '欢迎页', '美化'] as const;
type ToastFn = (message: string) => void;
type SettingsTabProps = { showToast: ToastFn; keyboardBottomInset: number };
const CUSTOM_TOP_BAR_ICON_MAX_BYTES = 2 * 1024 * 1024;
const CUSTOM_TOP_BAR_ICON_MIN_SIDE = 48;
const CUSTOM_TOP_BAR_ICON_MAX_SIDE = 2048;
const CUSTOM_BACKGROUND_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOM_BACKGROUND_MIN_SIDE = 320;
const CUSTOM_BACKGROUND_MAX_SIDE = 6000;
const CUSTOM_BUBBLE_TEXTURE_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOM_BUBBLE_TEXTURE_MIN_SIDE = 48;
const CUSTOM_BUBBLE_TEXTURE_MAX_SIDE = 4096;
const CUSTOM_STICKER_MAX_BYTES = 5 * 1024 * 1024;
const CUSTOM_STICKER_MIN_SIDE = 32;
const CUSTOM_STICKER_MAX_SIDE = 4096;
const IMAGE_GENERATION_FACE_REFERENCE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE = 64;
const IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE = 4096;
const IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT = 16;
const CUSTOM_FLOATING_BALL_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOM_FLOATING_BALL_MIN_SIDE = 24;
const CUSTOM_FLOATING_BALL_MAX_SIDE = 2048;
const CUSTOM_FLOATING_BALL_SELECTION_LIMIT = 50;
const FLOATING_BALL_SIZE_DEFAULT = 64;
const FLOATING_BALL_SIZE_MIN = 32;
const FLOATING_BALL_SIZE_MAX = 160;
const QQ_BOT_BACKEND_TIMEOUT_MS = 60000;
const QQ_BOT_CONFIG_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;
const QQ_BOT_STICKER_BATCH_MAX_BYTES = 900 * 1024;
const QQ_BOT_STICKER_BATCH_MAX_COUNT = 5;
const CHAT_INPUT_ICON_ITEMS: Array<{ key: ChatInputIconKey; label: string }> = [
  { key: 'options', label: '左侧菜单' },
  { key: 'sticker', label: '贴纸' },
  { key: 'sendIdle', label: '发送/回复' },
  { key: 'sendFocused', label: '聚焦发送' },
  { key: 'stop', label: '停止生成' },
];
const COLOR_SWATCHES = ['#f1eee7', '#FFFFFF', '#FDE68A', '#BFDBFE', '#FBCFE8', '#DCFCE7', '#2B241D', '#141413'];
const IMAGE_SIZE_OPTIONS = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;
const IMAGE_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
type ModelPickerTarget = 'chat' | 'image';
type ImageOptionTarget = 'size' | 'quality';
type BubbleTextureOwner = 'user' | 'assistant';

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
      {activeTab === 5 && <IncomingLetterTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 6 && <FloatingBallTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 7 && <StickerTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 8 && <WelcomePageTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 9 && <AppearanceTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}

      {toastMessage && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
    </View>
  );
}

/* ==================== 欢迎页 Tab ==================== */

function WelcomePageTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const { appearanceConfig, setAppearanceConfig } = useSettingsStore();
  const [pickingWelcomeLogo, setPickingWelcomeLogo] = useState(false);
  const customGreetings = appearanceConfig?.customGreetings || '';
  const welcomeLogoImageUri = appearanceConfig?.welcomeLogoImageUri;
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

  async function handlePickWelcomeLogo() {
    if (pickingWelcomeLogo) return;
    setPickingWelcomeLogo(true);
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
        Alert.alert('图片不适合作为欢迎页 Logo', validationError);
        return;
      }

      const uri = await copyAppearanceImage(asset, 'welcome-logos', 'welcome-logo');
      setAppearanceConfig({ welcomeLogoImageUri: uri });
      showToast('欢迎页 Logo 已更新');
    } catch (error: any) {
      Alert.alert('选择欢迎页 Logo 失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingWelcomeLogo(false);
    }
  }

  function handleClearWelcomeLogo() {
    setAppearanceConfig({ welcomeLogoImageUri: undefined });
    showToast('已恢复默认欢迎页 Logo');
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>中心 Logo</Text>
      <View style={styles.appearanceAssetRow}>
        <View style={styles.welcomeLogoPreview}>
          <Image
            source={welcomeLogoImageUri ? { uri: welcomeLogoImageUri } : require('../assets/claudelogo.png')}
            style={styles.welcomeLogoImage}
            resizeMode="contain"
          />
        </View>
        <View style={styles.appearanceIconText}>
          <Text style={styles.label}>欢迎页中心 Logo</Text>
          <Text style={styles.hint}>显示在聊天页空状态欢迎语上方，建议使用正方形透明 PNG。</Text>
        </View>
        <View style={styles.appearanceIconActions}>
          <Pressable
            style={[styles.smallActionButton, pickingWelcomeLogo && styles.smallActionButtonDisabled]}
            onPress={handlePickWelcomeLogo}
            disabled={pickingWelcomeLogo}
          >
            <Text style={[styles.smallActionText, pickingWelcomeLogo && styles.smallActionTextDisabled]}>
              {pickingWelcomeLogo ? '选择中' : '上传'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.smallActionButton, !welcomeLogoImageUri && styles.smallActionButtonDisabled]}
            onPress={handleClearWelcomeLogo}
            disabled={!welcomeLogoImageUri}
          >
            <Text style={[styles.smallActionText, !welcomeLogoImageUri && styles.smallActionTextDisabled]}>默认</Text>
          </Pressable>
        </View>
      </View>

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

function inferImageMimeType(uri: string): string {
  const cleanUri = uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.jpg') || cleanUri.endsWith('.jpeg')) return 'image/jpeg';
  if (cleanUri.endsWith('.webp')) return 'image/webp';
  if (cleanUri.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

async function copyTopBarIcon(asset: ImagePicker.ImagePickerAsset, key: TopBarIconKey): Promise<string> {
  const dir = new Directory(Paths.document, 'top-bar-icons');
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, `${key}-${randomUUID()}${topBarIconExtension(asset)}`);
  await copyAsync({ from: asset.uri, to: destination.uri });
  return destination.uri;
}

async function copyAppearanceImage(
  asset: ImagePicker.ImagePickerAsset,
  directoryName: string,
  prefix: string
): Promise<string> {
  const dir = new Directory(Paths.document, directoryName);
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, `${prefix}-${randomUUID()}${topBarIconExtension(asset)}`);
  await copyAsync({ from: asset.uri, to: destination.uri });
  return destination.uri;
}

function validateImageGenerationFaceReferenceAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  const mimeType = asset.mimeType?.toLowerCase();
  const extension = topBarIconExtension(asset);
  const isAllowedType =
    mimeType === 'image/png' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg' ||
    ['.png', '.webp', '.jpg'].includes(extension);

  if (!isAllowedType) {
    return '只支持 PNG、WebP 或 JPG';
  }
  if (asset.fileSize && asset.fileSize > IMAGE_GENERATION_FACE_REFERENCE_MAX_BYTES) {
    return '图片不能超过 8MB';
  }
  if (
    asset.width < IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE ||
    asset.height < IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE
  ) {
    return `图片边长至少 ${IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE}px`;
  }
  if (
    asset.width > IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE ||
    asset.height > IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE
  ) {
    return `图片边长不能超过 ${IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE}px`;
  }
  return null;
}

async function copyImageGenerationFaceReference(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  return copyAppearanceImage(asset, 'image-generation-face-references', 'face-ref');
}

function deleteLocalImageIfExists(uri?: string) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Ignore cleanup failures; the settings entry is still removed.
  }
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

function validateBubbleTextureAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  const mimeType = asset.mimeType?.toLowerCase();
  const extension = topBarIconExtension(asset);
  const isAllowedType =
    mimeType === 'image/png' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/jpeg' ||
    mimeType === 'image/jpg' ||
    ['.png', '.webp', '.jpg'].includes(extension);

  if (!isAllowedType) {
    return '只支持 PNG、WebP 或 JPG，推荐使用透明 PNG';
  }
  if (asset.fileSize && asset.fileSize > CUSTOM_BUBBLE_TEXTURE_MAX_BYTES) {
    return '图片不能超过 8MB';
  }
  if (
    asset.width < CUSTOM_BUBBLE_TEXTURE_MIN_SIDE ||
    asset.height < CUSTOM_BUBBLE_TEXTURE_MIN_SIDE
  ) {
    return `图片边长至少 ${CUSTOM_BUBBLE_TEXTURE_MIN_SIDE}px`;
  }
  if (
    asset.width > CUSTOM_BUBBLE_TEXTURE_MAX_SIDE ||
    asset.height > CUSTOM_BUBBLE_TEXTURE_MAX_SIDE
  ) {
    return `图片边长不能超过 ${CUSTOM_BUBBLE_TEXTURE_MAX_SIDE}px`;
  }
  return null;
}

function clampBubbleInset(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.round(value)), Math.max(0, Math.floor(max)));
}

function normalizeBubbleTextureConfig(config: BubbleTextureConfig): BubbleTextureConfig {
  const halfWidth = Math.max(1, Math.floor(config.originalWidth / 2) - 1);
  const halfHeight = Math.max(1, Math.floor(config.originalHeight / 2) - 1);

  return {
    ...config,
    stretchInsets: {
      left: clampBubbleInset(config.stretchInsets.left, halfWidth),
      top: clampBubbleInset(config.stretchInsets.top, halfHeight),
      right: clampBubbleInset(config.stretchInsets.right, halfWidth),
      bottom: clampBubbleInset(config.stretchInsets.bottom, halfHeight),
    },
    contentInsets: {
      left: clampBubbleInset(config.contentInsets.left, config.originalWidth - 1),
      top: clampBubbleInset(config.contentInsets.top, config.originalHeight - 1),
      right: clampBubbleInset(config.contentInsets.right, config.originalWidth - 1),
      bottom: clampBubbleInset(config.contentInsets.bottom, config.originalHeight - 1),
    },
  };
}

function createBubbleTextureConfig(asset: ImagePicker.ImagePickerAsset, uri: string): BubbleTextureConfig {
  const width = Math.max(CUSTOM_BUBBLE_TEXTURE_MIN_SIDE, asset.width || 240);
  const height = Math.max(CUSTOM_BUBBLE_TEXTURE_MIN_SIDE, asset.height || 120);
  const horizontal = Math.round(width * 0.24);
  const vertical = Math.round(height * 0.30);

  return normalizeBubbleTextureConfig({
    uri,
    originalWidth: width,
    originalHeight: height,
    stretchInsets: {
      left: horizontal,
      top: vertical,
      right: horizontal,
      bottom: vertical,
    },
    contentInsets: {
      left: horizontal + 8,
      top: vertical + 4,
      right: horizontal + 8,
      bottom: vertical + 4,
    },
  });
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

type ClampedNumberInputProps = {
  value: number;
  fallback: number;
  min: number;
  max: number;
  placeholder?: string;
  onCommit: (value: number) => void;
  keyboardType?: 'number-pad' | 'decimal-pad';
};

function ClampedNumberInput({
  value,
  fallback,
  min,
  max,
  placeholder,
  onCommit,
  keyboardType = 'number-pad',
}: ClampedNumberInputProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(String(value));
    }
  }, [focused, value]);

  function commit() {
    const next = parseAppearanceNumber(text, fallback, min, max);
    const normalized = String(next);
    setText(normalized);
    setFocused(false);
    if (next !== value) {
      onCommit(next);
    }
  }

  return (
    <TextInput
      style={styles.input}
      value={text}
      onFocus={() => setFocused(true)}
      onChangeText={(next) => {
        const cleaned = keyboardType === 'decimal-pad' ? next.replace(/[^0-9.]/g, '') : next.replace(/[^0-9]/g, '');
        setText(cleaned);
      }}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
    />
  );
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
        表情包全部由用户自定义添加；上传图片或批量导入链接后才会显示。
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
  const [pickingBackground, setPickingBackground] = useState<'chat' | 'input' | 'topBar' | null>(null);
  const [pickingAvatar, setPickingAvatar] = useState<'user' | 'assistant' | null>(null);
  const [pickingBubbleTexture, setPickingBubbleTexture] = useState<BubbleTextureOwner | null>(null);
  const [editingBubbleTexture, setEditingBubbleTexture] = useState<{
    owner: BubbleTextureOwner;
    config: BubbleTextureConfig;
  } | null>(null);
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
  const topBarBackgroundImageUri = appearanceConfig?.topBarBackgroundImageUri;
  const inputIconUris = appearanceConfig?.inputIconUris || {};
  const inputStyle = appearanceConfig?.inputStyle || 'default';
  const inputBlurIntensity = appearanceConfig?.inputBlurIntensity ?? 72;
  const inputBorderRadius = appearanceConfig?.inputBorderRadius ?? 24;
  const inputBackgroundTransparent = !!appearanceConfig?.inputBackgroundTransparent;
  const userBubbleTransparent = !!appearanceConfig?.userBubbleTransparent;
  const userBubbleWidthPercent = appearanceConfig?.userBubbleWidthPercent ?? 75;
  const userBubbleTexture = appearanceConfig?.userBubbleTexture;
  const assistantBubbleStyle = appearanceConfig?.assistantBubbleStyle || 'plain';
  const assistantBubbleTransparent = !!appearanceConfig?.assistantBubbleTransparent;
  const assistantBubbleWidthPercent = appearanceConfig?.assistantBubbleWidthPercent ?? 75;
  const assistantBubbleTexture = appearanceConfig?.assistantBubbleTexture;
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

  async function handlePickBackground(kind: 'chat' | 'input' | 'topBar') {
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
        kind === 'chat'
          ? 'chat-backgrounds'
          : kind === 'topBar'
            ? 'top-bar-backgrounds'
            : 'chat-input-backgrounds',
        kind === 'chat'
          ? 'chat-bg'
          : kind === 'topBar'
            ? 'top-bar-bg'
            : 'input-bg'
      );
      setAppearanceConfig(
        kind === 'chat'
          ? { chatBackgroundImageUri: uri }
          : kind === 'topBar'
            ? { topBarBackgroundImageUri: uri }
          : { inputBackgroundImageUri: uri }
      );
      showToast(kind === 'chat' ? '聊天背景已更新' : kind === 'topBar' ? '顶栏背景已更新' : '输入框背景已更新');
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

  async function handlePickBubbleTexture(owner: BubbleTextureOwner) {
    if (pickingBubbleTexture) return;
    setPickingBubbleTexture(owner);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets[0]?.uri) return;

      const asset = result.assets[0];
      const validationError = validateBubbleTextureAsset(asset);
      if (validationError) {
        Alert.alert('气泡贴图不可用', validationError);
        return;
      }

      const uri = await copyAppearanceImage(asset, 'bubble-textures', `${owner}-bubble`);
      const config = createBubbleTextureConfig(asset, uri);
      setAppearanceConfig(
        owner === 'user'
          ? { userBubbleTexture: config }
          : { assistantBubbleTexture: config, assistantBubbleStyle: 'bubble' }
      );
      setEditingBubbleTexture({ owner, config });
      showToast(owner === 'user' ? '用户气泡贴图已更新' : 'AI 气泡贴图已更新');
    } catch (error: any) {
      Alert.alert('选择气泡贴图失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingBubbleTexture(null);
    }
  }

  function handleEditBubbleTexture(owner: BubbleTextureOwner) {
    const config = owner === 'user' ? userBubbleTexture : assistantBubbleTexture;
    if (!config) return;
    setEditingBubbleTexture({ owner, config });
  }

  function handleClearBubbleTexture(owner: BubbleTextureOwner) {
    setAppearanceConfig(owner === 'user' ? { userBubbleTexture: undefined } : { assistantBubbleTexture: undefined });
    showToast(owner === 'user' ? '用户气泡贴图已移除' : 'AI 气泡贴图已移除');
  }

  function updateEditingBubbleTexture(
    group: 'stretchInsets' | 'contentInsets',
    key: keyof BubbleTextureConfig['stretchInsets'],
    value: number
  ) {
    setEditingBubbleTexture((current) => {
      if (!current) return current;
      return {
        ...current,
        config: normalizeBubbleTextureConfig({
          ...current.config,
          [group]: {
            ...current.config[group],
            [key]: value,
          },
        }),
      };
    });
  }

  function saveEditingBubbleTexture() {
    if (!editingBubbleTexture) return;
    const config = normalizeBubbleTextureConfig(editingBubbleTexture.config);
    setAppearanceConfig(
      editingBubbleTexture.owner === 'user'
        ? { userBubbleTexture: config }
        : { assistantBubbleTexture: config, assistantBubbleStyle: 'bubble' }
    );
    setEditingBubbleTexture(null);
    showToast('气泡文字区域已保存');
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
    showToast(
      nextStyle === 'compact'
        ? '输入框已切换为单行样式'
        : nextStyle === 'glass'
          ? '输入框已切换为磨砂玻璃'
          : '输入框已切换为默认风格'
    );
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

  function renderBubbleTextureRow(owner: BubbleTextureOwner) {
    const texture = owner === 'user' ? userBubbleTexture : assistantBubbleTexture;
    const isPicking = pickingBubbleTexture === owner;
    const label = owner === 'user' ? '用户气泡贴图' : 'AI 气泡贴图';

    return (
      <View style={styles.appearanceAssetRow}>
        <View style={styles.appearanceImagePreview}>
          {texture?.uri ? (
            <Image source={{ uri: texture.uri }} style={styles.appearanceImageThumb} resizeMode="contain" />
          ) : (
            <Text style={styles.appearanceImagePlaceholder}>{owner === 'user' ? 'UB' : 'AB'}</Text>
          )}
        </View>
        <View style={styles.appearanceIconText}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.hint}>
            {texture?.uri ? '已启用贴图；红框区域会随文字拉伸。' : '上传透明 PNG 效果最好；可在上传后设置文字区域。'}
          </Text>
        </View>
        <View style={styles.appearanceIconActions}>
          <Pressable
            style={[styles.smallActionButton, isPicking && styles.smallActionButtonDisabled]}
            onPress={() => handlePickBubbleTexture(owner)}
            disabled={!!pickingBubbleTexture}
          >
            {isPicking ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>上传</Text>}
          </Pressable>
          <Pressable
            style={[styles.smallActionButton, !texture?.uri && styles.smallActionButtonDisabled]}
            onPress={() => handleEditBubbleTexture(owner)}
            disabled={!texture?.uri}
          >
            <Text style={[styles.smallActionText, !texture?.uri && styles.smallActionTextDisabled]}>区域</Text>
          </Pressable>
          <Pressable
            style={[styles.smallActionButton, !texture?.uri && styles.smallActionButtonDisabled]}
            onPress={() => handleClearBubbleTexture(owner)}
            disabled={!texture?.uri}
          >
            <Text style={[styles.smallActionText, !texture?.uri && styles.smallActionTextDisabled]}>默认</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderBubbleInsetEditor(
    title: string,
    group: 'stretchInsets' | 'contentInsets',
    fallback: number
  ) {
    if (!editingBubbleTexture) return null;
    const values = editingBubbleTexture.config[group];
    const maxHorizontal =
      group === 'stretchInsets'
        ? Math.max(1, Math.floor(editingBubbleTexture.config.originalWidth / 2) - 1)
        : Math.max(1, editingBubbleTexture.config.originalWidth - 1);
    const maxVertical =
      group === 'stretchInsets'
        ? Math.max(1, Math.floor(editingBubbleTexture.config.originalHeight / 2) - 1)
        : Math.max(1, editingBubbleTexture.config.originalHeight - 1);

    return (
      <>
        <Text style={styles.bubbleTextureModalSection}>{title}</Text>
        <View style={styles.appearanceNumberGrid}>
          {(['left', 'right'] as const).map((key) => (
            <View key={`${group}-${key}`} style={styles.appearanceNumberField}>
              <Text style={styles.label}>{key === 'left' ? '左' : '右'}</Text>
              <ClampedNumberInput
                value={values[key]}
                fallback={fallback}
                min={0}
                max={maxHorizontal}
                onCommit={(value) => updateEditingBubbleTexture(group, key, value)}
              />
            </View>
          ))}
        </View>
        <View style={styles.appearanceNumberGrid}>
          {(['top', 'bottom'] as const).map((key) => (
            <View key={`${group}-${key}`} style={styles.appearanceNumberField}>
              <Text style={styles.label}>{key === 'top' ? '上' : '下'}</Text>
              <ClampedNumberInput
                value={values[key]}
                fallback={fallback}
                min={0}
                max={maxVertical}
                onCommit={(value) => updateEditingBubbleTexture(group, key, value)}
              />
            </View>
          ))}
        </View>
      </>
    );
  }

  const bubbleTextureModalConfig = editingBubbleTexture?.config;
  const bubbleTexturePreviewWidth = bubbleTextureModalConfig
    ? Math.min(260, Math.max(160, bubbleTextureModalConfig.originalWidth))
    : 220;
  const bubbleTexturePreviewHeight = bubbleTextureModalConfig
    ? Math.max(90, Math.round((bubbleTexturePreviewWidth * bubbleTextureModalConfig.originalHeight) / bubbleTextureModalConfig.originalWidth))
    : 120;
  const bubbleTextureScale = bubbleTextureModalConfig
    ? bubbleTexturePreviewWidth / bubbleTextureModalConfig.originalWidth
    : 1;
  const bubbleTextureStretchRect = bubbleTextureModalConfig
    ? {
        left: bubbleTextureModalConfig.stretchInsets.left * bubbleTextureScale,
        top: bubbleTextureModalConfig.stretchInsets.top * bubbleTextureScale,
        right: bubbleTextureModalConfig.stretchInsets.right * bubbleTextureScale,
        bottom: bubbleTextureModalConfig.stretchInsets.bottom * bubbleTextureScale,
      }
    : null;
  const bubbleTextureContentRect = bubbleTextureModalConfig
    ? {
        left: bubbleTextureModalConfig.contentInsets.left * bubbleTextureScale,
        top: bubbleTextureModalConfig.contentInsets.top * bubbleTextureScale,
        right: bubbleTextureModalConfig.contentInsets.right * bubbleTextureScale,
        bottom: bubbleTextureModalConfig.contentInsets.bottom * bubbleTextureScale,
      }
    : null;

  return (
    <>
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
        {topBarBackgroundImageUri && (
          <Image source={{ uri: topBarBackgroundImageUri }} style={styles.topBarPreviewBackground} resizeMode="cover" />
        )}
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

      <View style={styles.appearanceAssetRow}>
        <View style={styles.appearanceImagePreview}>
          {topBarBackgroundImageUri ? (
            <Image source={{ uri: topBarBackgroundImageUri }} style={styles.appearanceImageThumb} resizeMode="cover" />
          ) : (
            <Text style={styles.appearanceImagePlaceholder}>TB</Text>
          )}
        </View>
        <View style={styles.appearanceIconText}>
          <Text style={styles.label}>顶栏背景贴图</Text>
          <Text style={styles.hint}>{topBarBackgroundImageUri ? '已使用自定义顶栏背景' : '使用主题遮罩和透明顶栏'}</Text>
        </View>
        <View style={styles.appearanceIconActions}>
          <Pressable
            style={[styles.smallActionButton, pickingBackground === 'topBar' && styles.smallActionButtonDisabled]}
            onPress={() => handlePickBackground('topBar')}
            disabled={!!pickingBackground}
          >
            {pickingBackground === 'topBar' ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
          </Pressable>
          <Pressable
            style={[styles.smallActionButton, !topBarBackgroundImageUri && styles.smallActionButtonDisabled]}
            onPress={() => {
              setAppearanceConfig({ topBarBackgroundImageUri: undefined });
              showToast('顶栏背景已恢复默认');
            }}
            disabled={!topBarBackgroundImageUri}
          >
            <Text style={[styles.smallActionText, !topBarBackgroundImageUri && styles.smallActionTextDisabled]}>默认</Text>
          </Pressable>
        </View>
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
          <ClampedNumberInput
            value={messageAvatarRadius}
            fallback={18}
            min={0}
            max={20}
            placeholder="18"
            onCommit={(value) => setAppearanceConfig({ messageAvatarRadius: value })}
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
      {renderBubbleTextureRow('user')}
      {renderBubbleTextureRow('assistant')}
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
          <ClampedNumberInput
            value={userBubbleRadius}
            fallback={20}
            min={0}
            max={36}
            placeholder="20"
            onCommit={(value) => setAppearanceConfig({ userBubbleRadius: value })}
          />
        </View>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>磨砂系数</Text>
          <ClampedNumberInput
            value={userBubbleBlurIntensity}
            fallback={0}
            min={0}
            max={100}
            placeholder="0"
            onCommit={(value) => setAppearanceConfig({ userBubbleBlurIntensity: value })}
          />
        </View>
      </View>

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>用户气泡长度</Text>
          <ClampedNumberInput
            value={userBubbleWidthPercent}
            fallback={75}
            min={45}
            max={100}
            placeholder="75"
            onCommit={(value) => setAppearanceConfig({ userBubbleWidthPercent: value })}
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
              <ClampedNumberInput
                value={assistantBubbleRadius}
                fallback={20}
                min={0}
                max={36}
                placeholder="20"
                onCommit={(value) => setAppearanceConfig({ assistantBubbleRadius: value })}
              />
            </View>
            <View style={styles.appearanceNumberField}>
              <Text style={styles.label}>AI 磨砂系数</Text>
              <ClampedNumberInput
                value={assistantBubbleBlurIntensity}
                fallback={0}
                min={0}
                max={100}
                placeholder="0"
                onCommit={(value) => setAppearanceConfig({ assistantBubbleBlurIntensity: value })}
              />
            </View>
          </View>

          <View style={styles.appearanceNumberGrid}>
            <View style={styles.appearanceNumberField}>
              <Text style={styles.label}>AI 气泡长度</Text>
              <ClampedNumberInput
                value={assistantBubbleWidthPercent}
                fallback={75}
                min={45}
                max={100}
                placeholder="75"
                onCommit={(value) => setAppearanceConfig({ assistantBubbleWidthPercent: value })}
              />
            </View>
          </View>
        </>
      )}

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>用户字号</Text>
          <ClampedNumberInput
            value={userFontSize}
            fallback={16}
            min={12}
            max={24}
            placeholder="16"
            onCommit={(value) => setAppearanceConfig({ userFontSize: value })}
          />
        </View>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>AI 字号</Text>
          <ClampedNumberInput
            value={assistantFontSize}
            fallback={16}
            min={12}
            max={24}
            placeholder="16"
            onCommit={(value) => setAppearanceConfig({ assistantFontSize: value })}
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
          <ClampedNumberInput
            value={assistantTextStrokeWidth}
            fallback={0}
            min={0}
            max={8}
            placeholder="0"
            onCommit={(value) => setAppearanceConfig({ assistantTextStrokeWidth: value })}
          />
        </View>
      </View>

      <Text style={styles.sectionTitle}>输入框自定义</Text>
      <View style={styles.segmentedRow}>
        {(['default', 'glass', 'compact'] as ChatInputAppearanceStyle[]).map((styleKey) => (
          <Pressable
            key={styleKey}
            style={[styles.segmentedButton, inputStyle === styleKey && styles.segmentedButtonActive]}
            onPress={() => setInputStyle(styleKey)}
          >
            <Text style={[styles.segmentedText, inputStyle === styleKey && styles.segmentedTextActive]}>
              {styleKey === 'default' ? '默认原版' : styleKey === 'glass' ? '磨砂玻璃' : '单行'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.appearanceNumberGrid}>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>输入框磨砂系数</Text>
          <ClampedNumberInput
            value={inputBlurIntensity}
            fallback={72}
            min={0}
            max={100}
            placeholder="72"
            onCommit={(value) => setAppearanceConfig({ inputBlurIntensity: value })}
          />
        </View>
        <View style={styles.appearanceNumberField}>
          <Text style={styles.label}>输入框圆角</Text>
          <ClampedNumberInput
            value={inputBorderRadius}
            fallback={24}
            min={0}
            max={36}
            placeholder="24"
            onCommit={(value) => setAppearanceConfig({ inputBorderRadius: value })}
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
    <Modal
      transparent
      visible={!!editingBubbleTexture}
      animationType="fade"
      onRequestClose={() => setEditingBubbleTexture(null)}
    >
      <Pressable style={styles.overlay} onPress={() => setEditingBubbleTexture(null)}>
        <View style={styles.bubbleTextureModal} onStartShouldSetResponder={() => true}>
          <Text style={styles.modalTitle}>
            {editingBubbleTexture?.owner === 'user' ? '用户气泡文字区域' : 'AI 气泡文字区域'}
          </Text>
          <Text style={styles.hint}>红框内会随气泡尺寸拉伸；虚线框是文字放置区域，尾巴和装饰尽量放在红框外。</Text>
          <ScrollView style={styles.bubbleTextureModalBody} keyboardShouldPersistTaps="handled">
            {bubbleTextureModalConfig && (
              <View style={styles.bubbleTexturePreviewStage}>
                <View
                  style={[
                    styles.bubbleTexturePreview,
                    {
                      width: bubbleTexturePreviewWidth,
                      height: bubbleTexturePreviewHeight,
                    },
                  ]}
                >
                  <Image
                    source={{ uri: bubbleTextureModalConfig.uri }}
                    style={styles.appearanceImageThumb}
                    resizeMode="stretch"
                  />
                  {bubbleTextureStretchRect && (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.bubbleTextureStretchGuide,
                        {
                          left: bubbleTextureStretchRect.left,
                          top: bubbleTextureStretchRect.top,
                          right: bubbleTextureStretchRect.right,
                          bottom: bubbleTextureStretchRect.bottom,
                        },
                      ]}
                    />
                  )}
                  {bubbleTextureContentRect && (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.bubbleTextureContentGuide,
                        {
                          left: bubbleTextureContentRect.left,
                          top: bubbleTextureContentRect.top,
                          right: bubbleTextureContentRect.right,
                          bottom: bubbleTextureContentRect.bottom,
                        },
                      ]}
                    >
                      <Text style={styles.bubbleTextureContentGuideText}>文字区域</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
            {renderBubbleInsetEditor('拉伸保护边距', 'stretchInsets', 24)}
            {renderBubbleInsetEditor('文字内边距', 'contentInsets', 32)}
          </ScrollView>
          <View style={styles.modalButtons}>
            <Pressable style={styles.modalCancel} onPress={() => setEditingBubbleTexture(null)}>
              <Text style={styles.modalCancelText}>取消</Text>
            </Pressable>
            <Pressable style={styles.modalConfirm} onPress={saveEditingBubbleTexture}>
              <Text style={styles.modalConfirmText}>保存</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
    </>
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

  function handleSizeChange(kind: 'normal' | 'edge', value: number) {
    setFloatingBallConfig(kind === 'normal' ? { normalSizeDp: value } : { edgeSizeDp: value });
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
          <ClampedNumberInput
            value={normalSizeDp}
            fallback={FLOATING_BALL_SIZE_DEFAULT}
            min={FLOATING_BALL_SIZE_MIN}
            max={FLOATING_BALL_SIZE_MAX}
            placeholder={String(FLOATING_BALL_SIZE_DEFAULT)}
            onCommit={(value) => handleSizeChange('normal', value)}
          />
        </View>
        <View style={styles.floatingBallSizeField}>
          <Text style={styles.label}>贴边态大小</Text>
          <ClampedNumberInput
            value={edgeSizeDp}
            fallback={FLOATING_BALL_SIZE_DEFAULT}
            min={FLOATING_BALL_SIZE_MIN}
            max={FLOATING_BALL_SIZE_MAX}
            placeholder={String(FLOATING_BALL_SIZE_DEFAULT)}
            onCommit={(value) => handleSizeChange('edge', value)}
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
        <ClampedNumberInput
          value={assetAutoSwitchIntervalSeconds}
          fallback={8}
          min={1}
          max={3600}
          placeholder="8"
          onCommit={(value) => setFloatingBallConfig({ assetAutoSwitchIntervalSeconds: value })}
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
  const {
    _hydrated,
    apiConfigs,
    activeConfigIndex,
    imageGenerationConfig,
    saveAPIConfig,
    removeAPIConfig,
    setActiveConfig,
    setImageGenerationConfig,
  } = useSettingsStore();

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('');
  const [generateThinking, setGenerateThinking] = useState(false);
  const [returnNativeThinking, setReturnNativeThinking] = useState(false);
  const [imageEnabled, setImageEnabled] = useState(imageGenerationConfig?.enabled ?? false);
  const [imageBaseUrl, setImageBaseUrl] = useState(imageGenerationConfig?.baseUrl || '');
  const [imageApiKey, setImageApiKey] = useState(imageGenerationConfig?.apiKey || '');
  const [imageModel, setImageModel] = useState(imageGenerationConfig?.model || 'gpt-image-2');
  const [imageSize, setImageSize] = useState(imageGenerationConfig?.size || '1024x1024');
  const [imageQuality, setImageQuality] = useState(imageGenerationConfig?.quality || 'auto');
  const [models, setModels] = useState<string[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelPickerTarget, setModelPickerTarget] = useState<ModelPickerTarget>('chat');
  const [showImageOptionPicker, setShowImageOptionPicker] = useState<ImageOptionTarget | null>(null);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);

  useEffect(() => {
    if (_hydrated && apiConfigs.length > 0) {
      loadConfig(activeConfigIndex);
    }
  }, [_hydrated]);

  useEffect(() => {
    if (!_hydrated) return;
    setImageEnabled(imageGenerationConfig?.enabled ?? false);
    setImageBaseUrl(imageGenerationConfig?.baseUrl || '');
    setImageApiKey(imageGenerationConfig?.apiKey || '');
    setImageModel(imageGenerationConfig?.model || 'gpt-image-2');
    setImageSize(imageGenerationConfig?.size || '1024x1024');
    setImageQuality(imageGenerationConfig?.quality || 'auto');
  }, [_hydrated, imageGenerationConfig]);

  function loadConfig(index: number) {
    const config = apiConfigs[index];
    if (config) {
      setName(config.name);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setModel(config.model);
      setTemperature(typeof config.temperature === 'number' ? String(config.temperature) : '');
      setGenerateThinking(!!config.generateThinking);
      setReturnNativeThinking(!!config.returnNativeThinking);
    }
  }

  function handleNew() {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setTemperature('');
    setGenerateThinking(false);
    setReturnNativeThinking(false);
    setModels([]);
  }

  function resolveModelFetchCredentials(target: ModelPickerTarget) {
    if (target === 'chat') {
      return {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      };
    }

    const activeConfig = apiConfigs[activeConfigIndex];
    return {
      baseUrl: imageBaseUrl.trim() || activeConfig?.baseUrl?.trim() || '',
      apiKey: imageApiKey.trim() || activeConfig?.apiKey?.trim() || '',
    };
  }

  function parseOptionalTemperature(value: string): number | undefined | null {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) return null;
    return parsed;
  }

  async function handleFetchModels(target: ModelPickerTarget = 'chat') {
    const credentials = resolveModelFetchCredentials(target);
    if (!credentials.baseUrl || !credentials.apiKey) {
      Alert.alert('提示', '请先填写 Base URL 和 API Key');
      return;
    }
    setFetching(true);
    try {
      const url = `${credentials.baseUrl.replace(/\/$/, '')}/models`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const ids: string[] = (data.data || []).map((m: any) => m.id).sort();
      if (ids.length === 0) {
        Alert.alert('提示', '未获取到模型列表');
      } else {
        setModels(ids);
        setModelPickerTarget(target);
        setShowModelPicker(true);
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
      const parsedTemperature = parseOptionalTemperature(temperature);
      if (parsedTemperature === null) {
        Alert.alert('提示', 'temperature 必须是 0 到 2 之间的数字，或留空使用服务默认值');
        return;
      }
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
          max_tokens: generateThinking ? 64 : 5,
          ...(parsedTemperature !== undefined ? { temperature: parsedTemperature } : {}),
          ...(generateThinking ? { thinking: { type: 'adaptive' } } : {}),
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
    const parsedTemperature = parseOptionalTemperature(temperature);
    if (parsedTemperature === null) {
      Alert.alert('提示', 'temperature 必须是 0 到 2 之间的数字，或留空使用服务默认值');
      return;
    }
    const config: NamedAPIConfig = {
      name: trimmedName, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(),
      ...(parsedTemperature !== undefined ? { temperature: parsedTemperature } : {}),
      generateThinking,
      returnNativeThinking,
    };
    saveAPIConfig(config);
    const newIndex = useSettingsStore.getState().apiConfigs.findIndex((c) => c.name === trimmedName);
    if (newIndex >= 0) setActiveConfig(newIndex);
    showToast(`配置「${trimmedName}」已保存`);
  }

  function handleUseCurrentChatAPIForImage() {
    const config = apiConfigs[activeConfigIndex];
    if (!config) {
      Alert.alert('提示', '请先保存一个聊天 API 配置');
      return;
    }
    setImageBaseUrl(config.baseUrl);
    setImageApiKey(config.apiKey);
    showToast('已填入当前聊天 API 的 Base URL 和 Key');
  }

  function handleSaveImageAPI() {
    setImageGenerationConfig({
      enabled: imageEnabled,
      baseUrl: imageBaseUrl.trim(),
      apiKey: imageApiKey.trim(),
      model: imageModel.trim() || 'gpt-image-2',
      size: imageSize || '1024x1024',
      quality: imageQuality || 'auto',
    });
    showToast(imageEnabled ? '生图 API 已保存并启用' : '生图 API 已保存');
  }

  function handleSelectModel(item: string) {
    if (modelPickerTarget === 'image') {
      setImageModel(item);
    } else {
      setModel(item);
    }
    setShowModelPicker(false);
  }

  function handleSelectImageOption(item: string) {
    if (showImageOptionPicker === 'quality') {
      setImageQuality(item);
    } else {
      setImageSize(item);
    }
    setShowImageOptionPicker(null);
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
          <Pressable style={styles.fetchButton} onPress={() => handleFetchModels('chat')} disabled={fetching}>
            {fetching ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.fetchButtonText}>拉取</Text>}
          </Pressable>
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Temperature</Text>
        <TextInput
          style={styles.input}
          value={temperature}
          onChangeText={setTemperature}
          keyboardType="decimal-pad"
          placeholder="留空使用服务默认值"
          placeholderTextColor={colors.textTertiary}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>让 AI 生成思维链</Text>
          <Text style={styles.hint}>开启后，请求会附加 Claude thinking: {'{'} type: 'adaptive' {'}'} 参数。</Text>
        </View>
        <Switch
          value={generateThinking}
          onValueChange={setGenerateThinking}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>返回原生思维链</Text>
          <Text style={styles.hint}>开启后会显示兼容接口返回的 reasoning_content；关闭后忽略该字段。</Text>
        </View>
        <Switch
          value={returnNativeThinking}
          onValueChange={setReturnNativeThinking}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>AI 生图 API</Text>
      <Text style={styles.hint}>识别 AI 回复里的 [Pic:图片描述] 后调用 OpenAI 兼容生图接口；有参考图或锁脸图时会走 /images/edits。Base URL 和 Key 留空时会沿用当前聊天 API 配置。</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>启用 AI 生图</Text>
          <Text style={styles.hint}>关闭后 [Pic:...] 只按普通文本保留，不会生成图片。</Text>
        </View>
        <Switch
          value={imageEnabled}
          onValueChange={setImageEnabled}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Base URL</Text>
        <TextInput
          style={styles.input}
          value={imageBaseUrl}
          onChangeText={setImageBaseUrl}
          placeholder="留空沿用当前聊天 API"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={styles.input}
          value={imageApiKey}
          onChangeText={setImageApiKey}
          placeholder="留空沿用当前聊天 API"
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>生图模型</Text>
        <View style={styles.modelRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={imageModel}
            onChangeText={setImageModel}
            placeholder="gpt-image-2"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
          <Pressable style={styles.fetchButton} onPress={() => handleFetchModels('image')} disabled={fetching}>
            {fetching ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.fetchButtonText}>拉取</Text>}
          </Pressable>
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>图片尺寸</Text>
        <Pressable style={styles.selectInput} onPress={() => setShowImageOptionPicker('size')}>
          <Text style={styles.selectInputText}>{imageSize}</Text>
          <Text style={styles.selectInputChevron}>⌄</Text>
        </Pressable>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>图片质量</Text>
        <Pressable style={styles.selectInput} onPress={() => setShowImageOptionPicker('quality')}>
          <Text style={styles.selectInputText}>{imageQuality}</Text>
          <Text style={styles.selectInputChevron}>⌄</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleUseCurrentChatAPIForImage}>
          <Text style={styles.testButtonText}>沿用当前 API</Text>
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSaveImageAPI}>
          <Text style={styles.saveButtonText}>保存生图 API</Text>
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
        <Pressable
          style={styles.diagnosticsButton}
          onPress={() => router.push('/api-usage')}
        >
          <Text style={styles.diagnosticsButtonText}>打开 API 使用日志</Text>
        </Pressable>
      </View>

      {/* Model picker modal */}
      <Modal visible={showModelPicker} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowModelPicker(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>
              {modelPickerTarget === 'image' ? '选择生图模型' : '选择聊天模型'}
            </Text>
            <FlatList
              data={models}
              keyExtractor={(item) => item}
              style={styles.modelList}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.modelItem,
                    item === (modelPickerTarget === 'image' ? imageModel : model) && styles.modelItemActive,
                  ]}
                  onPress={() => handleSelectModel(item)}
                >
                  <Text
                    style={[
                      styles.modelItemText,
                      item === (modelPickerTarget === 'image' ? imageModel : model) && styles.modelItemTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
      <Modal visible={showImageOptionPicker !== null} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowImageOptionPicker(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>
              {showImageOptionPicker === 'quality' ? '选择图片质量' : '选择图片尺寸'}
            </Text>
            {(showImageOptionPicker === 'quality' ? IMAGE_QUALITY_OPTIONS : IMAGE_SIZE_OPTIONS).map((item) => {
              const active = item === (showImageOptionPicker === 'quality' ? imageQuality : imageSize);
              return (
                <Pressable
                  key={item}
                  style={[styles.modelItem, active && styles.modelItemActive]}
                  onPress={() => handleSelectImageOption(item)}
                >
                  <Text style={[styles.modelItemText, active && styles.modelItemTextActive]}>{item}</Text>
                </Pressable>
              );
            })}
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
    imageGenerationConfig,
    imageGenerationPrompt,
    setSystemPrompt,
    setMaxOutputTokens,
    setStripThinking,
    setPeriodConfig,
    setPromptCacheConfig,
    setImageGenerationConfig,
    setImageGenerationPrompt,
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
  const [imagePromptText, setImagePromptText] = useState(imageGenerationPrompt || '');
  const [importingMyphone, setImportingMyphone] = useState(false);
  const [pickingFaceReferences, setPickingFaceReferences] = useState(false);
  const [hiddenDiagnosticMessages, setHiddenDiagnosticMessages] = useState<ChatDiagnosticsMessage[]>([]);

  useEffect(() => {
    setImagePromptText(imageGenerationPrompt || '');
  }, [imageGenerationPrompt]);

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
  const faceReferences = imageGenerationConfig?.faceReferences || [];
  const enabledFaceReferenceCount = faceReferences.filter((item) => item.enabled !== false).length;

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
      Alert.alert('导入失败', error?.message || '无法读取 ephone 单聊备份');
    } finally {
      setImportingMyphone(false);
    }
  }

  async function handlePickFaceReferences() {
    if (pickingFaceReferences) return;
    setPickingFaceReferences(true);
    try {
      const remainingSlots = Math.max(0, IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT - faceReferences.length);
      if (remainingSlots <= 0) {
        Alert.alert('参考图已满', `最多保存 ${IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT} 张锁脸参考图。`);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        orderedSelection: true,
      });
      if (result.canceled) return;

      const assets = result.assets.slice(0, remainingSlots);
      const validationError = assets
        .map(validateImageGenerationFaceReferenceAsset)
        .find((message): message is string => !!message);
      if (validationError) {
        Alert.alert('图片不适合作为锁脸参考图', validationError);
        return;
      }

      const now = Date.now();
      const copiedReferences: ImageGenerationFaceReference[] = await Promise.all(
        assets.map(async (asset, index) => ({
          id: `face-ref-${now.toString(36)}-${index}-${randomUUID()}`,
          uri: await copyImageGenerationFaceReference(asset),
          enabled: true,
          createdAt: now + index,
        }))
      );
      if (copiedReferences.length === 0) return;

      setImageGenerationConfig({
        faceReferences: [...faceReferences, ...copiedReferences].slice(0, IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT),
      });
      showToast(`已添加 ${copiedReferences.length} 张锁脸参考图`);
    } catch (error: any) {
      Alert.alert('选择锁脸参考图失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingFaceReferences(false);
    }
  }

  function handleToggleFaceReference(id: string, enabled: boolean) {
    setImageGenerationConfig({
      faceReferences: faceReferences.map((item) =>
        item.id === id ? { ...item, enabled } : item
      ),
    });
  }

  function handleRemoveFaceReference(reference: ImageGenerationFaceReference) {
    setImageGenerationConfig({
      faceReferences: faceReferences.filter((item) => item.id !== reference.id),
    });
    deleteLocalImageIfExists(reference.uri);
    showToast('锁脸参考图已删除');
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

      <Text style={styles.sectionTitle}>生图配置</Text>
      <Text style={styles.hint}>AI 回复中的 [Pic:图片描述] 会与这里的基础提示词组合后发送给生图 API；这里不会作为真实图片发回给聊天 AI。</Text>
      <TextInput
        style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
        value={imagePromptText}
        onChangeText={setImagePromptText}
        onBlur={() => setImageGenerationPrompt(imagePromptText.trim())}
        multiline
        placeholder="例如：高质量图片，画面清晰，主体明确，无水印。"
        placeholderTextColor={colors.textTertiary}
      />

      <View style={styles.imageFaceReferenceHeader}>
        <View style={styles.imageFaceReferenceHeaderText}>
          <Text style={styles.label}>锁脸参考图</Text>
          <Text style={styles.hint}>启用的参考图会自动用于文生图/图生图，和输入框临时参考图一起传给生图 API。</Text>
        </View>
        <Pressable
          style={[styles.smallActionButton, pickingFaceReferences && styles.smallActionButtonDisabled]}
          onPress={handlePickFaceReferences}
          disabled={pickingFaceReferences}
        >
          <Text style={[styles.smallActionText, pickingFaceReferences && styles.smallActionTextDisabled]}>
            {pickingFaceReferences ? '选择中' : '上传'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        已启用 {enabledFaceReferenceCount} / {faceReferences.length} 张，最多 {IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT} 张。
      </Text>
      {faceReferences.length === 0 ? (
        <View style={styles.imageFaceReferenceEmpty}>
          <Text style={styles.hint}>暂无锁脸参考图。</Text>
        </View>
      ) : (
        <View style={styles.imageFaceReferenceGrid}>
          {faceReferences.map((reference, index) => {
            const enabled = reference.enabled !== false;
            return (
              <View
                key={reference.id}
                style={[
                  styles.imageFaceReferenceItem,
                  enabled && styles.imageFaceReferenceItemActive,
                ]}
              >
                <Image source={{ uri: reference.uri }} style={styles.imageFaceReferenceImage} resizeMode="cover" />
                <View style={styles.imageFaceReferenceMeta}>
                  <Text style={styles.imageFaceReferenceLabel}>参考图 {index + 1}</Text>
                  <Switch
                    value={enabled}
                    onValueChange={(value) => handleToggleFaceReference(reference.id, value)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
                <Pressable
                  style={styles.imageFaceReferenceRemove}
                  onPress={() => handleRemoveFaceReference(reference)}
                >
                  <Text style={styles.imageFaceReferenceRemoveText}>删除</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {/* 消息条数 */}
      <Text style={styles.sectionTitle}>当前对话</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>已加载消息</Text>
        <Text style={styles.infoValue}>
          {messageCount > 0 ? `${loadedFloorFrom}-${loadedFloorTo}` : '0'} 条
        </Text>
      </View>

      <Text style={styles.sectionTitle}>ephone 导入</Text>
      <Text style={styles.hint}>选择 ephone 导出的 .ee 或 JSON 单聊备份；只导入角色单聊，群聊会被跳过。</Text>
      <Pressable
        style={[styles.importButton, importingMyphone && styles.importButtonDisabled]}
        onPress={handleImportMyphone}
        disabled={importingMyphone}
      >
        {importingMyphone ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.importButtonText}>导入 ephone 单聊</Text>
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
    apiConfigs,
    activeConfigIndex,
    systemPrompt,
    ttsConfig,
    stickerConfig,
    memoryVaultConfig,
    webSearchConfig,
    webPageReaderConfig,
    webInteractionConfig,
    hotboardConfig,
    dailyPaperConfig,
    runCommandConfig,
    qqBotConfig,
    nativeToolConfig,
    shizukuFileConfig,
    mcpToolConfig,
    toolSettingsUiConfig,
    setMemoryVaultConfig,
    setWebSearchConfig,
    setWebPageReaderConfig,
    setWebInteractionConfig,
    setHotboardConfig,
    setDailyPaperConfig,
    setRunCommandConfig,
    setQqBotConfig,
    setNativeToolConfig,
    setShizukuFileConfig,
    setMcpToolConfig,
    setToolSettingsUiConfig,
  } = useSettingsStore();
  const activeApiConfig = apiConfigs[activeConfigIndex] || null;

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

  const [dailyUseDefaultSources, setDailyUseDefaultSources] = useState(dailyPaperConfig?.useDefaultSources ?? true);
  const [dailyCustomSources, setDailyCustomSources] = useState<DailyPaperSourceConfig[]>(dailyPaperConfig?.customSources || []);
  const [dailySourceName, setDailySourceName] = useState('');
  const [dailySourceUrl, setDailySourceUrl] = useState('');
  const [dailySourceCategory, setDailySourceCategory] = useState('general');
  const [dailySourceLanguage, setDailySourceLanguage] = useState('zh');

  const [rcEnabled, setRcEnabled] = useState(!!runCommandConfig?.enabled);
  const [rcEndpointUrl, setRcEndpointUrl] = useState(runCommandConfig?.endpointUrl || '');
  const [rcAccessToken, setRcAccessToken] = useState(runCommandConfig?.accessToken || '');
  const [rcDefaultCwd, setRcDefaultCwd] = useState(runCommandConfig?.defaultCwd || '');
  const [rcTimeoutMs, setRcTimeoutMs] = useState(String(runCommandConfig?.timeoutMs || 30000));
  const [rcMaxOutputChars, setRcMaxOutputChars] = useState(String(runCommandConfig?.maxOutputChars || 12000));
  const [rcMaxCalls, setRcMaxCalls] = useState(String(runCommandConfig?.maxToolCalls || 4));
  const [rcTesting, setRcTesting] = useState(false);

  const [qqEnabled, setQqEnabled] = useState(!!qqBotConfig?.enabled);
  const [qqBackendUrl, setQqBackendUrl] = useState(qqBotConfig?.backendUrl || 'http://127.0.0.1:8788');
  const [qqControlToken, setQqControlToken] = useState(qqBotConfig?.controlToken || '');
  const [qqAppId, setQqAppId] = useState(qqBotConfig?.appId || '');
  const [qqAppSecret, setQqAppSecret] = useState(qqBotConfig?.appSecret || '');
  const [qqSandbox, setQqSandbox] = useState(qqBotConfig?.sandbox ?? true);
  const [qqAutoConnect, setQqAutoConnect] = useState(qqBotConfig?.autoConnect ?? true);
  const [qqAllowDirectMessages, setQqAllowDirectMessages] = useState(qqBotConfig?.allowDirectMessages ?? true);
  const [qqAllowGuildMentions, setQqAllowGuildMentions] = useState(qqBotConfig?.allowGuildMentions ?? true);
  const [qqOpenAiBaseUrl, setQqOpenAiBaseUrl] = useState(qqBotConfig?.openAiBaseUrl || '');
  const [qqOpenAiApiKey, setQqOpenAiApiKey] = useState(qqBotConfig?.openAiApiKey || '');
  const [qqModel, setQqModel] = useState(qqBotConfig?.model || '');
  const [qqSystemPrompt, setQqSystemPrompt] = useState(qqBotConfig?.qqSystemPrompt || qqBotConfig?.systemPrompt || '你是 YSClaude 的 QQ 机器人入口。请用自然、简洁、友好的中文回复 QQ 用户。');
  const [wechatSystemPrompt, setWechatSystemPrompt] = useState(qqBotConfig?.wechatSystemPrompt || '你是 YSClaude 的微信机器人入口。请用自然、简洁、友好的中文回复微信用户。');
  const [qqTemperature, setQqTemperature] = useState(String(qqBotConfig?.temperature ?? 0.7));
  const [qqMaxOutputTokens, setQqMaxOutputTokens] = useState(String(qqBotConfig?.maxOutputTokens ?? 1200));
  const [qqHistoryLimit, setQqHistoryLimit] = useState(String(qqBotConfig?.historyLimit ?? 16));
  const [qqMemoryVaultEnabled, setQqMemoryVaultEnabled] = useState(!!qqBotConfig?.memoryVaultEnabled);
  const [qqMemoryVaultBaseUrl, setQqMemoryVaultBaseUrl] = useState(qqBotConfig?.memoryVaultBaseUrl || '');
  const [qqMemoryVaultTopK, setQqMemoryVaultTopK] = useState(String(qqBotConfig?.memoryVaultTopK ?? 5));
  const [qqMemoryVaultTokenBudget, setQqMemoryVaultTokenBudget] = useState(String(qqBotConfig?.memoryVaultTokenBudget ?? 2000));
  const [qqMemoryVaultMaxToolCalls, setQqMemoryVaultMaxToolCalls] = useState(String(qqBotConfig?.memoryVaultMaxToolCalls ?? 3));
  const [qqWebSearchEnabled, setQqWebSearchEnabled] = useState(!!qqBotConfig?.webSearchEnabled);
  const [qqTavilyApiKey, setQqTavilyApiKey] = useState(qqBotConfig?.tavilyApiKey || '');
  const [qqWebSearchMaxResults, setQqWebSearchMaxResults] = useState(String(qqBotConfig?.webSearchMaxResults ?? 5));
  const [qqMcpEnabled, setQqMcpEnabled] = useState(!!qqBotConfig?.mcpEnabled);
  const [qqMcpMaxToolCalls, setQqMcpMaxToolCalls] = useState(String(qqBotConfig?.mcpMaxToolCalls ?? 6));
  const [qqMcpServers, setQqMcpServers] = useState(qqBotConfig?.mcpServers || []);
  const [qqTtsEnabled, setQqTtsEnabled] = useState(!!qqBotConfig?.ttsEnabled);
  const [qqMessageBatchEnabled, setQqMessageBatchEnabled] = useState(qqBotConfig?.messageBatchEnabled ?? true);
  const [qqMessageBatchWindowSeconds, setQqMessageBatchWindowSeconds] = useState(String((qqBotConfig?.messageBatchWindowMs ?? 6000) / 1000));
  const [qqStickersEnabled, setQqStickersEnabled] = useState(!!qqBotConfig?.stickersEnabled);
  const [wechatEnabled, setWechatEnabled] = useState(!!qqBotConfig?.wechatEnabled);
  const [wechatAutoConnect, setWechatAutoConnect] = useState(qqBotConfig?.wechatAutoConnect ?? true);
  const [wechatAccountId, setWechatAccountId] = useState(qqBotConfig?.wechatAccountId || '');
  const [wechatBaseUrl, setWechatBaseUrl] = useState(qqBotConfig?.wechatBaseUrl || '');
  const [wechatBusy, setWechatBusy] = useState(false);
  const [botPanelTab, setBotPanelTab] = useState<'qq' | 'wechat'>('qq');
  const [qqBackendStatus, setQqBackendStatus] = useState('尚未检测');
  const [qqContextStatus, setQqContextStatus] = useState('尚未刷新');
  const [qqContextConversations, setQqContextConversations] = useState<Array<{ key: string; updatedAt: number; messageCount: number; preview: string; lastRole: string }>>([]);
  const [qqSelectedConversationKey, setQqSelectedConversationKey] = useState<string | null>(null);
  const [qqSelectedConversationMessages, setQqSelectedConversationMessages] = useState<Array<{ index: number; role: string; content: string; preview: string }>>([]);
  const [qqSelectedConversationPage, setQqSelectedConversationPage] = useState(1);
  const [qqSelectedConversationTotalPages, setQqSelectedConversationTotalPages] = useState(1);
  const [qqSelectedConversationMessageCount, setQqSelectedConversationMessageCount] = useState(0);
  const [qqSelectedMessageIndexes, setQqSelectedMessageIndexes] = useState<number[]>([]);
  const [qqBackendTesting, setQqBackendTesting] = useState(false);
  const [qqBackendSyncing, setQqBackendSyncing] = useState(false);
  const [qqContextRefreshing, setQqContextRefreshing] = useState(false);
  const [qqContextClearing, setQqContextClearing] = useState(false);
  const [qqConversationLoading, setQqConversationLoading] = useState(false);
  const [qqMessageDeleting, setQqMessageDeleting] = useState(false);

  useEffect(() => {
    if (!qqBotConfig) return;
    setQqEnabled(!!qqBotConfig.enabled);
    setQqBackendUrl(qqBotConfig.backendUrl || 'http://127.0.0.1:8788');
    setQqControlToken(qqBotConfig.controlToken || '');
    setQqAppId(qqBotConfig.appId || '');
    setQqAppSecret(qqBotConfig.appSecret || '');
    setQqSandbox(qqBotConfig.sandbox ?? true);
    setQqAutoConnect(qqBotConfig.autoConnect ?? true);
    setQqAllowDirectMessages(qqBotConfig.allowDirectMessages ?? true);
    setQqAllowGuildMentions(qqBotConfig.allowGuildMentions ?? true);
    setQqOpenAiBaseUrl(qqBotConfig.openAiBaseUrl || '');
    setQqOpenAiApiKey(qqBotConfig.openAiApiKey || '');
    setQqModel(qqBotConfig.model || '');
    setQqSystemPrompt(qqBotConfig.qqSystemPrompt || qqBotConfig.systemPrompt || '你是 YSClaude 的 QQ 机器人入口。请用自然、简洁、友好的中文回复 QQ 用户。');
    setWechatSystemPrompt(qqBotConfig.wechatSystemPrompt || '你是 YSClaude 的微信机器人入口。请用自然、简洁、友好的中文回复微信用户。');
    setQqTemperature(String(qqBotConfig.temperature ?? 0.7));
    setQqMaxOutputTokens(String(qqBotConfig.maxOutputTokens ?? 1200));
    setQqHistoryLimit(String(qqBotConfig.historyLimit ?? 16));
    setQqMemoryVaultEnabled(!!qqBotConfig.memoryVaultEnabled);
    setQqMemoryVaultBaseUrl(qqBotConfig.memoryVaultBaseUrl || '');
    setQqMemoryVaultTopK(String(qqBotConfig.memoryVaultTopK ?? 5));
    setQqMemoryVaultTokenBudget(String(qqBotConfig.memoryVaultTokenBudget ?? 2000));
    setQqMemoryVaultMaxToolCalls(String(qqBotConfig.memoryVaultMaxToolCalls ?? 3));
    setQqWebSearchEnabled(!!qqBotConfig.webSearchEnabled);
    setQqTavilyApiKey(qqBotConfig.tavilyApiKey || '');
    setQqWebSearchMaxResults(String(qqBotConfig.webSearchMaxResults ?? 5));
    setQqMcpEnabled(!!qqBotConfig.mcpEnabled);
    setQqMcpMaxToolCalls(String(qqBotConfig.mcpMaxToolCalls ?? 6));
    setQqMcpServers(qqBotConfig.mcpServers || []);
    setQqTtsEnabled(!!qqBotConfig.ttsEnabled);
    setQqMessageBatchEnabled(qqBotConfig.messageBatchEnabled ?? true);
    setQqMessageBatchWindowSeconds(String((qqBotConfig.messageBatchWindowMs ?? 6000) / 1000));
    setQqStickersEnabled(!!qqBotConfig.stickersEnabled);
    setWechatEnabled(!!qqBotConfig.wechatEnabled);
    setWechatAutoConnect(qqBotConfig.wechatAutoConnect ?? true);
    setWechatAccountId(qqBotConfig.wechatAccountId || '');
    setWechatBaseUrl(qqBotConfig.wechatBaseUrl || '');
  }, [qqBotConfig]);

  // Shizuku 文件访问本地 state
  const [shizukuEnabled, setShizukuEnabled] = useState(!!shizukuFileConfig?.enabled);
  const [shizukuRoots, setShizukuRoots] = useState<ShizukuFileRoot[]>(shizukuFileConfig?.roots || []);
  const [shizukuPathInput, setShizukuPathInput] = useState('');
  const [shizukuStatus, setShizukuStatus] = useState<ShizukuStatus | null>(null);
  const [shizukuChecking, setShizukuChecking] = useState(false);

  const [mcpMaxCalls, setMcpMaxCalls] = useState(String(mcpToolConfig?.maxToolCalls || 6));
  const [mcpServers, setMcpServers] = useState(mcpToolConfig?.servers || []);
  const [mcpServerName, setMcpServerName] = useState('');
  const [mcpServerUrl, setMcpServerUrl] = useState('');
  const [mcpServerAuth, setMcpServerAuth] = useState('');
  const [mcpSyncingServerId, setMcpSyncingServerId] = useState<string | null>(null);
  const [mcpResourceToolsEnabled, setMcpResourceToolsEnabled] = useState(!!mcpToolConfig?.resourceToolsEnabled);
  const builtInToolsExpanded = toolSettingsUiConfig?.builtInToolsExpanded ?? true;
  const customMcpExpanded = toolSettingsUiConfig?.customMcpExpanded ?? true;
  const [selectedBuiltInToolKey, setSelectedBuiltInToolKey] = useState<string | null>(null);
  const [selectedMcpServerId, setSelectedMcpServerId] = useState<string | null>(null);
  const [selectedMcpToolRef, setSelectedMcpToolRef] = useState<{ serverId: string; toolName: string } | null>(null);
  const [selectedMcpResourceRef, setSelectedMcpResourceRef] = useState<{ serverId: string; uri: string } | null>(null);
  const [selectedMcpPromptRef, setSelectedMcpPromptRef] = useState<{ serverId: string; promptName: string } | null>(null);
  const [mcpPromptArgs, setMcpPromptArgs] = useState('{}');
  const [mcpPromptApplying, setMcpPromptApplying] = useState(false);
  const { addUserMessage } = useChatStore();

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
      Alert.alert('提示', '启用联网搜索时请填写 Tavily 密钥');
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
      Alert.alert('提示', '启用 AI 网页巡游热榜时请填写 UAPI 密钥');
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

  function handleAddDailySource() {
    const url = dailySourceUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      Alert.alert('提示', 'RSS 地址必须以 http:// 或 https:// 开头');
      return;
    }
    const now = Date.now();
    let fallbackName = '自定义来源';
    try {
      fallbackName = new URL(url).hostname || fallbackName;
    } catch {}
    const source: DailyPaperSourceConfig = {
      id: randomUUID(),
      name: dailySourceName.trim() || fallbackName,
      url,
      category: dailySourceCategory.trim() || 'general',
      language: dailySourceLanguage.trim() || 'zh',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    setDailyCustomSources((sources) => [source, ...sources]);
    setDailySourceName('');
    setDailySourceUrl('');
    setDailySourceCategory('general');
    setDailySourceLanguage('zh');
  }

  function handleUpdateDailySource(id: string, patch: Partial<DailyPaperSourceConfig>) {
    setDailyCustomSources((sources) =>
      sources.map((source) =>
        source.id === id ? { ...source, ...patch, updatedAt: Date.now() } : source
      )
    );
  }

  function handleRemoveDailySource(id: string) {
    setDailyCustomSources((sources) => sources.filter((source) => source.id !== id));
  }

  function handleSaveDailyPaperSources() {
    const normalizedSources = dailyCustomSources
      .map((source) => ({
        ...source,
        name: source.name.trim() || '自定义来源',
        url: source.url.trim(),
        category: source.category.trim() || 'general',
        language: source.language.trim() || 'zh',
        updatedAt: Date.now(),
      }))
      .filter((source) => /^https?:\/\//i.test(source.url));
    if (!dailyUseDefaultSources && normalizedSources.filter((source) => source.enabled).length === 0) {
      Alert.alert('提示', '请保留内置来源，或至少启用一个自定义 RSS 来源');
      return false;
    }
    setDailyCustomSources(normalizedSources);
    setDailyPaperConfig({
      useDefaultSources: dailyUseDefaultSources,
      customSources: normalizedSources,
    });
    showToast('日报来源已保存');
    return true;
  }

  function buildRunCommandConfigDraft() {
    const timeoutMs = parseInt(rcTimeoutMs, 10);
    const maxOutputChars = parseInt(rcMaxOutputChars, 10);
    const maxToolCalls = parseInt(rcMaxCalls, 10);
    return {
      enabled: rcEnabled,
      endpointUrl: rcEndpointUrl.trim(),
      accessToken: rcAccessToken.trim(),
      defaultCwd: rcDefaultCwd.trim(),
      timeoutMs: isNaN(timeoutMs) || timeoutMs <= 0 ? 30000 : Math.min(300000, Math.max(1000, timeoutMs)),
      maxOutputChars: isNaN(maxOutputChars) || maxOutputChars <= 0 ? 12000 : Math.min(100000, Math.max(1000, maxOutputChars)),
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 4 : maxToolCalls,
    };
  }

  function handleSaveRunCommand() {
    const config = buildRunCommandConfigDraft();
    if (config.enabled && !/^https?:\/\//i.test(config.endpointUrl)) {
      Alert.alert('提示', '启用远程命令时请填写以 http:// 或 https:// 开头的服务地址');
      return false;
    }
    setRunCommandConfig(config);
    showToast(config.enabled ? '远程命令工具已保存' : '远程命令工具已关闭');
    return true;
  }

  async function handleTestRunCommand() {
    const config = buildRunCommandConfigDraft();
    if (!/^https?:\/\//i.test(config.endpointUrl)) {
      Alert.alert('提示', '请先填写以 http:// 或 https:// 开头的服务地址');
      return;
    }
    setRcTesting(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 30000) + 1000);
    try {
      const resp = await fetch(config.endpointUrl.replace(/\/$/, ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.accessToken
            ? { Authorization: config.accessToken.toLowerCase().startsWith('bearer ') ? config.accessToken : `Bearer ${config.accessToken}` }
            : {}),
        },
        body: JSON.stringify({
          command: 'echo ysclaude-run-command-ok',
          cwd: config.defaultCwd || undefined,
          timeout_ms: Math.min(config.timeoutMs, 30000),
        }),
        signal: controller.signal,
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      showToast(text.includes('ysclaude-run-command-ok') ? '远程命令服务正常' : '服务已响应，请确认返回格式');
    } catch (error: any) {
      Alert.alert('连接失败', error?.name === 'AbortError' ? '测试超时' : error?.message || '无法连接远程命令服务');
    } finally {
      clearTimeout(timeoutId);
      setRcTesting(false);
    }
  }

  function buildQqBotConfigDraft(): QQBotConfig {
    const temperature = parseFloat(qqTemperature);
    const maxOutputTokens = parseInt(qqMaxOutputTokens, 10);
    const historyLimit = parseInt(qqHistoryLimit, 10);
    const memoryVaultTopK = parseInt(qqMemoryVaultTopK, 10);
    const memoryVaultTokenBudget = parseInt(qqMemoryVaultTokenBudget, 10);
    const memoryVaultMaxToolCalls = parseInt(qqMemoryVaultMaxToolCalls, 10);
    const webSearchMaxResults = parseInt(qqWebSearchMaxResults, 10);
    const mcpMaxToolCalls = parseInt(qqMcpMaxToolCalls, 10);
    const messageBatchWindowSeconds = parseFloat(qqMessageBatchWindowSeconds);

    return {
      enabled: qqEnabled,
      backendUrl: qqBackendUrl.trim().replace(/\/$/, ''),
      controlToken: qqControlToken.trim(),
      appId: qqAppId.trim(),
      appSecret: qqAppSecret.trim(),
      sandbox: qqSandbox,
      autoConnect: qqAutoConnect,
      allowDirectMessages: qqAllowDirectMessages,
      allowGuildMentions: qqAllowGuildMentions,
      openAiBaseUrl: qqOpenAiBaseUrl.trim().replace(/\/$/, ''),
      openAiApiKey: qqOpenAiApiKey.trim(),
      model: qqModel.trim(),
      systemPrompt: qqSystemPrompt.trim() || '你是 YSClaude 的 QQ 机器人入口。请用自然、简洁、友好的中文回复 QQ 用户。',
      qqSystemPrompt: qqSystemPrompt.trim() || '你是 YSClaude 的 QQ 机器人入口。请用自然、简洁、友好的中文回复 QQ 用户。',
      wechatSystemPrompt: wechatSystemPrompt.trim() || '你是 YSClaude 的微信机器人入口。请用自然、简洁、友好的中文回复微信用户。',
      temperature: isNaN(temperature) ? 0.7 : Math.min(2, Math.max(0, temperature)),
      maxOutputTokens: isNaN(maxOutputTokens) || maxOutputTokens <= 0 ? 1200 : maxOutputTokens,
      historyLimit: isNaN(historyLimit) || historyLimit <= 0 ? 16 : historyLimit,
      memoryVaultEnabled: qqMemoryVaultEnabled,
      memoryVaultBaseUrl: qqMemoryVaultBaseUrl.trim().replace(/\/$/, ''),
      memoryVaultTopK: isNaN(memoryVaultTopK) || memoryVaultTopK <= 0 ? 5 : memoryVaultTopK,
      memoryVaultTokenBudget: isNaN(memoryVaultTokenBudget) || memoryVaultTokenBudget <= 0 ? 2000 : memoryVaultTokenBudget,
      memoryVaultMaxToolCalls: isNaN(memoryVaultMaxToolCalls) || memoryVaultMaxToolCalls <= 0 ? 3 : memoryVaultMaxToolCalls,
      webSearchEnabled: qqWebSearchEnabled,
      tavilyApiKey: qqTavilyApiKey.trim(),
      webSearchMaxResults: isNaN(webSearchMaxResults) || webSearchMaxResults <= 0 ? 5 : webSearchMaxResults,
      mcpEnabled: qqMcpEnabled,
      mcpMaxToolCalls: isNaN(mcpMaxToolCalls) || mcpMaxToolCalls <= 0 ? 6 : mcpMaxToolCalls,
      mcpServers: qqMcpServers,
      ttsEnabled: qqTtsEnabled,
      ttsWithText: false,
      ttsGroupId: ttsConfig.groupId.trim(),
      ttsApiKey: ttsConfig.apiKey.trim(),
      ttsModel: ttsConfig.model.trim() || 'speech-02-hd',
      ttsVoiceId: ttsConfig.voiceId.trim(),
      ttsSpeed: ttsConfig.speed,
      ttsVol: ttsConfig.vol,
      ttsPitch: ttsConfig.pitch,
      messageBatchEnabled: qqMessageBatchEnabled,
      messageBatchWindowMs: isNaN(messageBatchWindowSeconds) || messageBatchWindowSeconds <= 0
        ? 6000
        : Math.round(messageBatchWindowSeconds * 1000),
      stickersEnabled: qqStickersEnabled,
      wechatEnabled,
      wechatAutoConnect,
      wechatAccountId: wechatAccountId.trim(),
      wechatBaseUrl: wechatBaseUrl.trim().replace(/\/$/, ''),
    };
  }

  function validateQqBotBackendUrl(config: QQBotConfig): boolean {
    if (!config.backendUrl || !/^https?:\/\//i.test(config.backendUrl)) {
      Alert.alert('提示', '后端服务地址必须以 http:// 或 https:// 开头');
      return false;
    }
    return true;
  }

  function validateQqBotConfig(config: QQBotConfig): boolean {
    if (!validateQqBotBackendUrl(config)) return false;
    if (config.enabled && (!config.openAiBaseUrl || !config.openAiApiKey || !config.model)) {
      Alert.alert('提示', '启用 QQ 机器人时请填写 OpenAI 兼容接口、密钥和模型名');
      return false;
    }
    if (config.memoryVaultEnabled && !config.memoryVaultBaseUrl) {
      Alert.alert('提示', '启用 QQ 机器人记忆库时请填写记忆库地址');
      return false;
    }
    if (config.webSearchEnabled && !config.tavilyApiKey) {
      Alert.alert('提示', '启用 QQ 机器人联网搜索时请填写 Tavily 密钥');
      return false;
    }
    if (config.ttsEnabled && (!config.ttsGroupId || !config.ttsApiKey || !config.ttsVoiceId)) {
      Alert.alert('提示', '启用 QQ 机器人语音 TTS 时，请先在 TTS 配置中填写 MiniMax Group ID、API Key 和 Voice ID');
      return false;
    }
    return true;
  }

  function makeQqBotControlHeaders(config: QQBotConfig): Record<string, string> {
    const headers: Record<string, string> = {};
    if (config.controlToken) {
      headers.Authorization = `Bearer ${config.controlToken}`;
    }
    return headers;
  }

  function omitUnsetQqBotBackendCredentials(config: Record<string, any>) {
    if (!String(config.appId || '').trim()) delete config.appId;
    const appSecret = String(config.appSecret || '').trim();
    if (!appSecret || isMaskedBackendSecret(appSecret)) delete config.appSecret;
  }

  function isMaskedBackendSecret(value: string): boolean {
    return value === '********' || /^.{4}\.\.\..{4}$/.test(value);
  }

  function measureUtf8Bytes(value: string): number {
    return new TextEncoder().encode(value).length;
  }

  function buildStickerSyncBatches(stickers: Array<{ name: string; mimeType: string; dataBase64: string }>) {
    const batches: Array<Array<{ name: string; mimeType: string; dataBase64: string }>> = [];
    let current: Array<{ name: string; mimeType: string; dataBase64: string }> = [];
    for (const sticker of stickers) {
      const candidate = [...current, sticker];
      const candidateBytes = measureUtf8Bytes(JSON.stringify({ stickers: candidate }));
      if (
        current.length > 0 &&
        (current.length >= QQ_BOT_STICKER_BATCH_MAX_COUNT || candidateBytes > QQ_BOT_STICKER_BATCH_MAX_BYTES)
      ) {
        batches.push(current);
        current = [sticker];
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  async function syncQqBotStickers(
    draft: QQBotConfig,
    stickers: Array<{ name: string; mimeType: string; dataBase64: string }>
  ) {
    const batches = buildStickerSyncBatches(stickers);
    if (batches.length === 0) {
      const resp = await fetchQqBotBackend(`${draft.backendUrl}/config/stickers`, {
        method: 'PUT',
        headers: {
          ...makeQqBotControlHeaders(draft),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ replace: true, stickers: [] }),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      return 0;
    }

    let syncedCount = 0;
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const body = JSON.stringify({ replace: index === 0, stickers: batch });
      const resp = await fetchQqBotBackend(`${draft.backendUrl}/config/stickers`, {
        method: 'PUT',
        headers: {
          ...makeQqBotControlHeaders(draft),
          'Content-Type': 'application/json',
        },
        body,
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      syncedCount += batch.length;
      setQqBackendStatus(`正在同步表情包 ${syncedCount}/${stickers.length}`);
    }
    return syncedCount;
  }

  async function fetchQqBotBackend(url: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QQ_BOT_BACKEND_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error: any) {
      const errorName = String(error?.name || '').toLowerCase();
      const errorMessage = String(error?.message || '').toLowerCase();
      if (
        errorName === 'aborterror' ||
        errorMessage.includes('abort') ||
        errorMessage.includes('cancel')
      ) {
        throw new Error('后端响应超时，请检查后端日志或稍后再试');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function handleSaveQqBot(): boolean {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotBackendUrl(draft)) return false;
    setQqBotConfig(draft);
    if (draft.enabled && (!draft.openAiBaseUrl || !draft.openAiApiKey || !draft.model)) {
      showToast('QQ 机器人草稿已保存，启动前还需补全必填项');
    } else {
      showToast(draft.enabled ? 'QQ 机器人配置已保存' : 'QQ 机器人已关闭');
    }
    return true;
  }

  function handleImportMainChatConfig() {
    if (!activeApiConfig) {
      Alert.alert('提示', '当前没有可导入的主聊天 API 配置');
      return;
    }
    setQqOpenAiBaseUrl((activeApiConfig.baseUrl || '').trim().replace(/\/$/, ''));
    setQqOpenAiApiKey((activeApiConfig.apiKey || '').trim());
    setQqModel((activeApiConfig.model || '').trim());
    setQqSystemPrompt(systemPrompt || '你是 YSClaude 的 QQ 机器人入口。请用自然、简洁、友好的中文回复 QQ 用户。');
    setQqMemoryVaultEnabled(!!memoryVaultConfig.enabled);
    setQqMemoryVaultBaseUrl(memoryVaultConfig.baseUrl || '');
    setQqMemoryVaultTopK(String(memoryVaultConfig.topK ?? 5));
    setQqMemoryVaultTokenBudget(String(memoryVaultConfig.tokenBudget ?? 2000));
    setQqMemoryVaultMaxToolCalls(String(memoryVaultConfig.maxToolCalls ?? 3));
    setQqWebSearchEnabled(!!webSearchConfig.enabled);
    setQqTavilyApiKey(webSearchConfig.tavilyApiKey || '');
    setQqWebSearchMaxResults(String(webSearchConfig.maxResults ?? 5));
    setQqMcpEnabled(!!mcpToolConfig.enabled);
    setQqMcpMaxToolCalls(String(mcpToolConfig.maxToolCalls ?? 6));
    setQqMcpServers(mcpToolConfig.servers || []);
    setQqTtsEnabled(!!ttsConfig.groupId && !!ttsConfig.apiKey && !!ttsConfig.voiceId);
    setQqMessageBatchEnabled(true);
    setQqMessageBatchWindowSeconds('6');
    setQqStickersEnabled(getQqStickerCount() > 0);
    showToast('已导入主聊天 API、QQ System Prompt、记忆库、联网搜索、MCP 工具、TTS 开关、消息合并和表情包');
  }

  function handleImportMainChatMcpConfig() {
    setQqMcpEnabled(!!mcpToolConfig.enabled);
    setQqMcpMaxToolCalls(String(mcpToolConfig.maxToolCalls ?? 6));
    setQqMcpServers(mcpToolConfig.servers || []);
    showToast('已导入主聊天 MCP 工具配置');
  }

  function getQqStickerCount() {
    return getQqStickerCandidates().length;
  }

  function getQqStickerCandidates() {
    return (stickerConfig?.assistantStickers || [])
      .filter((sticker) => !!sticker.uri && !!normalizeStickerName(sticker.name));
  }

  async function buildQqBotStickerPayload() {
    if (!qqStickersEnabled) return [];
    const stickers = getQqStickerCandidates().slice(0, 40);
    const payload: Array<{ name: string; mimeType: string; dataBase64: string }> = [];
    for (const sticker of stickers) {
      try {
        const uri = sticker.uri || '';
        const dataBase64 = await readStickerImageAsBase64(uri);
        if (!dataBase64) continue;
        payload.push({
          name: normalizeStickerName(sticker.name),
          mimeType: inferStickerMimeType(uri, dataBase64),
          dataBase64,
        });
      } catch (error) {
        console.warn('[settings] skip QQ sticker sync', sticker.name, error);
      }
    }
    return payload;
  }

  async function readStickerImageAsBase64(uri: string): Promise<string> {
    if (/^https?:\/\//i.test(uri)) {
      return fetchImageAsBase64(uri);
    }
    const file = new File(uri);
    return file.base64();
  }

  async function fetchImageAsBase64(uri: string): Promise<string> {
    const resp = await fetch(uri);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function inferStickerMimeType(uri: string, dataBase64: string): string {
    const uriMimeType = inferImageMimeType(uri);
    if (uriMimeType !== 'image/png') return uriMimeType;
    if (dataBase64.startsWith('/9j/')) return 'image/jpeg';
    if (dataBase64.startsWith('R0lG')) return 'image/gif';
    if (dataBase64.startsWith('UklGR')) return 'image/webp';
    return uriMimeType;
  }

  function getQqMcpEnabledServerCount() {
    return qqMcpServers.filter((server) => server.enabled).length;
  }

  function getQqMcpEnabledToolCount() {
    return qqMcpServers.reduce(
      (count, server) =>
        server.enabled
          ? count + (server.tools || []).filter((tool) => tool.enabled !== false).length
          : count,
      0
    );
  }

  async function handleTestQqBotBackend() {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotConfig({ ...draft, enabled: false })) return;
    setQqBackendTesting(true);
    try {
      const resp = await fetchQqBotBackend(`${draft.backendUrl}/health`, {
        method: 'GET',
        headers: makeQqBotControlHeaders(draft),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      let statusText = '后端服务正常';
      try {
        const json = JSON.parse(text);
        statusText = json?.status ? `后端：${json.status}` : statusText;
        if (json?.qq?.connected !== undefined) {
          statusText += json.qq.connected ? '，QQ 已连接' : '，QQ 未连接';
        }
      } catch {
        // Plain text health responses are acceptable.
      }
      setQqBackendStatus(statusText);
      showToast(statusText);
    } catch (error: any) {
      const message = error?.message || '无法连接 QQ 机器人后端';
      setQqBackendStatus(message);
      Alert.alert('连接失败', message);
    } finally {
      setQqBackendTesting(false);
    }
  }

  async function handleSyncQqBotBackend() {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotConfig(draft)) return;
    setQqBotConfig(draft);
    setQqBackendSyncing(true);
    try {
      const backendConfig = Object.fromEntries(
        Object.entries(draft).filter(([key]) => key !== 'backendUrl' && key !== 'controlToken')
      );
      omitUnsetQqBotBackendCredentials(backendConfig);
      const stickerCandidateCount = getQqStickerCount();
      const stickerPayload = await buildQqBotStickerPayload();
      backendConfig.stickers = [];
      const body = JSON.stringify(backendConfig);
      const bodyBytes = measureUtf8Bytes(body);
      if (bodyBytes > QQ_BOT_CONFIG_PAYLOAD_MAX_BYTES) {
        throw new Error(`同步内容约 ${(bodyBytes / 1024 / 1024).toFixed(1)}MB，可能超过后端代理限制。请先关闭表情包同步或减少表情包数量/大小。`);
      }
      const resp = await fetchQqBotBackend(`${draft.backendUrl}/config`, {
        method: 'PUT',
        headers: {
          ...makeQqBotControlHeaders(draft),
          'Content-Type': 'application/json',
        },
        body,
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      let backendStickerCount = stickerPayload.length;
      try {
        const json = JSON.parse(text);
        backendStickerCount = Array.isArray(json?.config?.stickers) ? json.config.stickers.length : backendStickerCount;
      } catch {
        // Non-JSON responses are handled by the HTTP status above.
      }
      if (qqStickersEnabled) {
        backendStickerCount = await syncQqBotStickers(draft, stickerPayload);
      }
      const stickerStatus = qqStickersEnabled
        ? `表情包 ${backendStickerCount}/${stickerCandidateCount}`
        : '表情包未启用';
      setQqBackendStatus(`配置已同步到后端，${stickerStatus}`);
      showToast(`QQ/微信机器人配置已同步，${stickerStatus}`);
    } catch (error: any) {
      const message = error?.message || '无法同步 QQ 机器人后端';
      setQqBackendStatus(message);
      Alert.alert('同步失败', message);
    } finally {
      setQqBackendSyncing(false);
    }
  }

  async function callWechatControl(action: 'login' | 'start' | 'stop' | 'restart' | 'logout') {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotBackendUrl(draft)) return;
    setQqBotConfig(draft);
    setWechatBusy(true);
    if (action === 'login') {
      Alert.alert('微信扫码登录', '点击确定后请打开 Zeabur 服务日志查看二维码并用微信扫码。二维码过期后可重新点击登录。');
    }
    try {
      const resp = await fetchQqBotBackend(`${draft.backendUrl}/control/wechat/${action}`, {
        method: 'POST',
        headers: makeQqBotControlHeaders(draft),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      const json = text ? JSON.parse(text) : {};
      const accountId = json?.accountId || json?.wechat?.accountId || '';
      if (accountId) {
        setWechatAccountId(accountId);
        setQqBotConfig({ wechatAccountId: accountId });
      }
      setQqBackendStatus(`微信通道：${json?.wechat?.state || '已更新'}`);
      showToast(action === 'login' ? '微信扫码登录完成' : '微信通道状态已更新');
    } catch (error: any) {
      const message = error?.message || '微信通道控制失败';
      setQqBackendStatus(message);
      Alert.alert('微信通道失败', message);
    } finally {
      setWechatBusy(false);
    }
  }

  function getBotPanelPlatformLabel() {
    return botPanelTab === 'wechat' ? '微信' : 'QQ';
  }

  function getConversationPlatformLabel(key?: string | null) {
    return key?.startsWith('wechat:') ? '微信' : 'QQ';
  }

  function getBotPanelConversationQuery() {
    return `platform=${botPanelTab}`;
  }

  function getVisibleBotPanelConversations() {
    return qqContextConversations.filter((conversation) =>
      botPanelTab === 'wechat'
        ? conversation.key.startsWith('wechat:')
        : /^(c2c|dm|group|channel):/.test(conversation.key)
    );
  }

  async function handleRefreshQqBotContexts() {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotBackendUrl(draft)) return;
    setQqContextRefreshing(true);
    try {
      const resp = await fetch(`${draft.backendUrl}/conversations?${getBotPanelConversationQuery()}`, {
        method: 'GET',
        headers: makeQqBotControlHeaders(draft),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      const json = JSON.parse(text);
      const count = Number(json?.count || 0);
      setQqContextConversations(Array.isArray(json?.conversations) ? json.conversations : []);
      setQqContextStatus(`后端保存了 ${count} 个${getBotPanelPlatformLabel()}会话上下文`);
      if (qqSelectedConversationKey && !json.conversations?.some((conversation: any) => conversation.key === qqSelectedConversationKey)) {
        setQqSelectedConversationKey(null);
        setQqSelectedConversationMessages([]);
        setQqSelectedMessageIndexes([]);
      }
      showToast(`${getBotPanelPlatformLabel()}上下文：${count} 个会话`);
    } catch (error: any) {
      const message = error?.message || `无法读取${getBotPanelPlatformLabel()}上下文`;
      setQqContextStatus(message);
      Alert.alert('读取失败', message);
    } finally {
      setQqContextRefreshing(false);
    }
  }

  function handleClearQqBotContexts() {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotBackendUrl(draft)) return;
    const platformLabel = getBotPanelPlatformLabel();
    Alert.alert(`清空${platformLabel}上下文`, `确定清空后端保存的全部${platformLabel}会话上下文吗？这不会删除平台账号或 YSClaude 本地聊天记录。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          setQqContextClearing(true);
          try {
            const resp = await fetch(`${draft.backendUrl}/conversations?${getBotPanelConversationQuery()}`, {
              method: 'DELETE',
              headers: makeQqBotControlHeaders(draft),
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
            const json = JSON.parse(text);
            const deleted = Number(json?.deleted || 0);
            setQqContextStatus(`后端保存了 0 个${platformLabel}会话上下文`);
            setQqContextConversations([]);
            setQqSelectedConversationKey(null);
            setQqSelectedConversationMessages([]);
            setQqSelectedMessageIndexes([]);
            showToast(`已清空 ${deleted} 个${platformLabel}会话上下文`);
          } catch (error: any) {
            const message = error?.message || `无法清空${platformLabel}上下文`;
            Alert.alert('清空失败', message);
          } finally {
            setQqContextClearing(false);
          }
        },
      },
    ]);
  }

  async function handleOpenQqConversation(key: string, page = 1) {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotBackendUrl(draft)) return;
    setQqSelectedConversationKey(key);
    setQqConversationLoading(true);
    try {
      const resp = await fetch(`${draft.backendUrl}/conversations/${encodeURIComponent(key)}?page=${page}&limit=10`, {
        method: 'GET',
        headers: makeQqBotControlHeaders(draft),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      const json = JSON.parse(text);
      setQqSelectedConversationMessages(Array.isArray(json?.messages) ? json.messages : []);
      setQqSelectedConversationPage(Number(json?.page || page));
      setQqSelectedConversationTotalPages(Number(json?.totalPages || 1));
      setQqSelectedConversationMessageCount(Number(json?.messageCount || 0));
      setQqSelectedMessageIndexes([]);
      setQqContextStatus(`正在查看会话 ${key}`);
    } catch (error: any) {
      const message = error?.message || '无法读取会话详情';
      setQqContextStatus(message);
      Alert.alert('读取失败', message);
    } finally {
      setQqConversationLoading(false);
    }
  }

  function toggleQqMessageIndex(index: number) {
    setQqSelectedMessageIndexes((current) =>
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index].sort((a, b) => a - b)
    );
  }

  function handleDeleteSelectedQqMessages() {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotBackendUrl(draft)) return;
    if (!qqSelectedConversationKey) {
      Alert.alert('提示', '请先选择一个会话');
      return;
    }
    if (qqSelectedMessageIndexes.length === 0) {
      Alert.alert('提示', '请先勾选要删除的消息');
      return;
    }
    Alert.alert('删除消息', `确定删除当前会话里选中的 ${qqSelectedMessageIndexes.length} 条消息吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setQqMessageDeleting(true);
          try {
            const resp = await fetch(`${draft.backendUrl}/conversations/${encodeURIComponent(qqSelectedConversationKey)}/messages/delete`, {
              method: 'POST',
              headers: {
                ...makeQqBotControlHeaders(draft),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ indexes: qqSelectedMessageIndexes }),
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
            const json = JSON.parse(text);
            showToast(`已删除 ${Number(json?.deleted || 0)} 条消息`);
            await handleRefreshQqBotContexts();
            const remaining = Number(json?.remaining || 0);
            const nextTotalPages = Math.max(1, Math.ceil(remaining / 10));
            await handleOpenQqConversation(qqSelectedConversationKey, Math.min(qqSelectedConversationPage, nextTotalPages));
          } catch (error: any) {
            const message = error?.message || '无法删除选定消息';
            Alert.alert('删除失败', message);
          } finally {
            setQqMessageDeleting(false);
          }
        },
      },
    ]);
  }

  function handleClearSelectedQqConversation() {
    const draft = buildQqBotConfigDraft();
    if (!validateQqBotBackendUrl(draft)) return;
    if (!qqSelectedConversationKey) {
      Alert.alert('提示', '请先选择一个会话');
      return;
    }
    const platformLabel = getConversationPlatformLabel(qqSelectedConversationKey);
    Alert.alert('清除此会话', `确定清空当前${platformLabel}会话的全部上下文吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          setQqMessageDeleting(true);
          try {
            const key = qqSelectedConversationKey;
            const resp = await fetch(`${draft.backendUrl}/conversations/${encodeURIComponent(key)}`, {
              method: 'DELETE',
              headers: makeQqBotControlHeaders(draft),
            });
            const text = await resp.text();
            if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
            setQqSelectedConversationKey(null);
            setQqSelectedConversationMessages([]);
            setQqSelectedMessageIndexes([]);
            showToast(`已清空该${platformLabel}会话上下文`);
            await handleRefreshQqBotContexts();
          } catch (error: any) {
            const message = error?.message || '无法清空该会话';
            Alert.alert('清空失败', message);
          } finally {
            setQqMessageDeleting(false);
          }
        },
      },
    ]);
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

  function handleAddMcpServer() {
    const name = mcpServerName.trim();
    const url = mcpServerUrl.trim();
    if (!url) {
      Alert.alert('提示', '请填写 MCP 服务地址');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      Alert.alert('提示', 'MCP 服务地址需要以 http:// 或 https:// 开头');
      return;
    }
    const id = sanitizeMcpServerId(name || url);
    if (mcpServers.some((server) => server.id === id)) {
      Alert.alert('提示', '已有同 ID 的 MCP 服务');
      return;
    }
    setMcpServers((current) => [
      ...current,
      {
        id,
        name: name || id,
        url,
        authorization: mcpServerAuth.trim(),
        enabled: true,
        tools: [],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        updatedAt: Date.now(),
      },
    ]);
    setMcpServerName('');
    setMcpServerUrl('');
    setMcpServerAuth('');
    showToast('MCP 服务已添加');
  }

  function handleRemoveMcpServer(serverId: string) {
    setMcpServers((current) => current.filter((server) => server.id !== serverId));
  }

  function handleUpdateMcpServer(serverId: string, patch: Partial<(typeof mcpServers)[number]>) {
    setMcpServers((current) =>
      current.map((server) =>
        server.id === serverId ? { ...server, ...patch, updatedAt: Date.now() } : server
      )
    );
  }

  function handleUpdateMcpServerToolEnabled(serverId: string, toolName: string, enabled: boolean) {
    setMcpServers((current) =>
      current.map((server) => {
        if (server.id !== serverId) return server;
        return {
          ...server,
          tools: (server.tools || []).map((tool) =>
            tool.name === toolName ? { ...tool, enabled } : tool
          ),
          updatedAt: Date.now(),
        };
      })
    );
  }

  function handleUpdateMcpServerResource(
    serverId: string,
    uri: string,
    patch: { enabled?: boolean; pinned?: boolean }
  ) {
    setMcpServers((current) =>
      current.map((server) => {
        if (server.id !== serverId) return server;
        return {
          ...server,
          resources: (server.resources || []).map((resource) =>
            resource.uri === uri ? { ...resource, ...patch } : resource
          ),
          updatedAt: Date.now(),
        };
      })
    );
  }

  async function handleSyncMcpServer(serverId: string) {
    const server = mcpServers.find((item) => item.id === serverId);
    if (!server) return;
    setMcpSyncingServerId(serverId);
    try {
      const capabilities = await listMcpCapabilities({
        url: server.url,
        authorization: server.authorization,
      });
      const enabledByName = new Map((server.tools || []).map((tool) => [tool.name, tool.enabled !== false]));
      const resourceStateByUri = new Map(
        (server.resources || []).map((resource) => [
          resource.uri,
          { enabled: resource.enabled !== false, pinned: resource.pinned === true },
        ])
      );
      const promptEnabledByName = new Map((server.prompts || []).map((prompt) => [prompt.name, prompt.enabled !== false]));
      handleUpdateMcpServer(serverId, {
        tools: capabilities.tools.map((tool) => ({
          ...tool,
          enabled: enabledByName.get(tool.name) ?? true,
        })),
        resources: capabilities.resources.map((resource) => {
          const previous = resourceStateByUri.get(resource.uri);
          return {
            ...resource,
            enabled: previous?.enabled ?? true,
            pinned: previous?.pinned ?? false,
          };
        }),
        resourceTemplates: capabilities.resourceTemplates,
        prompts: capabilities.prompts.map((prompt) => ({
          ...prompt,
          enabled: promptEnabledByName.get(prompt.name) ?? true,
        })),
      });
      showToast(
        `已同步 ${capabilities.tools.length} 个工具、${capabilities.resources.length} 个资源、${capabilities.prompts.length} 个提示词`
      );
    } catch (error: any) {
      Alert.alert('同步失败', error?.message || '无法读取 MCP 能力');
    } finally {
      setMcpSyncingServerId(null);
    }
  }

  function handleSaveMcpTools() {
    const maxToolCalls = parseInt(mcpMaxCalls, 10);
    const hasEnabledMcpTool = mcpServers.some(
      (server) => server.enabled && (server.tools || []).some((tool) => tool.enabled !== false)
    );
    const hasEnabledMcpResourceTool = mcpResourceToolsEnabled && mcpServers.some(
      (server) => server.enabled && (server.resources || []).some((resource) => resource.enabled !== false)
    );
    const hasPinnedMcpResource = mcpServers.some(
      (server) => server.enabled && (server.resources || []).some((resource) => resource.enabled !== false && resource.pinned)
    );
    setMcpToolConfig({
      enabled: hasEnabledMcpTool || hasEnabledMcpResourceTool || hasPinnedMcpResource,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 6 : maxToolCalls,
      resourceToolsEnabled: mcpResourceToolsEnabled,
      servers: mcpServers,
    });
    showToast(
      hasEnabledMcpTool || hasEnabledMcpResourceTool || hasPinnedMcpResource
        ? 'MCP 能力已保存'
        : 'MCP 能力已保存，当前没有开启的 MCP 工具或资源'
    );
  }

  function handleSaveNativeTools() {
    setNativeToolConfig({
      deviceInfoEnabled,
      batteryStatusEnabled,
      appUsageStatsEnabled,
      calendarEnabled,
    });
    showToast('设备原生工具开关已保存');
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

  const builtInToolCards = [
    { key: 'memoryVault', name: '记忆库', intro: '搜索长期记忆，并按日期查询日记内容。', enabled: mvEnabled, onValueChange: setMvEnabled, meta: '2 个工具' },
    { key: 'webSearch', name: '联网搜索', intro: '通过 Tavily 搜索互联网，补充实时信息。', enabled: wsEnabled, onValueChange: setWsEnabled, meta: '1 个工具' },
    { key: 'webPageReader', name: '网页读取', intro: '读取链接中的网页正文，可配置渲染服务兜底。', enabled: wprEnabled, onValueChange: setWprEnabled, meta: '1 个工具' },
    { key: 'hotboard', name: '热榜查询', intro: '从已选择的平台列表中查询热门话题。', enabled: hbEnabled, onValueChange: setHbEnabled, meta: hbPlatformTypes.length + ' 个平台' },
    { key: 'dailyPaperSources', name: '日报来源', intro: '配置每日日报生成时读取的 RSS 新闻来源。', enabled: dailyUseDefaultSources || dailyCustomSources.some((source) => source.enabled), onValueChange: setDailyUseDefaultSources, meta: (dailyUseDefaultSources ? 6 : 0) + dailyCustomSources.filter((source) => source.enabled).length + ' 个来源' },
    { key: 'runCommand', name: '远程命令', intro: '通过你配置的远程命令服务执行 shell 命令。', enabled: rcEnabled, onValueChange: setRcEnabled, meta: '最多 ' + (rcMaxCalls || '4') + ' 次' },
    { key: 'qqBot', name: 'QQ 机器人', intro: '把 QQ 官方机器人消息接入独立后端，由 YSClaude 生成回复。', enabled: qqEnabled, onValueChange: setQqEnabled, meta: qqBackendStatus === '尚未检测' ? '官方 Bot' : qqBackendStatus },
    { key: 'webInteraction', name: '网页交互', intro: '允许 AI 打开、观察并操作应用内网页面板。', enabled: wiEnabled, onValueChange: setWiEnabled, meta: '最多 ' + (wiMaxCalls || '8') + ' 次' },
    { key: 'shizukuFile', name: 'Shizuku 文件', intro: '读写你明确授权的 Shizuku 路径内文件。', enabled: shizukuEnabled, onValueChange: setShizukuEnabled, meta: shizukuRoots.length + ' 个路径' },
    { key: 'deviceInfo', name: '设备信息', intro: '读取设备品牌、型号、系统版本和运行状态。', enabled: deviceInfoEnabled, onValueChange: setDeviceInfoEnabled, meta: '设备原生' },
    { key: 'batteryStatus', name: '电池状态', intro: '读取电量、充电状态和省电模式。', enabled: batteryStatusEnabled, onValueChange: setBatteryStatusEnabled, meta: '设备原生' },
    { key: 'appUsageStats', name: '应用使用统计', intro: '在系统授权后读取 Android 应用使用时间统计。', enabled: appUsageStatsEnabled, onValueChange: setAppUsageStatsEnabled, meta: '设备原生' },
    { key: 'calendar', name: '系统日历', intro: '读取、创建、修改和删除系统日历日程。', enabled: calendarEnabled, onValueChange: setCalendarEnabled, meta: '设备原生' },
  ];

  const selectedBuiltInTool = builtInToolCards.find((tool) => tool.key === selectedBuiltInToolKey) || null;
  const selectedMcpServer = mcpServers.find((server) => server.id === selectedMcpServerId) || null;
  const selectedMcpToolServer = selectedMcpToolRef
    ? mcpServers.find((server) => server.id === selectedMcpToolRef.serverId) || null
    : null;
  const selectedMcpTool = selectedMcpToolServer && selectedMcpToolRef
    ? (selectedMcpToolServer.tools || []).find((tool) => tool.name === selectedMcpToolRef.toolName) || null
    : null;
  const selectedMcpResourceServer = selectedMcpResourceRef
    ? mcpServers.find((server) => server.id === selectedMcpResourceRef.serverId) || null
    : null;
  const selectedMcpResource = selectedMcpResourceServer && selectedMcpResourceRef
    ? (selectedMcpResourceServer.resources || []).find((resource) => resource.uri === selectedMcpResourceRef.uri) || null
    : null;
  const selectedMcpPromptServer = selectedMcpPromptRef
    ? mcpServers.find((server) => server.id === selectedMcpPromptRef.serverId) || null
    : null;
  const selectedMcpPrompt = selectedMcpPromptServer && selectedMcpPromptRef
    ? (selectedMcpPromptServer.prompts || []).find((prompt) => prompt.name === selectedMcpPromptRef.promptName) || null
    : null;

  useEffect(() => {
    if (selectedMcpPrompt) {
      const args: Record<string, any> = {};
      for (const arg of selectedMcpPrompt.arguments || []) {
        if (arg.required) {
          args[arg.name] = '';
        }
      }
      setMcpPromptArgs(Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : '{}');
    } else {
      setMcpPromptArgs('{}');
    }
  }, [selectedMcpPrompt]);

  function getEnabledMcpToolCount(server: (typeof mcpServers)[number]) {
    return (server.tools || []).filter((tool) => tool.enabled !== false).length;
  }
  function getEnabledMcpResourceCount(server: (typeof mcpServers)[number]) {
    return (server.resources || []).filter((resource) => resource.enabled !== false).length;
  }
  function getPinnedMcpResourceCount(server: (typeof mcpServers)[number]) {
    return (server.resources || []).filter((resource) => resource.enabled !== false && resource.pinned).length;
  }

  function formatMcpToolInputSchema(tool: NonNullable<typeof selectedMcpTool>) {
    try {
      return JSON.stringify(tool.inputSchema || { type: 'object', properties: {}, required: [] }, null, 2);
    } catch {
      return '无法格式化参数定义';
    }
  }

  function formatMcpPromptArguments(prompt: NonNullable<typeof selectedMcpPrompt>) {
    try {
      return JSON.stringify(prompt.arguments || [], null, 2);
    } catch {
      return '无法格式化参数定义';
    }
  }

  async function handleApplyMcpPrompt() {
    if (!selectedMcpPromptServer || !selectedMcpPrompt) return;
    setMcpPromptApplying(true);
    try {
      let parsedArgs: Record<string, any> = {};
      if (mcpPromptArgs.trim()) {
        parsedArgs = JSON.parse(mcpPromptArgs);
      }
      const result = await getMcpPrompt(
        {
          url: selectedMcpPromptServer.url,
          authorization: selectedMcpPromptServer.authorization,
        },
        selectedMcpPrompt.name,
        parsedArgs
      );
      const promptText = formatMcpPromptResult(result);
      const draft = [
        `MCP 提示词：${selectedMcpPrompt.title || selectedMcpPrompt.name}`,
        `来源：${selectedMcpPromptServer.name}`,
        '',
        promptText,
      ].join('\n');
      const added = await addUserMessage(draft);
      if (added) {
        showToast('MCP 提示词已加入当前对话');
      } else {
        Alert.alert('应用失败', '无法把 MCP 提示词加入当前对话，请先确认 API 配置可用');
      }
    } catch (error: any) {
      Alert.alert('应用失败', error?.message || '无法读取 MCP 提示词');
    } finally {
      setMcpPromptApplying(false);
    }
  }

  function handleSaveBuiltInTool(toolKey: string) {
    switch (toolKey) {
      case 'memoryVault':
        handleSaveMemory();
        break;
      case 'webSearch':
        handleSaveWebSearch();
        break;
      case 'webPageReader':
        handleSaveWebPageReader();
        break;
      case 'hotboard':
        handleSaveHotboard();
        break;
      case 'dailyPaperSources':
        return handleSaveDailyPaperSources();
      case 'runCommand':
        return handleSaveRunCommand();
      case 'webInteraction':
        handleSaveWebInteraction();
        break;
      case 'qqBot':
        return handleSaveQqBot();
      case 'shizukuFile':
        handleSaveShizukuFile();
        break;
      default:
        handleSaveNativeTools();
        break;
    }
    return true;
  }

  function handleDisableBuiltInTool(toolKey: string) {
    Alert.alert('关闭工具', '确定关闭这个工具吗？已保存的配置会保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '关闭',
        style: 'destructive',
        onPress: () => {
          switch (toolKey) {
            case 'memoryVault':
              setMvEnabled(false);
              setMemoryVaultConfig({ enabled: false });
              break;
            case 'webSearch':
              setWsEnabled(false);
              setWebSearchConfig({ enabled: false });
              break;
            case 'webPageReader':
              setWprEnabled(false);
              setWebPageReaderConfig({ enabled: false });
              break;
            case 'hotboard':
              setHbEnabled(false);
              setHotboardConfig({ enabled: false });
              break;
            case 'dailyPaperSources':
              setDailyUseDefaultSources(false);
              setDailyCustomSources((sources) => sources.map((source) => ({ ...source, enabled: false })));
              setDailyPaperConfig({ useDefaultSources: false, customSources: dailyCustomSources.map((source) => ({ ...source, enabled: false })) });
              break;
            case 'runCommand':
              setRcEnabled(false);
              setRunCommandConfig({ enabled: false });
              break;
            case 'webInteraction':
              setWiEnabled(false);
              setWebInteractionConfig({ enabled: false });
              break;
            case 'qqBot':
              setQqEnabled(false);
              setQqBotConfig({ enabled: false });
              break;
            case 'shizukuFile':
              setShizukuEnabled(false);
              setShizukuFileConfig({ enabled: false });
              break;
            case 'deviceInfo':
              setDeviceInfoEnabled(false);
              setNativeToolConfig({ deviceInfoEnabled: false });
              break;
            case 'batteryStatus':
              setBatteryStatusEnabled(false);
              setNativeToolConfig({ batteryStatusEnabled: false });
              break;
            case 'appUsageStats':
              setAppUsageStatsEnabled(false);
              setNativeToolConfig({ appUsageStatsEnabled: false });
              break;
            case 'calendar':
              setCalendarEnabled(false);
              setNativeToolConfig({ calendarEnabled: false });
              break;
          }
          setSelectedBuiltInToolKey(null);
          showToast('工具已关闭');
        },
      },
    ]);
  }

  function handleRemoveMcpServerFromModal(serverId: string) {
    Alert.alert('删除 MCP 服务', '确定删除这个 MCP 服务及已缓存的工具列表吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          handleRemoveMcpServer(serverId);
          setSelectedMcpServerId(null);
          showToast('MCP 服务已删除，请保存 MCP 工具');
        },
      },
    ]);
  }

  function renderBuiltInToolEditor(toolKey: string) {
    switch (toolKey) {
      case 'memoryVault':
        return (
          <>
            <Text style={styles.toolModalDescription}>AI 可以搜索记忆库并查询日记内容。</Text>
            <View style={styles.switchRow}><Text style={styles.label}>启用记忆库</Text><Switch value={mvEnabled} onValueChange={setMvEnabled} trackColor={{ true: colors.primary }} /></View>
            <View style={styles.field}><Text style={styles.label}>记忆库地址</Text><TextInput style={styles.input} value={mvBaseUrl} onChangeText={setMvBaseUrl} placeholder="https://your-memory-vault.com" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>管理员令牌</Text><TextInput style={styles.input} value={mvAdminToken} onChangeText={setMvAdminToken} placeholder="ADMIN_TOKEN" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View>
            <View style={styles.toolNumberRow}><View style={styles.toolNumberField}><Text style={styles.label}>返回条数</Text><TextInput style={styles.input} value={mvTopK} onChangeText={setMvTopK} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} /></View><View style={styles.toolNumberField}><Text style={styles.label}>令牌预算</Text><TextInput style={styles.input} value={mvTokenBudget} onChangeText={setMvTokenBudget} keyboardType="number-pad" placeholder="2000" placeholderTextColor={colors.textTertiary} /></View></View>
            <View style={styles.field}><Text style={styles.label}>每轮最大调用次数</Text><TextInput style={styles.input} value={mvMaxCalls} onChangeText={setMvMaxCalls} keyboardType="number-pad" placeholder="3" placeholderTextColor={colors.textTertiary} /></View>
            <Pressable style={styles.testButton} onPress={handleTestMemory} disabled={mvTesting}>{mvTesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}</Pressable>
          </>
        );
      case 'webSearch':
        return (<><Text style={styles.toolModalDescription}>AI 可以通过 Tavily 搜索互联网获取实时信息。</Text><View style={styles.switchRow}><Text style={styles.label}>启用联网搜索</Text><Switch value={wsEnabled} onValueChange={setWsEnabled} trackColor={{ true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>Tavily 密钥</Text><TextInput style={styles.input} value={wsApiKey} onChangeText={setWsApiKey} placeholder="tvly-..." placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View><View style={styles.field}><Text style={styles.label}>搜索结果数量</Text><TextInput style={styles.input} value={wsMaxResults} onChangeText={setWsMaxResults} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} /></View></>);
      case 'webPageReader':
        return (<><Text style={styles.toolModalDescription}>AI 可以读取链接中的网页正文。</Text><View style={styles.switchRow}><Text style={styles.label}>启用网页读取</Text><Switch value={wprEnabled} onValueChange={setWprEnabled} trackColor={{ true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>渲染读取服务地址</Text><TextInput style={styles.input} value={wprRenderServiceUrl} onChangeText={setWprRenderServiceUrl} placeholder="http://localhost:8787/read" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View></>);
      case 'hotboard':
        return (<><Text style={styles.toolModalDescription}>AI 可以从已选择的平台类型中查询热榜。</Text><View style={styles.switchRow}><Text style={styles.label}>启用热榜查询</Text><Switch value={hbEnabled} onValueChange={setHbEnabled} trackColor={{ true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>UAPI 密钥</Text><TextInput style={styles.input} value={hbApiKey} onChangeText={setHbApiKey} placeholder="Bearer 令牌" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View><View style={styles.platformActions}><Pressable style={styles.platformActionButton} onPress={selectDefaultHotboardPlatforms}><Text style={styles.platformActionText}>默认</Text></Pressable><Pressable style={styles.platformActionButton} onPress={selectAllHotboardPlatforms}><Text style={styles.platformActionText}>全选</Text></Pressable><Pressable style={styles.platformActionButton} onPress={clearHotboardPlatforms}><Text style={styles.platformActionText}>清空</Text></Pressable></View><View style={styles.platformGrid}>{HOTBOARD_PLATFORMS.map((platform) => { const selected = hbPlatformTypes.includes(platform.type); return (<Pressable key={platform.type} style={[styles.platformChip, selected && styles.platformChipSelected]} onPress={() => toggleHotboardPlatform(platform.type)}><Text style={[styles.platformChipLabel, selected && styles.platformChipLabelSelected]}>{platform.label}</Text><Text style={[styles.platformChipType, selected && styles.platformChipTypeSelected]}>{platform.type}</Text></Pressable>); })}</View></>);
      case 'dailyPaperSources':
        return (
          <>
            <Text style={styles.toolModalDescription}>每日日报会读取已启用的 RSS 源，再交给当前聊天 API 生成中文日报。</Text>
            <View style={styles.switchRow}><Text style={styles.label}>使用内置新闻源</Text><Switch value={dailyUseDefaultSources} onValueChange={setDailyUseDefaultSources} trackColor={{ true: colors.primary }} /></View>
            <View style={styles.toolAddPanel}>
              <Text style={styles.sectionTitle}>添加 RSS 来源</Text>
              <TextInput style={styles.input} value={dailySourceName} onChangeText={setDailySourceName} placeholder="来源名称，例如 Reuters" placeholderTextColor={colors.textTertiary} />
              <TextInput style={styles.input} value={dailySourceUrl} onChangeText={setDailySourceUrl} placeholder="https://example.com/rss.xml" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
              <View style={styles.toolNumberRow}>
                <View style={styles.toolNumberField}><Text style={styles.label}>分类</Text><TextInput style={styles.input} value={dailySourceCategory} onChangeText={setDailySourceCategory} placeholder="technology" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
                <View style={styles.toolNumberField}><Text style={styles.label}>语言</Text><TextInput style={styles.input} value={dailySourceLanguage} onChangeText={setDailySourceLanguage} placeholder="zh" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
              </View>
              <Pressable style={styles.addPathButton} onPress={handleAddDailySource}><Text style={styles.addPathButtonText}>添加来源</Text></Pressable>
            </View>
            {dailyCustomSources.length === 0 ? (
              <Text style={styles.emptyText}>尚未添加自定义 RSS 来源</Text>
            ) : (
              <View style={styles.toolListPreview}>
                {dailyCustomSources.map((source) => (
                  <View key={source.id} style={styles.toolListPreviewItem}>
                    <View style={styles.toolListPreviewText}>
                      <TextInput
                        style={[styles.input, styles.dailySourceInlineInput]}
                        value={source.name}
                        onChangeText={(value) => handleUpdateDailySource(source.id, { name: value })}
                        placeholder="来源名称"
                        placeholderTextColor={colors.textTertiary}
                      />
                      <TextInput
                        style={[styles.input, styles.dailySourceInlineInput]}
                        value={source.url}
                        onChangeText={(value) => handleUpdateDailySource(source.id, { url: value })}
                        placeholder="RSS URL"
                        placeholderTextColor={colors.textTertiary}
                        autoCapitalize="none"
                      />
                      <View style={styles.toolNumberRow}>
                        <View style={styles.toolNumberField}><TextInput style={[styles.input, styles.dailySourceInlineInput]} value={source.category} onChangeText={(value) => handleUpdateDailySource(source.id, { category: value })} placeholder="分类" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
                        <View style={styles.toolNumberField}><TextInput style={[styles.input, styles.dailySourceInlineInput]} value={source.language} onChangeText={(value) => handleUpdateDailySource(source.id, { language: value })} placeholder="语言" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
                      </View>
                    </View>
                    <View style={styles.mcpResourceSwitches}>
                      <Switch value={source.enabled} onValueChange={(value) => handleUpdateDailySource(source.id, { enabled: value })} trackColor={{ true: colors.primary }} />
                      <Pressable style={styles.removeSmallButton} onPress={() => handleRemoveDailySource(source.id)}><Text style={styles.removeSmallButtonText}>删除</Text></Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        );
      case 'runCommand':
        return (
          <>
            <Text style={styles.toolModalDescription}>AI 会把命令发送到你配置的远程命令服务，由服务器端执行 shell 并返回 stdout/stderr。</Text>
            <View style={styles.switchRow}><Text style={styles.label}>启用远程命令</Text><Switch value={rcEnabled} onValueChange={setRcEnabled} trackColor={{ true: colors.primary }} /></View>
            <View style={styles.field}><Text style={styles.label}>服务地址</Text><TextInput style={styles.input} value={rcEndpointUrl} onChangeText={setRcEndpointUrl} placeholder="https://your-server.example.com/run-command" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>访问令牌</Text><TextInput style={styles.input} value={rcAccessToken} onChangeText={setRcAccessToken} placeholder="Bearer token 或纯 token" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>默认工作目录</Text><TextInput style={styles.input} value={rcDefaultCwd} onChangeText={setRcDefaultCwd} placeholder="/home/ubuntu/app" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
            <View style={styles.toolNumberRow}>
              <View style={styles.toolNumberField}><Text style={styles.label}>超时 ms</Text><TextInput style={styles.input} value={rcTimeoutMs} onChangeText={setRcTimeoutMs} keyboardType="number-pad" placeholder="30000" placeholderTextColor={colors.textTertiary} /></View>
              <View style={styles.toolNumberField}><Text style={styles.label}>输出上限</Text><TextInput style={styles.input} value={rcMaxOutputChars} onChangeText={setRcMaxOutputChars} keyboardType="number-pad" placeholder="12000" placeholderTextColor={colors.textTertiary} /></View>
            </View>
            <View style={styles.field}><Text style={styles.label}>每轮最大调用次数</Text><TextInput style={styles.input} value={rcMaxCalls} onChangeText={setRcMaxCalls} keyboardType="number-pad" placeholder="4" placeholderTextColor={colors.textTertiary} /></View>
            <Text style={styles.hint}>服务需接受 POST JSON：command、cwd、timeout_ms；建议只允许 HTTPS、强 Token、服务器侧目录/命令白名单。</Text>
            <Pressable style={styles.testButton} onPress={handleTestRunCommand} disabled={rcTesting}>{rcTesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}</Pressable>
          </>
        );
      case 'qqBot':
        const visibleConversations = getVisibleBotPanelConversations();
        return (
          <>
            <Text style={styles.toolModalDescription}>手机端保存控制配置，QQ 和微信长连接都由桌面或云端后端服务负责。</Text>
            <View style={styles.field}>
              <Text style={styles.label}>后端服务地址</Text>
              <TextInput style={styles.input} value={qqBackendUrl} onChangeText={setQqBackendUrl} placeholder="http://127.0.0.1:8788" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>控制台令牌</Text>
              <TextInput style={styles.input} value={qqControlToken} onChangeText={setQqControlToken} placeholder="后台 ADMIN_TOKEN" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>OpenAI 兼容 Base URL</Text>
              <TextInput style={styles.input} value={qqOpenAiBaseUrl} onChangeText={setQqOpenAiBaseUrl} placeholder="https://api.openai.com/v1" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>OpenAI 兼容 API Key</Text>
              <TextInput style={styles.input} value={qqOpenAiApiKey} onChangeText={setQqOpenAiApiKey} placeholder="sk-..." placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>模型</Text>
              <TextInput style={styles.input} value={qqModel} onChangeText={setQqModel} placeholder="gpt-4.1-mini" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
            </View>
            <View style={styles.toolNumberRow}>
              <View style={styles.toolNumberField}><Text style={styles.label}>Temperature</Text><TextInput style={styles.input} value={qqTemperature} onChangeText={setQqTemperature} keyboardType="decimal-pad" placeholder="0.7" placeholderTextColor={colors.textTertiary} /></View>
              <View style={styles.toolNumberField}><Text style={styles.label}>最大输出</Text><TextInput style={styles.input} value={qqMaxOutputTokens} onChangeText={setQqMaxOutputTokens} keyboardType="number-pad" placeholder="1200" placeholderTextColor={colors.textTertiary} /></View>
            </View>
            <View style={styles.field}><Text style={styles.label}>历史消息条数</Text><TextInput style={styles.input} value={qqHistoryLimit} onChangeText={setQqHistoryLimit} keyboardType="number-pad" placeholder="16" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>合并连续消息</Text>
                <Text style={styles.hint}>同一会话内连续发来的消息会先等待并合并，窗口结束后只回复一次。</Text>
              </View>
              <Switch value={qqMessageBatchEnabled} onValueChange={setQqMessageBatchEnabled} trackColor={{ true: colors.primary }} />
            </View>
            <View style={styles.field}><Text style={styles.label}>合并等待秒数</Text><TextInput style={styles.input} value={qqMessageBatchWindowSeconds} onChangeText={setQqMessageBatchWindowSeconds} keyboardType="decimal-pad" placeholder="6" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用表情包</Text>
                <Text style={styles.hint}>同步 AI 表情包到后端，模型可用 &lt;sticker&gt;名称&lt;/sticker&gt; 发送图片表情。当前 {getQqStickerCount()} 个。</Text>
              </View>
              <Switch value={qqStickersEnabled} onValueChange={setQqStickersEnabled} trackColor={{ true: colors.primary }} />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用记忆库工具</Text>
                <Text style={styles.hint}>由后端直接调用云端记忆库，逻辑与主聊天一致。</Text>
              </View>
              <Switch value={qqMemoryVaultEnabled} onValueChange={setQqMemoryVaultEnabled} trackColor={{ true: colors.primary }} />
            </View>
            <View style={styles.field}><Text style={styles.label}>记忆库地址</Text><TextInput style={styles.input} value={qqMemoryVaultBaseUrl} onChangeText={setQqMemoryVaultBaseUrl} placeholder="https://your-memory-vault.com" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
            <View style={styles.toolNumberRow}>
              <View style={styles.toolNumberField}><Text style={styles.label}>返回条数</Text><TextInput style={styles.input} value={qqMemoryVaultTopK} onChangeText={setQqMemoryVaultTopK} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} /></View>
              <View style={styles.toolNumberField}><Text style={styles.label}>令牌预算</Text><TextInput style={styles.input} value={qqMemoryVaultTokenBudget} onChangeText={setQqMemoryVaultTokenBudget} keyboardType="number-pad" placeholder="2000" placeholderTextColor={colors.textTertiary} /></View>
            </View>
            <View style={styles.field}><Text style={styles.label}>每轮最大记忆库调用次数</Text><TextInput style={styles.input} value={qqMemoryVaultMaxToolCalls} onChangeText={setQqMemoryVaultMaxToolCalls} keyboardType="number-pad" placeholder="3" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用联网搜索</Text>
                <Text style={styles.hint}>由后端通过 Tavily 搜索实时信息。</Text>
              </View>
              <Switch value={qqWebSearchEnabled} onValueChange={setQqWebSearchEnabled} trackColor={{ true: colors.primary }} />
            </View>
            <View style={styles.field}><Text style={styles.label}>Tavily 密钥</Text><TextInput style={styles.input} value={qqTavilyApiKey} onChangeText={setQqTavilyApiKey} placeholder="tvly-..." placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>搜索结果数量</Text><TextInput style={styles.input} value={qqWebSearchMaxResults} onChangeText={setQqWebSearchMaxResults} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用自定义 MCP 工具</Text>
                <Text style={styles.hint}>{getQqMcpEnabledServerCount()} 个服务 · {getQqMcpEnabledToolCount()} 个工具。仅支持 Zeabur 后端可访问的 HTTP MCP。</Text>
              </View>
              <Switch value={qqMcpEnabled} onValueChange={setQqMcpEnabled} trackColor={{ true: colors.primary }} />
            </View>
            <View style={styles.field}><Text style={styles.label}>每轮最大 MCP 调用次数</Text><TextInput style={styles.input} value={qqMcpMaxToolCalls} onChangeText={setQqMcpMaxToolCalls} keyboardType="number-pad" placeholder="6" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.platformActions}>
              <Pressable style={styles.platformActionButton} onPress={handleImportMainChatMcpConfig}>
                <Text style={styles.platformActionText}>导入主聊天 MCP 工具</Text>
              </Pressable>
            </View>
            <View style={styles.platformActions}>
              <Pressable style={[styles.platformActionButton, botPanelTab === 'qq' && styles.platformChipSelected]} onPress={() => setBotPanelTab('qq')}>
                <Text style={styles.platformActionText}>QQ</Text>
              </Pressable>
              <Pressable style={[styles.platformActionButton, botPanelTab === 'wechat' && styles.platformChipSelected]} onPress={() => setBotPanelTab('wechat')}>
                <Text style={styles.platformActionText}>微信</Text>
              </Pressable>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{getBotPanelPlatformLabel()} 会话管理</Text>
              <Text style={styles.hint}>{qqContextStatus}</Text>
              <View style={styles.platformActions}>
                <Pressable style={[styles.platformActionButton, qqContextRefreshing && styles.importButtonDisabled]} onPress={handleRefreshQqBotContexts} disabled={qqContextRefreshing}>
                  <Text style={styles.platformActionText}>{qqContextRefreshing ? '刷新中' : '刷新上下文'}</Text>
                </Pressable>
                <Pressable style={[styles.platformActionButton, qqContextClearing && styles.importButtonDisabled]} onPress={handleClearQqBotContexts} disabled={qqContextClearing}>
                  <Text style={styles.platformActionText}>{qqContextClearing ? '清空中' : '清空全部上下文'}</Text>
                </Pressable>
              </View>
              {visibleConversations.length > 0 && (
                <View style={styles.toolListPreview}>
                  {visibleConversations.map((conversation) => (
                    <Pressable
                      key={conversation.key}
                      style={styles.toolListPreviewItem}
                      onPress={() => handleOpenQqConversation(conversation.key)}
                    >
                      <View style={styles.toolListPreviewText}>
                        <Text style={styles.toolListPreviewName} numberOfLines={1}>{conversation.key}</Text>
                        <Text style={styles.toolListPreviewDescription} numberOfLines={2}>{conversation.preview || '暂无预览'}</Text>
                        <Text style={styles.toolListPreviewStatus}>{conversation.messageCount} 条消息 · {conversation.lastRole || 'unknown'} · 点按查看</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            {botPanelTab === 'qq' ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>QQ System Prompt</Text>
                  <TextInput style={[styles.input, styles.multilineInput]} value={qqSystemPrompt} onChangeText={setQqSystemPrompt} multiline textAlignVertical="top" placeholder="QQ 机器人提示词" placeholderTextColor={colors.textTertiary} />
                </View>
                <View style={styles.platformActions}>
                  <Pressable style={styles.platformActionButton} onPress={handleImportMainChatConfig}>
                    <Text style={styles.platformActionText}>导入主聊天配置</Text>
                  </Pressable>
                </View>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.label}>启用语音 TTS</Text>
                    <Text style={styles.hint}>使用 TTS 配置中的 MiniMax 参数；仅 {'<voice>'} 标签内的内容会作为 QQ 语音消息发送。</Text>
                  </View>
                  <Switch value={qqTtsEnabled} onValueChange={setQqTtsEnabled} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.label}>启用 QQ 机器人</Text>
                    <Text style={styles.hint}>{qqBackendStatus}</Text>
                  </View>
                  <Switch value={qqEnabled} onValueChange={setQqEnabled} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>沙箱环境</Text><Text style={styles.hint}>用于 QQ 官方机器人测试环境。</Text></View><Switch value={qqSandbox} onValueChange={setQqSandbox} trackColor={{ true: colors.primary }} /></View>
                <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>后端启动时自动连接</Text><Text style={styles.hint}>保存到后端后，服务重启会按此开关连接 QQ 网关。</Text></View><Switch value={qqAutoConnect} onValueChange={setQqAutoConnect} trackColor={{ true: colors.primary }} /></View>
                <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>允许私聊</Text><Text style={styles.hint}>接收 QQ 用户与机器人的单独对话。</Text></View><Switch value={qqAllowDirectMessages} onValueChange={setQqAllowDirectMessages} trackColor={{ true: colors.primary }} /></View>
                <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>允许频道/群提及</Text><Text style={styles.hint}>仅处理平台推送的机器人提及消息。</Text></View><Switch value={qqAllowGuildMentions} onValueChange={setQqAllowGuildMentions} trackColor={{ true: colors.primary }} /></View>
              </>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>微信 System Prompt</Text>
                  <TextInput style={[styles.input, styles.multilineInput]} value={wechatSystemPrompt} onChangeText={setWechatSystemPrompt} multiline textAlignVertical="top" placeholder="微信 ClawBot 提示词" placeholderTextColor={colors.textTertiary} />
                </View>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.label}>启用微信 ClawBot 通道</Text>
                    <Text style={styles.hint}>微信只作为扫码消息通道，回复仍由 YSClaude AgentCore 生成。</Text>
                  </View>
                  <Switch value={wechatEnabled} onValueChange={setWechatEnabled} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.label}>微信后端自动连接</Text>
                    <Text style={styles.hint}>服务重启后自动恢复微信长轮询；需要 Zeabur 持久化卷保留扫码状态。</Text>
                  </View>
                  <Switch value={wechatAutoConnect} onValueChange={setWechatAutoConnect} trackColor={{ true: colors.primary }} />
                </View>
                <View style={styles.field}><Text style={styles.label}>微信账号 ID</Text><TextInput style={styles.input} value={wechatAccountId} onChangeText={setWechatAccountId} placeholder="扫码后自动写入，可留空自动选择" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
                <View style={styles.field}><Text style={styles.label}>微信 API Base URL</Text><TextInput style={styles.input} value={wechatBaseUrl} onChangeText={setWechatBaseUrl} placeholder="默认留空" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
                <View style={styles.platformActions}>
                  <Pressable style={[styles.platformActionButton, wechatBusy && styles.importButtonDisabled]} onPress={() => callWechatControl('login')} disabled={wechatBusy}><Text style={styles.platformActionText}>微信登录</Text></Pressable>
                  <Pressable style={[styles.platformActionButton, wechatBusy && styles.importButtonDisabled]} onPress={() => callWechatControl('start')} disabled={wechatBusy}><Text style={styles.platformActionText}>启动微信</Text></Pressable>
                  <Pressable style={[styles.platformActionButton, wechatBusy && styles.importButtonDisabled]} onPress={() => callWechatControl('stop')} disabled={wechatBusy}><Text style={styles.platformActionText}>停止微信</Text></Pressable>
                  <Pressable style={[styles.platformActionButton, wechatBusy && styles.importButtonDisabled]} onPress={() => callWechatControl('logout')} disabled={wechatBusy}><Text style={styles.platformActionText}>退出微信</Text></Pressable>
                </View>
              </>
            )}
            <View style={styles.platformActions}>
              <Pressable style={[styles.platformActionButton, qqBackendTesting && styles.importButtonDisabled]} onPress={handleTestQqBotBackend} disabled={qqBackendTesting}><Text style={styles.platformActionText}>{qqBackendTesting ? '检测中' : '测试后端'}</Text></Pressable>
              <Pressable style={[styles.platformActionButton, qqBackendSyncing && styles.importButtonDisabled]} onPress={handleSyncQqBotBackend} disabled={qqBackendSyncing}><Text style={styles.platformActionText}>{qqBackendSyncing ? '同步中' : '同步到后端'}</Text></Pressable>
            </View>
          </>
        );
      case 'webInteraction':
        return (<><Text style={styles.toolModalDescription}>AI 可以在网页面板中打开、观察、点击和等待。</Text><View style={styles.switchRow}><Text style={styles.label}>启用网页交互</Text><Switch value={wiEnabled} onValueChange={setWiEnabled} trackColor={{ true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>每轮最大操作次数</Text><TextInput style={styles.input} value={wiMaxCalls} onChangeText={setWiMaxCalls} keyboardType="number-pad" placeholder="8" placeholderTextColor={colors.textTertiary} /></View></>);
      case 'shizukuFile':
        return (<><Text style={styles.toolModalDescription}>读写你手动授权的 Shizuku 路径内文件。</Text><View style={styles.switchRow}><Text style={styles.label}>启用 Shizuku 文件</Text><Switch value={shizukuEnabled} onValueChange={setShizukuEnabled} trackColor={{ true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>Shizuku 状态</Text><Text style={styles.hint}>{(() => { if (!shizukuStatus) return '尚未检测'; const status = shizukuStatus as ShizukuStatus; return '运行：' + (status.running ? '是' : '否') + ' | 授权：' + (status.permissionGranted ? '是' : '否') + ((status.uid ?? -1) >= 0 ? ' | uid ' + status.uid : ''); })()}</Text><View style={styles.platformActions}><Pressable style={styles.platformActionButton} onPress={handleCheckShizukuStatus} disabled={shizukuChecking}><Text style={styles.platformActionText}>{shizukuChecking ? '检测中' : '检测状态'}</Text></Pressable><Pressable style={styles.platformActionButton} onPress={handleRequestShizukuPermission} disabled={shizukuChecking}><Text style={styles.platformActionText}>请求授权</Text></Pressable></View></View><View style={styles.field}><Text style={styles.label}>允许访问的路径</Text><TextInput style={styles.input} value={shizukuPathInput} onChangeText={setShizukuPathInput} placeholder="/storage/emulated/0/Android/data/com.tencent.mobileqq" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /><Pressable style={styles.addPathButton} onPress={handleAddShizukuRoot}><Text style={styles.addPathButtonText}>添加路径</Text></Pressable>{shizukuRoots.length === 0 ? <Text style={styles.emptyText}>尚未添加 Shizuku 路径</Text> : shizukuRoots.map((root) => (<View key={root.id} style={styles.fileRootRow}><View style={styles.nativeToolText}><Text style={styles.label}>{root.name}</Text><Text style={styles.hint}>{root.path}</Text></View><Pressable style={styles.removeSmallButton} onPress={() => handleRemoveShizukuRoot(root.id)}><Text style={styles.removeSmallButtonText}>移除</Text></Pressable></View>))}</View></>);
      default: {
        const nativeRow = builtInToolCards.find((tool) => tool.key === toolKey);
        if (!nativeRow) return null;
        return (<><Text style={styles.toolModalDescription}>{nativeRow.intro}</Text><View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>启用 {nativeRow.name}</Text><Text style={styles.hint}>这是设备原生工具，可能需要 Android 系统权限。</Text></View><Switch value={nativeRow.enabled} onValueChange={nativeRow.onValueChange} trackColor={{ true: colors.primary }} /></View></>);
      }
    }
  }

  function renderMcpServerEditor() {
    if (!selectedMcpServer) return null;
    const enabledToolCount = getEnabledMcpToolCount(selectedMcpServer);
    const enabledResourceCount = getEnabledMcpResourceCount(selectedMcpServer);
    const pinnedResourceCount = getPinnedMcpResourceCount(selectedMcpServer);
    return (
      <>
        <Text style={styles.toolModalDescription}>远程 HTTP MCP 服务。同步会读取并缓存 Tools、Resources 和 Prompts。</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.label}>启用此服务</Text>
            <Text style={styles.hint}>
              {enabledToolCount} / {selectedMcpServer.tools.length} 个工具已开启 | {enabledResourceCount} / {(selectedMcpServer.resources || []).length} 个资源可用 | {pinnedResourceCount} 个固定附加
            </Text>
          </View>
          <Switch
            value={selectedMcpServer.enabled}
            onValueChange={(value) => handleUpdateMcpServer(selectedMcpServer.id, { enabled: value })}
            trackColor={{ true: colors.primary }}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>服务名称</Text>
          <TextInput
            style={styles.input}
            value={selectedMcpServer.name}
            onChangeText={(value) => handleUpdateMcpServer(selectedMcpServer.id, { name: value })}
            placeholder="我的 MCP 服务"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>服务地址</Text>
          <TextInput
            style={styles.input}
            value={selectedMcpServer.url}
            onChangeText={(value) => handleUpdateMcpServer(selectedMcpServer.id, { url: value })}
            placeholder="https://example.com/mcp"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>授权信息</Text>
          <TextInput
            style={styles.input}
            value={selectedMcpServer.authorization}
            onChangeText={(value) => handleUpdateMcpServer(selectedMcpServer.id, { authorization: value })}
            placeholder="Bearer 令牌"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            autoCapitalize="none"
          />
        </View>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.label}>允许 AI 主动读取资源</Text>
            <Text style={styles.hint}>开启后会为每个有资源的 MCP 服务提供一个读取资源的通用工具；不会把所有资源全文自动塞进上下文。</Text>
          </View>
          <Switch
            value={mcpResourceToolsEnabled}
            onValueChange={setMcpResourceToolsEnabled}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>
        <Text style={styles.sectionTitle}>Tools</Text>
        <View style={styles.toolListPreview}>
          {selectedMcpServer.tools.length === 0 ? (
            <Text style={styles.emptyText}>尚未同步工具</Text>
          ) : (
            selectedMcpServer.tools.map((tool) => (
              <View key={tool.name} style={styles.toolListPreviewItem}>
                <Pressable
                  style={styles.toolListPreviewText}
                  onPress={() => setSelectedMcpToolRef({ serverId: selectedMcpServer.id, toolName: tool.name })}
                >
                  <Text style={styles.toolListPreviewName}>{tool.title || tool.name}</Text>
                  {!!tool.description && (
                    <Text style={styles.toolListPreviewDescription} numberOfLines={2}>
                      {tool.description}
                    </Text>
                  )}
                  <Text style={styles.toolListPreviewStatus}>查看详情</Text>
                </Pressable>
                <Switch
                  value={tool.enabled !== false}
                  onValueChange={(value) =>
                    handleUpdateMcpServerToolEnabled(selectedMcpServer.id, tool.name, value)
                  }
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            ))
          )}
        </View>
        <Text style={styles.sectionTitle}>Resources</Text>
        <View style={styles.toolListPreview}>
          {(selectedMcpServer.resources || []).length === 0 ? (
            <Text style={styles.emptyText}>尚未同步资源</Text>
          ) : (
            (selectedMcpServer.resources || []).map((resource) => (
              <View key={resource.uri} style={styles.toolListPreviewItem}>
                <Pressable
                  style={styles.toolListPreviewText}
                  onPress={() => setSelectedMcpResourceRef({ serverId: selectedMcpServer.id, uri: resource.uri })}
                >
                  <Text style={styles.toolListPreviewName}>{resource.title || resource.name || resource.uri}</Text>
                  {!!resource.description && (
                    <Text style={styles.toolListPreviewDescription} numberOfLines={2}>
                      {resource.description}
                    </Text>
                  )}
                  <Text style={styles.toolListPreviewDescription} numberOfLines={1}>{resource.uri}</Text>
                  <Text style={styles.toolListPreviewStatus}>查看详情</Text>
                </Pressable>
                <View style={styles.mcpResourceSwitches}>
                  <View style={styles.mcpResourceSwitchRow}>
                    <Text style={styles.mcpResourceSwitchLabel}>可读</Text>
                    <Switch
                      value={resource.enabled !== false}
                      onValueChange={(value) =>
                        handleUpdateMcpServerResource(selectedMcpServer.id, resource.uri, { enabled: value })
                      }
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                  <View style={styles.mcpResourceSwitchRow}>
                    <Text style={styles.mcpResourceSwitchLabel}>固定</Text>
                    <Switch
                      value={resource.pinned === true}
                      onValueChange={(value) =>
                        handleUpdateMcpServerResource(selectedMcpServer.id, resource.uri, { pinned: value })
                      }
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
        {(selectedMcpServer.resourceTemplates || []).length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Resource Templates</Text>
            <View style={styles.toolListPreview}>
              {(selectedMcpServer.resourceTemplates || []).map((template) => (
                <View key={template.uriTemplate} style={styles.toolListPreviewItem}>
                  <View style={styles.toolListPreviewText}>
                    <Text style={styles.toolListPreviewName}>{template.title || template.name || template.uriTemplate}</Text>
                    {!!template.description && (
                      <Text style={styles.toolListPreviewDescription} numberOfLines={2}>
                        {template.description}
                      </Text>
                    )}
                    <Text style={styles.toolListPreviewDescription} numberOfLines={1}>{template.uriTemplate}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
        <Text style={styles.sectionTitle}>Prompts</Text>
        <View style={styles.toolListPreview}>
          {(selectedMcpServer.prompts || []).length === 0 ? (
            <Text style={styles.emptyText}>尚未同步提示词</Text>
          ) : (
            (selectedMcpServer.prompts || []).map((prompt) => (
              <View key={prompt.name} style={styles.toolListPreviewItem}>
                <Pressable
                  style={styles.toolListPreviewText}
                  onPress={() => setSelectedMcpPromptRef({ serverId: selectedMcpServer.id, promptName: prompt.name })}
                >
                  <Text style={styles.toolListPreviewName}>{prompt.title || prompt.name}</Text>
                  {!!prompt.description && (
                    <Text style={styles.toolListPreviewDescription} numberOfLines={2}>
                      {prompt.description}
                    </Text>
                  )}
                  <Text style={styles.toolListPreviewStatus}>查看并应用</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
        <Pressable
          style={styles.testButton}
          onPress={() => handleSyncMcpServer(selectedMcpServer.id)}
          disabled={mcpSyncingServerId === selectedMcpServer.id}
        >
          <Text style={styles.testButtonText}>
            {mcpSyncingServerId === selectedMcpServer.id ? '同步中' : '同步 MCP 能力'}
          </Text>
        </Pressable>
      </>
    );
  }

  return (
    <>
      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.toolGroupHeader} onPress={() => setToolSettingsUiConfig({ builtInToolsExpanded: !builtInToolsExpanded })}><View style={styles.switchText}><Text style={styles.toolGroupTitle}>内置工具</Text><Text style={styles.hint}>点击卡片查看和编辑详情；开关会先更新本页状态，保存后才写入配置。</Text></View><Text style={styles.platformToggleIcon}>{builtInToolsExpanded ? '↑' : '↓'}</Text></Pressable>
        {builtInToolsExpanded && <View style={styles.toolCardGrid}>{builtInToolCards.map((tool) => (<Pressable key={tool.key} style={[styles.toolCard, tool.enabled && styles.toolCardEnabled]} onPress={() => setSelectedBuiltInToolKey(tool.key)}><View style={styles.toolCardTop}><View style={styles.toolCardText}><Text style={styles.toolCardName} numberOfLines={1}>{tool.name}</Text><Text style={styles.toolCardMeta}>{tool.meta}</Text></View><Switch value={tool.enabled} onValueChange={tool.onValueChange} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" /></View><Text style={styles.toolCardIntro} numberOfLines={3}>{tool.intro}</Text><Text style={[styles.toolCardStatus, tool.enabled && styles.toolCardStatusEnabled]}>{tool.enabled ? '已开启' : '已关闭'}</Text></Pressable>))}</View>}
        <Pressable style={styles.toolGroupHeader} onPress={() => setToolSettingsUiConfig({ customMcpExpanded: !customMcpExpanded })}><View style={styles.switchText}><Text style={styles.toolGroupTitle}>自定义 MCP</Text><Text style={styles.hint}>每个远程 MCP 服务都单独用卡片展示，点开后可以同步、编辑或删除。</Text></View><Text style={styles.platformToggleIcon}>{customMcpExpanded ? '↑' : '↓'}</Text></Pressable>
        {customMcpExpanded && <><View style={styles.field}><Text style={styles.label}>每轮最大调用次数</Text><TextInput style={styles.input} value={mcpMaxCalls} onChangeText={setMcpMaxCalls} keyboardType="number-pad" placeholder="6" placeholderTextColor={colors.textTertiary} /></View><View style={styles.toolAddPanel}><Text style={styles.sectionTitle}>添加 MCP 服务</Text><TextInput style={styles.input} value={mcpServerName} onChangeText={setMcpServerName} placeholder="服务名称" placeholderTextColor={colors.textTertiary} /><TextInput style={styles.input} value={mcpServerUrl} onChangeText={setMcpServerUrl} placeholder="https://example.com/mcp" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /><TextInput style={styles.input} value={mcpServerAuth} onChangeText={setMcpServerAuth} placeholder="授权信息，可选" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /><Pressable style={styles.addPathButton} onPress={handleAddMcpServer}><Text style={styles.addPathButtonText}>添加服务</Text></Pressable></View>{mcpServers.length === 0 ? <Text style={styles.emptyText}>尚未添加 MCP 服务</Text> : <View style={styles.toolCardGrid}>{mcpServers.map((server) => (<Pressable key={server.id} style={[styles.toolCard, server.enabled && styles.toolCardEnabled]} onPress={() => setSelectedMcpServerId(server.id)}><View style={styles.toolCardTop}><View style={styles.toolCardText}><Text style={styles.toolCardName} numberOfLines={1}>{server.name}</Text><Text style={styles.toolCardMeta}>工具 {getEnabledMcpToolCount(server)}/{server.tools.length} · 资源 {getEnabledMcpResourceCount(server)}/{(server.resources || []).length} · 提示词 {(server.prompts || []).length}</Text></View><Switch value={server.enabled} onValueChange={(value) => handleUpdateMcpServer(server.id, { enabled: value })} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#FFFFFF" /></View><Text style={styles.toolCardIntro} numberOfLines={2}>{server.url}</Text><Text style={[styles.toolCardStatus, server.enabled && styles.toolCardStatusEnabled]}>{server.enabled ? '已开启' : '已关闭'}</Text></Pressable>))}</View>}<View style={styles.actions}><Pressable style={styles.saveButton} onPress={handleSaveMcpTools}><Text style={styles.saveButtonText}>保存 MCP 能力</Text></Pressable></View></>}
      </ScrollView>
      <Modal visible={!!selectedBuiltInTool} transparent animationType="fade" onRequestClose={() => setSelectedBuiltInToolKey(null)}><View style={styles.overlay}><View style={[styles.modal, styles.toolModal]}><View style={styles.toolModalHeader}><View style={styles.switchText}><Text style={styles.modalTitle}>{selectedBuiltInTool?.name || '工具'}</Text>{!!selectedBuiltInTool && <Text style={styles.hint}>{selectedBuiltInTool.meta}</Text>}</View><Pressable style={styles.modalCancel} onPress={() => setSelectedBuiltInToolKey(null)}><Text style={styles.modalCancelText}>关闭</Text></Pressable></View><ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled">{!!selectedBuiltInTool && renderBuiltInToolEditor(selectedBuiltInTool.key)}</ScrollView>{!!selectedBuiltInTool && <View style={styles.toolModalActions}><Pressable style={styles.removeSmallButton} onPress={() => handleDisableBuiltInTool(selectedBuiltInTool.key)}><Text style={styles.removeSmallButtonText}>删除/关闭</Text></Pressable><Pressable style={styles.modalConfirm} onPress={() => { const saved = handleSaveBuiltInTool(selectedBuiltInTool.key); if (saved !== false) setSelectedBuiltInToolKey(null); }}><Text style={styles.modalConfirmText}>保存</Text></Pressable></View>}</View></View></Modal>
      <Modal visible={!!qqSelectedConversationKey} transparent animationType="fade" onRequestClose={() => setQqSelectedConversationKey(null)}><View style={styles.overlay}><View style={[styles.modal, styles.toolModal]}><View style={styles.toolModalHeader}><View style={styles.switchText}><Text style={styles.modalTitle}>{getConversationPlatformLabel(qqSelectedConversationKey)} 上下文</Text><Text style={styles.hint}>{qqSelectedConversationMessageCount} 条消息 · 第 {qqSelectedConversationPage}/{qqSelectedConversationTotalPages} 页</Text></View><Pressable style={styles.modalCancel} onPress={() => setQqSelectedConversationKey(null)}><Text style={styles.modalCancelText}>关闭</Text></Pressable></View><ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled"><Text style={styles.label}>会话</Text><Text selectable style={styles.toolDetailText}>{qqSelectedConversationKey || ''}</Text><View style={styles.platformActions}><Pressable style={[styles.platformActionButton, (qqConversationLoading || qqSelectedConversationPage <= 1) && styles.importButtonDisabled]} onPress={() => qqSelectedConversationKey && handleOpenQqConversation(qqSelectedConversationKey, qqSelectedConversationPage - 1)} disabled={qqConversationLoading || qqSelectedConversationPage <= 1}><Text style={styles.platformActionText}>上一页</Text></Pressable><Pressable style={[styles.platformActionButton, (qqConversationLoading || qqSelectedConversationPage >= qqSelectedConversationTotalPages) && styles.importButtonDisabled]} onPress={() => qqSelectedConversationKey && handleOpenQqConversation(qqSelectedConversationKey, qqSelectedConversationPage + 1)} disabled={qqConversationLoading || qqSelectedConversationPage >= qqSelectedConversationTotalPages}><Text style={styles.platformActionText}>下一页</Text></Pressable></View><View style={styles.platformActions}><Pressable style={[styles.platformActionButton, (qqMessageDeleting || qqSelectedMessageIndexes.length === 0) && styles.importButtonDisabled]} onPress={handleDeleteSelectedQqMessages} disabled={qqMessageDeleting || qqSelectedMessageIndexes.length === 0}><Text style={styles.platformActionText}>{qqMessageDeleting ? '删除中' : `删除选中 ${qqSelectedMessageIndexes.length} 条`}</Text></Pressable><Pressable style={[styles.platformActionButton, qqMessageDeleting && styles.importButtonDisabled]} onPress={handleClearSelectedQqConversation} disabled={qqMessageDeleting}><Text style={styles.platformActionText}>清除此会话</Text></Pressable></View>{qqConversationLoading ? (<ActivityIndicator size="small" color={colors.primary} />) : qqSelectedConversationMessages.length === 0 ? (<Text style={styles.emptyText}>该页没有可管理的消息</Text>) : (<View style={styles.toolListPreview}>{qqSelectedConversationMessages.map((message) => { const selected = qqSelectedMessageIndexes.includes(message.index); return (<Pressable key={`${qqSelectedConversationKey}-${message.index}`} style={[styles.toolListPreviewItem, selected && styles.toolCardEnabled]} onPress={() => toggleQqMessageIndex(message.index)}><View style={styles.toolListPreviewText}><Text style={styles.toolListPreviewName}>#{message.index} · {message.role || 'unknown'}</Text><Text selectable style={styles.toolListPreviewDescription}>{message.content || message.preview || '空消息'}</Text><Text style={styles.toolListPreviewStatus}>{selected ? '已选中' : '点按选择'}</Text></View></Pressable>); })}</View>)}</ScrollView></View></View></Modal>
      <Modal visible={!!selectedMcpServer} transparent animationType="fade" onRequestClose={() => setSelectedMcpServerId(null)}><View style={styles.overlay}><View style={[styles.modal, styles.toolModal]}><View style={styles.toolModalHeader}><View style={styles.switchText}><Text style={styles.modalTitle}>{selectedMcpServer?.name || 'MCP 服务'}</Text>{!!selectedMcpServer && <Text style={styles.hint}>{selectedMcpServer.url}</Text>}</View><Pressable style={styles.modalCancel} onPress={() => setSelectedMcpServerId(null)}><Text style={styles.modalCancelText}>关闭</Text></Pressable></View><ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled">{renderMcpServerEditor()}</ScrollView>{!!selectedMcpServer && <View style={styles.toolModalActions}><Pressable style={styles.removeSmallButton} onPress={() => handleRemoveMcpServerFromModal(selectedMcpServer.id)}><Text style={styles.removeSmallButtonText}>删除</Text></Pressable><Pressable style={styles.modalConfirm} onPress={() => { handleSaveMcpTools(); setSelectedMcpServerId(null); }}><Text style={styles.modalConfirmText}>保存</Text></Pressable></View>}</View></View></Modal>
      <Modal visible={!!selectedMcpTool} transparent animationType="fade" onRequestClose={() => setSelectedMcpToolRef(null)}><View style={styles.overlay}><View style={[styles.modal, styles.toolModal]}><View style={styles.toolModalHeader}><View style={styles.switchText}><Text style={styles.modalTitle}>{selectedMcpTool?.title || selectedMcpTool?.name || 'MCP 工具'}</Text>{!!selectedMcpToolServer && <Text style={styles.hint}>{selectedMcpToolServer.name}</Text>}</View><Pressable style={styles.modalCancel} onPress={() => setSelectedMcpToolRef(null)}><Text style={styles.modalCancelText}>关闭</Text></Pressable></View>{!!selectedMcpTool && <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled"><Text style={styles.label}>工具名称</Text><Text style={styles.toolDetailText}>{selectedMcpTool.name}</Text><Text style={styles.label}>启用状态</Text><Text style={styles.toolDetailText}>{selectedMcpTool.enabled !== false ? '已开启' : '已关闭'}</Text><Text style={styles.label}>简介</Text><Text style={styles.toolDetailText}>{selectedMcpTool.description || '暂无简介'}</Text><Text style={styles.label}>参数定义</Text><Text selectable style={styles.toolSchemaText}>{formatMcpToolInputSchema(selectedMcpTool)}</Text></ScrollView>}</View></View></Modal>
      <Modal visible={!!selectedMcpResource} transparent animationType="fade" onRequestClose={() => setSelectedMcpResourceRef(null)}><View style={styles.overlay}><View style={[styles.modal, styles.toolModal]}><View style={styles.toolModalHeader}><View style={styles.switchText}><Text style={styles.modalTitle}>{selectedMcpResource?.title || selectedMcpResource?.name || 'MCP 资源'}</Text>{!!selectedMcpResourceServer && <Text style={styles.hint}>{selectedMcpResourceServer.name}</Text>}</View><Pressable style={styles.modalCancel} onPress={() => setSelectedMcpResourceRef(null)}><Text style={styles.modalCancelText}>关闭</Text></Pressable></View>{!!selectedMcpResource && <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled"><Text style={styles.label}>URI</Text><Text selectable style={styles.toolDetailText}>{selectedMcpResource.uri}</Text><Text style={styles.label}>MIME 类型</Text><Text style={styles.toolDetailText}>{selectedMcpResource.mimeType || '未知'}</Text><Text style={styles.label}>状态</Text><Text style={styles.toolDetailText}>{selectedMcpResource.enabled !== false ? '允许读取' : '已关闭'} · {selectedMcpResource.pinned ? '固定附加到上下文' : '不自动附加'}</Text><Text style={styles.label}>简介</Text><Text style={styles.toolDetailText}>{selectedMcpResource.description || '暂无简介'}</Text></ScrollView>}</View></View></Modal>
      <Modal visible={!!selectedMcpPrompt} transparent animationType="fade" onRequestClose={() => setSelectedMcpPromptRef(null)}><View style={styles.overlay}><View style={[styles.modal, styles.toolModal]}><View style={styles.toolModalHeader}><View style={styles.switchText}><Text style={styles.modalTitle}>{selectedMcpPrompt?.title || selectedMcpPrompt?.name || 'MCP 提示词'}</Text>{!!selectedMcpPromptServer && <Text style={styles.hint}>{selectedMcpPromptServer.name}</Text>}</View><Pressable style={styles.modalCancel} onPress={() => setSelectedMcpPromptRef(null)}><Text style={styles.modalCancelText}>关闭</Text></Pressable></View>{!!selectedMcpPrompt && <ScrollView style={styles.toolModalBody} keyboardShouldPersistTaps="handled"><Text style={styles.label}>提示词名称</Text><Text style={styles.toolDetailText}>{selectedMcpPrompt.name}</Text><Text style={styles.label}>简介</Text><Text style={styles.toolDetailText}>{selectedMcpPrompt.description || '暂无简介'}</Text><Text style={styles.label}>参数定义</Text><Text selectable style={styles.toolSchemaText}>{formatMcpPromptArguments(selectedMcpPrompt)}</Text><Text style={styles.label}>调用参数 JSON</Text><TextInput style={[styles.input, styles.multilineInput]} value={mcpPromptArgs} onChangeText={setMcpPromptArgs} multiline textAlignVertical="top" autoCapitalize="none" placeholder="{}" placeholderTextColor={colors.textTertiary} /><Pressable style={[styles.saveButton, mcpPromptApplying && styles.importButtonDisabled]} onPress={handleApplyMcpPrompt} disabled={mcpPromptApplying}><Text style={styles.saveButtonText}>{mcpPromptApplying ? '应用中' : '应用到当前对话'}</Text></Pressable></ScrollView>}</View></View></Modal>
    </>
  );


}

/* ==================== 来信 Tab ==================== */

function IncomingLetterTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const {
    incomingLetterConfig,
    setIncomingLetterConfig,
    addIncomingLetterOccasion,
    updateIncomingLetterOccasion,
    removeIncomingLetterOccasion,
  } = useSettingsStore();
  const occasions = incomingLetterConfig?.occasions || [];
  const [editing, setEditing] = useState<IncomingLetterOccasion | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftRepeatYearly, setDraftRepeatYearly] = useState(true);
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');
  const [generatingOccasionId, setGeneratingOccasionId] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setDraftTitle('');
    setDraftDate(formatDateOnly(Date.now()));
    setDraftRepeatYearly(true);
    setDraftEnabled(true);
    setDraftSystemPrompt('');
    setCreating(true);
  }

  function openEdit(occasion: IncomingLetterOccasion) {
    setEditing(occasion);
    setDraftTitle(occasion.title);
    setDraftDate(occasion.date);
    setDraftRepeatYearly(occasion.repeatYearly);
    setDraftEnabled(occasion.enabled);
    setDraftSystemPrompt(occasion.systemPrompt);
    setCreating(true);
  }

  function closeEditor() {
    setCreating(false);
    setEditing(null);
  }

  function validateDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map((part) => parseInt(part, 10));
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  function handleSaveDraft() {
    const title = draftTitle.trim();
    const date = draftDate.trim();
    if (!title) {
      Alert.alert('提示', '请填写收信日名称');
      return;
    }
    if (!validateDate(date)) {
      Alert.alert('提示', '日期格式应为 YYYY-MM-DD');
      return;
    }

    const now = Date.now();
    if (editing) {
      updateIncomingLetterOccasion(editing.id, {
        title,
        date,
        repeatYearly: draftRepeatYearly,
        enabled: draftEnabled,
        systemPrompt: draftSystemPrompt.trim(),
        updatedAt: now,
      });
      showToast('收信日已更新');
    } else {
      addIncomingLetterOccasion({
        id: randomUUID(),
        title,
        date,
        repeatYearly: draftRepeatYearly,
        enabled: draftEnabled,
        systemPrompt: draftSystemPrompt.trim(),
        createdAt: now,
        updatedAt: now,
      });
      showToast('收信日已添加');
    }
    closeEditor();
  }

  function handleDelete(occasion: IncomingLetterOccasion) {
    Alert.alert('删除收信日', `确定删除「${occasion.title || '收信日'}」？历史信件会保留。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removeIncomingLetterOccasion(occasion.id);
          showToast('收信日已删除');
        },
      },
    ]);
  }

  async function handleGenerateNow(occasion: IncomingLetterOccasion) {
    if (generatingOccasionId) return;
    setGeneratingOccasionId(occasion.id);
    try {
      await generateImmediateIncomingLetter(occasion);
      showToast('测试来信已生成');
      Alert.alert('已生成来信', '回到首页后会弹出这封测试来信。');
    } catch (error: any) {
      Alert.alert('生成失败', error?.message || '无法生成测试来信');
    } finally {
      setGeneratingOccasionId(null);
    }
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.label}>启用来信</Text>
          <Text style={styles.hint}>当天打开 App 或回到前台时，会为命中的收信日生成并保存一封信。</Text>
        </View>
        <Switch
          value={!!incomingLetterConfig?.enabled}
          onValueChange={(value) => {
            setIncomingLetterConfig({ enabled: value });
            showToast(value ? '来信已开启' : '来信已关闭');
          }}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>

      <View style={styles.diaryHeaderRow}>
        <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>自定义收信日</Text>
        <Pressable style={styles.diaryAddButton} onPress={openCreate}>
          <Text style={styles.diaryAddText}>+ 新建</Text>
        </Pressable>
      </View>

      {occasions.length === 0 ? (
        <View style={styles.customStickerEmpty}>
          <Text style={styles.hint}>暂无收信日。可以添加生日、纪念日或任何你想收到信的日子。</Text>
        </View>
      ) : (
        <View style={styles.rangeList}>
          {occasions.map((occasion) => (
            <Pressable
              key={occasion.id}
              style={styles.diaryItem}
              onPress={() => openEdit(occasion)}
            >
              <View style={styles.diaryContent}>
                <Text style={styles.diaryTitle}>{occasion.title || '收信日'}</Text>
                <Text style={styles.diaryPreview} numberOfLines={2}>
                  {occasion.date} · {occasion.repeatYearly ? '每年重复' : '仅此一次'} · {occasion.enabled ? '已开启' : '已关闭'}
                </Text>
                <Text style={styles.diaryDate} numberOfLines={1}>
                  {occasion.systemPrompt ? '已设置专属 System Prompt' : '未设置 System Prompt'}
                </Text>
              </View>
              <Switch
                value={occasion.enabled}
                onValueChange={(enabled) => updateIncomingLetterOccasion(occasion.id, { enabled })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
              <Pressable
                style={[
                  styles.smallActionButton,
                  styles.incomingLetterNowButton,
                  generatingOccasionId === occasion.id && styles.smallActionButtonDisabled,
                ]}
                onPress={() => handleGenerateNow(occasion)}
                disabled={!!generatingOccasionId}
              >
                {generatingOccasionId === occasion.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.smallActionText}>立即来信</Text>
                )}
              </Pressable>
              <Pressable style={styles.deleteButton} onPress={() => handleDelete(occasion)}>
                <Text style={styles.deleteIcon}>×</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={creating} transparent animationType="fade" onRequestClose={closeEditor}>
        <View style={styles.overlay}>
          <View style={[styles.modal, styles.bubbleTextureModal]}>
            <Text style={styles.modalTitle}>{editing ? '编辑收信日' : '新建收信日'}</Text>
            <ScrollView style={styles.bubbleTextureModalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.field}>
                <Text style={styles.label}>名称</Text>
                <TextInput
                  style={styles.input}
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  placeholder="生日 / 纪念日"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>日期</Text>
                <TextInput
                  style={styles.input}
                  value={draftDate}
                  onChangeText={setDraftDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>每年重复</Text>
                <Switch
                  value={draftRepeatYearly}
                  onValueChange={setDraftRepeatYearly}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>启用这个收信日</Text>
                <Switch
                  value={draftEnabled}
                  onValueChange={setDraftEnabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>System Prompt</Text>
                <TextInput
                  style={[styles.input, styles.multilineInput, { minHeight: 180 }]}
                  value={draftSystemPrompt}
                  onChangeText={setDraftSystemPrompt}
                  multiline
                  textAlignVertical="top"
                  placeholder="这里写这个收信日专用的写信规则、语气、长度和输出格式。"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={closeEditor}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveDraft}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
          temperature: config.temperature,
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
  toolGroupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  toolGroupTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  toolCardGrid: {
    gap: 10,
    marginBottom: 16,
  },
  toolCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toolCardEnabled: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  toolCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  toolCardText: {
    flex: 1,
    minWidth: 0,
  },
  toolCardName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  toolCardMeta: {
    marginTop: 3,
    fontSize: 12,
    color: colors.textTertiary,
  },
  toolCardIntro: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  toolCardStatus: {
    marginTop: 10,
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  toolCardStatusEnabled: {
    color: colors.primary,
  },
  toolAddPanel: {
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  toolModal: {
    width: '90%',
    maxHeight: '82%',
  },
  toolModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  toolModalDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  toolModalBody: {
    maxHeight: 480,
  },
  toolModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  toolNumberRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  toolNumberField: {
    flex: 1,
    minWidth: 0,
  },
  toolListPreview: {
    gap: 8,
    marginBottom: 12,
  },
  toolListPreviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toolListPreviewText: {
    flex: 1,
    minWidth: 0,
  },
  toolListPreviewName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  toolListPreviewDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  toolListPreviewStatus: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  mcpResourceSwitches: {
    flexShrink: 0,
    gap: 6,
  },
  mcpResourceSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  mcpResourceSwitchLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  toolDetailText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  toolSchemaText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.text,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
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
  dailySourceInlineInput: {
    minHeight: 38,
    marginBottom: 6,
    paddingVertical: 8,
  },
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
  selectInput: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  selectInputText: { fontSize: 14, color: colors.text },
  selectInputChevron: { fontSize: 16, color: colors.textTertiary },
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
  mcpServerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    maxWidth: 180,
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
  bubbleTextureModal: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 18,
    width: '90%',
    maxHeight: '86%',
  },
  bubbleTextureModalBody: {
    flexShrink: 1,
  },
  bubbleTexturePreviewStage: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  bubbleTexturePreview: {
    overflow: 'hidden',
    backgroundColor: colors.inputBackground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleTextureStretchGuide: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239,68,68,0.10)',
  },
  bubbleTextureContentGuide: {
    position: 'absolute',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: 'rgba(60,120,255,0.10)',
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 28,
    minHeight: 18,
  },
  bubbleTextureContentGuideText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  bubbleTextureModalSection: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
  },
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
  imageFaceReferenceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  imageFaceReferenceHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  imageFaceReferenceEmpty: {
    minHeight: 54,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  imageFaceReferenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  imageFaceReferenceItem: {
    width: '48%',
    minWidth: 142,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 8,
  },
  imageFaceReferenceItemActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  imageFaceReferenceImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  imageFaceReferenceMeta: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  imageFaceReferenceLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  imageFaceReferenceRemove: {
    minHeight: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  imageFaceReferenceRemoveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.danger,
  },
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
    overflow: 'hidden',
  },
  topBarPreviewBackground: {
    ...StyleSheet.absoluteFill,
    opacity: 0.88,
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
  welcomeLogoPreview: {
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
  welcomeLogoImage: {
    width: 42,
    height: 42,
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
  incomingLetterNowButton: {
    minWidth: 84,
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
  deleteButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  deleteIcon: {
    fontSize: 20,
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
