import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { sqliteStorage } from '../db/kv-storage';
import { APIConfig, IncomingLetterOccasion, type PromptCacheTtl, type StablePromptRole } from '../types';
import { DEFAULT_HOTBOARD_PLATFORM_TYPES } from '../utils/hotboardPlatforms';
import type { TopBarIconKey } from '../utils/topBarIconTypes';

export type ChatInputIconKey =
  | 'options'
  | 'sticker'
  | 'sendIdle'
  | 'sendFocused'
  | 'stop';

export type ChatInputAppearanceStyle = 'default' | 'compact';
export type AssistantBubbleAppearanceStyle = 'plain' | 'bubble';
export type MessageAvatarLayout = 'header' | 'side';

export interface AppearanceThemeSnapshot {
  topBarIconUris: Partial<Record<TopBarIconKey, string>>;
  topBarIconHidden?: Partial<Record<TopBarIconKey, boolean>>;
  topBarIconsHidden?: boolean;
  topBarFadeHidden?: boolean;
  topBarBackgroundImageUri?: string;
  customGreetings?: string;
  welcomeLogoImageUri?: string;
  chatBackgroundImageUri?: string;
  userBubbleColor?: string;
  userBubbleTransparent?: boolean;
  userBubbleRadius?: number;
  userBubbleWidthPercent?: number;
  assistantBubbleStyle?: AssistantBubbleAppearanceStyle;
  assistantBubbleColor?: string;
  assistantBubbleTransparent?: boolean;
  assistantBubbleRadius?: number;
  assistantBubbleWidthPercent?: number;
  messageAvatarsVisible?: boolean;
  messageAvatarLayout?: MessageAvatarLayout;
  messageMetaVisible?: boolean;
  userAvatarImageUri?: string;
  assistantAvatarImageUri?: string;
  messageAvatarRadius?: number;
  userDisplayName?: string;
  assistantDisplayName?: string;
  assistantFooterHidden?: boolean;
  assistantActionsHidden?: boolean;
  assistantFooterColor?: string;
  userTextColor?: string;
  assistantTextColor?: string;
  assistantTextStrokeColor?: string;
  assistantTextStrokeWidth?: number;
  userFontSize?: number;
  assistantFontSize?: number;
  customCss?: string;
  inputBackgroundImageUri?: string;
  inputBackgroundTransparent?: boolean;
  inputStyle?: ChatInputAppearanceStyle;
  inputBorderRadius?: number;
  inputIconUris?: Partial<Record<ChatInputIconKey, string>>;
}

interface AppearanceTheme {
  id: string;
  name: string;
  updatedAt: number;
  config: AppearanceThemeSnapshot;
}

export interface NamedAPIConfig extends APIConfig {
  name: string;
}

export type { PromptCacheCompatibility, PromptCacheTtl, ThinkingCompatibility, ThinkingEffort, StablePromptRole } from '../types';

// HiddenRange 已迁移到 src/types，这里 re-export 保持旧的 import 路径兼容。
export type { HiddenRange } from '../types';

export type TTSProvider = 'minimax' | 'fish' | 'deepgram' | 'cartesia' | 'elevenlabs';

export interface TTSConfig {
  provider: TTSProvider;
  groupId: string;
  apiKey: string;
  model: string;
  voiceId: string;
  speed: number;
  vol: number;
  pitch: number;
  fishBaseUrl: string;
  fishApiKey: string;
  fishReferenceId: string;
  fishModel: string;
  fishFormat: 'mp3' | 'wav' | 'pcm';
  fishSpeed: number;
  fishVolume: number;
  deepgramBaseUrl: string;
  deepgramApiKey: string;
  deepgramModel: string;
  cartesiaBaseUrl: string;
  cartesiaApiKey: string;
  cartesiaModel: string;
  cartesiaVoiceId: string;
  cartesiaLanguage: string;
  cartesiaSpeed: number;
  cartesiaVolume: number;
  elevenLabsTokenEndpoint: string;
  elevenLabsVoiceId: string;
  elevenLabsLanguage: string;
}

export type STTProvider = 'openai' | 'fish' | 'deepgram' | 'aliyun' | 'elevenlabs';

export type VoiceCallEngine = 'livekit' | 'elevenlabs';

export interface LiveKitVoiceCallConfig {
  brainUrl: string;
  accessToken: string;
}

export interface STTConfig {
  provider: STTProvider;
  openAiBaseUrl: string;
  openAiApiKey: string;
  openAiModel: string;
  fishBaseUrl: string;
  fishApiKey: string;
  fishLanguage: string;
  fishIgnoreTimestamps: boolean;
  deepgramBaseUrl: string;
  deepgramApiKey: string;
  deepgramModel: string;
  deepgramLanguage: string;
  aliyunBaseUrl: string;
  aliyunApiKey: string;
  aliyunModel: string;
  aliyunLanguage: string;
  aliyunSemanticVad: boolean;
}

export interface MemoryVaultConfig {
  enabled: boolean;
  baseUrl: string;
  adminToken: string;
  topK: number;
  tokenBudget: number;
  maxToolCalls: number;
}

export interface WebSearchConfig {
  enabled: boolean;
  tavilyApiKey: string;
  maxResults: number;
}

export interface WebInteractionConfig {
  enabled: boolean;
  maxToolCalls: number;
}

export interface HtmlArtifactToolConfig {
  enabled: boolean;
  maxToolCalls: number;
}

export interface ConversationArtifactToolConfig {
  enabled: boolean;
  maxToolCalls: number;
}

export interface ConversationWindowToolConfig {
  enabled: boolean;
}

export interface HotboardConfig {
  enabled: boolean;
  apiKey: string;
  platforms: string;
}

export interface RunCommandProfileConfig {
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPassword: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  strictHostKeyChecking: boolean;
  knownHosts: string;
  defaultCwd: string;
  customPrompt: string;
  timeoutMs: number;
  maxOutputChars: number;
  maxToolCalls: number;
}

export interface RunCommandProfile {
  id: string;
  name: string;
  updatedAt: number;
  config: RunCommandProfileConfig;
}

export interface RunCommandConfig extends RunCommandProfileConfig {
  enabled: boolean;
  profiles?: RunCommandProfile[];
  activeProfileId?: string;
}

export interface QQBotConfig {
  enabled: boolean;
  backendUrl: string;
  controlToken: string;
  appId: string;
  appSecret: string;
  sandbox: boolean;
  autoConnect: boolean;
  allowDirectMessages: boolean;
  allowGuildMentions: boolean;
  openAiBaseUrl: string;
  openAiApiKey: string;
  model: string;
  systemPrompt: string;
  qqSystemPrompt: string;
  wechatSystemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  historyLimit: number;
  memoryVaultEnabled: boolean;
  memoryVaultBaseUrl: string;
  memoryVaultTopK: number;
  memoryVaultTokenBudget: number;
  memoryVaultMaxToolCalls: number;
  webSearchEnabled: boolean;
  tavilyApiKey: string;
  webSearchMaxResults: number;
  mcpEnabled: boolean;
  mcpMaxToolCalls: number;
  mcpServers: McpServerConfig[];
  ttsEnabled: boolean;
  ttsWithText: boolean;
  ttsGroupId: string;
  ttsApiKey: string;
  ttsModel: string;
  ttsVoiceId: string;
  ttsSpeed: number;
  ttsVol: number;
  ttsPitch: number;
  messageBatchEnabled: boolean;
  messageBatchWindowMs: number;
  stickersEnabled: boolean;
  wechatEnabled: boolean;
  wechatAutoConnect: boolean;
  wechatAccountId: string;
  wechatBaseUrl: string;
}

