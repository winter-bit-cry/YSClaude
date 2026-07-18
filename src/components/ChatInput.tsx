import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  View,
  TextInput,
  Pressable,
  Text,
  StyleSheet,
  Image,
  Modal,
  ScrollView,
  Dimensions,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Easing,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FolderOpen,
  Globe2,
  Image as ImageIcon,
  MapPin,
  Palette,
  Paperclip,
  Phone,
  Sparkles,
  TerminalSquare,
  Wrench,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Svg, { Rect } from 'react-native-svg';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { lightColors, useThemeColors, type ThemeColors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { TIKTOK_SANS_REGULAR } from '../theme/interfaceFonts';

import { useSettingsStore } from '../stores/settings';
import { useChatStore } from '../stores/chat';
import type { ConversationArtifact, ConversationArtifactVersion, LocationAttachment } from '../types';
import { buildStickerDefinitions, normalizeStickerName, type StickerDefinition } from '../utils/stickers';
import { getAppearanceCssStyle, getAppearancePlaceholderTextColor, parseAppearanceCss } from '../utils/appearanceCss';
import {
  deleteConversationArtifactFile,
  listConversationArtifacts,
  readConversationArtifact,
  replaceConversationArtifactContent,
} from '../services/conversationArtifacts';
import {
  formatMcpPromptResult,
  formatMcpResourceResult,
  getMcpPrompt,
  readMcpResource,
} from '../services/mcpHttpClient';
import { copyFileFromUri } from '../utils/fileSystem';
import { FloatingTerminal } from './FloatingTerminal';
import {
  createCurrentLocationDraft,
  createLocationDraftFromSearchResult,
  finalizeLocationDraft,
  resolveTencentLocationDraft,
  searchLocationDrafts,
  type LocationDraft,
  type LocationSearchResult,
} from '../services/locationShare';


let colors = lightColors;
const KEYBOARD_LIKE_PANEL_MIN_HEIGHT = 286;
const KEYBOARD_LIKE_PANEL_MAX_HEIGHT = 340;
const KEYBOARD_LIKE_PANEL_HEIGHT_RATIO = 0.36;
const OPTION_ACTIONS_PER_PAGE = 8;
const MCP_PANEL_HEIGHT = Math.min(560, Dimensions.get('window').height * 0.68);
const MAX_IMAGE_REFERENCE_COUNT = 16;
const CUSTOM_CSS_MAX_LENGTH = 12000;
const RESPONSE_BUTTON_COLLAPSED_SCALE = 0.56;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const CUSTOM_CSS_PLACEHOLDER = `.user-bubble {
  background-color: rgba(255,255,255,0.72);
  border-radius: 22px;
}

.input-bar {
  border-width: 0;
  border-color: transparent;
  border-radius: 25px;
  box-shadow: 0 0 15px 0 rgba(0,0,0,0.05);
}

.assistant-bubble {
  backdrop-filter: blur(18px);
  background-color: rgba(255,255,255,0.24);
}

.top-bar {
  height: 112px;
}`;
type McpPanelTab = 'tools' | 'resources' | 'prompts';

function formatArtifactKind(kind?: ConversationArtifact['kind']): string {
  switch (kind) {
    case 'markdown':
      return 'Markdown';
    case 'html':
      return 'HTML';
    case 'css':
      return 'CSS';
    case 'javascript':
      return 'JavaScript';
    case 'typescript':
      return 'TypeScript';
    case 'json':
      return 'JSON';
    case 'csv':
      return 'CSV';
    default:
      return 'Text';
  }
}

function formatArtifactSize(size?: number): string {
  if (!Number.isFinite(size)) return '';
  const value = size || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  return `${Math.round(value / 1024 / 102.4) / 10} MB`;
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}

function getStickerSuggestionQuery(value: string): string {
  const trimmed = normalizeStickerName(value);
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] || '';
}

function extensionFromPickedImage(asset: ImagePicker.ImagePickerAsset): string {
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  const name = (asset.fileName || asset.uri || '').toLowerCase().split('?')[0];
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return '.jpg';
  if (name.endsWith('.png')) return '.png';
  if (name.endsWith('.webp')) return '.webp';
  return '.png';
}

