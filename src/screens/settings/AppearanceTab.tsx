import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useSettingsPageColors } from '../../theme/colors';
import {
  type AssistantBubbleAppearanceStyle,
  type ChatInputAppearanceStyle,
  type ChatInputIconKey,
  type MessageAvatarLayout,
  type SideAvatarDisplayMode,
  useSettingsStore,
} from '../../stores/settings';
import { TopBarIcon, TOP_BAR_ICON_ITEMS } from '../../components/TopBarIcon';
import type { TopBarIconKey } from '../../utils/topBarIconTypes';
import { copyFileFromUri } from '../../utils/fileSystem';
import { ClampedNumberInput } from './ClampedNumberInput';
import { createSettingsStyles } from './styles';

type AppearanceTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};
const CUSTOM_TOP_BAR_ICON_MAX_BYTES = 2 * 1024 * 1024;
const CUSTOM_TOP_BAR_ICON_MIN_SIDE = 48;
const CUSTOM_TOP_BAR_ICON_MAX_SIDE = 2048;
const CUSTOM_BACKGROUND_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOM_FONT_MAX_BYTES = 100 * 1024 * 1024;
const CUSTOM_BACKGROUND_MIN_SIDE = 320;
const CUSTOM_BACKGROUND_MAX_SIDE = 6000;
const CHAT_INPUT_ICON_ITEMS: Array<{ key: ChatInputIconKey; label: string }> = [
  { key: 'options', label: '左侧菜单' },
  { key: 'sticker', label: '贴纸' },
  { key: 'sendIdle', label: '发送/回复' },
  { key: 'sendFocused', label: '聚焦发送' },
  { key: 'stop', label: '停止生成' },
];
const MESSAGE_AVATAR_LAYOUT_OPTIONS: Array<{ key: MessageAvatarLayout; label: string }> = [
  { key: 'header', label: '上方信息' },
  { key: 'side', label: '侧边头像' },
];
const SIDE_AVATAR_DISPLAY_OPTIONS: Array<{ key: SideAvatarDisplayMode; label: string }> = [
  { key: 'every', label: '每条消息' },
  { key: 'first', label: '连续首条' },
  { key: 'last', label: '连续末条' },
];
const COLOR_SWATCHES = ['#f1eee7', '#FFFFFF', '#FDE68A', '#BFDBFE', '#FBCFE8', '#DCFCE7', '#2B241D', '#141413'];
function appearanceImageExtension(asset: ImagePicker.ImagePickerAsset): string {
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

  const destination = new File(dir, `${key}-${randomUUID()}${appearanceImageExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

async function copyAppearanceImage(
  asset: ImagePicker.ImagePickerAsset,
  directoryName: string,
  prefix: string
): Promise<string> {
  const dir = new Directory(Paths.document, directoryName);
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, `${prefix}-${randomUUID()}${appearanceImageExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

async function copyGlobalFont(uri: string, extension: string, weight: 'regular' | 'bold'): Promise<string> {
  const dir = new Directory(Paths.document, 'custom-fonts');
  dir.create({ intermediates: true, idempotent: true });
  const destination = new File(dir, `global-${weight}-${randomUUID()}${extension}`);
  await copyFileFromUri(uri, destination);
  return destination.uri;
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

function isHexColor(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value.trim());
}
export function AppearanceTab({ showToast, keyboardBottomInset }: AppearanceTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
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
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [pickingInputIconKey, setPickingInputIconKey] = useState<string | null>(null);
  const [pickingBackground, setPickingBackground] = useState<'chat' | 'input' | 'topBar' | null>(null);
  const [pickingAvatar, setPickingAvatar] = useState<'user' | 'assistant' | null>(null);
  const [pickingFont, setPickingFont] = useState<'regular' | 'bold' | null>(null);
  const [appearanceThemeName, setAppearanceThemeName] = useState('');
  const [appearanceThemesExpanded, setAppearanceThemesExpanded] = useState(false);
  const [userBubbleColorInput, setUserBubbleColorInput] = useState(appearanceConfig?.userBubbleColor || colors.userBubble);
  const [assistantBubbleColorInput, setAssistantBubbleColorInput] = useState(appearanceConfig?.assistantBubbleColor || colors.userBubble);
  const [userTextColorInput, setUserTextColorInput] = useState(appearanceConfig?.userTextColor || colors.text);
  const [assistantTextColorInput, setAssistantTextColorInput] = useState(appearanceConfig?.assistantTextColor || colors.text);
  const [assistantTextStrokeColorInput, setAssistantTextStrokeColorInput] = useState(appearanceConfig?.assistantTextStrokeColor || colors.background);
  const [assistantFooterColorInput, setAssistantFooterColorInput] = useState(appearanceConfig?.assistantFooterColor || colors.conversationMuted);
  const [chatBackgroundColorInput, setChatBackgroundColorInput] = useState(appearanceConfig?.chatBackgroundColor || colors.background);
  const [topBarFadeColorInput, setTopBarFadeColorInput] = useState(appearanceConfig?.topBarFadeColor || colors.background);
  const [inputControlBackgroundColorInput, setInputControlBackgroundColorInput] = useState(appearanceConfig?.inputControlBackgroundColor || colors.inputControlBackground);
  const appearanceThemes = appearanceConfig?.appearanceThemes || [];
  const activeAppearanceThemeId = appearanceConfig?.activeAppearanceThemeId;
  const topBarIconUris = appearanceConfig?.topBarIconUris || {};
  const topBarIconDarkUris = appearanceConfig?.topBarIconDarkUris || {};
  const topBarIconHidden = appearanceConfig?.topBarIconHidden || {};
  const topBarIconsHidden = !!appearanceConfig?.topBarIconsHidden;
  const topBarFadeHidden = !!appearanceConfig?.topBarFadeHidden;
  const topBarBackgroundImageUri = appearanceConfig?.topBarBackgroundImageUri;
  const inputIconUris = appearanceConfig?.inputIconUris || {};
  const inputIconDarkUris = appearanceConfig?.inputIconDarkUris || {};
  const inputStyle = appearanceConfig?.inputStyle === 'compact' ? 'compact' : 'default';
  const inputBorderRadius = appearanceConfig?.inputBorderRadius ?? 20;
  const inputBackgroundTransparent = !!appearanceConfig?.inputBackgroundTransparent;
  const userBubbleTransparent = !!appearanceConfig?.userBubbleTransparent;
  const userBubbleWidthPercent = appearanceConfig?.userBubbleWidthPercent ?? 75;
  const assistantBubbleStyle = appearanceConfig?.assistantBubbleStyle || 'plain';
  const assistantBubbleTransparent = !!appearanceConfig?.assistantBubbleTransparent;
  const assistantBubbleWidthPercent = appearanceConfig?.assistantBubbleWidthPercent ?? 75;
  const messageAvatarsVisible = !!appearanceConfig?.messageAvatarsVisible;
  const messageAvatarLayout: MessageAvatarLayout = appearanceConfig?.messageAvatarLayout === 'side' ? 'side' : 'header';
  const sideAvatarDisplayMode: SideAvatarDisplayMode =
    appearanceConfig?.sideAvatarDisplayMode === 'first' || appearanceConfig?.sideAvatarDisplayMode === 'last'
      ? appearanceConfig.sideAvatarDisplayMode
      : 'every';
  const hideUserSideAvatar = !!appearanceConfig?.hideUserSideAvatar;
  const messageMetaVisible = appearanceConfig?.messageMetaVisible ?? true;
  const userAvatarImageUri = appearanceConfig?.userAvatarImageUri;
  const assistantAvatarImageUri = appearanceConfig?.assistantAvatarImageUri;
  const messageAvatarRadius = appearanceConfig?.messageAvatarRadius ?? 18;
  const userDisplayName = appearanceConfig?.userDisplayName ?? 'You';
  const assistantDisplayName = appearanceConfig?.assistantDisplayName ?? 'Claude';
  const assistantFooterHidden = !!appearanceConfig?.assistantFooterHidden;
  const assistantActionsHidden = !!appearanceConfig?.assistantActionsHidden;
  const userBubbleRadius = appearanceConfig?.userBubbleRadius ?? 20;
  const assistantBubbleRadius = appearanceConfig?.assistantBubbleRadius ?? 20;
  const userFontSize = appearanceConfig?.userFontSize ?? 16;
  const assistantFontSize = appearanceConfig?.assistantFontSize ?? 16;
  const assistantTextStrokeWidth = appearanceConfig?.assistantTextStrokeWidth ?? 0;

  async function handlePickFont(weight: 'regular' | 'bold') {
    if (pickingFont) return;
    setPickingFont(weight);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['font/ttf', 'font/otf', 'application/x-font-ttf', 'application/x-font-opentype'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const extension = asset.name.toLowerCase().endsWith('.otf')
        ? '.otf'
        : asset.name.toLowerCase().endsWith('.ttf')
          ? '.ttf'
          : '';
      if (!extension) {
        Alert.alert('字体格式不支持', '请选择 .ttf 或 .otf 字体文件');
        return;
      }
      if (asset.size && asset.size > CUSTOM_FONT_MAX_BYTES) {
        Alert.alert('字体文件过大', '字体文件不能超过 100MB');
        return;
      }
      const uri = await copyGlobalFont(asset.uri, extension, weight);
      setAppearanceConfig(weight === 'regular'
        ? { globalFontUri: uri, globalFontName: asset.name }
        : { globalBoldFontUri: uri, globalBoldFontName: asset.name });
      showToast(weight === 'regular' ? '正文字体已应用' : '粗体字体已应用');
    } catch (error: any) {
      Alert.alert('字体上传失败', error?.message || '无法读取所选字体');
    } finally {
      setPickingFont(null);
    }
  }

  function handleClearFont(weight: 'regular' | 'bold') {
    setAppearanceConfig(weight === 'regular'
      ? {
          globalFontUri: undefined,
          globalFontName: undefined,
          globalBoldFontUri: undefined,
          globalBoldFontName: undefined,
        }
      : { globalBoldFontUri: undefined, globalBoldFontName: undefined });
    showToast(weight === 'regular' ? '已恢复系统默认字体' : '粗体将使用正文字体');
  }
  useEffect(() => {
    setUserBubbleColorInput(appearanceConfig?.userBubbleColor || colors.userBubble);
    setAssistantBubbleColorInput(appearanceConfig?.assistantBubbleColor || colors.userBubble);
    setUserTextColorInput(appearanceConfig?.userTextColor || colors.text);
    setAssistantTextColorInput(appearanceConfig?.assistantTextColor || colors.text);
    setAssistantTextStrokeColorInput(appearanceConfig?.assistantTextStrokeColor || colors.background);
    setAssistantFooterColorInput(appearanceConfig?.assistantFooterColor || colors.conversationMuted);
    setChatBackgroundColorInput(appearanceConfig?.chatBackgroundColor || colors.background);
    setTopBarFadeColorInput(appearanceConfig?.topBarFadeColor || colors.background);
    setInputControlBackgroundColorInput(appearanceConfig?.inputControlBackgroundColor || colors.inputControlBackground);
  }, [
    appearanceConfig?.assistantFooterColor,
    appearanceConfig?.assistantBubbleColor,
    appearanceConfig?.assistantTextStrokeColor,
    appearanceConfig?.assistantTextColor,
    appearanceConfig?.userBubbleColor,
    appearanceConfig?.userTextColor,
    appearanceConfig?.chatBackgroundColor,
    appearanceConfig?.topBarFadeColor,
    appearanceConfig?.inputControlBackgroundColor,
  ]);

  async function handlePickIcon(key: TopBarIconKey, variant: 'light' | 'dark') {
    if (pickingKey) return;
    setPickingKey(`${key}-${variant}`);
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
      setTopBarIconUri(key, uri, variant);
      showToast(`${variant === 'light' ? '日间' : '夜间'}顶栏图标已更新`);
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

  async function handlePickInputIcon(key: ChatInputIconKey, variant: 'light' | 'dark') {
    if (pickingInputIconKey) return;
    setPickingInputIconKey(`${key}-${variant}`);
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
      setChatInputIconUri(key, uri, variant);
      showToast(`${variant === 'light' ? '日间' : '夜间'}输入框图标已更新`);
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
      | 'chatBackgroundColor'
      | 'topBarFadeColor'
      | 'inputControlBackgroundColor'
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
      '恢复当前美化默认',
      '这只会将当前聊天页美化恢复到原始默认，已保存的美化主题会保留。确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '恢复默认',
          style: 'destructive',
          onPress: () => {
            resetAppearanceConfig();
            setAppearanceThemeName('');
            showToast('当前美化已恢复默认');
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
      <Text style={styles.sectionTitle}>全局字体</Text>
      <Text style={styles.hint}>
        可分别上传正文和粗体 TTF/OTF 文件。未上传粗体时，加粗文字使用正文字体且不叠加 700，避免回退为系统字体。输入框保持系统字体。
      </Text>
      <View style={styles.field}>
        <Text style={styles.label}>正文字体（Regular）</Text>
        <Text style={styles.hint} numberOfLines={1}>
          {appearanceConfig?.globalFontName || '系统默认字体'}
        </Text>
        <View style={styles.platformActions}>
          <Pressable
            style={styles.platformActionButton}
            onPress={() => handlePickFont('regular')}
            disabled={!!pickingFont}
          >
            <Text style={styles.platformActionText}>
              {pickingFont === 'regular' ? '正在读取…' : appearanceConfig?.globalFontUri ? '更换字体' : '上传字体'}
            </Text>
          </Pressable>
          {!!appearanceConfig?.globalFontUri && (
            <Pressable style={styles.platformActionButton} onPress={() => handleClearFont('regular')}>
              <Text style={styles.platformActionText}>恢复默认</Text>
            </Pressable>
          )}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>粗体字体（Bold）</Text>
        <Text style={styles.hint} numberOfLines={1}>
          {appearanceConfig?.globalBoldFontName || (appearanceConfig?.globalFontUri ? '沿用正文字体（不叠加 700）' : '请先上传正文字体')}
        </Text>
        <View style={styles.platformActions}>
          <Pressable
            style={styles.platformActionButton}
            onPress={() => handlePickFont('bold')}
            disabled={!!pickingFont || !appearanceConfig?.globalFontUri}
          >
            <Text style={styles.platformActionText}>
              {pickingFont === 'bold' ? '正在读取…' : appearanceConfig?.globalBoldFontUri ? '更换粗体' : '上传粗体'}
            </Text>
          </Pressable>
          {!!appearanceConfig?.globalBoldFontUri && (
            <Pressable style={styles.platformActionButton} onPress={() => handleClearFont('bold')}>
              <Text style={styles.platformActionText}>移除粗体</Text>
            </Pressable>
          )}
        </View>
      </View>

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
        <Text style={styles.appearanceClearText}>一键恢复当前美化默认</Text>
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
            {!topBarIconsHidden && !topBarIconHidden[item.key] && (
              <TopBarIcon
                iconKey={item.key}
                color={colors.text}
                customUri={topBarIconUris[item.key]}
                darkCustomUri={topBarIconDarkUris[item.key]}
                size={22}
              />
            )}
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
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
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
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>顶栏遮罩层颜色</Text>
        <Text style={styles.hint}>调整顶栏由实到透明的渐隐颜色。</Text>
        <TextInput
          style={styles.input}
          value={topBarFadeColorInput}
          onChangeText={setTopBarFadeColorInput}
          onBlur={() => commitColor('顶栏遮罩层颜色', topBarFadeColorInput, 'topBarFadeColor')}
          autoCapitalize="characters"
          placeholder="#FFFFFF"
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      {TOP_BAR_ICON_ITEMS.map((item) => {
        const customUri = topBarIconUris[item.key];
        const darkCustomUri = topBarIconDarkUris[item.key];
        const isVisible = !topBarIconHidden[item.key];
        const isPickingLight = pickingKey === `${item.key}-light`;
        const isPickingDark = pickingKey === `${item.key}-dark`;
        return (
          <View key={item.key} style={styles.appearanceIconRow}>
            <View style={styles.appearanceIconPreview}>
              <TopBarIcon
                iconKey={item.key}
                color={colors.text}
                customUri={customUri}
                darkCustomUri={darkCustomUri}
                size={24}
              />
            </View>
            <View style={styles.appearanceIconText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.hint}>
                {isVisible ? (customUri || darkCustomUri ? `日间${customUri ? '✓' : '自动反色'} · 夜间${darkCustomUri ? '✓' : '自动反色'}` : '显示 · 默认 SVG 图标') : '已单独隐藏'}
              </Text>
            </View>
            <Switch
              value={isVisible}
              onValueChange={(value) => {
                setAppearanceConfig({
                  topBarIconHidden: {
                    ...topBarIconHidden,
                    [item.key]: !value,
                  },
                });
                showToast(value ? `${item.label}图标已显示` : `${item.label}图标已隐藏`);
              }}
              trackColor={{ false: colors.inputBorder, true: colors.primary }}
            />
            <View style={styles.appearanceIconActions}>
              <Pressable
                style={[styles.smallActionButton, isPickingLight && styles.smallActionButtonDisabled]}
                onPress={() => handlePickIcon(item.key, 'light')}
                disabled={!!pickingKey}
              >
                {isPickingLight ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.smallActionText}>日间</Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, isPickingDark && styles.smallActionButtonDisabled]}
                onPress={() => handlePickIcon(item.key, 'dark')}
                disabled={!!pickingKey}
              >
                {isPickingDark ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>夜间</Text>}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, !customUri && !darkCustomUri && styles.smallActionButtonDisabled]}
                onPress={() => {
                  clearTopBarIconUri(item.key);
                  showToast('已恢复默认图标');
                }}
                disabled={!customUri && !darkCustomUri}
              >
                <Text style={[styles.smallActionText, !customUri && !darkCustomUri && styles.smallActionTextDisabled]}>
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

      <View style={styles.field}>
        <Text style={styles.label}>聊天页背景颜色</Text>
        <Text style={styles.hint}>未设置聊天页背景图时生效；设置背景图后完整显示图片。</Text>
        <TextInput
          style={styles.input}
          value={chatBackgroundColorInput}
          onChangeText={setChatBackgroundColorInput}
          onBlur={() => commitColor('聊天页背景颜色', chatBackgroundColorInput, 'chatBackgroundColor')}
          autoCapitalize="characters"
          placeholder="#FFFFFF"
          placeholderTextColor={colors.textTertiary}
        />
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
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
        />
      </View>

      {messageAvatarsVisible && (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>头像布局</Text>
            <View style={styles.segmentedRow}>
              {MESSAGE_AVATAR_LAYOUT_OPTIONS.map((item) => (
                <Pressable
                  key={item.key}
                  style={[styles.segmentedButton, messageAvatarLayout === item.key && styles.segmentedButtonActive]}
                  onPress={() => {
                    setAppearanceConfig({ messageAvatarLayout: item.key });
                    showToast(item.key === 'side' ? '头像已改为侧边显示' : '头像已改为上方信息行');
                  }}
                >
                  <Text style={[styles.segmentedText, messageAvatarLayout === item.key && styles.segmentedTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>
              {messageAvatarLayout === 'side'
                ? 'AI 头像显示在左侧，用户头像显示在右侧。'
                : '头像、名字、楼层与时间显示在连续消息组的第一条上方。'}
            </Text>
          </View>
        </>
      )}

      {messageAvatarsVisible && messageAvatarLayout === 'side' && (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>侧边头像显示位置</Text>
            <View style={styles.segmentedRow}>
              {SIDE_AVATAR_DISPLAY_OPTIONS.map((item) => (
                <Pressable
                  key={item.key}
                  style={[styles.segmentedButton, sideAvatarDisplayMode === item.key && styles.segmentedButtonActive]}
                  onPress={() => {
                    setAppearanceConfig({ sideAvatarDisplayMode: item.key });
                    showToast(`侧边头像：${item.label}`);
                  }}
                >
                  <Text style={[styles.segmentedText, sideAvatarDisplayMode === item.key && styles.segmentedTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>连续消息按相同角色且未跨越时间分隔线判断。</Text>
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>只显示 AI 头像</Text>
              <Text style={styles.hint}>隐藏用户头像，可与上方任一显示位置叠加。</Text>
            </View>
            <Switch
              value={hideUserSideAvatar}
              onValueChange={(value) => {
                setAppearanceConfig({ hideUserSideAvatar: value });
                showToast(value ? '已隐藏用户侧边头像' : '已显示用户侧边头像');
              }}
              trackColor={{ false: colors.inputBorder, true: colors.primary }}
            />
          </View>
        </>
      )}

      {messageAvatarsVisible && messageAvatarLayout === 'header' && (
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
            trackColor={{ false: colors.inputBorder, true: colors.primary }}
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
      <Text style={styles.hint}>颜色使用 #RRGGBB 格式。</Text>
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
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
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
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
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
          <Text style={styles.hint}>保留文字，不叠加气泡底色。</Text>
        </View>
        <Switch
          value={userBubbleTransparent}
          onValueChange={(value) => {
            setAppearanceConfig({ userBubbleTransparent: value });
            showToast(value ? '用户气泡已设为透明' : '用户气泡已恢复底色');
          }}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
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
              <Text style={styles.hint}>保留文字，不叠加 AI 气泡底色。</Text>
            </View>
            <Switch
              value={assistantBubbleTransparent}
              onValueChange={(value) => {
                setAppearanceConfig({ assistantBubbleTransparent: value });
                showToast(value ? 'AI 气泡已设为透明' : 'AI 气泡已恢复底色');
              }}
              trackColor={{ false: colors.inputBorder, true: colors.primary }}
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
        {(['default', 'compact'] as ChatInputAppearanceStyle[]).map((styleKey) => (
          <Pressable
            key={styleKey}
            style={[styles.segmentedButton, inputStyle === styleKey && styles.segmentedButtonActive]}
            onPress={() => setInputStyle(styleKey)}
          >
            <Text style={[styles.segmentedText, inputStyle === styleKey && styles.segmentedTextActive]}>
              {styleKey === 'default' ? '默认原版' : '单行'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.appearanceNumberGrid}>
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
          <Text style={styles.hint}>保留输入框内容和背景图，不叠加默认底色。</Text>
        </View>
        <Switch
          value={inputBackgroundTransparent}
          onValueChange={(value) => {
            setAppearanceConfig({ inputBackgroundTransparent: value });
            showToast(value ? '输入框背景已设为透明' : '输入框背景已恢复底色');
          }}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
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

      <View style={styles.field}>
        <Text style={styles.label}>输入框按键底色</Text>
        <Text style={styles.hint}>统一调整加号、模型选择和表情包按键的底色。</Text>
        <TextInput
          style={styles.input}
          value={inputControlBackgroundColorInput}
          onChangeText={setInputControlBackgroundColorInput}
          onBlur={() => commitColor('输入框按键底色', inputControlBackgroundColorInput, 'inputControlBackgroundColor')}
          autoCapitalize="characters"
          placeholder="#F5F5F5"
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      {CHAT_INPUT_ICON_ITEMS.map((item) => {
        const customUri = inputIconUris[item.key];
        const darkCustomUri = inputIconDarkUris[item.key];
        const isPickingLight = pickingInputIconKey === `${item.key}-light`;
        const isPickingDark = pickingInputIconKey === `${item.key}-dark`;
        return (
          <View key={item.key} style={styles.appearanceIconRow}>
            <View style={styles.appearanceIconPreview}>
              {customUri || darkCustomUri ? (
                <Image source={{ uri: customUri || darkCustomUri }} style={[styles.customInputIconPreview, !customUri && { tintColor: colors.text }]} resizeMode="contain" />
              ) : (
                <Text style={styles.appearanceImagePlaceholder}>IC</Text>
              )}
            </View>
            <View style={styles.appearanceIconText}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.hint}>{customUri || darkCustomUri ? `日间${customUri ? '✓' : '自动反色'} · 夜间${darkCustomUri ? '✓' : '自动反色'}` : '使用默认按钮图标'}</Text>
            </View>
            <View style={styles.appearanceIconActions}>
              <Pressable
                style={[styles.smallActionButton, isPickingLight && styles.smallActionButtonDisabled]}
                onPress={() => handlePickInputIcon(item.key, 'light')}
                disabled={!!pickingInputIconKey}
              >
                {isPickingLight ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>日间</Text>}
              </Pressable>
              <Pressable style={[styles.smallActionButton, isPickingDark && styles.smallActionButtonDisabled]} onPress={() => handlePickInputIcon(item.key, 'dark')} disabled={!!pickingInputIconKey}>
                {isPickingDark ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>夜间</Text>}
              </Pressable>
              <Pressable
                style={[styles.smallActionButton, !customUri && !darkCustomUri && styles.smallActionButtonDisabled]}
                onPress={() => {
                  clearChatInputIconUri(item.key);
                  showToast('已恢复默认输入框图标');
                }}
                disabled={!customUri && !darkCustomUri}
              >
                <Text style={[styles.smallActionText, !customUri && !darkCustomUri && styles.smallActionTextDisabled]}>默认</Text>
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

/* ==================== API 配置 Tab ==================== */