export interface NativeToolConfig {
  accountingEnabled?: boolean;
  deviceInfoEnabled: boolean;
  batteryStatusEnabled: boolean;
  appUsageStatsEnabled: boolean;
  calendarEnabled: boolean;
  aiVoiceCallEnabled?: boolean;
  aiVoiceCallHangupEnabled?: boolean;
  accessibilityControlEnabled?: boolean;
  shizukuShellEnabled?: boolean;
  shellTimeoutMs?: number;
  shellMaxOutputChars?: number;
  shellMaxToolCalls?: number;
}

export interface CalendarAiSyncConfig {
  sendTodayTodosToAI: boolean;
}

export interface TodayWidgetConfig {
  displayName: string;
  handle: string;
  avatarUri?: string;
  quote: string;
}

export interface LocationShareConfig {
  enabled: boolean;
  provider: 'tencent';
  tencentKey: string;
}

export interface McpToolSnapshot {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
  enabled?: boolean;
}

export interface McpResourceSnapshot {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  enabled?: boolean;
  pinned?: boolean;
}

export interface McpResourceTemplateSnapshot {
  uriTemplate: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  enabled?: boolean;
}

export interface McpPromptArgumentSnapshot {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptSnapshot {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgumentSnapshot[];
  enabled?: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  authorization: string;
  enabled: boolean;
  tools: McpToolSnapshot[];
  resources?: McpResourceSnapshot[];
  resourceTemplates?: McpResourceTemplateSnapshot[];
  prompts?: McpPromptSnapshot[];
  updatedAt: number;
}

export interface McpToolConfig {
  enabled: boolean;
  servers: McpServerConfig[];
  maxToolCalls: number;
  resourceToolsEnabled?: boolean;
}

interface ToolSettingsUiConfig {
  builtInToolsExpanded: boolean;
  customMcpExpanded: boolean;
  otherFeaturesExpanded?: boolean;
}

interface ReadingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  summarySystemPrompt: string;
  sourceCharLimit: number;
  conversationMessageLimit: number;
}

export interface FloatingBallConfig {
  enabled: boolean;
  ttsEnabled: boolean;
  autoReplyOnScreenshotShare?: boolean;
  normalImageUri?: string;
  edgeImageUri?: string;
  normalImageUris?: string[];
  edgeImageUris?: string[];
  normalSizeDp?: number;
  edgeSizeDp?: number;
  assetAutoSwitchEnabled?: boolean;
  assetAutoSwitchIntervalSeconds?: number;
}

interface PeriodConfig {
  sendToAI: boolean;
}

export interface PromptCacheConfig {
  enabled: boolean;
  ttl: PromptCacheTtl;
  keepaliveMode: 'local' | 'remote';
  reminderEnabled: boolean;
  remoteKeepaliveEnabled: boolean;
  quietHoursEnabled: boolean;
  quietStartMinutes: number;
  quietEndMinutes: number;
  remoteServerUrl: string;
  remoteAuthToken: string;
  remoteAgentTickEnabled: boolean;
  pushChannel: 'wxpusher' | 'dingtalk';
  wxPusherAppToken: string;
  wxPusherUid: string;
  wxPusherTopicIds: string;
  dingTalkWebhook: string;
  dingTalkSecret: string;
  dingTalkAtMobiles: string;
}

export interface ImageGenerationFaceReference {
  id: string;
  uri: string;
  enabled: boolean;
  createdAt: number;
}

export interface ImageGenerationConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  size: string;
  quality: string;
  faceReferences: ImageGenerationFaceReference[];
}

export interface IncomingLetterConfig {
  enabled: boolean;
  occasions: IncomingLetterOccasion[];
}