async function copyImageGenerationReference(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const dir = new Directory(Paths.document, 'image-generation-references');
  dir.create({ intermediates: true, idempotent: true });
  const destination = new File(dir, `ref-${Date.now().toString(36)}-${randomUUID()}${extensionFromPickedImage(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

function buildLocationMapHtml(key: string, latitude: number, longitude: number): string {
  const safeKey = encodeURIComponent(key);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    .hint {
      position: absolute; left: 50%; top: 12px; transform: translateX(-50%);
      z-index: 20; padding: 7px 12px; border-radius: 999px;
      background: rgba(20, 20, 20, 0.68); color: white;
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: nowrap;
    }
  </style>
  <script charset="utf-8" src="https://map.qq.com/api/js?v=2.exp&key=${safeKey}"></script>
</head>
<body>
  <div id="map"></div>
  <div class="hint">拖动定位点或点击地图调整位置</div>
  <script>
    (function () {
      function post(type, latLng) {
        window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
          type: type,
          latitude: latLng.getLat(),
          longitude: latLng.getLng()
        }));
      }
      function init() {
        var center = new qq.maps.LatLng(${latitude}, ${longitude});
        var map = new qq.maps.Map(document.getElementById('map'), {
          center: center,
          zoom: 16,
          mapTypeControl: false,
          panControl: false,
          zoomControl: true
        });
        var marker = new qq.maps.Marker({
          position: center,
          map: map,
          draggable: true
        });
        qq.maps.event.addListener(marker, 'dragend', function () {
          post('pin_drag_end', marker.getPosition());
        });
        qq.maps.event.addListener(map, 'click', function (event) {
          marker.setPosition(event.latLng);
          map.panTo(event.latLng);
          post('pin_drag_end', event.latLng);
        });
      }
      if (window.qq && qq.maps) init();
      else window.onload = init;
    })();
  </script>
</body>
</html>`;
}

interface Props {
  onSend: (text: string, imageUri?: string, imageGenerationReferenceUris?: string[]) => void | Promise<void>;
  onSendVoice?: (recording: { uri: string; durationMs: number; mimeType?: string }) => void | Promise<void>;
  onTriggerResponse: () => void | Promise<void>;
  onEnableWebCruise?: () => void | Promise<void>;
  onAttachFile?: () => void | Promise<unknown>;
  onSendLocation?: (location: LocationAttachment) => void | Promise<unknown>;
  onStartVoiceCall?: () => void | Promise<void>;
  voiceCallAvailable?: boolean;
  voiceCallActive?: boolean;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  onModelPress?: () => void;
}

export function ChatInput({
  onSend,
  onSendVoice,
  onTriggerResponse,
  onEnableWebCruise,
  onAttachFile,
  onSendLocation,
  onStartVoiceCall,
  voiceCallAvailable = false,
  voiceCallActive = false,
  disabled,
  isStreaming,
  onStop,
  onModelPress,
}: Props) {
  colors = useThemeColors();
  const windowDimensions = useWindowDimensions();
  styles = useMemo(
    () => createStyles(colors, windowDimensions.width, windowDimensions.height),
    [colors, windowDimensions.height, windowDimensions.width]
  );
  const isDarkTheme = colors.background === '#20201e';

  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingImageRefs, setPendingImageRefs] = useState<string[]>([]);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [stickerPickerVisible, setStickerPickerVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [optionsMenuPage, setOptionsMenuPage] = useState(0);
  const [cssEditorVisible, setCssEditorVisible] = useState(false);
  const [cssDraft, setCssDraft] = useState('');
  const [fileManagerVisible, setFileManagerVisible] = useState(false);
  const [fileManagerLoading, setFileManagerLoading] = useState(false);
  const [fileManagerSaving, setFileManagerSaving] = useState(false);
  const [fileManagerDeleting, setFileManagerDeleting] = useState(false);
  const [conversationFiles, setConversationFiles] = useState<ConversationArtifact[]>([]);
  const [selectedFile, setSelectedFile] = useState<ConversationArtifact | null>(null);
  const [selectedFileVersion, setSelectedFileVersion] = useState<ConversationArtifactVersion | null>(null);
  const [fileDraft, setFileDraft] = useState('');
  const [fileDirty, setFileDirty] = useState(false);
  const [mcpPanelVisible, setMcpPanelVisible] = useState(false);
  const [mcpSelectedServerId, setMcpSelectedServerId] = useState<string | null>(null);
  const [mcpTab, setMcpTab] = useState<McpPanelTab>('resources');
  const [mcpPromptArgs, setMcpPromptArgs] = useState<Record<string, string>>({});
  const [mcpBusyKey, setMcpBusyKey] = useState<string | null>(null);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [isSendingLocation, setIsSendingLocation] = useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationPickerLoading, setLocationPickerLoading] = useState(false);
  const [locationPickerMessage, setLocationPickerMessage] = useState('');
  const [locationDraft, setLocationDraft] = useState<LocationDraft | null>(null);
  const [locationMapVersion, setLocationMapVersion] = useState(0);
  const [locationSearchQuery, setLocationSearchQuery] = useState('');
  const [locationSearchResults, setLocationSearchResults] = useState<LocationSearchResult[]>([]);
  const [locationSearchLoading, setLocationSearchLoading] = useState(false);
  const shouldShowFocusedResponse = !isStreaming && isInputFocused && text.trim().length > 0;
  const [displayFocusedResponse, setDisplayFocusedResponse] = useState(shouldShowFocusedResponse);
  const displayFocusedResponseRef = useRef(shouldShowFocusedResponse);
  const responseButtonScale = useRef(new Animated.Value(1)).current;
  const responseAnimationVersionRef = useRef(0);
  const shouldInvertResponseIcon = isDarkTheme && (isStreaming || !displayFocusedResponse);
  const responseTouchStartedRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const voiceRecordingStartedAtRef = useRef(0);
  const voiceLongPressActiveRef = useRef(false);
  const suppressStickerPressAfterVoiceRef = useRef(false);
  const optionsPagerRef = useRef<ScrollView>(null);
  const voiceRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voiceRecorderState = useAudioRecorderState(voiceRecorder, 150);
  const insets = useSafeAreaInsets();
  const conversationId = useChatStore((state) => state.conversationId);
  const {
    apiConfigs,
    activeConfigIndex,
    appearanceConfig,
    stickerConfig,
    mcpToolConfig,
    locationShareConfig,
    setAppearanceConfig,
    setMcpToolConfig,
  } = useSettingsStore();
  const customCssStyles = useMemo(
    () => parseAppearanceCss(appearanceConfig?.customCss),
    [appearanceConfig?.customCss]
  );
  const cssStyle = (...selectors: string[]) => getAppearanceCssStyle(customCssStyles, ...selectors);
  const inputPlaceholderStyle = cssStyle('.input-placeholder', '.chat-input-placeholder');
  const inputPlaceholderTextColor = getAppearancePlaceholderTextColor(inputPlaceholderStyle, colors.conversationMuted);
  const current = apiConfigs[activeConfigIndex];
  const currentModel = current?.name || current?.model || '未配置';
  const locationMapHtml = useMemo(() => {
    if (!locationDraft || !locationShareConfig?.tencentKey?.trim()) return '';
    return buildLocationMapHtml(
      locationShareConfig.tencentKey.trim(),
      locationDraft.mapLatitude ?? locationDraft.latitude,
      locationDraft.mapLongitude ?? locationDraft.longitude
    );
  }, [
    locationDraft?.latitude,
    locationDraft?.longitude,
    locationDraft?.mapLatitude,
    locationDraft?.mapLongitude,
    locationMapVersion,
    locationShareConfig?.tencentKey,
  ]);
  const mcpServers = mcpToolConfig?.servers || [];
  const selectedMcpServer =
    mcpServers.find((server) => server.id === mcpSelectedServerId) ||
    mcpServers.find((server) => server.enabled) ||
    mcpServers[0] ||
    null;
  const userStickers = useMemo(
    () => buildStickerDefinitions(stickerConfig?.userStickers),
    [stickerConfig?.userStickers]
  );
  const stickerSuggestionsEnabled = stickerConfig?.stickerSuggestionsEnabled ?? true;
  const suggestedStickers = useMemo<StickerDefinition[]>(() => {
    if (!stickerSuggestionsEnabled || disabled || isStreaming || stickerPickerVisible || optionsMenuVisible) {
      return [];
    }
    const query = getStickerSuggestionQuery(text);
    if (!query) return [];

    return userStickers
      .filter((sticker) => sticker.name.includes(query))
      .slice(0, 8);
  }, [
    disabled,
    isStreaming,
    optionsMenuVisible,
    stickerPickerVisible,
    stickerSuggestionsEnabled,
    text,
    userStickers,
  ]);

  const inputIconUris = appearanceConfig?.inputIconUris || {};
  const inputStyle = appearanceConfig?.inputStyle === 'compact' ? 'compact' : 'default';
  const inputBackgroundImageUri = appearanceConfig?.inputBackgroundImageUri;
  const inputBackgroundTransparent = !!appearanceConfig?.inputBackgroundTransparent;
  const inputBorderRadius = clampNumber(appearanceConfig?.inputBorderRadius, 25, 0, 36);
  const inputPanelRadius = typeof customCssStyles.inputBar?.borderRadius === 'number'
    ? customCssStyles.inputBar.borderRadius
    : inputBorderRadius;
  const hasCustomInputBoxShadow = customCssStyles.inputBar?.boxShadow !== undefined;
  const isCompactInput = inputStyle === 'compact';
  const hasCustomInputSurface = !!inputBackgroundImageUri || inputBackgroundTransparent;
  const inputPanelBackground = inputBackgroundTransparent
    ? 'transparent'
    : colors.inputBackground;
  const inputOverlayBackground = inputBackgroundTransparent
    ? 'transparent'
    : isDarkTheme
        ? 'rgba(32,32,30,0.08)'
        : 'rgba(255,255,255,0.08)';

  useEffect(() => {
    if (isStreaming) {
      responseAnimationVersionRef.current += 1;
      responseButtonScale.stopAnimation();
      responseButtonScale.setValue(1);
      displayFocusedResponseRef.current = false;
      setDisplayFocusedResponse(false);
      return;
    }
    if (shouldShowFocusedResponse === displayFocusedResponseRef.current) {
      responseButtonScale.stopAnimation();
      Animated.timing(responseButtonScale, {
        toValue: 1,
        duration: 100,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    const animationVersion = responseAnimationVersionRef.current + 1;
    responseAnimationVersionRef.current = animationVersion;
    responseButtonScale.stopAnimation();
    Animated.timing(responseButtonScale, {
      toValue: RESPONSE_BUTTON_COLLAPSED_SCALE,
      duration: 120,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || responseAnimationVersionRef.current !== animationVersion) return;
      displayFocusedResponseRef.current = shouldShowFocusedResponse;
      setDisplayFocusedResponse(shouldShowFocusedResponse);
      Animated.timing(responseButtonScale, {
        toValue: 1,
        duration: 170,
        easing: Easing.out(Easing.back(1.15)),
        useNativeDriver: true,
      }).start();
    });

    return () => {
      responseAnimationVersionRef.current += 1;
      responseButtonScale.stopAnimation();
    };
  }, [
    isStreaming,
    responseButtonScale,
    shouldShowFocusedResponse,
  ]);

  const pickImage = async () => {
    setOptionsMenuVisible(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPendingImage(result.assets[0].uri);
    }
  };

  const pickImageReferences = async () => {
    setOptionsMenuVisible(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMAGE_REFERENCE_COUNT,
        orderedSelection: true,
      });
      if (!result.canceled) {
        const assets = result.assets.slice(0, MAX_IMAGE_REFERENCE_COUNT);
        const uris = await Promise.all(assets.map(copyImageGenerationReference));
        setPendingImageRefs(uris);
      }
    } catch (error: any) {
      Alert.alert('选择生图参考图失败', error?.message || '无法读取所选图片');
    }
  };

  const removeImageReference = (uri: string) => {
    setPendingImageRefs((current) => current.filter((item) => item !== uri));
  };

  const handleEnableWebCruise = async () => {
    if (disabled || isStreaming) return;
    setOptionsMenuVisible(false);
    await onEnableWebCruise?.();
  };

  const handleAttachFile = async () => {
    if (disabled || isStreaming) return;
    setOptionsMenuVisible(false);
    try {
      await onAttachFile?.();
    } catch (error: any) {
      Alert.alert('上传文件失败', error?.message || '无法读取所选文件');
    }
  };

  const handleSendLocation = async () => {
    if (disabled || isStreaming || isSendingLocation) return;
    setOptionsMenuVisible(false);
    Keyboard.dismiss();
    setIsSendingLocation(true);
    setLocationPickerVisible(true);
    setLocationPickerLoading(true);
    setLocationPickerMessage('正在定位...');
    setLocationSearchQuery('');
    setLocationSearchResults([]);
    try {
      const draft = await createCurrentLocationDraft(locationShareConfig);
      setLocationDraft(draft);
      setLocationMapVersion((value) => value + 1);
      setLocationPickerMessage('');
    } catch (error: any) {
      setLocationPickerVisible(false);
      Alert.alert('发送位置失败', error?.message || '无法获取当前位置');
    } finally {
      setLocationPickerLoading(false);
      setIsSendingLocation(false);
    }
  };

  const handleCloseLocationPicker = () => {
    setLocationPickerVisible(false);
    setLocationPickerLoading(false);
    setLocationPickerMessage('');
    setLocationSearchResults([]);
  };

  const handleLocationMapMessage = async (event: WebViewMessageEvent) => {
    let payload: any;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (payload?.type !== 'pin_drag_end') return;
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    setLocationPickerMessage('正在解析位置...');
    try {
      const draft = await resolveTencentLocationDraft(locationShareConfig, latitude, longitude);
      setLocationDraft(draft);
      setLocationPickerMessage('');
    } catch (error: any) {
      setLocationPickerMessage(error?.message || '位置解析失败');
    }
  };

  const handleSearchLocations = async () => {
    const query = locationSearchQuery.trim();
    if (!query || locationSearchLoading) return;
    setLocationSearchLoading(true);
    setLocationPickerMessage('');
    try {
      const results = await searchLocationDrafts(locationShareConfig, query, locationDraft);
      setLocationSearchResults(results);
      if (results.length === 0) {
        setLocationPickerMessage('没有找到相关地点');
      }
    } catch (error: any) {
      setLocationPickerMessage(error?.message || '地点搜索失败');
    } finally {
      setLocationSearchLoading(false);
    }
  };

  const handleSelectLocationSearchResult = async (result: LocationSearchResult) => {
    setLocationSearchLoading(true);
    setLocationPickerMessage('正在定位到搜索结果...');
    try {
      const draft = await createLocationDraftFromSearchResult(locationShareConfig, result);
      setLocationDraft(draft);
      setLocationSearchQuery(result.title);
      setLocationSearchResults([]);
      setLocationMapVersion((value) => value + 1);
      setLocationPickerMessage('');
    } catch (error: any) {
      setLocationPickerMessage(error?.message || '无法选择该地点');
    } finally {
      setLocationSearchLoading(false);
    }
  };

  const handleConfirmLocation = async () => {
    if (!locationDraft || isSendingLocation) return;
    setIsSendingLocation(true);
    try {
      await onSendLocation?.(finalizeLocationDraft(locationDraft));
      handleCloseLocationPicker();
    } catch (error: any) {
      Alert.alert('发送位置失败', error?.message || '无法发送当前位置');
    } finally {
      setIsSendingLocation(false);
    }
  };

  const refreshConversationFiles = async () => {
    if (!conversationId) {
      setConversationFiles([]);
      setSelectedFile(null);
      setSelectedFileVersion(null);
      setFileDraft('');
      setFileDirty(false);
      return;
    }
    setFileManagerLoading(true);
    try {
      const files = await listConversationArtifacts(conversationId);
      setConversationFiles(files);
      if (selectedFile && !files.some((file) => file.id === selectedFile.id)) {
        setSelectedFile(null);
        setSelectedFileVersion(null);
        setFileDraft('');
        setFileDirty(false);
      }
    } catch (error: any) {
      Alert.alert('读取文件失败', error?.message || '无法读取当前对话文件');
    } finally {
      setFileManagerLoading(false);
    }
  };

  const openFileManager = async () => {
    setOptionsMenuVisible(false);
    setFileManagerVisible(true);
    await refreshConversationFiles();
  };

  const closeFileManager = () => {
    if (fileDirty) {
      Alert.alert('关闭文件管理', '当前文件有未保存修改，确定关闭吗？', [
        { text: '取消', style: 'cancel' },
        {
          text: '关闭',
          style: 'destructive',
          onPress: () => setFileManagerVisible(false),
        },
      ]);
      return;
    }
    setFileManagerVisible(false);
  };

  const selectConversationFile = async (file: ConversationArtifact) => {
    const load = async () => {
      if (!conversationId) return;
      setFileManagerLoading(true);
      try {
        const result = await readConversationArtifact(conversationId, file.id);
        setSelectedFile(result.artifact);
        setSelectedFileVersion(result.version);
        setFileDraft(result.version.content);
        setFileDirty(false);
      } catch (error: any) {
        Alert.alert('打开文件失败', error?.message || '无法读取文件内容');
      } finally {
        setFileManagerLoading(false);
      }
    };

    if (fileDirty) {
      Alert.alert('切换文件', '当前文件有未保存修改，切换会丢弃这些修改。', [
        { text: '取消', style: 'cancel' },
        { text: '切换', style: 'destructive', onPress: () => void load() },
      ]);
      return;
    }

    await load();
  };

  const updateFileDraft = (value: string) => {
    setFileDraft(value);
    setFileDirty(value !== (selectedFileVersion?.content || ''));
  };

  const saveSelectedFile = async () => {
    if (!conversationId || !selectedFile) return;
    setFileManagerSaving(true);
    try {
      const version = await replaceConversationArtifactContent({
        conversationId,
        artifactId: selectedFile.id,
        content: fileDraft,
        createdBy: 'user',
      });
      const latest = await readConversationArtifact(conversationId, selectedFile.id);
      setSelectedFile(latest.artifact);
      setSelectedFileVersion(version);
      setFileDraft(version.content);
      setFileDirty(false);
      await refreshConversationFiles();
    } catch (error: any) {
      Alert.alert('保存失败', error?.message || '无法保存文件');
    } finally {
      setFileManagerSaving(false);
    }
  };

  const deleteSelectedFile = () => {
    if (!conversationId || !selectedFile) return;
    const target = selectedFile;
    Alert.alert('删除文件', `确定删除 ${target.name} 及其所有版本吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setFileManagerDeleting(true);
          try {
            await deleteConversationArtifactFile(conversationId, target.id);
            setSelectedFile(null);
            setSelectedFileVersion(null);
            setFileDraft('');
            setFileDirty(false);
            await refreshConversationFiles();
          } catch (error: any) {
            Alert.alert('删除失败', error?.message || '无法删除文件');
          } finally {
            setFileManagerDeleting(false);
          }
        },
      },
    ]);
  };

  const handleOpenMcpPanel = () => {
    setOptionsMenuVisible(false);
    setMcpPanelVisible(true);
    if (!mcpSelectedServerId && selectedMcpServer) {
      setMcpSelectedServerId(selectedMcpServer.id);
    }
  };

  const appendToInput = (content: string) => {
    setText((current) => {
      const prefix = current.trimEnd();
      return prefix ? `${prefix}\n\n${content}` : content;
    });
  };

  const hasEnabledMcpAbility = (servers: typeof mcpServers) =>
    servers.some(
      (server) =>
        server.enabled &&
        (
          (server.tools || []).some((tool) => tool.enabled !== false) ||
          (server.resources || []).some((resource) => resource.enabled !== false && resource.pinned)
        )
    );

  const handleToggleMcpResourcePinned = (serverId: string, uri: string, pinned: boolean) => {
    const nextServers = mcpServers.map((server) => {
      if (server.id !== serverId) return server;
      return {
        ...server,
        resources: (server.resources || []).map((resource) =>
          resource.uri === uri ? { ...resource, pinned } : resource
        ),
        updatedAt: Date.now(),
      };
    });
    setMcpToolConfig({
      servers: nextServers,
      enabled: hasEnabledMcpAbility(nextServers) || !!mcpToolConfig?.resourceToolsEnabled,
    });
  };

  const handleInsertMcpResource = async (
    server: NonNullable<typeof selectedMcpServer>,
    resource: NonNullable<NonNullable<typeof selectedMcpServer>['resources']>[number]
  ) => {
    const busyKey = `resource:${server.id}:${resource.uri}`;
    setMcpBusyKey(busyKey);
    try {
      const result = await readMcpResource(
        { url: server.url, authorization: server.authorization },
        resource.uri
      );
      const content = formatMcpResourceResult(result);
      appendToInput([
        `MCP Resource：${resource.title || resource.name || resource.uri}`,
        `来源：${server.name}`,
        `URI：${resource.uri}`,
        '',
        content,
      ].join('\n'));
      setMcpPanelVisible(false);
    } catch (error: any) {
      Alert.alert('读取失败', error?.message || '无法读取 MCP 资源');
    } finally {
      setMcpBusyKey(null);
    }
  };

  const defaultPromptArgsText = (prompt: NonNullable<NonNullable<typeof selectedMcpServer>['prompts']>[number]) => {
    const args: Record<string, string> = {};
    for (const arg of prompt.arguments || []) {
      if (arg.required) args[arg.name] = '';
    }
    return Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : '{}';
  };

  const handleApplyMcpPrompt = async (
    server: NonNullable<typeof selectedMcpServer>,
    prompt: NonNullable<NonNullable<typeof selectedMcpServer>['prompts']>[number]
  ) => {
    const key = `${server.id}:${prompt.name}`;
    const busyKey = `prompt:${key}`;
    setMcpBusyKey(busyKey);
    try {
      const rawArgs = mcpPromptArgs[key] ?? defaultPromptArgsText(prompt);
      const args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      const result = await getMcpPrompt(
        { url: server.url, authorization: server.authorization },
        prompt.name,
        args
      );
      appendToInput([
        `MCP Prompt：${prompt.title || prompt.name}`,
        `来源：${server.name}`,
        '',
        formatMcpPromptResult(result),
      ].join('\n'));
      setMcpPanelVisible(false);
    } catch (error: any) {
      Alert.alert('应用失败', error?.message || '无法读取 MCP 提示词');
    } finally {
      setMcpBusyKey(null);
    }
  };

  const handleSend = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed && !pendingImage && pendingImageRefs.length === 0) return;
    if (disabled) return;
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    setStickerPickerVisible(false);
    setOptionsMenuVisible(false);
    const submittedImage = pendingImage || undefined;
    const submittedImageRefs = pendingImageRefs.length > 0 ? pendingImageRefs : undefined;
    setText('');
    setPendingImage(null);
    setPendingImageRefs([]);
    try {
      await onSend(trimmed, submittedImage, submittedImageRefs);
    } catch (err) {
      setText(value);
      setPendingImage(submittedImage || null);
      setPendingImageRefs(submittedImageRefs || []);
      throw err;
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const canRecordVoice =
    !!onSendVoice &&
    !disabled &&
    !isStreaming &&
    text.trim().length === 0 &&
    !pendingImage &&
    pendingImageRefs.length === 0 &&
    !sendInFlightRef.current;

  const startVoiceRecording = async () => {
    if (!canRecordVoice || isVoiceRecording) return;
    try {
      setStickerPickerVisible(false);
      setOptionsMenuVisible(false);
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('无法录音', '请先允许麦克风权限');
        return;
      }
      await setIsAudioActiveAsync(true);
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      inputRef.current?.blur();
      Keyboard.dismiss();
      await voiceRecorder.prepareToRecordAsync({
        ...RecordingPresets.HIGH_QUALITY,
        directory: 'document',
      });
      voiceRecordingStartedAtRef.current = Date.now();
      voiceLongPressActiveRef.current = true;
      suppressStickerPressAfterVoiceRef.current = true;
      setIsVoiceRecording(true);
      voiceRecorder.record();
    } catch (error: any) {
      voiceLongPressActiveRef.current = false;
      suppressStickerPressAfterVoiceRef.current = false;
      setIsVoiceRecording(false);
      Alert.alert('录音失败', error?.message || '无法开始录音');
    }
  };

  const stopVoiceRecording = async () => {
    if (!voiceLongPressActiveRef.current && !isVoiceRecording) return;
    voiceLongPressActiveRef.current = false;
    const startedAt = voiceRecordingStartedAtRef.current || Date.now();
    try {
      const statusBeforeStop = voiceRecorder.getStatus();
      if (statusBeforeStop.isRecording) {
        await voiceRecorder.stop();
      }
      const statusAfterStop = voiceRecorder.getStatus();
      const uri = voiceRecorder.uri || statusAfterStop.url;
      const durationMs = Math.max(
        statusAfterStop.durationMillis || voiceRecorderState.durationMillis || 0,
        Date.now() - startedAt
      );
      setIsVoiceRecording(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      if (!uri) {
        Alert.alert('录音失败', '没有生成可用的语音文件');
        return;
      }
      if (durationMs < 500) {
        Alert.alert('录音太短', '请按住稍微说久一点');
        return;
      }
      await onSendVoice?.({ uri, durationMs });
    } catch (error: any) {
      setIsVoiceRecording(false);
      Alert.alert('发送语音失败', error?.message || '无法发送语音');
    } finally {
      setTimeout(() => {
        suppressStickerPressAfterVoiceRef.current = false;
      }, 600);
    }
  };

  const handleStickerButtonPress = () => {
    if (suppressStickerPressAfterVoiceRef.current || isVoiceRecording) {
      suppressStickerPressAfterVoiceRef.current = false;
      return;
    }
    Keyboard.dismiss();
    inputRef.current?.blur();
    setOptionsMenuVisible(false);
    setStickerPickerVisible((visible) => !visible);
  };

  const handleOptionsButtonPress = () => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    setStickerPickerVisible(false);
    setOptionsMenuVisible((visible) => {
      if (!visible) {
        setOptionsMenuPage(0);
      }
      return !visible;
    });
  };

  const handleInputFocus = () => {
    setIsInputFocused(true);
    setStickerPickerVisible(false);
    setOptionsMenuVisible(false);
  };

  const handleChangeText = (next: string) => {
    if (
      next.length === text.length + 1 &&
      next.startsWith(text) &&
      next.endsWith('\n')
    ) {
      void handleSend(text);
      return;
    }
    setText(next);
  };

  const handleGetResponsePressIn = async () => {
    responseTouchStartedRef.current = true;
    if (isStreaming) {
      onStop?.();
      return;
    }
    await onTriggerResponse();
  };

  const handleGetResponsePress = async () => {
    if (responseTouchStartedRef.current) {
      responseTouchStartedRef.current = false;
      return;
    }
    if (isStreaming) {
      onStop?.();
      return;
    }
    await onTriggerResponse();
  };

  const handleSendSticker = async (token: string) => {
    if (disabled || isStreaming) return;
    setStickerPickerVisible(false);
    setOptionsMenuVisible(false);
    setText('');
    setPendingImage(null);
    setPendingImageRefs([]);
    await onSend(token);
  };

  const getResponseIcon = () => {
    if (isStreaming) {
      return inputIconUris.stop ? { uri: inputIconUris.stop } : require('../../assets/stopsend.png');
    }
    if (displayFocusedResponse) {
      return inputIconUris.sendFocused ? { uri: inputIconUris.sendFocused } : require('../../assets/getresponse2.png');
    }
    return inputIconUris.sendIdle ? { uri: inputIconUris.sendIdle } : null;
  };

  const renderResponseIcon = () => {
    const responseIcon = getResponseIcon();
    if (!responseIcon) {
      return (
        <Svg width={20} height={20} viewBox="0 0 21.2 21.2">
          <Rect x={0} y={7.6} width={1.2} height={6} rx={0.6} fill={colors.idleResponseIcon} />
          <Rect x={4} y={5.6} width={1.2} height={10} rx={0.6} fill={colors.idleResponseIcon} />
          <Rect x={8} y={2.6} width={1.2} height={16} rx={0.6} fill={colors.idleResponseIcon} />
          <Rect x={12} y={5.6} width={1.2} height={10} rx={0.6} fill={colors.idleResponseIcon} />
          <Rect x={16} y={2.6} width={1.2} height={16} rx={0.6} fill={colors.idleResponseIcon} />
          <Rect x={20} y={7.6} width={1.2} height={6} rx={0.6} fill={colors.idleResponseIcon} />
        </Svg>
      );
    }
    return (
      <Image
        source={responseIcon}
        style={[
          styles.sendImage,
          displayFocusedResponse && !isStreaming && styles.focusedResponseImage,
          shouldInvertResponseIcon && styles.invertedImageIcon,
        ]}
        resizeMode="contain"
      />
    );
  };

  const responseButtonStateStyle = isStreaming
    ? styles.responseUtilityButton
    : displayFocusedResponse
      ? styles.responseFocusedButton
      : styles.responseIdleButton;

  const handleOpenCssEditor = () => {
    setCssDraft((appearanceConfig?.customCss || '').slice(0, CUSTOM_CSS_MAX_LENGTH));
    setOptionsMenuVisible(false);
    setCssEditorVisible(true);
  };

  const handleSaveCustomCss = () => {
    setAppearanceConfig({ customCss: cssDraft.slice(0, CUSTOM_CSS_MAX_LENGTH) });
    setCssEditorVisible(false);
  };

  const handleClearCustomCss = () => {
    setCssDraft('');
    setAppearanceConfig({ customCss: '' });
  };

  const primaryOptionActions = [
    { key: 'terminal', label: '终端', Icon: TerminalSquare, onPress: () => { setOptionsMenuVisible(false); Keyboard.dismiss(); setTerminalVisible(true); } },
    ...(voiceCallAvailable ? [{
      key: 'voice-call',
      label: voiceCallActive ? '语音通话中' : '语音通话',
      Icon: Phone,
      onPress: () => {
        setOptionsMenuVisible(false);
        void onStartVoiceCall?.();
      },
    }] : []),
    { key: 'mcp', label: 'MCP 管理', Icon: Wrench, onPress: handleOpenMcpPanel },
    { key: 'image', label: '图片', Icon: ImageIcon, onPress: () => void pickImage() },
    { key: 'reference', label: '生图参考图', Icon: Sparkles, onPress: () => void pickImageReferences() },
    { key: 'file', label: '文件', Icon: Paperclip, onPress: () => void handleAttachFile() },
    {
      key: 'location',
      label: isSendingLocation ? '定位中...' : '发送位置',
      Icon: MapPin,
      onPress: () => void handleSendLocation(),
      disabled: isSendingLocation,
    },
    { key: 'manager', label: '文件管理', Icon: FolderOpen, onPress: () => void openFileManager() },
    { key: 'css', label: '自定义 CSS', Icon: Palette, onPress: handleOpenCssEditor },
  ];

  const secondaryOptionActions = [
    { key: 'web', label: 'AI网页巡游', Icon: Globe2, onPress: () => void handleEnableWebCruise() },
  ];
  const optionPages = [
    ...primaryOptionActions,
    ...secondaryOptionActions,
  ].reduce<typeof primaryOptionActions[]>((pages, action, index) => {
    if (index % OPTION_ACTIONS_PER_PAGE === 0) {
      pages.push([]);
    }
    pages[pages.length - 1].push(action);
    return pages;
  }, []);

  const scrollToOptionsPage = (pageIndex: number) => {
    const nextPage = Math.min(Math.max(pageIndex, 0), optionPages.length - 1);
    setOptionsMenuPage(nextPage);
    optionsPagerRef.current?.scrollTo({
      x: nextPage * styles.optionPage.width,
      animated: true,
    });
  };

  const handleOptionsPageMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const pageWidth = styles.optionPage.width || 1;
    const nextPage = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
    setOptionsMenuPage(Math.min(Math.max(nextPage, 0), optionPages.length - 1));
  };

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: Math.max(insets.bottom, 18) },
        cssStyle('.input-wrapper', '.chat-input-wrapper'),
      ]}
    >
      <FloatingTerminal visible={terminalVisible} onClose={() => setTerminalVisible(false)} />
      {suggestedStickers.length > 0 && (
        <View style={styles.suggestionPanel}>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionList}
          >
            {suggestedStickers.map((sticker) => (
              <Pressable
                key={sticker.id}
                style={styles.suggestionItem}
                onPress={() => void handleSendSticker(sticker.token)}
              >
                <Image source={sticker.image} style={styles.suggestionImage} resizeMode="contain" />
                <Text style={styles.suggestionName} numberOfLines={1}>{sticker.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      <View
        style={[
          styles.container,
          { backgroundColor: inputPanelBackground, borderRadius: inputPanelRadius },
          hasCustomInputBoxShadow && { shadowOpacity: 0, elevation: 0 },
          hasCustomInputSurface && styles.customContainer,
          isCompactInput && styles.compactContainer,
          customCssStyles.inputBar,
          cssStyle('.chat-input', '.input-container', '.input-bar'),
        ]}
      >
        {inputBackgroundImageUri && (
          <Image source={{ uri: inputBackgroundImageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
        {hasCustomInputSurface && (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: inputOverlayBackground }]} />
        )}
        {isVoiceRecording && (
          <View style={styles.voiceRecordingBar}>
            <Text style={styles.voiceRecordingText}>正在录音，松手发送</Text>
            <Text style={styles.voiceRecordingTime}>
              {Math.max(1, Math.ceil((voiceRecorderState.durationMillis || 0) / 1000))}s
            </Text>
          </View>
        )}
        {pendingImage && !isCompactInput && (
          <View style={[styles.previewRow, cssStyle('.input-preview-row')]}>
            <View style={[styles.previewWrap, cssStyle('.input-preview')]}>
              <Image source={{ uri: pendingImage }} style={styles.previewImage} resizeMode="cover" />
              <Pressable style={styles.previewClose} onPress={() => setPendingImage(null)}>
                <Text style={styles.previewCloseText}>✕</Text>
              </Pressable>
            </View>
          </View>
        )}
        {pendingImageRefs.length > 0 && !isCompactInput && (
          <View style={[styles.referencePreviewRow, cssStyle('.input-reference-row')]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.referencePreviewList}
            >
              {pendingImageRefs.map((uri, index) => (
                <View key={`${uri}-${index}`} style={[styles.referencePreviewWrap, cssStyle('.input-reference-preview')]}>
                  <Image source={{ uri }} style={styles.referencePreviewImage} resizeMode="cover" />
                  <Pressable style={styles.previewClose} onPress={() => removeImageReference(uri)}>
                    <Text style={styles.previewCloseText}>x</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
        {isCompactInput ? (
          <View style={[styles.compactRow, cssStyle('.input-compact-row')]}>
            <Pressable style={[styles.optionsButton, cssStyle('.options-button')]} onPress={handleOptionsButtonPress}>
              <Image
                source={inputIconUris.options ? { uri: inputIconUris.options } : require('../../assets/optionsbutton.png')}
                style={styles.optionsImage}
                resizeMode="contain"
              />
            </Pressable>
            {pendingImage && (
              <View style={styles.compactPreviewWrap}>
                <Image source={{ uri: pendingImage }} style={styles.compactPreviewImage} resizeMode="cover" />
                <Pressable style={styles.compactPreviewClose} onPress={() => setPendingImage(null)}>
                  <Text style={styles.compactPreviewCloseText}>x</Text>
                </Pressable>
              </View>
            )}
            {pendingImageRefs.length > 0 && (
              <View style={styles.compactReferencePill}>
                <Text style={styles.compactReferenceText}>{pendingImageRefs.length} 参考图</Text>
                <Pressable onPress={() => setPendingImageRefs([])}>
                  <Text style={styles.compactReferenceClear}>x</Text>
                </Pressable>
              </View>
            )}
            <Pressable
              style={styles.compactInputPressZone}
              onPress={() => inputRef.current?.focus()}
            >
              {text.length === 0 && (
                <Text
                  accessible={false}
                  pointerEvents="none"
                  style={[
                    styles.inputPlaceholder,
                    styles.compactInputPlaceholder,
                    { color: inputPlaceholderTextColor },
                  ]}
                >
                  Reply to Claude...
                </Text>
              )}
              <TextInput
                ref={inputRef}
                style={[styles.input, styles.compactInput, customCssStyles.inputText, cssStyle('.input-text')]}
                value={text}
                onChangeText={handleChangeText}
                onSubmitEditing={() => void handleSend(text)}
                accessibilityLabel={text.length === 0 ? 'Reply to Claude...' : undefined}
                multiline={false}
                submitBehavior="submit"
                returnKeyType="send"
                maxLength={10000}
                scrollEnabled={false}
                editable={!disabled && !isVoiceRecording}
                onFocus={handleInputFocus}
                onBlur={() => setIsInputFocused(false)}
              />
            </Pressable>
            <View style={[styles.rightButtons, cssStyle('.input-actions')]}>
              <Pressable
                style={[styles.stickerButton, cssStyle('.sticker-button')]}
                delayLongPress={320}
                disabled={disabled || isStreaming}
                onPress={handleStickerButtonPress}
                onLongPress={() => void startVoiceRecording()}
                onPressOut={() => void stopVoiceRecording()}
              >
                <Image
                  source={inputIconUris.sticker ? { uri: inputIconUris.sticker } : require('../../assets/sticker.png')}
                  style={styles.stickerButtonImage}
                  resizeMode="contain"
                />
              </Pressable>
              <AnimatedPressable
                style={[
                  styles.sendButton,
                  responseButtonStateStyle,
                  styles.responseButtonAnimationAnchor,
                  cssStyle('.send-button'),
                  { transform: [{ scale: responseButtonScale }] },
                ]}
                onPressIn={() => void handleGetResponsePressIn()}
                onPress={() => void handleGetResponsePress()}
              >
                {renderResponseIcon()}
              </AnimatedPressable>
            </View>
          </View>
        ) : (
          <>
            <Pressable
              style={styles.inputPressZone}
              onPress={() => inputRef.current?.focus()}
            >
              {text.length === 0 && (
                <Text
                  accessible={false}
                  pointerEvents="none"
                  style={[styles.inputPlaceholder, { color: inputPlaceholderTextColor }]}
                >
                  Reply to Claude...
                </Text>
              )}
              <TextInput
                ref={inputRef}
                style={[styles.input, customCssStyles.inputText, cssStyle('.input-text')]}
                value={text}
                onChangeText={handleChangeText}
                onSubmitEditing={() => void handleSend(text)}
                accessibilityLabel={text.length === 0 ? 'Reply to Claude...' : undefined}
                multiline
                submitBehavior="submit"
                returnKeyType="send"
                maxLength={10000}
                scrollEnabled
                editable={!disabled && !isVoiceRecording}
                onFocus={handleInputFocus}
                onBlur={() => setIsInputFocused(false)}
              />
            </Pressable>
            <View style={[styles.toolbar, cssStyle('.input-toolbar')]}>
          <Pressable style={[styles.optionsButton, cssStyle('.options-button')]} onPress={handleOptionsButtonPress}>
            <Image
              source={inputIconUris.options ? { uri: inputIconUris.options } : require('../../assets/optionsbutton.png')}
              style={styles.optionsImage}
              resizeMode="contain"
            />
          </Pressable>

          <Pressable style={[styles.modelPill, cssStyle('.model-pill')]} onPress={onModelPress}>
            <Text style={styles.modelText} numberOfLines={1}>{currentModel}</Text>
          </Pressable>

          <View style={[styles.rightButtons, cssStyle('.input-actions')]}>
            <Pressable
              style={[styles.stickerButton, cssStyle('.sticker-button')]}
              delayLongPress={320}
              disabled={disabled || isStreaming}
              onPress={handleStickerButtonPress}
              onLongPress={() => void startVoiceRecording()}
              onPressOut={() => void stopVoiceRecording()}
            >
              <Image
                source={inputIconUris.sticker ? { uri: inputIconUris.sticker } : require('../../assets/sticker.png')}
                style={styles.stickerButtonImage}
                resizeMode="contain"
              />
            </Pressable>
            <AnimatedPressable
              style={[
                styles.sendButton,
                responseButtonStateStyle,
                styles.responseButtonAnimationAnchor,
                cssStyle('.send-button'),
                { transform: [{ scale: responseButtonScale }] },
              ]}
              onPressIn={() => void handleGetResponsePressIn()}
              onPress={() => void handleGetResponsePress()}
            >
              {renderResponseIcon()}
            </AnimatedPressable>
          </View>
            </View>
          </>
        )}
      </View>

      {stickerPickerVisible && (
        <View style={[styles.inlinePanel, styles.stickerPanel]}>
            <ScrollView
              style={styles.stickerScroll}
              contentContainerStyle={styles.stickerGrid}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              persistentScrollbar
            >
              {userStickers.length === 0 ? (
                <View style={styles.stickerEmpty}>
                  <Text style={styles.stickerEmptyText}>还没有自定义表情包</Text>
                  <Text style={styles.stickerEmptyHint}>到设置里的表情包页添加自己的表情包</Text>
                </View>
              ) : (
                userStickers.map((sticker) => (
                  <Pressable
                    key={sticker.id}
                    style={styles.stickerItem}
                    onPress={() => void handleSendSticker(sticker.token)}
                  >
                    <Image source={sticker.image} style={styles.stickerImage} resizeMode="contain" />
                    <Text style={styles.stickerName} numberOfLines={1}>{sticker.name}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
        </View>
      )}

      {optionsMenuVisible && (
        <View style={[styles.inlinePanel, styles.optionsPanel]}>
          <ScrollView
            ref={optionsPagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.optionsPagerScroll}
            contentContainerStyle={styles.optionsPagerContent}
            onMomentumScrollEnd={handleOptionsPageMomentumEnd}
            scrollEventThrottle={16}
          >
            {optionPages.map((pageActions, pageIndex) => (
              <View key={pageIndex} style={styles.optionPage}>
                <View style={styles.optionsGrid}>
                  {pageActions.map((action) => {
                    const Icon = action.Icon;
                    const disabledAction = 'disabled' in action && !!action.disabled;
                    return (
                      <Pressable
                        key={action.key}
                        style={[styles.optionItem, disabledAction && styles.optionItemDisabled]}
                        onPress={action.onPress}
                        disabled={disabledAction}
                      >
                        <View style={styles.optionIconWrap}>
                          <Icon
                            size={24}
                            color={disabledAction ? colors.textTertiary : colors.textSecondary}
                            strokeWidth={2}
                          />
                        </View>
                        <Text
                          style={[styles.optionText, disabledAction && styles.optionTextDisabled]}
                          numberOfLines={1}
                        >
                          {action.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={styles.optionsPager}>
            {optionPages.map((_, pageIndex) => (
              <Pressable
                key={pageIndex}
                style={[
                  styles.optionPageDot,
                  optionsMenuPage === pageIndex && styles.optionPageDotActive,
                ]}
                onPress={() => scrollToOptionsPage(pageIndex)}
              />
            ))}
          </View>
        </View>
      )}

      <Modal visible={locationPickerVisible} transparent animationType="slide" onRequestClose={handleCloseLocationPicker}>
        <View style={styles.locationPickerOverlay}>
          <View style={styles.locationPickerPanel}>
            <View style={styles.locationPickerHeader}>
              <Pressable style={styles.locationPickerHeaderButton} onPress={handleCloseLocationPicker}>
                <Text style={styles.locationPickerHeaderButtonText}>取消</Text>
              </Pressable>
              <Text style={styles.locationPickerTitle}>发送位置</Text>
              <Pressable
                style={[styles.locationPickerHeaderButton, (!locationDraft || isSendingLocation) && styles.locationPickerHeaderButtonDisabled]}
                onPress={() => void handleConfirmLocation()}
                disabled={!locationDraft || isSendingLocation}
              >
                <Text style={[styles.locationPickerHeaderButtonText, styles.locationPickerSendText]}>
                  {isSendingLocation ? '发送中' : '发送'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.locationSearchBar}>
              <TextInput
                style={styles.locationSearchInput}
                value={locationSearchQuery}
                onChangeText={setLocationSearchQuery}
                onSubmitEditing={() => void handleSearchLocations()}
                placeholder="搜索地点"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="search"
                autoCapitalize="none"
              />
              <Pressable
                style={[styles.locationSearchButton, locationSearchLoading && styles.locationPickerHeaderButtonDisabled]}
                onPress={() => void handleSearchLocations()}
                disabled={locationSearchLoading}
              >
                {locationSearchLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.locationSearchButtonText}>搜索</Text>
                )}
              </Pressable>
            </View>
            {locationSearchResults.length > 0 && (
              <ScrollView
                style={styles.locationSearchResults}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.locationSearchResultsContent}
              >
                {locationSearchResults.map((result) => (
                  <Pressable
                    key={result.id}
                    style={styles.locationSearchResultItem}
                    onPress={() => void handleSelectLocationSearchResult(result)}
                  >
                    <Text style={styles.locationSearchResultTitle} numberOfLines={1}>{result.title}</Text>
                    <Text style={styles.locationSearchResultAddress} numberOfLines={1}>{result.address || `${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.locationMapContainer}>
              {locationDraft && locationMapHtml ? (
                <WebView
                  key={`location-map-${locationMapVersion}`}
                  originWhitelist={['*']}
                  source={{ html: locationMapHtml, baseUrl: 'https://map.qq.com/' }}
                  javaScriptEnabled
                  domStorageEnabled
                  onMessage={(event) => void handleLocationMapMessage(event)}
                  onError={() => setLocationPickerMessage('地图加载失败，请检查网络或腾讯地图 Key')}
                  style={styles.locationMapWebView}
                />
              ) : (
                <View style={styles.locationMapLoading}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={styles.locationMapLoadingText}>{locationPickerMessage || '正在加载地图...'}</Text>
                </View>
              )}
              {locationPickerLoading && (
                <View style={styles.locationMapBusyOverlay}>
                  <ActivityIndicator size="large" color={colors.primary} />
                </View>
              )}
            </View>
            <View style={styles.locationSelectionPanel}>
              <Text style={styles.locationSelectionTitle} numberOfLines={1}>
                {locationDraft?.title || '正在获取位置'}
              </Text>
              <Text style={styles.locationSelectionAddress} numberOfLines={2}>
                {locationDraft?.address || locationPickerMessage || '拖动定位点或搜索地点后选择'}
              </Text>
              {!!locationPickerMessage && !!locationDraft && (
                <Text style={styles.locationSelectionStatus} numberOfLines={1}>{locationPickerMessage}</Text>
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={fileManagerVisible} animationType="fade" onRequestClose={closeFileManager}>
        <KeyboardAvoidingView
          style={styles.fileManagerKeyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Math.max(insets.bottom, 12)}
        >
          <View style={styles.fileManagerOverlay}>
            <Pressable style={styles.fileManagerBackdrop} onPress={closeFileManager} />
            <View style={styles.fileManagerPanel} onStartShouldSetResponder={() => true}>
              <View style={styles.fileManagerHeader}>
                <View style={styles.fileManagerTitleBlock}>
                  <Text style={styles.fileManagerTitle}>文件管理</Text>
                  <Text style={styles.fileManagerHint}>
                    {conversationId ? `${conversationFiles.length} 个当前对话文件` : '当前还没有对话窗口'}
                  </Text>
                </View>
                {fileManagerLoading && <ActivityIndicator size="small" color={colors.primary} />}
                <Pressable style={styles.fileManagerHeaderButton} onPress={() => void refreshConversationFiles()}>
                  <Text style={styles.fileManagerHeaderButtonText}>刷新</Text>
                </Pressable>
                <Pressable style={styles.fileManagerHeaderButton} onPress={closeFileManager}>
                  <Text style={styles.fileManagerHeaderButtonText}>关闭</Text>
                </Pressable>
              </View>
              <View style={styles.fileManagerBody}>
                <View style={styles.fileManagerList}>
                  <ScrollView keyboardShouldPersistTaps="handled">
                    {!conversationId ? (
                      <Text style={styles.fileManagerEmpty}>打开或创建一个对话后，这里会显示当前对话绑定的文件。</Text>
                    ) : conversationFiles.length === 0 ? (
                      <Text style={styles.fileManagerEmpty}>当前对话还没有文件。</Text>
                    ) : (
                      conversationFiles.map((file) => {
                        const selected = selectedFile?.id === file.id;
                        return (
                          <Pressable
                            key={file.id}
                            style={[styles.fileManagerItem, selected && styles.fileManagerItemSelected]}
                            onPress={() => void selectConversationFile(file)}
                          >
                            <Text style={[styles.fileManagerItemName, selected && styles.fileManagerItemNameSelected]} numberOfLines={1}>
                              {file.name}
                            </Text>
                            <Text style={styles.fileManagerItemMeta} numberOfLines={1}>
                              {formatArtifactKind(file.kind)} · {formatArtifactSize(file.size)}
                            </Text>
                          </Pressable>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
                <View style={styles.fileManagerEditor}>
                  {selectedFile ? (
                    <>
                      <View style={styles.fileManagerEditorHeader}>
                        <View style={styles.fileManagerEditorTitleBlock}>
                          <Text style={styles.fileManagerEditorTitle} numberOfLines={1}>{selectedFile.name}</Text>
                          <Text style={styles.fileManagerEditorMeta} numberOfLines={1}>
                            {formatArtifactKind(selectedFile.kind)} · v{selectedFileVersion?.version || '?'} · {formatArtifactSize(selectedFile.size)}{fileDirty ? ' · 未保存' : ''}
                          </Text>
                        </View>
                        <Pressable
                          style={[styles.fileManagerActionButton, (!fileDirty || fileManagerSaving) && styles.fileManagerActionButtonDisabled]}
                          onPress={() => void saveSelectedFile()}
                          disabled={!fileDirty || fileManagerSaving}
                        >
                          <Text style={styles.fileManagerActionText}>{fileManagerSaving ? '保存中' : '保存'}</Text>
                        </Pressable>
                        <Pressable
                          style={styles.fileManagerDangerButton}
                          onPress={deleteSelectedFile}
                          disabled={fileManagerDeleting}
                        >
                          <Text style={styles.fileManagerDangerText}>{fileManagerDeleting ? '删除中' : '删除'}</Text>
                        </Pressable>
                      </View>
                      <TextInput
                        style={styles.fileManagerInput}
                        value={fileDraft}
                        onChangeText={updateFileDraft}
                        multiline
                        autoCapitalize="none"
                        autoCorrect={false}
                        textAlignVertical="top"
                      />
                    </>
                  ) : (
                    <View style={styles.fileManagerPlaceholder}>
                      <Text style={styles.fileManagerPlaceholderTitle}>选择一个文件</Text>
                      <Text style={styles.fileManagerPlaceholderText}>可以查看、编辑并直接保存为新版本。</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal transparent visible={cssEditorVisible} animationType="fade" onRequestClose={() => setCssEditorVisible(false)}>
        <KeyboardAvoidingView
          style={styles.cssEditorKeyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Math.max(insets.bottom, 12)}
        >
          <View style={styles.cssEditorOverlay}>
            <Pressable style={styles.cssEditorBackdrop} onPress={() => setCssEditorVisible(false)} />
            <View style={styles.cssEditorPanel} onStartShouldSetResponder={() => true}>
              <View style={styles.cssEditorHeader}>
                <View style={styles.cssEditorTitleBlock}>
                  <Text style={styles.cssEditorTitle}>自定义 CSS</Text>
                  <Text style={styles.cssEditorHint}>可用类名见 docs/主聊天页自定义CSS类.md</Text>
                </View>
                <Pressable style={styles.cssEditorCloseButton} onPress={() => setCssEditorVisible(false)}>
                  <Text style={styles.cssEditorCloseText}>关闭</Text>
                </Pressable>
              </View>
              <TextInput
                style={styles.cssEditorInput}
                value={cssDraft}
                onChangeText={(value) => setCssDraft(value.slice(0, CUSTOM_CSS_MAX_LENGTH))}
                placeholder={CUSTOM_CSS_PLACEHOLDER}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.cssEditorFooter}>
                <Pressable
                  style={[styles.cssEditorSecondaryButton, !cssDraft.trim() && styles.cssEditorButtonDisabled]}
                  onPress={handleClearCustomCss}
                  disabled={!cssDraft.trim()}
                >
                  <Text style={[styles.cssEditorSecondaryText, !cssDraft.trim() && styles.optionTextDisabled]}>清空</Text>
                </Pressable>
                <Pressable style={styles.cssEditorPrimaryButton} onPress={handleSaveCustomCss}>
                  <Text style={styles.cssEditorPrimaryText}>保存</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal transparent visible={mcpPanelVisible} animationType="fade" onRequestClose={() => setMcpPanelVisible(false)}>
        <KeyboardAvoidingView
          style={styles.mcpKeyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Math.max(insets.bottom, 12)}
        >
          <View style={styles.mcpOverlay}>
            <Pressable style={styles.mcpBackdrop} onPress={() => setMcpPanelVisible(false)} />
            <View style={styles.mcpPanel}>
              <View style={styles.mcpHeader}>
                <View style={styles.mcpHeaderText}>
                  <Text style={styles.mcpTitle}>MCP 管理</Text>
                  <Text style={styles.mcpHint}>选择资源或提示词插入输入框；固定资源会自动附加到后续回复上下文。</Text>
                </View>
                <Pressable style={styles.mcpCloseButton} onPress={() => setMcpPanelVisible(false)}>
                  <Text style={styles.mcpCloseText}>关闭</Text>
                </Pressable>
              </View>

              {mcpServers.length === 0 ? (
                <View style={styles.mcpEmpty}>
                  <Text style={styles.mcpEmptyTitle}>尚未添加 MCP 服务</Text>
                  <Text style={styles.mcpEmptyHint}>到设置的工具设置页添加并同步远程 MCP 服务。</Text>
                </View>
              ) : (
                <View style={styles.mcpBody}>
                  <ScrollView
                    style={styles.mcpServerTabScroller}
                    horizontal
                    showsHorizontalScrollIndicator
                    persistentScrollbar
                    contentContainerStyle={styles.mcpServerTabs}
                  >
                    {mcpServers.map((server) => {
                      const active = selectedMcpServer?.id === server.id;
                      return (
                        <Pressable
                          key={server.id}
                          style={[styles.mcpServerTab, active && styles.mcpServerTabActive]}
                          onPress={() => setMcpSelectedServerId(server.id)}
                        >
                          <Text style={[styles.mcpServerTabText, active && styles.mcpServerTabTextActive]} numberOfLines={1}>
                            {server.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.mcpSegmented}>
                    {(['resources', 'prompts', 'tools'] as McpPanelTab[]).map((tab) => {
                      const label = tab === 'resources' ? 'Resources' : tab === 'prompts' ? 'Prompts' : 'Tools';
                      return (
                        <Pressable
                          key={tab}
                          style={[styles.mcpSegmentButton, mcpTab === tab && styles.mcpSegmentButtonActive]}
                          onPress={() => setMcpTab(tab)}
                        >
                          <Text style={[styles.mcpSegmentText, mcpTab === tab && styles.mcpSegmentTextActive]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <ScrollView
                    style={styles.mcpList}
                    contentContainerStyle={styles.mcpListContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                    persistentScrollbar
                  >
                    {!selectedMcpServer ? null : mcpTab === 'resources' ? (
                      (selectedMcpServer.resources || []).length === 0 ? (
                        <Text style={styles.mcpEmptyInline}>这个服务还没有同步 Resources。</Text>
                      ) : (
                        (selectedMcpServer.resources || []).map((resource) => {
                          const busyKey = `resource:${selectedMcpServer.id}:${resource.uri}`;
                          return (
                            <View key={resource.uri} style={styles.mcpItem}>
                              <View style={styles.mcpItemText}>
                                <Text style={styles.mcpItemTitle}>{resource.title || resource.name || resource.uri}</Text>
                                {!!resource.description && <Text style={styles.mcpItemDescription} numberOfLines={2}>{resource.description}</Text>}
                                <Text style={styles.mcpItemMeta} numberOfLines={1}>{resource.uri}</Text>
                                <Text style={styles.mcpItemStatus}>{resource.pinned ? '已固定到上下文' : '未固定'}</Text>
                              </View>
                              <View style={styles.mcpItemActions}>
                                <Pressable
                                  style={styles.mcpSmallButton}
                                  onPress={() => void handleInsertMcpResource(selectedMcpServer, resource)}
                                  disabled={mcpBusyKey === busyKey}
                                >
                                  <Text style={styles.mcpSmallButtonText}>{mcpBusyKey === busyKey ? '读取中' : '插入'}</Text>
                                </Pressable>
                                <Pressable
                                  style={[styles.mcpSmallButton, resource.pinned && styles.mcpSmallButtonActive]}
                                  onPress={() => handleToggleMcpResourcePinned(selectedMcpServer.id, resource.uri, !resource.pinned)}
                                >
                                  <Text style={[styles.mcpSmallButtonText, resource.pinned && styles.mcpSmallButtonTextActive]}>
                                    {resource.pinned ? '取消固定' : '固定'}
                                  </Text>
                                </Pressable>
                              </View>
                            </View>
                          );
                        })
                      )
                    ) : mcpTab === 'prompts' ? (
                      (selectedMcpServer.prompts || []).length === 0 ? (
                        <Text style={styles.mcpEmptyInline}>这个服务还没有同步 Prompts。</Text>
                      ) : (
                        (selectedMcpServer.prompts || []).map((prompt) => {
                          const key = `${selectedMcpServer.id}:${prompt.name}`;
                          const busyKey = `prompt:${key}`;
                          const argsText = mcpPromptArgs[key] ?? defaultPromptArgsText(prompt);
                          return (
                            <View key={prompt.name} style={styles.mcpPromptItem}>
                              <Text style={styles.mcpItemTitle}>{prompt.title || prompt.name}</Text>
                              {!!prompt.description && <Text style={styles.mcpItemDescription}>{prompt.description}</Text>}
                              {(prompt.arguments || []).length > 0 && (
                                <Text style={styles.mcpItemMeta}>
                                  参数：{(prompt.arguments || []).map((arg) => arg.required ? `${arg.name}*` : arg.name).join(', ')}
                                </Text>
                              )}
                              <TextInput
                                style={styles.mcpPromptArgsInput}
                                value={argsText}
                                onChangeText={(value) => setMcpPromptArgs((current) => ({ ...current, [key]: value }))}
                                multiline
                                textAlignVertical="top"
                                autoCapitalize="none"
                                placeholder="{}"
                                placeholderTextColor={colors.textTertiary}
                              />
                              <Pressable
                                style={styles.mcpPrimaryButton}
                                onPress={() => void handleApplyMcpPrompt(selectedMcpServer, prompt)}
                                disabled={mcpBusyKey === busyKey}
                              >
                                <Text style={styles.mcpPrimaryButtonText}>{mcpBusyKey === busyKey ? '应用中' : '应用到输入框'}</Text>
                              </Pressable>
                            </View>
                          );
                        })
                      )
                    ) : (
                      (selectedMcpServer.tools || []).length === 0 ? (
                        <Text style={styles.mcpEmptyInline}>这个服务还没有同步 Tools。</Text>
                      ) : (
                        (selectedMcpServer.tools || []).map((tool) => (
                          <View key={tool.name} style={styles.mcpItem}>
                            <View style={styles.mcpItemText}>
                              <Text style={styles.mcpItemTitle}>{tool.title || tool.name}</Text>
                              {!!tool.description && <Text style={styles.mcpItemDescription} numberOfLines={2}>{tool.description}</Text>}
                              <Text style={styles.mcpItemStatus}>{tool.enabled !== false ? 'AI 可自动调用' : '已关闭'}</Text>
                            </View>
                          </View>
                        ))
                      )
                    )}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const createStyles = (
  colors: ThemeColors,
  viewportWidth = Dimensions.get('window').width,
  viewportHeight = Dimensions.get('window').height
) => {
  const fileManagerWide = viewportWidth >= 680;
  const keyboardLikePanelHeight = Math.min(
    KEYBOARD_LIKE_PANEL_MAX_HEIGHT,
    Math.max(KEYBOARD_LIKE_PANEL_MIN_HEIGHT, Math.round(viewportHeight * KEYBOARD_LIKE_PANEL_HEIGHT_RATIO))
  );

  return StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    backgroundColor: 'transparent',
  },
  container: {
    minHeight: 110,
    backgroundColor: colors.inputBackground,
    borderRadius: 25,
    borderWidth: colors.inputPanelBorderWidth,
    borderColor: colors.inputPanelBorder,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    boxShadow: '0 0 15px 0 rgba(0,0,0,0.05)',
  },
  customContainer: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  compactContainer: {
    minHeight: 52,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  compactRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  suggestionPanel: {
    minHeight: 84,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  suggestionList: {
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  suggestionItem: {
    width: 72,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 6,
  },
  suggestionImage: {
    width: 42,
    height: 42,
  },
  suggestionName: {
    width: '100%',
    marginTop: 3,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  previewRow: {
    marginBottom: 8,
  },
  previewWrap: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
  },
  previewImage: {
    width: 72,
    height: 72,
  },
  referencePreviewRow: {
    marginBottom: 8,
  },
  referencePreviewList: {
    gap: 8,
    paddingRight: 2,
  },
  referencePreviewWrap: {
    width: 58,
    height: 58,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
  },
  referencePreviewImage: {
    width: 58,
    height: 58,
  },
  previewClose: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCloseText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    fontFamily: TIKTOK_SANS_REGULAR,
    maxHeight: 120,
    minHeight: 28,
    paddingVertical: 0,
  },
  inputPressZone: {
    width: '100%',
  },
  inputPlaceholder: {
    position: 'absolute',
    top: 3,
    left: 0,
    zIndex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontFamily: TIKTOK_SANS_REGULAR,
  },
  compactInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    maxHeight: 36,
    paddingHorizontal: 6,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  compactInputPressZone: {
    flex: 1,
    minWidth: 0,
  },
  compactInputPlaceholder: {
    top: 7,
    left: 6,
  },
  voiceRecordingBar: {
    minHeight: 34,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.primaryLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  voiceRecordingText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  voiceRecordingTime: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    fontFamily: fonts.mono,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  optionsButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.inputControlBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionsImage: {
    width: 20,
    height: 20,
    tintColor: colors.inputControlIcon,
  },
  modelPill: {
    backgroundColor: colors.inputControlBackground,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 8,
    maxWidth: 180,
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
  },
  modelText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    width: '100%',
  },
  rightButtons: {
    flexDirection: 'row',
    marginLeft: 'auto',
    alignItems: 'center',
    gap: 8,
  },
  stickerButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.inputControlBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickerButtonImage: {
    width: 20,
    height: 20,
    tintColor: colors.inputControlIcon,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  responseButtonAnimationAnchor: {
    transformOrigin: 'top center',
  },
  responseUtilityButton: {
    backgroundColor: colors.inputControlBackground,
  },
  responseFocusedButton: {
    backgroundColor: '#c96342',
  },
  responseIdleButton: {
    backgroundColor: colors.idleResponseBackground,
  },
  sendImage: {
    width: 20,
    height: 20,
  },
  focusedResponseImage: {
    tintColor: '#FFFFFF',
  },
  compactPreviewWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
  },
  compactPreviewImage: {
    width: 34,
    height: 34,
  },
  compactPreviewClose: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.52)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactPreviewCloseText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
  compactReferencePill: {
    height: 30,
    maxWidth: 96,
    borderRadius: 15,
    paddingLeft: 10,
    paddingRight: 8,
    backgroundColor: colors.surfaceHover,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactReferenceText: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  compactReferenceClear: {
    fontSize: 12,
    lineHeight: 14,
    color: colors.textTertiary,
    fontWeight: '700',
  },
  invertedImageIcon: {
    tintColor: colors.text,
  },
  inlinePanel: {
    marginTop: 8,
    backgroundColor: colors.inputBackground,
    borderTopWidth: 1,
    borderTopColor: colors.inputBorder,
  },
  stickerPanel: {
    height: keyboardLikePanelHeight,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
  },
  stickerScroll: {
    flex: 1,
  },
  stickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 4,
  },
  stickerEmpty: {
    width: '100%',
    minHeight: keyboardLikePanelHeight - 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  stickerEmptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  stickerEmptyHint: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  stickerItem: {
    width: '30%',
    minWidth: 86,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.surfaceHover,
  },
  stickerImage: {
    width: 64,
    height: 64,
  },
  stickerName: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
  },
  optionsPanel: {
    height: keyboardLikePanelHeight,
    paddingHorizontal: 8,
    paddingTop: 18,
    paddingBottom: 10,
  },
  optionsPagerScroll: {
    flex: 1,
  },
  optionsPagerContent: {
    alignItems: 'stretch',
  },
  optionPage: {
    width: Math.max(0, viewportWidth - 40),
  },
  optionsGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    rowGap: 18,
  },
  optionsPager: {
    height: 22,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  optionPageDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textTertiary,
    opacity: 0.36,
  },
  optionPageDotActive: {
    width: 18,
    opacity: 1,
    backgroundColor: colors.primary,
  },
  optionItem: {
    width: '25%',
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  optionItemDisabled: {
    opacity: 0.55,
  },
  optionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  optionText: {
    width: '100%',
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
    textAlign: 'center',
  },
  optionTextDisabled: {
    color: colors.textTertiary,
  },
  locationPickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  locationPickerPanel: {
    height: Math.min(720, Math.max(520, viewportHeight - 36)),
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  locationPickerHeader: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  locationPickerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  locationPickerHeaderButton: {
    minWidth: 62,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  locationPickerHeaderButtonDisabled: {
    opacity: 0.5,
  },
  locationPickerHeaderButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  locationPickerSendText: {
    color: colors.primary,
  },
  locationSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.background,
  },
  locationSearchInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    color: colors.text,
    fontSize: 15,
  },
  locationSearchButton: {
    width: 64,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  locationSearchButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  locationSearchResults: {
    maxHeight: 168,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
  },
  locationSearchResultsContent: {
    paddingVertical: 4,
  },
  locationSearchResultItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  locationSearchResultTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  locationSearchResultAddress: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
  },
  locationMapContainer: {
    flex: 1,
    minHeight: 260,
    backgroundColor: colors.surface,
  },
  locationMapWebView: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  locationMapLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  locationMapLoadingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  locationMapBusyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  locationSelectionPanel: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 92,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  locationSelectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  locationSelectionAddress: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  locationSelectionStatus: {
    marginTop: 6,
    color: colors.textTertiary,
    fontSize: 12,
  },
  fileManagerKeyboardAvoider: {
    flex: 1,
  },
  fileManagerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  fileManagerBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  fileManagerPanel: {
    marginHorizontal: 12,
    marginBottom: 96,
    height: Math.min(620, viewportHeight * 0.78),
    backgroundColor: colors.inputBackground,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  fileManagerHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.inputBorder,
  },
  fileManagerTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  fileManagerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  fileManagerHint: {
    marginTop: 3,
    fontSize: 12,
    color: colors.textTertiary,
  },
  fileManagerHeaderButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceHover,
  },
  fileManagerHeaderButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  fileManagerBody: {
    flex: 1,
    flexDirection: fileManagerWide ? 'row' : 'column',
  },
  fileManagerList: {
    width: fileManagerWide ? 260 : '100%',
    maxHeight: fileManagerWide ? undefined : 180,
    borderRightWidth: fileManagerWide ? StyleSheet.hairlineWidth : 0,
    borderBottomWidth: fileManagerWide ? 0 : StyleSheet.hairlineWidth,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  fileManagerEmpty: {
    padding: 14,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTertiary,
  },
  fileManagerItem: {
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.inputBorder,
  },
  fileManagerItemSelected: {
    backgroundColor: colors.surfaceHover,
  },
  fileManagerItemName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  fileManagerItemNameSelected: {
    color: colors.primary,
  },
  fileManagerItemMeta: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textTertiary,
  },
  fileManagerEditor: {
    flex: 1,
    minHeight: 0,
  },
  fileManagerEditorHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.inputBorder,
  },
  fileManagerEditorTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  fileManagerEditorTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  fileManagerEditorMeta: {
    marginTop: 3,
    fontSize: 11,
    color: colors.textTertiary,
  },
  fileManagerActionButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  fileManagerActionButtonDisabled: {
    opacity: 0.45,
  },
  fileManagerActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  fileManagerDangerButton: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.dangerSurface,
  },
  fileManagerDangerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  fileManagerInput: {
    flex: 1,
    minHeight: 180,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.background,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  fileManagerPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  fileManagerPlaceholderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  fileManagerPlaceholderText: {
    marginTop: 6,
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  cssEditorKeyboardAvoider: {
    flex: 1,
  },
  cssEditorOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  cssEditorBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  cssEditorPanel: {
    marginHorizontal: 12,
    marginBottom: 96,
    maxHeight: Math.min(560, viewportHeight * 0.72),
    backgroundColor: colors.inputBackground,
    borderRadius: 18,
    padding: 14,
    gap: 12,
    boxShadow: '0 8px 18px rgba(0,0,0,0.18)',
  },
  cssEditorHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cssEditorTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  cssEditorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  cssEditorHint: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  cssEditorCloseButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: colors.surfaceHover,
  },
  cssEditorCloseText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  cssEditorInput: {
    minHeight: 260,
    maxHeight: 360,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  cssEditorFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  cssEditorSecondaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceHover,
  },
  cssEditorButtonDisabled: {
    opacity: 0.55,
  },
  cssEditorSecondaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.danger,
  },
  cssEditorPrimaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  cssEditorPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  mcpOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  mcpBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  mcpPanel: {
    marginHorizontal: 12,
    marginBottom: 96,
    height: MCP_PANEL_HEIGHT,
    backgroundColor: colors.inputBackground,
    borderRadius: 20,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  mcpKeyboardAvoider: {
    flex: 1,
  },
  mcpHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  mcpHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  mcpTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  mcpHint: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  mcpCloseButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: colors.surfaceHover,
  },
  mcpCloseText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  mcpServerTabs: {
    gap: 8,
    paddingBottom: 4,
    paddingRight: 4,
    alignItems: 'center',
  },
  mcpServerTabScroller: {
    maxHeight: 38,
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 10,
  },
  mcpBody: {
    flex: 1,
    minHeight: 0,
  },
  mcpServerTab: {
    maxWidth: 120,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceHover,
    justifyContent: 'center',
  },
  mcpServerTabActive: {
    backgroundColor: colors.primaryLight,
  },
  mcpServerTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  mcpServerTabTextActive: {
    color: colors.primary,
  },
  mcpSegmented: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  mcpSegmentButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceHover,
  },
  mcpSegmentButtonActive: {
    backgroundColor: colors.primary,
  },
  mcpSegmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  mcpSegmentTextActive: {
    color: '#FFFFFF',
  },
  mcpList: {
    flex: 1,
    minHeight: 0,
  },
  mcpListContent: {
    gap: 10,
    paddingBottom: 12,
  },
  mcpItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mcpPromptItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mcpItemText: {
    flex: 1,
    minWidth: 0,
  },
  mcpItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  mcpItemDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  mcpItemMeta: {
    marginTop: 5,
    fontSize: 11,
    color: colors.textTertiary,
  },
  mcpItemStatus: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  mcpItemActions: {
    flexShrink: 0,
    gap: 8,
  },
  mcpSmallButton: {
    minWidth: 72,
    minHeight: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  mcpSmallButtonActive: {
    backgroundColor: colors.primary,
  },
  mcpSmallButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  mcpSmallButtonTextActive: {
    color: '#FFFFFF',
  },
  mcpPromptArgsInput: {
    minHeight: 72,
    marginTop: 8,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  mcpPrimaryButton: {
    minHeight: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  mcpPrimaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  mcpEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  mcpEmptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  mcpEmptyHint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  mcpEmptyInline: {
    paddingVertical: 28,
    textAlign: 'center',
    fontSize: 13,
    color: colors.textTertiary,
  },
  });
};

let styles = createStyles(colors);