export interface DailyPaperSourceConfig {
  id: string;
  name: string;
  url: string;
  category: string;
  language: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DailyPaperConfig {
  useDefaultSources: boolean;
  customSources: DailyPaperSourceConfig[];
}

export type StickerOwner = 'user' | 'assistant';

export interface CustomSticker {
  id: string;
  name: string;
  uri?: string;
  assetKey?: string;
  createdAt: number;
}

export interface StickerConfig {
  initialized?: boolean;
  stickerSuggestionsEnabled?: boolean;
  userStickers: CustomSticker[];
  assistantStickers: CustomSticker[];
}

export interface AppearanceConfig extends AppearanceThemeSnapshot {
  useDefaultGreetings?: boolean;
  defaultGreetingName?: string;
  globalFontUri?: string;
  globalFontName?: string;
  globalBoldFontUri?: string;
  globalBoldFontName?: string;
  appearanceThemes?: AppearanceTheme[];
  activeAppearanceThemeId?: string;
}

function createDefaultStickerConfig(): StickerConfig {
  return {
    initialized: true,
    stickerSuggestionsEnabled: true,
    userStickers: [],
    assistantStickers: [],
  };
}

function isLegacyDefaultSticker(sticker: CustomSticker): boolean {
  return sticker.id.startsWith('default-') || !!sticker.assetKey;
}

function filterCustomStickers(stickers?: CustomSticker[]): CustomSticker[] {
  return (stickers || []).filter((sticker) => !isLegacyDefaultSticker(sticker));
}

function normalizeStickerConfig(config?: StickerConfig): StickerConfig {
  if (!config?.initialized) {
    return {
      initialized: true,
      stickerSuggestionsEnabled: config?.stickerSuggestionsEnabled ?? true,
      userStickers: filterCustomStickers(config?.userStickers),
      assistantStickers: filterCustomStickers(config?.assistantStickers),
    };
  }

  return {
    initialized: true,
    stickerSuggestionsEnabled: config.stickerSuggestionsEnabled ?? true,
    userStickers: filterCustomStickers(config.userStickers),
    assistantStickers: filterCustomStickers(config.assistantStickers),
  };
}

function normalizeFloatingBallConfig(config?: FloatingBallConfig): FloatingBallConfig {
  const normalImageUris =
    (config?.normalImageUris && config.normalImageUris.length > 0)
      ? Array.from(new Set(config.normalImageUris.filter(Boolean)))
      : config?.normalImageUri
        ? [config.normalImageUri]
        : [];
  const edgeImageUris =
    (config?.edgeImageUris && config.edgeImageUris.length > 0)
      ? Array.from(new Set(config.edgeImageUris.filter(Boolean)))
      : config?.edgeImageUri
        ? [config.edgeImageUri]
        : [];

  return {
    enabled: config?.enabled ?? false,
    ttsEnabled: config?.ttsEnabled ?? false,
    autoReplyOnScreenshotShare: config?.autoReplyOnScreenshotShare ?? false,
    normalImageUri: config?.normalImageUri || normalImageUris[0],
    edgeImageUri: config?.edgeImageUri || edgeImageUris[0],
    normalImageUris,
    edgeImageUris,
    normalSizeDp: Math.min(160, Math.max(32, config?.normalSizeDp ?? 64)),
    edgeSizeDp: Math.min(160, Math.max(32, config?.edgeSizeDp ?? 64)),
    assetAutoSwitchEnabled: config?.assetAutoSwitchEnabled ?? false,
    assetAutoSwitchIntervalSeconds: Math.min(
      3600,
      Math.max(1, config?.assetAutoSwitchIntervalSeconds ?? 8)
    ),
  };
}

function normalizeTodayWidgetConfig(config?: Partial<TodayWidgetConfig>): TodayWidgetConfig {
  return {
    displayName: config?.displayName?.trim() || '',
    handle: config?.handle?.replace(/^@+/, '').trim() || '',
    avatarUri: config?.avatarUri || undefined,
    quote: config?.quote?.trim() || '',
  };
}

function normalizeImageGenerationConfig(config?: Partial<ImageGenerationConfig>): ImageGenerationConfig {
  return {
    enabled: config?.enabled ?? false,
    baseUrl: config?.baseUrl || '',
    apiKey: config?.apiKey || '',
    model: config?.model || 'gpt-image-2',
    size: config?.size || '1024x1024',
    quality: config?.quality || 'auto',
    faceReferences: (config?.faceReferences || [])
      .filter((item) => !!item?.uri)
      .map((item) => ({
        id: item.id || createId('face-ref'),
        uri: item.uri,
        enabled: item.enabled !== false,
        createdAt: item.createdAt || Date.now(),
      })),
  };
}

function normalizeSTTConfig(config?: Partial<STTConfig>): STTConfig {
  const provider =
    config?.provider === 'fish' || config?.provider === 'deepgram' || config?.provider === 'aliyun' || config?.provider === 'elevenlabs'
      ? config.provider
      : 'openai';
  return {
    provider,
    openAiBaseUrl: config?.openAiBaseUrl || '',
    openAiApiKey: config?.openAiApiKey || '',
    openAiModel: config?.openAiModel || 'whisper-1',
    fishBaseUrl: config?.fishBaseUrl || 'https://api.fish.audio',
    fishApiKey: config?.fishApiKey || '',
    fishLanguage: config?.fishLanguage || 'zh',
    fishIgnoreTimestamps: config?.fishIgnoreTimestamps ?? true,
    deepgramBaseUrl: config?.deepgramBaseUrl || 'https://api.deepgram.com/v1',
    deepgramApiKey: config?.deepgramApiKey || '',
    deepgramModel: config?.deepgramModel || 'nova-3',
    deepgramLanguage: config?.deepgramLanguage || '',
    aliyunBaseUrl: config?.aliyunBaseUrl || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    aliyunApiKey: config?.aliyunApiKey || '',
    aliyunModel: config?.aliyunModel || 'qwen3-asr-flash-realtime',
    aliyunLanguage: config?.aliyunLanguage || 'zh',
    aliyunSemanticVad: config?.aliyunSemanticVad ?? true,
  };
}

function normalizeTTSConfig(config?: Partial<TTSConfig>): TTSConfig {
  const provider =
    config?.provider === 'fish' || config?.provider === 'deepgram' || config?.provider === 'cartesia' || config?.provider === 'elevenlabs'
      ? config.provider
      : 'minimax';
  return {
    provider,
    groupId: config?.groupId || '',
    apiKey: config?.apiKey || '',
    model: config?.model || 'speech-02-hd',
    voiceId: config?.voiceId || '',
    speed: config?.speed ?? 1,
    vol: config?.vol ?? 1,
    pitch: config?.pitch ?? 0,
    fishBaseUrl: config?.fishBaseUrl || 'https://api.fish.audio',
    fishApiKey: config?.fishApiKey || '',
    fishReferenceId: config?.fishReferenceId || '',
    fishModel: config?.fishModel || 's2-pro',
    fishFormat:
      config?.fishFormat === 'wav' || config?.fishFormat === 'pcm'
        ? config.fishFormat
        : 'mp3',
    fishSpeed: config?.fishSpeed ?? 1,
    fishVolume: config?.fishVolume ?? 0,
    deepgramBaseUrl: config?.deepgramBaseUrl || 'https://api.deepgram.com/v1',
    deepgramApiKey: config?.deepgramApiKey || '',
    deepgramModel: config?.deepgramModel || 'aura-2-thalia-en',
    cartesiaBaseUrl: config?.cartesiaBaseUrl || 'https://api.cartesia.ai',
    cartesiaApiKey: config?.cartesiaApiKey || '',
    cartesiaModel: config?.cartesiaModel || 'sonic-3.5',
    cartesiaVoiceId: config?.cartesiaVoiceId || '',
    cartesiaLanguage: config?.cartesiaLanguage || 'zh',
    cartesiaSpeed: config?.cartesiaSpeed ?? 1,
    cartesiaVolume: config?.cartesiaVolume ?? 1,
    elevenLabsTokenEndpoint: config?.elevenLabsTokenEndpoint || '',
    elevenLabsVoiceId: config?.elevenLabsVoiceId || '',
    elevenLabsLanguage: config?.elevenLabsLanguage || 'zh',
  };
}

function normalizeIncomingLetterConfig(config?: Partial<IncomingLetterConfig>): IncomingLetterConfig {
  return {
    enabled: config?.enabled ?? false,
    occasions: (config?.occasions || [])
      .filter((item) => !!item?.id && !!item?.date)
      .map((item) => ({
        id: item.id,
        title: item.title || '收信日',
        date: item.date,
        repeatYearly: item.repeatYearly !== false,
        enabled: item.enabled !== false,
        systemPrompt: item.systemPrompt || '',
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || item.createdAt || Date.now(),
      })),
  };
}

function normalizePromptCacheConfig(config?: Partial<PromptCacheConfig>): PromptCacheConfig {
  const clampMinutes = (value: unknown, fallback: number) => {
    const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
    return Math.min(1439, Math.max(0, numeric));
  };
  const rawPushChannel = String((config as any)?.pushChannel || '').toLowerCase();
  const pushChannel: PromptCacheConfig['pushChannel'] =
    rawPushChannel === 'wxpusher'
      ? 'wxpusher'
      : 'dingtalk';
  return {
    enabled: config?.enabled ?? false,
    ttl: config?.ttl === '1h' ? '1h' : '5m',
    keepaliveMode: 'remote',
    reminderEnabled: false,
    remoteKeepaliveEnabled: (config as any)?.remoteKeepaliveEnabled ?? (config?.keepaliveMode === 'remote'),
    quietHoursEnabled: config?.quietHoursEnabled ?? false,
    quietStartMinutes: clampMinutes(config?.quietStartMinutes, 23 * 60),
    quietEndMinutes: clampMinutes(config?.quietEndMinutes, 7 * 60),
    remoteServerUrl: config?.remoteServerUrl || '',
    remoteAuthToken: config?.remoteAuthToken || '',
    remoteAgentTickEnabled: config?.remoteAgentTickEnabled ?? true,
    pushChannel,
    wxPusherAppToken: config?.wxPusherAppToken || '',
    wxPusherUid: config?.wxPusherUid || '',
    wxPusherTopicIds: config?.wxPusherTopicIds || '',
    dingTalkWebhook: config?.dingTalkWebhook || '',
    dingTalkSecret: config?.dingTalkSecret || '',
    dingTalkAtMobiles: config?.dingTalkAtMobiles || '',
  };
}

function normalizeDailyPaperConfig(config?: Partial<DailyPaperConfig>): DailyPaperConfig {
  return {
    useDefaultSources: config?.useDefaultSources ?? true,
    customSources: (config?.customSources || [])
      .filter((source) => !!source?.url)
      .map((source) => ({
        id: source.id || createId('daily-source'),
        name: source.name?.trim() || '自定义来源',
        url: source.url.trim(),
        category: source.category?.trim() || 'general',
        language: source.language?.trim() || 'zh',
        enabled: source.enabled !== false,
        createdAt: source.createdAt || Date.now(),
        updatedAt: source.updatedAt || source.createdAt || Date.now(),
      })),
  };
}

const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  topBarIconUris: {},
  topBarIconHidden: {},
  topBarIconsHidden: false,
  customGreetings: '',
  welcomeLogoImageUri: undefined,
  useDefaultGreetings: false,
  defaultGreetingName: '',
  messageAvatarsVisible: false,
  messageAvatarLayout: 'header',
  messageMetaVisible: true,
  messageAvatarRadius: 18,
  userDisplayName: 'You',
  assistantDisplayName: 'Claude',
  assistantBubbleStyle: 'plain',
  userBubbleWidthPercent: 75,
  assistantBubbleWidthPercent: 75,
  assistantActionsHidden: false,
  inputIconUris: {},
  inputStyle: 'default',
  inputBorderRadius: 20,
  customCss: '',
  appearanceThemes: [],
};

function createDefaultAppearanceConfig(): AppearanceConfig {
  return {
    ...DEFAULT_APPEARANCE_CONFIG,
    topBarIconUris: {},
    topBarIconHidden: {},
    inputIconUris: {},
    appearanceThemes: [],
    activeAppearanceThemeId: undefined,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotAppearanceConfig(config?: AppearanceConfig): AppearanceThemeSnapshot {
  const source = config || DEFAULT_APPEARANCE_CONFIG;
  return {
    topBarIconUris: { ...(source.topBarIconUris || {}) },
    topBarIconHidden: { ...(source.topBarIconHidden || {}) },
    topBarIconsHidden: source.topBarIconsHidden,
    topBarFadeHidden: source.topBarFadeHidden,
    topBarBackgroundImageUri: source.topBarBackgroundImageUri,
    chatBackgroundImageUri: source.chatBackgroundImageUri,
    userBubbleColor: source.userBubbleColor,
    userBubbleTransparent: source.userBubbleTransparent,
    userBubbleRadius: source.userBubbleRadius,
    userBubbleWidthPercent: source.userBubbleWidthPercent,
    assistantBubbleStyle: source.assistantBubbleStyle,
    assistantBubbleColor: source.assistantBubbleColor,
    assistantBubbleTransparent: source.assistantBubbleTransparent,
    assistantBubbleRadius: source.assistantBubbleRadius,
    assistantBubbleWidthPercent: source.assistantBubbleWidthPercent,
    messageAvatarsVisible: source.messageAvatarsVisible,
    messageAvatarLayout: source.messageAvatarLayout === 'side' ? 'side' : 'header',
    messageMetaVisible: source.messageMetaVisible,
    userAvatarImageUri: source.userAvatarImageUri,
    assistantAvatarImageUri: source.assistantAvatarImageUri,
    messageAvatarRadius: source.messageAvatarRadius,
    userDisplayName: source.userDisplayName,
    assistantDisplayName: source.assistantDisplayName,
    assistantFooterHidden: source.assistantFooterHidden,
    assistantActionsHidden: source.assistantActionsHidden,
    assistantFooterColor: source.assistantFooterColor,
    userTextColor: source.userTextColor,
    assistantTextColor: source.assistantTextColor,
    assistantTextStrokeColor: source.assistantTextStrokeColor,
    assistantTextStrokeWidth: source.assistantTextStrokeWidth,
    userFontSize: source.userFontSize,
    assistantFontSize: source.assistantFontSize,
    customCss: source.customCss,
    inputBackgroundImageUri: source.inputBackgroundImageUri,
    inputBackgroundTransparent: source.inputBackgroundTransparent,
    inputStyle: source.inputStyle === 'compact' ? 'compact' : 'default',
    inputBorderRadius: source.inputBorderRadius,
    inputIconUris: { ...(source.inputIconUris || {}) },
  };
}

interface SettingsState {
  _hydrated: boolean;
  apiConfigs: NamedAPIConfig[];
  activeConfigIndex: number;
  systemPrompt: string;
  stablePromptRole: StablePromptRole;
  systemPrompts: { name: string; content: string }[];
  maxOutputTokens: number | null;
  tokenWarningThreshold: number | null;
  stripThinking: boolean;
  ttsConfig: TTSConfig;
  sttConfig: STTConfig;
  voiceCallTTSProvider: TTSProvider;
  voiceCallSTTProvider: STTProvider;
  voiceCallEngine: VoiceCallEngine;
  liveKitVoiceCallConfig: LiveKitVoiceCallConfig;
  voiceCallBackgroundImageUri?: string;
  memoryVaultConfig: MemoryVaultConfig;
  webSearchConfig: WebSearchConfig;
  webInteractionConfig: WebInteractionConfig;
  conversationArtifactToolConfig: ConversationArtifactToolConfig;
  conversationWindowToolConfig: ConversationWindowToolConfig;
  htmlArtifactToolConfig: HtmlArtifactToolConfig;
  hotboardConfig: HotboardConfig;
  runCommandConfig: RunCommandConfig;
  qqBotConfig: QQBotConfig;
  nativeToolConfig: NativeToolConfig;
  calendarAiSyncConfig: CalendarAiSyncConfig;
  todayWidgetConfig: TodayWidgetConfig;
  locationShareConfig: LocationShareConfig;
  mcpToolConfig: McpToolConfig;
  toolSettingsUiConfig: ToolSettingsUiConfig;
  readingConfig: ReadingConfig;
  floatingBallConfig: FloatingBallConfig;
  periodConfig: PeriodConfig;
  promptCacheConfig: PromptCacheConfig;
  imageGenerationConfig: ImageGenerationConfig;
  imageGenerationPrompt: string;
  incomingLetterConfig: IncomingLetterConfig;
  dailyPaperConfig: DailyPaperConfig;
  stickerConfig: StickerConfig;
  appearanceConfig: AppearanceConfig;

  setActiveConfig: (index: number) => void;
  saveAPIConfig: (config: NamedAPIConfig) => void;
  removeAPIConfig: (index: number) => void;
  setSystemPrompt: (prompt: string) => void;
  setStablePromptRole: (role: StablePromptRole) => void;
  setSystemPrompts: (prompts: { name: string; content: string }[]) => void;
  setMaxOutputTokens: (tokens: number | null) => void;
  setTokenWarningThreshold: (tokens: number | null) => void;
  setStripThinking: (value: boolean) => void;
  setTTSConfig: (config: Partial<TTSConfig>) => void;
  setSTTConfig: (config: Partial<STTConfig>) => void;
  setVoiceCallTTSProvider: (provider: TTSProvider) => void;
  setVoiceCallSTTProvider: (provider: STTProvider) => void;
  setVoiceCallEngine: (engine: VoiceCallEngine) => void;
  setLiveKitVoiceCallConfig: (config: Partial<LiveKitVoiceCallConfig>) => void;
  setVoiceCallBackgroundImageUri: (uri?: string) => void;
  setMemoryVaultConfig: (config: Partial<MemoryVaultConfig>) => void;
  setWebSearchConfig: (config: Partial<WebSearchConfig>) => void;
  setWebInteractionConfig: (config: Partial<WebInteractionConfig>) => void;
  setConversationArtifactToolConfig: (config: Partial<ConversationArtifactToolConfig>) => void;
  setConversationWindowToolConfig: (config: Partial<ConversationWindowToolConfig>) => void;
  setHtmlArtifactToolConfig: (config: Partial<HtmlArtifactToolConfig>) => void;
  setHotboardConfig: (config: Partial<HotboardConfig>) => void;
  setRunCommandConfig: (config: Partial<RunCommandConfig>) => void;
  setQqBotConfig: (config: Partial<QQBotConfig>) => void;
  setNativeToolConfig: (config: Partial<NativeToolConfig>) => void;
  setCalendarAiSyncConfig: (config: Partial<CalendarAiSyncConfig>) => void;
  setTodayWidgetConfig: (config: Partial<TodayWidgetConfig>) => void;
  setLocationShareConfig: (config: Partial<LocationShareConfig>) => void;
  setMcpToolConfig: (config: Partial<McpToolConfig>) => void;
  setToolSettingsUiConfig: (config: Partial<ToolSettingsUiConfig>) => void;
  setReadingConfig: (config: Partial<ReadingConfig>) => void;
  setFloatingBallConfig: (config: Partial<FloatingBallConfig>) => void;
  setPeriodConfig: (config: Partial<PeriodConfig>) => void;
  setPromptCacheConfig: (config: Partial<PromptCacheConfig>) => void;
  setImageGenerationConfig: (config: Partial<ImageGenerationConfig>) => void;
  setImageGenerationPrompt: (prompt: string) => void;
  setIncomingLetterConfig: (config: Partial<IncomingLetterConfig>) => void;
  setDailyPaperConfig: (config: Partial<DailyPaperConfig>) => void;
  addIncomingLetterOccasion: (occasion: IncomingLetterOccasion) => void;
  updateIncomingLetterOccasion: (id: string, patch: Partial<IncomingLetterOccasion>) => void;
  removeIncomingLetterOccasion: (id: string) => void;
  setStickerSuggestionsEnabled: (enabled: boolean) => void;
  addSticker: (owner: StickerOwner, sticker: CustomSticker) => void;
  updateSticker: (owner: StickerOwner, id: string, patch: Partial<Pick<CustomSticker, 'name' | 'uri'>>) => void;
  removeSticker: (owner: StickerOwner, id: string) => void;
  setAppearanceConfig: (config: Partial<AppearanceConfig>) => void;
  setTopBarIconUri: (key: TopBarIconKey, uri: string) => void;
  clearTopBarIconUri: (key: TopBarIconKey) => void;
  resetTopBarIcons: () => void;
  setChatInputIconUri: (key: ChatInputIconKey, uri: string) => void;
  clearChatInputIconUri: (key: ChatInputIconKey) => void;
  resetChatInputIcons: () => void;
  saveAppearanceTheme: (name: string) => string;
  updateAppearanceTheme: (id: string) => void;
  applyAppearanceTheme: (id: string) => void;
  removeAppearanceTheme: (id: string) => void;
  resetAppearanceConfig: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      _hydrated: false,
      apiConfigs: [],
      activeConfigIndex: 0,
      systemPrompt: 'You are a helpful assistant.',
      stablePromptRole: 'system',
      systemPrompts: [
        { name: '默认', content: 'You are a helpful assistant.' },
      ],
      maxOutputTokens: null,
      tokenWarningThreshold: null,
      stripThinking: false,
      ttsConfig: normalizeTTSConfig(),
      sttConfig: normalizeSTTConfig(),
      voiceCallTTSProvider: 'minimax',
      voiceCallSTTProvider: 'deepgram',
      voiceCallEngine: 'livekit',
      liveKitVoiceCallConfig: { brainUrl: '', accessToken: '' },
      voiceCallBackgroundImageUri: undefined,
      memoryVaultConfig: {
        enabled: false,
        baseUrl: '',
        adminToken: '',
        topK: 5,
        tokenBudget: 2000,
        maxToolCalls: 3,
      },
      webSearchConfig: {
        enabled: false,
        tavilyApiKey: '',
        maxResults: 5,
      },
      webInteractionConfig: {
        enabled: false,
        maxToolCalls: 8,
      },
      conversationArtifactToolConfig: {
        enabled: false,
        maxToolCalls: 8,
      },
      conversationWindowToolConfig: {
        enabled: false,
      },
      htmlArtifactToolConfig: {
        enabled: false,
        maxToolCalls: 8,
      },
      hotboardConfig: {
        enabled: false,
        apiKey: '',
        platforms: DEFAULT_HOTBOARD_PLATFORM_TYPES.join(','),
      },
      runCommandConfig: {
        enabled: false,
        sshHost: '',
        sshPort: 22,
        sshUsername: '',
        sshPassword: '',
        sshPrivateKey: '',
        sshPassphrase: '',
        strictHostKeyChecking: false,
        knownHosts: '',
        defaultCwd: '',
        customPrompt: '',
        timeoutMs: 60000,
        maxOutputChars: 20000,
        maxToolCalls: 20,
      },
      qqBotConfig: {
        enabled: false,
        backendUrl: 'http://127.0.0.1:8788',
        controlToken: '',
        appId: '',
        appSecret: '',
        sandbox: true,
        autoConnect: true,
        allowDirectMessages: true,
        allowGuildMentions: true,
        openAiBaseUrl: '',
        openAiApiKey: '',
        model: '',
        systemPrompt: '你是 YSClaude 的 QQ 机器人入口。请用自然、简洁、友好的中文回复 QQ 用户。',
        qqSystemPrompt: '你是 YSClaude 的 QQ 机器人入口。请用自然、简洁、友好的中文回复 QQ 用户。',
        wechatSystemPrompt: '你是 YSClaude 的微信机器人入口。请用自然、简洁、友好的中文回复微信用户。',
        temperature: 0.7,
        maxOutputTokens: 1200,
        historyLimit: 16,
        memoryVaultEnabled: false,
        memoryVaultBaseUrl: '',
        memoryVaultTopK: 5,
        memoryVaultTokenBudget: 2000,
        memoryVaultMaxToolCalls: 3,
        webSearchEnabled: false,
        tavilyApiKey: '',
        webSearchMaxResults: 5,
        mcpEnabled: false,
        mcpMaxToolCalls: 6,
        mcpServers: [],
        ttsEnabled: false,
        ttsWithText: false,
        ttsGroupId: '',
        ttsApiKey: '',
        ttsModel: 'speech-02-hd',
        ttsVoiceId: '',
        ttsSpeed: 1,
        ttsVol: 1,
        ttsPitch: 0,
        messageBatchEnabled: true,
        messageBatchWindowMs: 6000,
        stickersEnabled: false,
        wechatEnabled: false,
        wechatAutoConnect: true,
        wechatAccountId: '',
        wechatBaseUrl: '',
      },
      nativeToolConfig: {
        accountingEnabled: false,
        deviceInfoEnabled: false,
        batteryStatusEnabled: false,
        appUsageStatsEnabled: false,
        calendarEnabled: false,
        aiVoiceCallEnabled: false,
        aiVoiceCallHangupEnabled: false,
        accessibilityControlEnabled: false,
        shizukuShellEnabled: false,
        shellTimeoutMs: 30000,
        shellMaxOutputChars: 20000,
        shellMaxToolCalls: 10,
      },
      calendarAiSyncConfig: {
        sendTodayTodosToAI: false,
      },
      todayWidgetConfig: {
        displayName: '',
        handle: '',
        avatarUri: undefined,
        quote: '',
      },
      locationShareConfig: {
        enabled: false,
        provider: 'tencent',
        tencentKey: '',
      },
      mcpToolConfig: {
        enabled: false,
        servers: [],
        maxToolCalls: 6,
      },
      toolSettingsUiConfig: {
        builtInToolsExpanded: true,
        customMcpExpanded: true,
      },
      readingConfig: {
        baseUrl: '',
        apiKey: '',
        model: '',
        systemPrompt:
          '你是一个温柔、细致的 AI 共读伙伴。围绕用户正在阅读的原文回答，帮助解释、联想、提问和梳理，但不要剧透当前原文之后的内容。',
        summarySystemPrompt:
          '你是一个细致的 AI 共读记录整理者。只根据用户提供的聊天记录做总结，不补充书籍原文、阅读位置或外部信息。',
        sourceCharLimit: 4000,
        conversationMessageLimit: 8,
      },
      floatingBallConfig: {
        enabled: false,
        ttsEnabled: false,
        autoReplyOnScreenshotShare: false,
        normalImageUri: undefined,
        edgeImageUri: undefined,
        normalImageUris: [],
        edgeImageUris: [],
        normalSizeDp: 64,
        edgeSizeDp: 64,
        assetAutoSwitchEnabled: false,
        assetAutoSwitchIntervalSeconds: 8,
      },
      periodConfig: {
        sendToAI: false,
      },
      promptCacheConfig: {
        enabled: false,
        ttl: '5m',
        keepaliveMode: 'remote',
        reminderEnabled: false,
        remoteKeepaliveEnabled: false,
        quietHoursEnabled: false,
        quietStartMinutes: 23 * 60,
        quietEndMinutes: 7 * 60,
        remoteServerUrl: '',
        remoteAuthToken: '',
        remoteAgentTickEnabled: true,
        pushChannel: 'dingtalk',
        wxPusherAppToken: '',
        wxPusherUid: '',
        wxPusherTopicIds: '',
        dingTalkWebhook: '',
        dingTalkSecret: '',
        dingTalkAtMobiles: '',
      },
      imageGenerationConfig: {
        enabled: false,
        baseUrl: '',
        apiKey: '',
        model: 'gpt-image-2',
        size: '1024x1024',
        quality: 'auto',
        faceReferences: [],
      },
      imageGenerationPrompt: '高质量图片，画面清晰，主体明确，无水印，无乱码文字。',
      incomingLetterConfig: {
        enabled: false,
        occasions: [],
      },
      dailyPaperConfig: {
        useDefaultSources: true,
        customSources: [],
      },
      stickerConfig: createDefaultStickerConfig(),
      appearanceConfig: DEFAULT_APPEARANCE_CONFIG,

      setActiveConfig: (index) => set({ activeConfigIndex: index }),

      saveAPIConfig: (config) =>
        set((state) => {
          const existingIndex = state.apiConfigs.findIndex((c) => c.name === config.name);
          if (existingIndex >= 0) {
            const configs = [...state.apiConfigs];
            configs[existingIndex] = config;
            return { apiConfigs: configs };
          }
          return { apiConfigs: [...state.apiConfigs, config] };
        }),

      removeAPIConfig: (index) =>
        set((state) => ({
          apiConfigs: state.apiConfigs.filter((_, i) => i !== index),
          activeConfigIndex:
            state.activeConfigIndex >= state.apiConfigs.length - 1
              ? Math.max(0, state.apiConfigs.length - 2)
              : state.activeConfigIndex,
        })),

      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
      setStablePromptRole: (role) => set({ stablePromptRole: role }),
      setSystemPrompts: (prompts) => set({ systemPrompts: prompts }),

      setMaxOutputTokens: (tokens) => set({ maxOutputTokens: tokens }),
      setTokenWarningThreshold: (tokens) => set({ tokenWarningThreshold: tokens }),
      setStripThinking: (value) => set({ stripThinking: value }),
      setTTSConfig: (config) =>
        set((state) => ({ ttsConfig: normalizeTTSConfig({ ...state.ttsConfig, ...config }) })),
      setSTTConfig: (config) =>
        set((state) => ({ sttConfig: normalizeSTTConfig({ ...state.sttConfig, ...config }) })),
      setVoiceCallTTSProvider: (provider) => set({ voiceCallTTSProvider: provider }),
      setVoiceCallSTTProvider: (provider) => set({ voiceCallSTTProvider: provider }),
      setVoiceCallEngine: (engine) => set({ voiceCallEngine: engine }),
      setLiveKitVoiceCallConfig: (config) =>
        set((state) => ({ liveKitVoiceCallConfig: { ...state.liveKitVoiceCallConfig, ...config } })),
      setVoiceCallBackgroundImageUri: (uri) => set({ voiceCallBackgroundImageUri: uri }),
      setMemoryVaultConfig: (config) =>
        set((state) => ({ memoryVaultConfig: { ...state.memoryVaultConfig, ...config } })),
      setWebSearchConfig: (config) =>
        set((state) => ({ webSearchConfig: { ...state.webSearchConfig, ...config } })),
      setWebInteractionConfig: (config) =>
        set((state) => ({ webInteractionConfig: { ...state.webInteractionConfig, ...config } })),
      setConversationArtifactToolConfig: (config) =>
        set((state) => ({ conversationArtifactToolConfig: { ...state.conversationArtifactToolConfig, ...config } })),
      setConversationWindowToolConfig: (config) =>
        set((state) => ({ conversationWindowToolConfig: { ...state.conversationWindowToolConfig, ...config } })),
      setHtmlArtifactToolConfig: (config) =>
        set((state) => ({ htmlArtifactToolConfig: { ...state.htmlArtifactToolConfig, ...config } })),
      setHotboardConfig: (config) =>
        set((state) => ({ hotboardConfig: { ...state.hotboardConfig, ...config } })),
      setRunCommandConfig: (config) =>
        set((state) => ({
          runCommandConfig: {
            ...(state.runCommandConfig || {
              enabled: false,
              sshHost: '',
              sshPort: 22,
              sshUsername: '',
              sshPassword: '',
              sshPrivateKey: '',
              sshPassphrase: '',
              strictHostKeyChecking: false,
              knownHosts: '',
              defaultCwd: '',
              customPrompt: '',
              timeoutMs: 60000,
              maxOutputChars: 20000,
              maxToolCalls: 20,
            }),
            ...config,
          },
        })),
      setQqBotConfig: (config) =>
        set((state) => ({ qqBotConfig: { ...state.qqBotConfig, ...config } })),
      setNativeToolConfig: (config) =>
        set((state) => ({ nativeToolConfig: { ...state.nativeToolConfig, ...config } })),
      setCalendarAiSyncConfig: (config) =>
        set((state) => ({
          calendarAiSyncConfig: {
            ...(state.calendarAiSyncConfig || { sendTodayTodosToAI: false }),
            ...config,
          },
        })),
      setTodayWidgetConfig: (config) =>
        set((state) => ({
          todayWidgetConfig: normalizeTodayWidgetConfig({
            ...state.todayWidgetConfig,
            ...config,
          }),
        })),
      setLocationShareConfig: (config) =>
        set((state) => ({
          locationShareConfig: {
            ...(state.locationShareConfig || { enabled: false, provider: 'tencent', tencentKey: '' }),
            ...config,
            provider: 'tencent',
          },
        })),
      setMcpToolConfig: (config) =>
        set((state) => ({
          mcpToolConfig: {
            ...(state.mcpToolConfig || { enabled: false, servers: [], maxToolCalls: 6 }),
            ...config,
          },
        })),
      setToolSettingsUiConfig: (config) =>
        set((state) => ({
          toolSettingsUiConfig: {
            ...(state.toolSettingsUiConfig || { builtInToolsExpanded: true, customMcpExpanded: true }),
            ...config,
          },
        })),
      setReadingConfig: (config) =>
        set((state) => ({ readingConfig: { ...state.readingConfig, ...config } })),
      setFloatingBallConfig: (config) =>
        set((state) => ({ floatingBallConfig: { ...state.floatingBallConfig, ...config } })),
      setPeriodConfig: (config) =>
        set((state) => ({ periodConfig: { ...state.periodConfig, ...config } })),
      setPromptCacheConfig: (config) =>
        set((state) => ({
          promptCacheConfig: normalizePromptCacheConfig({
            ...state.promptCacheConfig,
            ...config,
          }),
        })),
      setImageGenerationConfig: (config) =>
        set((state) => ({
          imageGenerationConfig: normalizeImageGenerationConfig({
            ...state.imageGenerationConfig,
            ...config,
          }),
        })),
      setImageGenerationPrompt: (prompt) => set({ imageGenerationPrompt: prompt }),
      setIncomingLetterConfig: (config) =>
        set((state) => ({
          incomingLetterConfig: normalizeIncomingLetterConfig({
            ...state.incomingLetterConfig,
            ...config,
          }),
        })),
      setDailyPaperConfig: (config) =>
        set((state) => ({
          dailyPaperConfig: normalizeDailyPaperConfig({
            ...state.dailyPaperConfig,
            ...config,
          }),
        })),
      addIncomingLetterOccasion: (occasion) =>
        set((state) => {
          const current = normalizeIncomingLetterConfig(state.incomingLetterConfig);
          return {
            incomingLetterConfig: {
              ...current,
              occasions: [occasion, ...current.occasions],
            },
          };
        }),
      updateIncomingLetterOccasion: (id, patch) =>
        set((state) => {
          const current = normalizeIncomingLetterConfig(state.incomingLetterConfig);
          return {
            incomingLetterConfig: {
              ...current,
              occasions: current.occasions.map((occasion) =>
                occasion.id === id
                  ? { ...occasion, ...patch, updatedAt: patch.updatedAt || Date.now() }
                  : occasion
              ),
            },
          };
        }),
      removeIncomingLetterOccasion: (id) =>
        set((state) => {
          const current = normalizeIncomingLetterConfig(state.incomingLetterConfig);
          return {
            incomingLetterConfig: {
              ...current,
              occasions: current.occasions.filter((occasion) => occasion.id !== id),
            },
          };
        }),
      setStickerSuggestionsEnabled: (enabled) =>
        set((state) => {
          const current = normalizeStickerConfig(state.stickerConfig);
          return {
            stickerConfig: {
              ...current,
              stickerSuggestionsEnabled: enabled,
            },
          };
        }),
      addSticker: (owner, sticker) =>
        set((state) => {
          const current = normalizeStickerConfig(state.stickerConfig);
          const key = owner === 'user' ? 'userStickers' : 'assistantStickers';
          return {
            stickerConfig: {
              ...current,
              [key]: [sticker, ...(current[key] || [])],
            },
          };
        }),
      updateSticker: (owner, id, patch) =>
        set((state) => {
          const current = normalizeStickerConfig(state.stickerConfig);
          const key = owner === 'user' ? 'userStickers' : 'assistantStickers';
          return {
            stickerConfig: {
              ...current,
              [key]: (current[key] || []).map((sticker) =>
                sticker.id === id ? { ...sticker, ...patch } : sticker
              ),
            },
          };
        }),
      removeSticker: (owner, id) =>
        set((state) => {
          const current = normalizeStickerConfig(state.stickerConfig);
          const key = owner === 'user' ? 'userStickers' : 'assistantStickers';
          return {
            stickerConfig: {
              ...current,
              [key]: (current[key] || []).filter((sticker) => sticker.id !== id),
            },
          };
        }),
      setAppearanceConfig: (config) =>
        set((state) => ({
          appearanceConfig: {
            ...(state.appearanceConfig || { topBarIconUris: {}, inputIconUris: {}, inputStyle: 'default' }),
            ...config,
            topBarIconUris: {
              ...(state.appearanceConfig?.topBarIconUris || {}),
              ...(config.topBarIconUris || {}),
            },
            topBarIconHidden: {
              ...(state.appearanceConfig?.topBarIconHidden || {}),
              ...(config.topBarIconHidden || {}),
            },
            inputIconUris: {
              ...(state.appearanceConfig?.inputIconUris || {}),
              ...(config.inputIconUris || {}),
            },
          },
        })),
      setTopBarIconUri: (key, uri) =>
        set((state) => ({
          appearanceConfig: {
            ...(state.appearanceConfig || { topBarIconUris: {}, inputIconUris: {}, inputStyle: 'default' }),
            topBarIconUris: {
              ...(state.appearanceConfig?.topBarIconUris || {}),
              [key]: uri,
            },
          },
        })),
      clearTopBarIconUri: (key) =>
        set((state) => {
          const nextUris = { ...(state.appearanceConfig?.topBarIconUris || {}) };
          delete nextUris[key];
          return {
            appearanceConfig: {
              ...(state.appearanceConfig || { topBarIconUris: {}, inputIconUris: {}, inputStyle: 'default' }),
              topBarIconUris: nextUris,
            },
          };
        }),
      resetTopBarIcons: () =>
        set((state) => ({
          appearanceConfig: {
            ...(state.appearanceConfig || { topBarIconUris: {}, inputIconUris: {}, inputStyle: 'default' }),
            topBarIconUris: {},
          },
        })),
      setChatInputIconUri: (key, uri) =>
        set((state) => ({
          appearanceConfig: {
            ...(state.appearanceConfig || { topBarIconUris: {}, inputIconUris: {}, inputStyle: 'default' }),
            inputIconUris: {
              ...(state.appearanceConfig?.inputIconUris || {}),
              [key]: uri,
            },
          },
        })),
      clearChatInputIconUri: (key) =>
        set((state) => {
          const nextUris = { ...(state.appearanceConfig?.inputIconUris || {}) };
          delete nextUris[key];
          return {
            appearanceConfig: {
              ...(state.appearanceConfig || { topBarIconUris: {}, inputIconUris: {}, inputStyle: 'default' }),
              inputIconUris: nextUris,
            },
          };
        }),
      resetChatInputIcons: () =>
        set((state) => ({
          appearanceConfig: {
            ...(state.appearanceConfig || { topBarIconUris: {}, inputIconUris: {}, inputStyle: 'default' }),
            inputIconUris: {},
          },
        })),
      saveAppearanceTheme: (name) => {
        const id = createId('appearance-theme');
        set((state) => {
          const current = state.appearanceConfig || DEFAULT_APPEARANCE_CONFIG;
          const themes = current.appearanceThemes || [];
          const theme: AppearanceTheme = {
            id,
            name: name.trim(),
            updatedAt: Date.now(),
            config: snapshotAppearanceConfig(current),
          };
          return {
            appearanceConfig: {
              ...current,
              appearanceThemes: [theme, ...themes],
              activeAppearanceThemeId: id,
            },
          };
        });
        return id;
      },
      updateAppearanceTheme: (id) =>
        set((state) => {
          const current = state.appearanceConfig || DEFAULT_APPEARANCE_CONFIG;
          const themes = current.appearanceThemes || [];
          return {
            appearanceConfig: {
              ...current,
              appearanceThemes: themes.map((theme) =>
                theme.id === id
                  ? { ...theme, updatedAt: Date.now(), config: snapshotAppearanceConfig(current) }
                  : theme
              ),
              activeAppearanceThemeId: id,
            },
          };
        }),
      applyAppearanceTheme: (id) =>
        set((state) => {
          const current = state.appearanceConfig || DEFAULT_APPEARANCE_CONFIG;
          const themes = current.appearanceThemes || [];
          const theme = themes.find((item) => item.id === id);
          if (!theme) return { appearanceConfig: current };
          return {
            appearanceConfig: {
              ...DEFAULT_APPEARANCE_CONFIG,
              ...theme.config,
              customGreetings: current.customGreetings,
              welcomeLogoImageUri: current.welcomeLogoImageUri,
              useDefaultGreetings: current.useDefaultGreetings,
              defaultGreetingName: current.defaultGreetingName,
              globalFontUri: current.globalFontUri,
              globalFontName: current.globalFontName,
              globalBoldFontUri: current.globalBoldFontUri,
              globalBoldFontName: current.globalBoldFontName,
              topBarIconUris: { ...(theme.config.topBarIconUris || {}) },
              inputIconUris: { ...(theme.config.inputIconUris || {}) },
              appearanceThemes: themes,
              activeAppearanceThemeId: id,
            },
          };
        }),
      removeAppearanceTheme: (id) =>
        set((state) => {
          const current = state.appearanceConfig || DEFAULT_APPEARANCE_CONFIG;
          const nextThemes = (current.appearanceThemes || []).filter((theme) => theme.id !== id);
          return {
            appearanceConfig: {
              ...current,
              appearanceThemes: nextThemes,
              activeAppearanceThemeId:
                current.activeAppearanceThemeId === id ? undefined : current.activeAppearanceThemeId,
            },
          };
        }),
      resetAppearanceConfig: () =>
        set((state) => {
          const current = state.appearanceConfig || DEFAULT_APPEARANCE_CONFIG;
          return {
            appearanceConfig: {
              ...createDefaultAppearanceConfig(),
              customGreetings: current.customGreetings || '',
              welcomeLogoImageUri: current.welcomeLogoImageUri,
              useDefaultGreetings: current.useDefaultGreetings ?? false,
              defaultGreetingName: current.defaultGreetingName || '',
              globalFontUri: current.globalFontUri,
              globalFontName: current.globalFontName,
              globalBoldFontUri: current.globalBoldFontUri,
              globalBoldFontName: current.globalBoldFontName,
              appearanceThemes: current.appearanceThemes || [],
              activeAppearanceThemeId: undefined,
            },
          };
        }),
    }),
    {
      name: 'ysclaude-settings',
      storage: createJSONStorage(() => sqliteStorage),
      merge: (persistedState, currentState) => {
        const saved = (persistedState || {}) as Partial<SettingsState>;
        return {
          ...currentState,
          ...saved,
          // On the first upgrade, preserve the old shared provider choice for calls.
          voiceCallTTSProvider: saved.voiceCallTTSProvider || saved.ttsConfig?.provider || currentState.voiceCallTTSProvider,
          voiceCallSTTProvider: saved.voiceCallSTTProvider || saved.sttConfig?.provider || currentState.voiceCallSTTProvider,
          voiceCallEngine: saved.voiceCallEngine || currentState.voiceCallEngine,
          liveKitVoiceCallConfig: { ...currentState.liveKitVoiceCallConfig, ...saved.liveKitVoiceCallConfig },
        };
      },
      partialize: (state) => ({
        apiConfigs: state.apiConfigs,
        activeConfigIndex: state.activeConfigIndex,
        systemPrompt: state.systemPrompt,
        stablePromptRole: state.stablePromptRole,
        systemPrompts: state.systemPrompts,
        maxOutputTokens: state.maxOutputTokens,
        tokenWarningThreshold: state.tokenWarningThreshold,
        stripThinking: state.stripThinking,
        ttsConfig: state.ttsConfig,
        sttConfig: state.sttConfig,
        voiceCallTTSProvider: state.voiceCallTTSProvider,
        voiceCallSTTProvider: state.voiceCallSTTProvider,
        voiceCallEngine: state.voiceCallEngine,
        liveKitVoiceCallConfig: state.liveKitVoiceCallConfig,
        voiceCallBackgroundImageUri: state.voiceCallBackgroundImageUri,
        memoryVaultConfig: state.memoryVaultConfig,
        webSearchConfig: state.webSearchConfig,
        webInteractionConfig: state.webInteractionConfig,
        conversationArtifactToolConfig: state.conversationArtifactToolConfig,
        conversationWindowToolConfig: state.conversationWindowToolConfig,
        htmlArtifactToolConfig: state.htmlArtifactToolConfig,
        hotboardConfig: state.hotboardConfig,
        runCommandConfig: state.runCommandConfig,
        qqBotConfig: state.qqBotConfig,
        nativeToolConfig: state.nativeToolConfig,
        calendarAiSyncConfig: state.calendarAiSyncConfig,
        todayWidgetConfig: state.todayWidgetConfig,
        locationShareConfig: state.locationShareConfig,
        mcpToolConfig: state.mcpToolConfig,
        toolSettingsUiConfig: state.toolSettingsUiConfig,
        readingConfig: state.readingConfig,
        floatingBallConfig: state.floatingBallConfig,
        periodConfig: state.periodConfig,
        promptCacheConfig: state.promptCacheConfig,
        imageGenerationConfig: state.imageGenerationConfig,
        imageGenerationPrompt: state.imageGenerationPrompt,
        incomingLetterConfig: state.incomingLetterConfig,
        dailyPaperConfig: state.dailyPaperConfig,
        stickerConfig: state.stickerConfig,
        appearanceConfig: state.appearanceConfig,
      }),
      onRehydrateStorage: () => (state) => {
        useSettingsStore.setState({
          _hydrated: true,
          conversationArtifactToolConfig:
            state?.conversationArtifactToolConfig ||
            state?.htmlArtifactToolConfig || {
              enabled: false,
              maxToolCalls: 8,
            },
          conversationWindowToolConfig: {
            enabled: state?.conversationWindowToolConfig?.enabled ?? false,
          },
          stickerConfig: normalizeStickerConfig(state?.stickerConfig),
          floatingBallConfig: normalizeFloatingBallConfig(state?.floatingBallConfig),
          calendarAiSyncConfig: {
            sendTodayTodosToAI: state?.calendarAiSyncConfig?.sendTodayTodosToAI ?? false,
          },
          todayWidgetConfig: normalizeTodayWidgetConfig(state?.todayWidgetConfig),
          promptCacheConfig: normalizePromptCacheConfig(state?.promptCacheConfig),
          ttsConfig: normalizeTTSConfig(state?.ttsConfig),
          sttConfig: normalizeSTTConfig(state?.sttConfig),
          voiceCallTTSProvider: state?.voiceCallTTSProvider || state?.ttsConfig?.provider || 'minimax',
          voiceCallSTTProvider: state?.voiceCallSTTProvider || state?.sttConfig?.provider || 'deepgram',
          voiceCallEngine: state?.voiceCallEngine === 'elevenlabs' ? 'elevenlabs' : 'livekit',
          liveKitVoiceCallConfig: {
            brainUrl: state?.liveKitVoiceCallConfig?.brainUrl || '',
            accessToken: state?.liveKitVoiceCallConfig?.accessToken || '',
          },
          nativeToolConfig: {
            accountingEnabled: state?.nativeToolConfig?.accountingEnabled ?? false,
            deviceInfoEnabled: state?.nativeToolConfig?.deviceInfoEnabled ?? false,
            batteryStatusEnabled: state?.nativeToolConfig?.batteryStatusEnabled ?? false,
            appUsageStatsEnabled: state?.nativeToolConfig?.appUsageStatsEnabled ?? false,
            calendarEnabled: state?.nativeToolConfig?.calendarEnabled ?? false,
            aiVoiceCallEnabled: state?.nativeToolConfig?.aiVoiceCallEnabled ?? false,
            aiVoiceCallHangupEnabled: state?.nativeToolConfig?.aiVoiceCallHangupEnabled ?? false,
            accessibilityControlEnabled: state?.nativeToolConfig?.accessibilityControlEnabled ?? false,
            shizukuShellEnabled: state?.nativeToolConfig?.shizukuShellEnabled ?? false,
            shellTimeoutMs: state?.nativeToolConfig?.shellTimeoutMs ?? 30000,
            shellMaxOutputChars: state?.nativeToolConfig?.shellMaxOutputChars ?? 20000,
            shellMaxToolCalls: state?.nativeToolConfig?.shellMaxToolCalls ?? 10,
          },
          locationShareConfig: {
            enabled: state?.locationShareConfig?.enabled ?? false,
            provider: 'tencent',
            tencentKey: state?.locationShareConfig?.tencentKey || '',
          },
          imageGenerationConfig: normalizeImageGenerationConfig(state?.imageGenerationConfig),
          incomingLetterConfig: normalizeIncomingLetterConfig(state?.incomingLetterConfig),
          dailyPaperConfig: normalizeDailyPaperConfig(state?.dailyPaperConfig),
        });
      },
    }
  )
);

/** Shared provider credentials with the provider selected specifically for realtime calls. */
export function getVoiceCallTTSConfig(): TTSConfig {
  const state = useSettingsStore.getState();
  return { ...state.ttsConfig, provider: state.voiceCallTTSProvider };
}

export function getVoiceCallSTTConfig(): STTConfig {
  const state = useSettingsStore.getState();
  return { ...state.sttConfig, provider: state.voiceCallSTTProvider };
}
