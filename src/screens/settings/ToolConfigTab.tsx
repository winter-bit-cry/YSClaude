import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, NativeModules, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import QRCode from 'react-native-qrcode-svg';
import { useSettingsPageColors } from '../../theme/colors';
import {
  useSettingsStore,
  type DailyPaperSourceConfig,
  type QQBotConfig,
  type RunCommandProfile,
  type RunCommandProfileConfig,
} from '../../stores/settings';
import { useChatStore } from '../../stores/chat';
import { formatMcpPromptResult, getMcpPrompt, listMcpCapabilities } from '../../services/mcpHttpClient';
import { sanitizeMcpServerId } from '../../services/toolModules/mcpRemote';
import {
  DEFAULT_HOTBOARD_PLATFORM_TYPES,
  HOTBOARD_PLATFORMS,
  normalizeHotboardPlatformTypes,
} from '../../utils/hotboardPlatforms';
import { normalizeStickerName } from '../../utils/stickers';
import {
  DEFAULT_AI_REACTION_EMOJIS,
  DEFAULT_NEGATIVE_REACTION_EMOJIS,
  DEFAULT_POSITIVE_REACTION_EMOJIS,
  formatReactionEmojiList,
  normalizeReactionEmojiList,
} from '../../utils/reactionEmojis';
import { createSettingsStyles } from './styles';
import {
  BuiltInToolModal,
  McpPromptModal,
  McpResourceModal,
  McpServerModal,
  McpToolModal,
  QqConversationModal,
} from './tool/ToolConfigModals';
import { BuiltInToolsSection, McpToolsSection, OtherFeaturesSection } from './tool/ToolConfigSections';
import { McpServerEditor } from './tool/McpServerEditor';
import { executeShizukuShell, getShizukuStatus, openShizukuManager, requestShizukuPermission } from '../../services/shizukuShell';
import {
  beginWechatClawLogin,
  logoutWechatClawBot,
  pollWechatClawLogin,
} from '../../services/localBotChannels';

type SettingsTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const QQ_BOT_BACKEND_TIMEOUT_MS = 60000;
const QQ_BOT_CONFIG_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;
const QQ_BOT_STICKER_BATCH_MAX_BYTES = 900 * 1024;
const QQ_BOT_STICKER_BATCH_MAX_COUNT = 5;

function inferImageMimeType(uri: string): string {
  const cleanUri = uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.jpg') || cleanUri.endsWith('.jpeg')) return 'image/jpeg';
  if (cleanUri.endsWith('.webp')) return 'image/webp';
  if (cleanUri.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

export function ToolConfigTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const {
    apiConfigs,
    activeConfigIndex,
    systemPrompt,
    ttsConfig,
    stickerConfig,
    memoryVaultConfig,
    webSearchConfig,
    webInteractionConfig,
    conversationArtifactToolConfig,
    conversationWindowToolConfig,
    htmlArtifactToolConfig,
    hotboardConfig,
    dailyPaperConfig,
    runCommandConfig,
    qqBotConfig,
    qqBotToolConfig,
    wechatClawBotToolConfig,
    nativeToolConfig,
    locationShareConfig,
    mcpToolConfig,
    setMemoryVaultConfig,
    setWebSearchConfig,
    setWebInteractionConfig,
    setConversationArtifactToolConfig,
    setConversationWindowToolConfig,
    setHtmlArtifactToolConfig,
    setHotboardConfig,
    setDailyPaperConfig,
    setRunCommandConfig,
    setQqBotConfig,
    setQqBotToolConfig,
    setWechatClawBotToolConfig,
    setNativeToolConfig,
    setLocationShareConfig,
    setMcpToolConfig,
  } = useSettingsStore();
  const activeApiConfig = apiConfigs[activeConfigIndex] || null;
  const [localQqEnabled, setLocalQqEnabled] = useState(!!qqBotToolConfig?.enabled);
  const [localQqAppId, setLocalQqAppId] = useState(qqBotToolConfig?.appId || '');
  const [localQqSecret, setLocalQqSecret] = useState(qqBotToolConfig?.appSecret || '');
  const [localQqSandbox, setLocalQqSandbox] = useState(qqBotToolConfig?.sandbox ?? true);
  const [localQqReadLimit, setLocalQqReadLimit] = useState(String(qqBotToolConfig?.defaultReadLimit || 20));
  const [wechatClawEnabled, setWechatClawEnabled] = useState(!!wechatClawBotToolConfig?.enabled);
  const [wechatClawToken, setWechatClawToken] = useState(wechatClawBotToolConfig?.botToken || '');
  const [wechatClawBaseUrl, setWechatClawBaseUrl] = useState(wechatClawBotToolConfig?.baseUrl || 'https://ilinkai.weixin.qq.com');
  const [wechatClawAccountId, setWechatClawAccountId] = useState(wechatClawBotToolConfig?.accountId || '');
  const [wechatClawReadLimit, setWechatClawReadLimit] = useState(String(wechatClawBotToolConfig?.defaultReadLimit || 20));
  const [wechatLoginQrToken, setWechatLoginQrToken] = useState('');
  const [wechatLoginQrContent, setWechatLoginQrContent] = useState('');
  const [wechatLoginStatus, setWechatLoginStatus] = useState(
    wechatClawBotToolConfig?.botToken ? '已登录' : '未登录'
  );
  const [wechatLoginBusy, setWechatLoginBusy] = useState(false);

  function handleLocalQqBotToolsEnabledChange(value: boolean) {
    setLocalQqEnabled(value);
    setQqBotToolConfig({ enabled: value });
    showToast(value
      ? 'QQ Bot 工具已开启，重启应用后生效'
      : 'QQ Bot 工具已关闭，重启应用后生效');
  }

  function handleWechatClawBotToolsEnabledChange(value: boolean) {
    setWechatClawEnabled(value);
    setWechatClawBotToolConfig({ enabled: value });
    showToast(value
      ? '微信 ClawBot 工具已开启，重启应用后生效'
      : '微信 ClawBot 工具已关闭，重启应用后生效');
  }

  function saveLocalQqBotTools() {
    const defaultReadLimit = Math.max(1, Math.min(100, parseInt(localQqReadLimit, 10) || 20));
    setQqBotToolConfig({
      enabled: localQqEnabled,
      appId: localQqAppId.trim(),
      appSecret: localQqSecret.trim(),
      sandbox: localQqSandbox,
      defaultReadLimit,
      maxReadLimit: 100,
    });
    showToast(localQqEnabled ? 'QQ Bot 工具已保存，重启应用后连接生效' : 'QQ Bot 工具已关闭');
  }

  function saveWechatClawBotTools() {
    const defaultReadLimit = Math.max(1, Math.min(100, parseInt(wechatClawReadLimit, 10) || 20));
    setWechatClawBotToolConfig({
      enabled: wechatClawEnabled,
      botToken: wechatClawToken.trim(),
      baseUrl: wechatClawBaseUrl.trim().replace(/\/+$/, ''),
      accountId: wechatClawAccountId.trim(),
      defaultReadLimit,
      maxReadLimit: 100,
    });
    showToast(wechatClawEnabled ? '微信 ClawBot 工具已保存，重启应用后连接生效' : '微信 ClawBot 工具已关闭');
  }

  async function handleWechatClawLogin() {
    setWechatLoginBusy(true);
    try {
      const login = await beginWechatClawLogin();
      setWechatLoginQrToken(login.qrcode || '');
      setWechatLoginQrContent(login.qrContent || '');
      setWechatLoginStatus('等待扫码');
    } catch (error: any) {
      Alert.alert('微信登录失败', error?.message || '无法获取登录二维码');
    } finally {
      setWechatLoginBusy(false);
    }
  }

  function handleWechatClawLogout() {
    logoutWechatClawBot();
    setWechatClawEnabled(false);
    setWechatClawToken('');
    setWechatClawAccountId('');
    setWechatLoginQrToken('');
    setWechatLoginQrContent('');
    setWechatLoginStatus('未登录');
    showToast('微信 ClawBot 已退出');
  }

  useEffect(() => {
    if (!wechatLoginQrToken) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const result = await pollWechatClawLogin(wechatLoginQrToken);
        if (cancelled) return;
        if (result.status === 'scaned') {
          setWechatLoginStatus('已扫码，请在微信确认');
        } else if (result.status === 'expired') {
          setWechatLoginStatus('二维码已过期，请重新获取');
          setWechatLoginQrToken('');
          setWechatLoginQrContent('');
        } else if (result.status === 'confirmed' && result.botToken) {
          const baseUrl = result.baseUrl || 'https://ilinkai.weixin.qq.com';
          const accountId = result.accountId || '';
          setWechatClawToken(result.botToken);
          setWechatClawBaseUrl(baseUrl);
          setWechatClawAccountId(accountId);
          setWechatClawEnabled(true);
          setWechatClawBotToolConfig({
            enabled: true,
            botToken: result.botToken,
            baseUrl,
            accountId,
          });
          setWechatLoginStatus('已登录');
          setWechatLoginQrToken('');
          setWechatLoginQrContent('');
          showToast('微信 ClawBot 登录成功');
        }
      } catch (error: any) {
        if (!cancelled) setWechatLoginStatus(error?.message || '登录状态查询失败');
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [wechatLoginQrToken]);

  // 记忆库本地 state
  const [mvEnabled, setMvEnabled] = useState(memoryVaultConfig.enabled);
  const [mvBaseUrl] = useState(memoryVaultConfig.baseUrl);
  const [mvTopK, setMvTopK] = useState(String(memoryVaultConfig.topK));
  const [mvTokenBudget, setMvTokenBudget] = useState(String(memoryVaultConfig.tokenBudget));
  const [mvMaxCalls, setMvMaxCalls] = useState(String(memoryVaultConfig.maxToolCalls));
  const [mvAdminToken] = useState(memoryVaultConfig.adminToken);
  const [mvEmbeddingProvider, setMvEmbeddingProvider] = useState<'openai' | 'google'>(memoryVaultConfig.embeddingProvider || 'openai');
  const [mvEmbeddingBaseUrl, setMvEmbeddingBaseUrl] = useState(memoryVaultConfig.embeddingBaseUrl || 'https://api.openai.com/v1');
  const [mvEmbeddingApiKey, setMvEmbeddingApiKey] = useState(memoryVaultConfig.embeddingApiKey || '');
  const [mvEmbeddingModel, setMvEmbeddingModel] = useState(memoryVaultConfig.embeddingModel || 'text-embedding-3-small');
  const [mvSplitBaseUrl, setMvSplitBaseUrl] = useState(memoryVaultConfig.splitBaseUrl || 'https://api.openai.com/v1');
  const [mvSplitApiKey, setMvSplitApiKey] = useState(memoryVaultConfig.splitApiKey || '');
  const [mvSplitModel, setMvSplitModel] = useState(memoryVaultConfig.splitModel || 'gpt-4o-mini');
  const [mvTesting, setMvTesting] = useState(false);

  // 联网搜索本地 state
  const [wsEnabled, setWsEnabled] = useState(webSearchConfig.enabled);
  const [wsApiKey, setWsApiKey] = useState(webSearchConfig.tavilyApiKey);
  const [wsMaxResults, setWsMaxResults] = useState(String(webSearchConfig.maxResults));

  // 网页交互本地 state
  const [wiEnabled, setWiEnabled] = useState(!!webInteractionConfig?.enabled);
  const [wiMaxCalls, setWiMaxCalls] = useState(String(webInteractionConfig?.maxToolCalls || 8));
  const [conversationArtifactEnabled, setConversationArtifactEnabled] = useState(!!conversationArtifactToolConfig?.enabled);
  const [conversationWindowEnabled, setConversationWindowEnabled] = useState(!!conversationWindowToolConfig?.enabled);
  const [conversationArtifactMaxCalls, setConversationArtifactMaxCalls] = useState(String(conversationArtifactToolConfig?.maxToolCalls || 8));
  const [htmlArtifactEnabled, setHtmlArtifactEnabled] = useState(!!htmlArtifactToolConfig?.enabled);
  const [htmlArtifactMaxCalls, setHtmlArtifactMaxCalls] = useState(String(htmlArtifactToolConfig?.maxToolCalls || 8));

  const [hbEnabled, setHbEnabled] = useState(!!hotboardConfig?.enabled);
  const [hbApiKey, setHbApiKey] = useState(hotboardConfig?.apiKey || '');
  const [hbPlatformTypes, setHbPlatformTypes] = useState<string[]>(
    normalizeHotboardPlatformTypes(hotboardConfig?.platforms || DEFAULT_HOTBOARD_PLATFORM_TYPES.join(','))
  );

  const [dailyUseDefaultSources, setDailyUseDefaultSources] = useState(dailyPaperConfig?.useDefaultSources ?? true);
  const [dailyCustomSources, setDailyCustomSources] = useState<DailyPaperSourceConfig[]>(dailyPaperConfig?.customSources || []);
  const [dailySourceName, setDailySourceName] = useState('');
  const [dailySourceUrl, setDailySourceUrl] = useState('');
  const [dailySourceCategory, setDailySourceCategory] = useState('general');
  const [dailySourceLanguage, setDailySourceLanguage] = useState('zh');

  const [rcEnabled, setRcEnabled] = useState(!!runCommandConfig?.enabled);
  const [rcSshHost, setRcSshHost] = useState(runCommandConfig?.sshHost || '');
  const [rcSshPort, setRcSshPort] = useState(String(runCommandConfig?.sshPort || 22));
  const [rcSshUsername, setRcSshUsername] = useState(runCommandConfig?.sshUsername || '');
  const [rcSshPassword, setRcSshPassword] = useState(runCommandConfig?.sshPassword || '');
  const [rcSshPrivateKey, setRcSshPrivateKey] = useState(runCommandConfig?.sshPrivateKey || '');
  const [rcSshPassphrase, setRcSshPassphrase] = useState(runCommandConfig?.sshPassphrase || '');
  const [rcStrictHostKeyChecking, setRcStrictHostKeyChecking] = useState(!!runCommandConfig?.strictHostKeyChecking);
  const [rcKnownHosts, setRcKnownHosts] = useState(runCommandConfig?.knownHosts || '');
  const [rcDefaultCwd, setRcDefaultCwd] = useState(runCommandConfig?.defaultCwd || '');
  const [rcCustomPrompt, setRcCustomPrompt] = useState(runCommandConfig?.customPrompt || '');
  const [rcTimeoutMs, setRcTimeoutMs] = useState(String(runCommandConfig?.timeoutMs || 60000));
  const [rcMaxOutputChars, setRcMaxOutputChars] = useState(String(runCommandConfig?.maxOutputChars || 20000));
  const [rcMaxCalls, setRcMaxCalls] = useState(String(runCommandConfig?.maxToolCalls || 20));
  const [rcProfileName, setRcProfileName] = useState('');
  const [rcTesting, setRcTesting] = useState(false);
  const rcProfiles = runCommandConfig?.profiles || [];
  const activeRunCommandProfileId = runCommandConfig?.activeProfileId;

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

  const [mcpMaxCalls, setMcpMaxCalls] = useState(String(mcpToolConfig?.maxToolCalls || 6));
  const [mcpServers, setMcpServers] = useState(mcpToolConfig?.servers || []);
  const [mcpServerName, setMcpServerName] = useState('');
  const [mcpServerUrl, setMcpServerUrl] = useState('');
  const [mcpServerAuth, setMcpServerAuth] = useState('');
  const [mcpSyncingServerId, setMcpSyncingServerId] = useState<string | null>(null);
  const [mcpResourceToolsEnabled, setMcpResourceToolsEnabled] = useState(!!mcpToolConfig?.resourceToolsEnabled);
  const [toolSettingsPage, setToolSettingsPage] = useState<'builtIn' | 'mcp' | 'features'>('builtIn');
  const [locationEnabled, setLocationEnabled] = useState(!!locationShareConfig?.enabled);
  const [locationTencentKey, setLocationTencentKey] = useState(locationShareConfig?.tencentKey || '');
  const [selectedBuiltInToolKey, setSelectedBuiltInToolKey] = useState<string | null>(null);
  const [selectedMcpServerId, setSelectedMcpServerId] = useState<string | null>(null);
  const [selectedMcpToolRef, setSelectedMcpToolRef] = useState<{ serverId: string; toolName: string } | null>(null);
  const [selectedMcpResourceRef, setSelectedMcpResourceRef] = useState<{ serverId: string; uri: string } | null>(null);
  const [selectedMcpPromptRef, setSelectedMcpPromptRef] = useState<{ serverId: string; promptName: string } | null>(null);
  const [mcpPromptArgs, setMcpPromptArgs] = useState('{}');
  const [mcpPromptApplying, setMcpPromptApplying] = useState(false);
  const { addUserMessage } = useChatStore();

  // 设备原生工具本地 state
  const [accountingEnabled, setAccountingEnabled] = useState(!!nativeToolConfig?.accountingEnabled);
  const [messageReactionEnabled, setMessageReactionEnabled] = useState(nativeToolConfig?.messageReactionEnabled !== false);
  const [aiReactionEmojis, setAiReactionEmojis] = useState(formatReactionEmojiList(
    normalizeReactionEmojiList(nativeToolConfig?.aiReactionEmojis, DEFAULT_AI_REACTION_EMOJIS)
  ));
  const [positiveReactionEmojis, setPositiveReactionEmojis] = useState(formatReactionEmojiList(
    normalizeReactionEmojiList(nativeToolConfig?.positiveReactionEmojis, DEFAULT_POSITIVE_REACTION_EMOJIS)
  ));
  const [negativeReactionEmojis, setNegativeReactionEmojis] = useState(formatReactionEmojiList(
    normalizeReactionEmojiList(nativeToolConfig?.negativeReactionEmojis, DEFAULT_NEGATIVE_REACTION_EMOJIS)
  ));
  const [askUserEnabled, setAskUserEnabled] = useState(nativeToolConfig?.askUserEnabled !== false);
  const [askUserMinQuestions, setAskUserMinQuestions] = useState(String(nativeToolConfig?.askUserMinQuestions ?? 1));
  const [askUserMaxQuestions, setAskUserMaxQuestions] = useState(String(nativeToolConfig?.askUserMaxQuestions ?? 4));
  const [askUserMinOptions, setAskUserMinOptions] = useState(String(nativeToolConfig?.askUserMinOptions ?? 2));
  const [askUserMaxOptions, setAskUserMaxOptions] = useState(String(nativeToolConfig?.askUserMaxOptions ?? 4));
  const [deviceInfoEnabled, setDeviceInfoEnabled] = useState(!!nativeToolConfig?.deviceInfoEnabled);
  const [batteryStatusEnabled, setBatteryStatusEnabled] = useState(!!nativeToolConfig?.batteryStatusEnabled);
  const [appUsageStatsEnabled, setAppUsageStatsEnabled] = useState(!!nativeToolConfig?.appUsageStatsEnabled);
  const [calendarEnabled, setCalendarEnabled] = useState(!!nativeToolConfig?.calendarEnabled);
  const [aiVoiceCallEnabled, setAiVoiceCallEnabled] = useState(!!nativeToolConfig?.aiVoiceCallEnabled);
  const [aiVoiceCallHangupEnabled, setAiVoiceCallHangupEnabled] = useState(!!nativeToolConfig?.aiVoiceCallHangupEnabled);
  const [shizukuShellEnabled, setShizukuShellEnabled] = useState(!!nativeToolConfig?.shizukuShellEnabled);
  const [shellTimeoutMs, setShellTimeoutMs] = useState(String(nativeToolConfig?.shellTimeoutMs || 30000));
  const [shellMaxOutputChars, setShellMaxOutputChars] = useState(String(nativeToolConfig?.shellMaxOutputChars || 20000));
  const [shellMaxToolCalls, setShellMaxToolCalls] = useState(String(nativeToolConfig?.shellMaxToolCalls || 10));
  const [shizukuTesting, setShizukuTesting] = useState(false);
  const [shizukuStatusText, setShizukuStatusText] = useState('尚未检测');

  useEffect(() => {
    setLocationEnabled(!!locationShareConfig?.enabled);
    setLocationTencentKey(locationShareConfig?.tencentKey || '');
  }, [locationShareConfig]);

  function handleMemoryVaultEnabledChange(value: boolean) {
    setMvEnabled(value);
    setMemoryVaultConfig({ enabled: value });
    showToast(value ? '记忆库已开启' : '记忆库已关闭');
  }

  function handleWebSearchEnabledChange(value: boolean) {
    setWsEnabled(value);
    setWebSearchConfig({ enabled: value });
    showToast(value ? '联网搜索已开启' : '联网搜索已关闭');
  }

  function handleHotboardEnabledChange(value: boolean) {
    setHbEnabled(value);
    setHotboardConfig({ enabled: value });
    showToast(value ? '热榜查询已开启' : '热榜查询已关闭');
  }

  function handleDailyDefaultSourcesEnabledChange(value: boolean) {
    setDailyUseDefaultSources(value);
    setDailyPaperConfig({
      useDefaultSources: value,
      customSources: dailyCustomSources,
    });
    showToast('日报来源开关已保存');
  }

  function handleRunCommandEnabledChange(value: boolean) {
    setRcEnabled(value);
    setRunCommandConfig({ enabled: value });
    showToast(value ? '远程命令已开启' : '远程命令已关闭');
  }

  function handleQqBotEnabledChange(value: boolean) {
    setQqEnabled(value);
    setQqBotConfig({ enabled: value });
    showToast(value ? 'QQ 机器人已开启' : 'QQ 机器人已关闭');
  }

  function handleWebInteractionEnabledChange(value: boolean) {
    setWiEnabled(value);
    setWebInteractionConfig({ enabled: value });
    showToast(value ? '网页交互已开启' : '网页交互已关闭');
  }

  function handleConversationArtifactEnabledChange(value: boolean) {
    setConversationArtifactEnabled(value);
    setConversationArtifactToolConfig({ enabled: value });
    showToast(value ? '对话文件工具已开启' : '对话文件工具已关闭');
  }

  function handleConversationWindowEnabledChange(value: boolean) {
    setConversationWindowEnabled(value);
    setConversationWindowToolConfig({ enabled: value });
    showToast(value ? '对话窗口查看工具已开启' : '对话窗口查看工具已关闭');
  }

  function handleHtmlArtifactEnabledChange(value: boolean) {
    setHtmlArtifactEnabled(value);
    setHtmlArtifactToolConfig({ enabled: value });
    showToast(value ? 'HTML 预览交互已开启' : 'HTML 预览交互已关闭');
  }

  function handleNativeToolEnabledChange(
    key:
      | 'accountingEnabled'
      | 'messageReactionEnabled'
      | 'askUserEnabled'
      | 'deviceInfoEnabled'
      | 'batteryStatusEnabled'
      | 'appUsageStatsEnabled'
      | 'calendarEnabled'
      | 'aiVoiceCallEnabled'
      | 'aiVoiceCallHangupEnabled'
      | 'shizukuShellEnabled',
    value: boolean
  ) {
    switch (key) {
      case 'messageReactionEnabled':
        setMessageReactionEnabled(value);
        break;
      case 'askUserEnabled':
        setAskUserEnabled(value);
        break;
      case 'accountingEnabled':
        setAccountingEnabled(value);
        break;
      case 'deviceInfoEnabled':
        setDeviceInfoEnabled(value);
        break;
      case 'batteryStatusEnabled':
        setBatteryStatusEnabled(value);
        break;
      case 'appUsageStatsEnabled':
        setAppUsageStatsEnabled(value);
        break;
      case 'calendarEnabled':
        setCalendarEnabled(value);
        break;
      case 'aiVoiceCallEnabled':
        setAiVoiceCallEnabled(value);
        break;
      case 'aiVoiceCallHangupEnabled':
        setAiVoiceCallHangupEnabled(value);
        break;
      case 'shizukuShellEnabled':
        setShizukuShellEnabled(value);
        break;
    }
    setNativeToolConfig({ [key]: value });
    showToast(value ? '内置工具已开启' : '内置工具已关闭');
  }

  async function handleOpenShizukuPairing() {
    if (Platform.OS !== 'android') {
      Alert.alert('暂不支持', 'Shizuku 仅支持 Android 原生版本');
      return;
    }
    try {
      await openShizukuManager();
      Alert.alert('在 Shizuku 中完成配对', '进入“通过无线调试启动”，按 Shizuku 的提示完成配对并启动服务，然后返回 YSClaude 点击“测试连接”。');
    } catch (error: any) {
      Alert.alert('无法打开 Shizuku', error?.message || '请先安装 Shizuku');
    }
  }

  async function handleTestShizuku() {
    setShizukuTesting(true);
    setShizukuStatusText('正在检测…');
    try {
      let status = await getShizukuStatus();
      if (!status.installed) throw new Error('Shizuku 服务未运行，请先完成无线调试配对并启动服务');
      if (!status.permissionGranted) {
        const granted = await requestShizukuPermission();
        if (!granted) throw new Error('YSClaude 的 Shizuku 授权被拒绝');
        status = await getShizukuStatus();
      }
      const result = await executeShizukuShell('id', 15000, 4000);
      if (result.timedOut) throw new Error('Shell 测试命令执行超时');
      if (result.exitCode !== 0) throw new Error(result.stderr || `Shell 返回退出码 ${result.exitCode}`);
      const identity = result.stdout.trim() || `uid=${status.uid}`;
      setShizukuStatusText(`已连接 · ${identity}`);
      Alert.alert('Shizuku 连接成功', identity);
    } catch (error: any) {
      const message = error?.message || '无法连接 Shizuku';
      setShizukuStatusText(`连接失败 · ${message}`);
      Alert.alert('Shizuku 连接失败', message);
    } finally {
      setShizukuTesting(false);
    }
  }

  function handleSaveMemory() {
    const topK = parseInt(mvTopK, 10);
    const tokenBudget = parseInt(mvTokenBudget, 10);
    const maxToolCalls = parseInt(mvMaxCalls, 10);
    setMemoryVaultConfig({
      enabled: mvEnabled,
      baseUrl: mvBaseUrl.trim(),
      adminToken: mvAdminToken.trim(),
      topK: isNaN(topK) || topK <= 0 ? 5 : topK,
      tokenBudget: isNaN(tokenBudget) || tokenBudget <= 0 ? 2000 : tokenBudget,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 3 : maxToolCalls,
      embeddingProvider: mvEmbeddingProvider,
      embeddingBaseUrl: mvEmbeddingBaseUrl.trim(),
      embeddingApiKey: mvEmbeddingApiKey.trim(),
      embeddingModel: mvEmbeddingModel.trim(),
      splitBaseUrl: mvSplitBaseUrl.trim(),
      splitApiKey: mvSplitApiKey.trim(),
      splitModel: mvSplitModel.trim(),
    });
    showToast('记忆库配置已保存');
  }

  async function handleTestMemory() {
    setMvTesting(true);
    try {
      const { generateMemoryEmbedding } = await import('../../services/localMemoryVault');
      const config = {
        ...memoryVaultConfig,
        embeddingProvider: mvEmbeddingProvider,
        embeddingBaseUrl: mvEmbeddingBaseUrl.trim(),
        embeddingApiKey: mvEmbeddingApiKey.trim(),
        embeddingModel: mvEmbeddingModel.trim(),
      };
      const embedding = await generateMemoryEmbedding('记忆库连接测试', config);
      if (!embedding?.length) throw new Error('请填写 Embedding API Key');
      showToast(`向量 API 正常（${embedding.length} 维）`);
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

  function handleSaveWebInteraction() {
    const maxToolCalls = parseInt(wiMaxCalls, 10);
    setWebInteractionConfig({
      enabled: wiEnabled,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 8 : maxToolCalls,
    });
    showToast(wiEnabled ? '网页交互配置已保存' : '网页交互已关闭');
  }

  function handleSaveConversationArtifactTools() {
    const maxToolCalls = parseInt(conversationArtifactMaxCalls, 10);
    setConversationArtifactToolConfig({
      enabled: conversationArtifactEnabled,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 8 : maxToolCalls,
    });
    showToast(conversationArtifactEnabled ? '对话文件工具已保存' : '对话文件工具已关闭');
  }

  function handleSaveHtmlArtifactTools() {
    const maxToolCalls = parseInt(htmlArtifactMaxCalls, 10);
    setHtmlArtifactToolConfig({
      enabled: htmlArtifactEnabled,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 8 : maxToolCalls,
    });
    showToast(htmlArtifactEnabled ? 'HTML 预览交互工具已保存' : 'HTML 预览交互工具已关闭');
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

  function handleSaveLocationShare() {
    if (locationEnabled && !locationTencentKey.trim()) {
      Alert.alert('提示', '启用位置分享时请填写腾讯地图 Key');
      return false;
    }
    setLocationShareConfig({
      enabled: locationEnabled,
      provider: 'tencent',
      tencentKey: locationTencentKey.trim(),
    });
    showToast(locationEnabled ? '位置分享配置已保存' : '位置分享已关闭');
    return true;
  }

  function handleLocationShareEnabledChange(value: boolean) {
    setLocationEnabled(value);
    if (!value) {
      setLocationShareConfig({
        enabled: false,
        provider: 'tencent',
        tencentKey: locationTencentKey.trim(),
      });
      showToast('位置分享已关闭');
      return;
    }
    if (!locationTencentKey.trim()) {
      setSelectedBuiltInToolKey('locationShare');
      showToast('请先填写腾讯地图 Key');
      return;
    }
    setLocationShareConfig({
      enabled: true,
      provider: 'tencent',
      tencentKey: locationTencentKey.trim(),
    });
    showToast('位置分享已开启');
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
    const sshPort = parseInt(rcSshPort, 10);
    const timeoutMs = parseInt(rcTimeoutMs, 10);
    const maxOutputChars = parseInt(rcMaxOutputChars, 10);
    const maxToolCalls = parseInt(rcMaxCalls, 10);
    return {
      enabled: rcEnabled,
      sshHost: rcSshHost.trim(),
      sshPort: isNaN(sshPort) ? 22 : Math.min(65535, Math.max(1, sshPort)),
      sshUsername: rcSshUsername.trim(),
      sshPassword: rcSshPassword,
      sshPrivateKey: rcSshPrivateKey.trim(),
      sshPassphrase: rcSshPassphrase,
      strictHostKeyChecking: rcStrictHostKeyChecking,
      knownHosts: rcKnownHosts.trim(),
      defaultCwd: rcDefaultCwd.trim(),
      customPrompt: rcCustomPrompt.trim(),
      timeoutMs: isNaN(timeoutMs) || timeoutMs <= 0 ? 60000 : Math.min(3600000, Math.max(1000, timeoutMs)),
      maxOutputChars: isNaN(maxOutputChars) || maxOutputChars <= 0 ? 20000 : Math.min(500000, Math.max(1000, maxOutputChars)),
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 20 : maxToolCalls,
    };
  }

  function buildRunCommandProfileConfig(): RunCommandProfileConfig {
    const { enabled: _enabled, ...profileConfig } = buildRunCommandConfigDraft();
    return profileConfig;
  }

  function applyRunCommandProfileConfig(config: RunCommandProfileConfig) {
    setRcSshHost(config.sshHost || '');
    setRcSshPort(String(config.sshPort || 22));
    setRcSshUsername(config.sshUsername || '');
    setRcSshPassword(config.sshPassword || '');
    setRcSshPrivateKey(config.sshPrivateKey || '');
    setRcSshPassphrase(config.sshPassphrase || '');
    setRcStrictHostKeyChecking(!!config.strictHostKeyChecking);
    setRcKnownHosts(config.knownHosts || '');
    setRcDefaultCwd(config.defaultCwd || '');
    setRcCustomPrompt(config.customPrompt || '');
    setRcTimeoutMs(String(config.timeoutMs || 60000));
    setRcMaxOutputChars(String(config.maxOutputChars || 20000));
    setRcMaxCalls(String(config.maxToolCalls || 20));
  }

  function validateRunCommandProfileConfig(config: RunCommandProfileConfig): boolean {
    if (!config.sshHost) {
      Alert.alert('提示', '请先填写 SSH 主机');
      return false;
    }
    if (!config.sshUsername) {
      Alert.alert('提示', '请先填写 SSH 用户名');
      return false;
    }
    if (!config.sshPassword && !config.sshPrivateKey) {
      Alert.alert('提示', '请至少填写 SSH 密码或私钥');
      return false;
    }
    return true;
  }

  function createRunCommandProfileId(name: string): string {
    const base = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || `ssh-${Date.now().toString(36)}`;
    let id = base;
    let suffix = 2;
    while (rcProfiles.some((profile) => profile.id === id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    return id;
  }

  function handleSaveRunCommandProfile() {
    const name = rcProfileName.trim();
    if (!name) {
      Alert.alert('提示', '请填写配置名称');
      return;
    }
    const config = buildRunCommandProfileConfig();
    if (!validateRunCommandProfileConfig(config)) return;

    const profile: RunCommandProfile = {
      id: createRunCommandProfileId(name),
      name,
      updatedAt: Date.now(),
      config,
    };
    setRunCommandConfig({
      ...config,
      profiles: [...rcProfiles, profile],
      activeProfileId: profile.id,
    });
    setRcProfileName('');
    showToast('SSH 配置已保存');
  }

  function handleApplyRunCommandProfile(profile: RunCommandProfile) {
    applyRunCommandProfileConfig(profile.config);
    setRunCommandConfig({
      ...profile.config,
      activeProfileId: profile.id,
    });
    showToast(`已切换到 ${profile.name}`);
  }

  function handleUpdateRunCommandProfile(profile: RunCommandProfile) {
    const config = buildRunCommandProfileConfig();
    if (!validateRunCommandProfileConfig(config)) return;
    const updatedProfiles = rcProfiles.map((item) =>
      item.id === profile.id
        ? { ...item, config, updatedAt: Date.now() }
        : item
    );
    setRunCommandConfig({
      ...config,
      profiles: updatedProfiles,
      activeProfileId: profile.id,
    });
    showToast(`${profile.name} 已覆盖`);
  }

  function handleRemoveRunCommandProfile(profile: RunCommandProfile) {
    Alert.alert('删除 SSH 配置', `确定删除「${profile.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          setRunCommandConfig({
            profiles: rcProfiles.filter((item) => item.id !== profile.id),
            activeProfileId: activeRunCommandProfileId === profile.id ? undefined : activeRunCommandProfileId,
          });
          showToast('SSH 配置已删除');
        },
      },
    ]);
  }

  function handleSaveRunCommand() {
    const config = buildRunCommandConfigDraft();
    if (config.enabled && !config.sshHost) {
      Alert.alert('提示', '启用远程命令时请填写 SSH 主机');
      return false;
    }
    if (config.enabled && !config.sshUsername) {
      Alert.alert('提示', '启用远程命令时请填写 SSH 用户名');
      return false;
    }
    if (config.enabled && !config.sshPassword && !config.sshPrivateKey) {
      Alert.alert('提示', '请至少填写 SSH 密码或私钥');
      return false;
    }
    setRunCommandConfig(config);
    showToast(config.enabled ? 'SSH 远程命令已保存' : '远程命令工具已关闭');
    return true;
  }

  async function handleTestRunCommand() {
    const config = buildRunCommandConfigDraft();
    if (Platform.OS !== 'android') {
      Alert.alert('暂不支持', 'SSH 远程命令当前仅支持 Android development build');
      return;
    }
    const remoteSshCommand = NativeModules.RemoteSshCommand as
      | {
          connect: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
          command: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
          close: () => Promise<Record<string, unknown>>;
        }
      | undefined;
    if (!remoteSshCommand) {
      Alert.alert('原生模块未加载', '请重新运行 npx expo run:android 安装包含 SSH 原生模块的新包');
      return;
    }
    if (!config.sshHost || !config.sshUsername || (!config.sshPassword && !config.sshPrivateKey)) {
      Alert.alert('提示', '请先填写 SSH 主机、用户名，以及密码或私钥');
      return;
    }
    setRcTesting(true);
    try {
      await remoteSshCommand.connect({
        host: config.sshHost,
        port: config.sshPort,
        username: config.sshUsername,
        password: config.sshPassword || undefined,
        privateKey: config.sshPrivateKey || undefined,
        passphrase: config.sshPassphrase || undefined,
        strictHostKeyChecking: config.strictHostKeyChecking,
        knownHosts: config.knownHosts || undefined,
        cwd: config.defaultCwd || undefined,
        timeoutMs: Math.min(config.timeoutMs, 30000),
        maxOutputChars: 4000,
      });
      const result = await remoteSshCommand.command({
        command: 'echo ysclaude-run-command-ok',
        timeoutMs: Math.min(config.timeoutMs, 30000),
        maxOutputChars: 4000,
      });
      await remoteSshCommand.close();
      const stdout = String(result?.stdout || '');
      const stderr = String(result?.stderr || '');
      showToast(stdout.includes('ysclaude-run-command-ok') ? 'SSH 连接正常' : `SSH 已响应: ${stderr || stdout || '无输出'}`);
    } catch (error: any) {
      Alert.alert('SSH 连接失败', error?.message || '无法连接远程服务器');
    } finally {
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

  function handleAddMcpServer() {
    const name = mcpServerName.trim();
    const url = mcpServerUrl.trim();
    if (!name || !url) {
      Alert.alert('提示', '请填写 MCP 服务名称和地址');
      return;
    }

    const baseId = sanitizeMcpServerId(name || url) || `mcp-${Date.now().toString(36)}`;
    let id = baseId;
    let suffix = 2;
    while (mcpServers.some((server) => server.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const nextServers = [
      ...mcpServers,
      {
        id,
        name,
        url,
        authorization: mcpServerAuth.trim(),
        enabled: true,
        tools: [],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        updatedAt: Date.now(),
      },
    ];
    setMcpServers(nextServers);
    persistMcpTools(nextServers);
    setMcpServerName('');
    setMcpServerUrl('');
    setMcpServerAuth('');
    showToast('MCP 服务已添加并保存');
  }

  function buildMcpToolConfigDraft(
    nextServers = mcpServers,
    nextResourceToolsEnabled = mcpResourceToolsEnabled,
    nextMaxCalls = mcpMaxCalls
  ) {
    const maxToolCalls = parseInt(nextMaxCalls, 10);
    const hasEnabledMcpTool = nextServers.some(
      (server) => server.enabled && (server.tools || []).some((tool) => tool.enabled !== false)
    );
    const hasEnabledMcpResourceTool = nextResourceToolsEnabled && nextServers.some(
      (server) => server.enabled && (server.resources || []).some((resource) => resource.enabled !== false)
    );
    const hasPinnedMcpResource = nextServers.some(
      (server) => server.enabled && (server.resources || []).some((resource) => resource.enabled !== false && resource.pinned)
    );
    return {
      enabled: hasEnabledMcpTool || hasEnabledMcpResourceTool || hasPinnedMcpResource,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 6 : maxToolCalls,
      resourceToolsEnabled: nextResourceToolsEnabled,
      servers: nextServers,
    };
  }

  function persistMcpTools(
    nextServers = mcpServers,
    nextResourceToolsEnabled = mcpResourceToolsEnabled,
    nextMaxCalls = mcpMaxCalls
  ) {
    setMcpToolConfig(buildMcpToolConfigDraft(nextServers, nextResourceToolsEnabled, nextMaxCalls));
  }

  function handleChangeMcpMaxCalls(value: string) {
    setMcpMaxCalls(value);
    persistMcpTools(mcpServers, mcpResourceToolsEnabled, value);
  }

  function handleMcpResourceToolsEnabledChange(value: boolean) {
    setMcpResourceToolsEnabled(value);
    persistMcpTools(mcpServers, value);
    showToast(value ? 'MCP 资源读取工具已开启' : 'MCP 资源读取工具已关闭');
  }

  function handleUpdateMcpServer(
    serverId: string,
    patch: Partial<(typeof mcpServers)[number]>
  ) {
    const nextServers = mcpServers.map((server) =>
      server.id === serverId
        ? { ...server, ...patch, updatedAt: Date.now() }
        : server
    );
    setMcpServers(nextServers);
    persistMcpTools(nextServers);
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      showToast(patch.enabled ? 'MCP 服务已开启' : 'MCP 服务已关闭');
    }
  }

  function handleUpdateMcpServerToolEnabled(serverId: string, toolName: string, enabled: boolean) {
    const nextServers = mcpServers.map((server) =>
      server.id === serverId
        ? {
            ...server,
            tools: (server.tools || []).map((tool) =>
              tool.name === toolName ? { ...tool, enabled } : tool
            ),
            updatedAt: Date.now(),
          }
        : server
    );
    setMcpServers(nextServers);
    persistMcpTools(nextServers);
    showToast(enabled ? 'MCP 工具已开启' : 'MCP 工具已关闭');
  }

  function handleUpdateMcpServerResource(
    serverId: string,
    uri: string,
    patch: Partial<NonNullable<(typeof mcpServers)[number]['resources']>[number]>
  ) {
    const nextServers = mcpServers.map((server) =>
      server.id === serverId
        ? {
            ...server,
            resources: (server.resources || []).map((resource) =>
              resource.uri === uri ? { ...resource, ...patch } : resource
            ),
            updatedAt: Date.now(),
          }
        : server
    );
    setMcpServers(nextServers);
    persistMcpTools(nextServers);
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      showToast(patch.enabled ? 'MCP 资源已开启' : 'MCP 资源已关闭');
    } else if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) {
      showToast(patch.pinned ? 'MCP 资源已固定附加' : 'MCP 资源已取消固定');
    }
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
      const nextServers = mcpServers.map((item) =>
        item.id === serverId
          ? {
              ...item,
              tools: capabilities.tools,
              resources: capabilities.resources,
              resourceTemplates: capabilities.resourceTemplates,
              prompts: capabilities.prompts,
              updatedAt: Date.now(),
            }
          : item
      );
      setMcpServers(nextServers);
      persistMcpTools(nextServers);
      showToast('MCP 能力已同步并保存');
    } catch (error: any) {
      Alert.alert('同步失败', error?.message || '无法读取 MCP 能力');
    } finally {
      setMcpSyncingServerId(null);
    }
  }

  function handleRemoveMcpServer(serverId: string) {
    const nextServers = mcpServers.filter((server) => server.id !== serverId);
    setMcpServers(nextServers);
    persistMcpTools(nextServers);
    if (selectedMcpServerId === serverId) {
      setSelectedMcpServerId(null);
    }
    showToast('MCP 服务已删除并保存');
  }

  function handleSaveNativeTools() {
    const minQuestions = Math.max(1, Math.min(10, parseInt(askUserMinQuestions, 10) || 1));
    const maxQuestions = Math.max(minQuestions, Math.min(10, parseInt(askUserMaxQuestions, 10) || 4));
    const minOptions = Math.max(1, Math.min(8, parseInt(askUserMinOptions, 10) || 2));
    const maxOptions = Math.max(minOptions, Math.min(8, parseInt(askUserMaxOptions, 10) || 4));
    const normalizedAiReactionEmojis = normalizeReactionEmojiList(aiReactionEmojis, DEFAULT_AI_REACTION_EMOJIS);
    const normalizedPositiveReactionEmojis = normalizeReactionEmojiList(positiveReactionEmojis, DEFAULT_POSITIVE_REACTION_EMOJIS);
    const normalizedNegativeReactionEmojis = normalizeReactionEmojiList(negativeReactionEmojis, DEFAULT_NEGATIVE_REACTION_EMOJIS);
    setAskUserMinQuestions(String(minQuestions));
    setAskUserMaxQuestions(String(maxQuestions));
    setAskUserMinOptions(String(minOptions));
    setAskUserMaxOptions(String(maxOptions));
    setAiReactionEmojis(formatReactionEmojiList(normalizedAiReactionEmojis));
    setPositiveReactionEmojis(formatReactionEmojiList(normalizedPositiveReactionEmojis));
    setNegativeReactionEmojis(formatReactionEmojiList(normalizedNegativeReactionEmojis));
    setNativeToolConfig({
      messageReactionEnabled,
      aiReactionEmojis: normalizedAiReactionEmojis,
      positiveReactionEmojis: normalizedPositiveReactionEmojis,
      negativeReactionEmojis: normalizedNegativeReactionEmojis,
      askUserEnabled,
      askUserMinQuestions: minQuestions,
      askUserMaxQuestions: maxQuestions,
      askUserMinOptions: minOptions,
      askUserMaxOptions: maxOptions,
      accountingEnabled,
      deviceInfoEnabled,
      batteryStatusEnabled,
      appUsageStatsEnabled,
      calendarEnabled,
      aiVoiceCallEnabled,
      aiVoiceCallHangupEnabled,
      shizukuShellEnabled,
      shellTimeoutMs: Math.max(1000, Math.min(600000, parseInt(shellTimeoutMs, 10) || 30000)),
      shellMaxOutputChars: Math.max(1000, Math.min(1000000, parseInt(shellMaxOutputChars, 10) || 20000)),
      shellMaxToolCalls: Math.max(1, Math.min(100, parseInt(shellMaxToolCalls, 10) || 10)),
    });
    showToast('设备原生工具开关已保存');
  }

  const dailyPaperSourcesCard = {
    key: 'dailyPaperSources',
    name: '日报来源',
    intro: '配置每日日报生成时读取的 RSS 新闻来源。',
    enabled: dailyUseDefaultSources || dailyCustomSources.some((source) => source.enabled),
    onValueChange: handleDailyDefaultSourcesEnabledChange,
    meta: (dailyUseDefaultSources ? 6 : 0) + dailyCustomSources.filter((source) => source.enabled).length + ' 个来源',
  };
  const locationShareCard = {
    key: 'locationShare',
    name: '位置分享',
    intro: '加号菜单可发送当前位置卡片，并用腾讯地图解析地址和缩略图。',
    enabled: locationEnabled,
    onValueChange: handleLocationShareEnabledChange,
    meta: locationTencentKey.trim() ? '腾讯地图 Key 已配置' : '需要腾讯地图 Key',
  };
  const otherFeatureCards = [dailyPaperSourcesCard, locationShareCard];

  const builtInToolCards = [
    { key: 'askUser', name: '选项卡追问', intro: '允许 AI 在需要补充信息时展示问题和快捷选项，回答完成后继续对话。', enabled: askUserEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('askUserEnabled', value), meta: `${askUserMinQuestions}-${askUserMaxQuestions} 题 · ${askUserMinOptions}-${askUserMaxOptions} 项` },
    { key: 'messageReaction', name: '消息表情回应', intro: '允许 AI 给用户消息贴 emoji，并配置用户给 AI 消息回应时的两个表情面板。', enabled: messageReactionEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('messageReactionEnabled', value), meta: `${normalizeReactionEmojiList(aiReactionEmojis, DEFAULT_AI_REACTION_EMOJIS).length} 个 AI 表情` },
    { key: 'shizukuShell', name: 'Shizuku 本机终端', intro: '允许 AI 以 Shizuku 身份在当前 Android 设备执行 Shell 命令。', enabled: shizukuShellEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('shizukuShellEnabled', value), meta: '超时 ' + shellTimeoutMs + ' ms' },
    { key: 'accounting', name: '记账管理', intro: '允许 AI 查看用户今日消费与收入，并新增或删除流水记录。', enabled: accountingEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('accountingEnabled', value), meta: '3 个工具' },
    { key: 'webSearch', name: '联网搜索', intro: '通过 Tavily 搜索互联网，补充实时信息。', enabled: wsEnabled, onValueChange: handleWebSearchEnabledChange, meta: '1 个工具' },
    { key: 'hotboard', name: '热榜查询', intro: '从已选择的平台列表中查询热门话题。', enabled: hbEnabled, onValueChange: handleHotboardEnabledChange, meta: hbPlatformTypes.length + ' 个平台' },
    { key: 'runCommand', name: '远程命令', intro: '通过 SSH 连接专用 AI 服务器执行 shell 命令。与「对话文件」同时开启时，自动激活对话文件与服务器互传工具。', enabled: rcEnabled, onValueChange: handleRunCommandEnabledChange, meta: '最多 ' + (rcMaxCalls || '20') + ' 次' },
    { key: 'qqBotTools', name: 'QQ Bot 工具', intro: '本机连接 QQ 官方 Bot，AI 可查看消息列表、读取本地历史并向指定联系人或群聊发消息。', enabled: localQqEnabled, onValueChange: handleLocalQqBotToolsEnabledChange, meta: '3 个工具' },
    { key: 'wechatClawBotTools', name: '微信 ClawBot 工具', intro: '本机连接微信 ClawBot，AI 可读取本地历史并向绑定账号发消息。', enabled: wechatClawEnabled, onValueChange: handleWechatClawBotToolsEnabledChange, meta: '2 个工具' },
    { key: 'webInteraction', name: '网页交互', intro: '允许 AI 打开、观察并操作应用内网页面板。', enabled: wiEnabled, onValueChange: handleWebInteractionEnabledChange, meta: '最多 ' + (wiMaxCalls || '8') + ' 次' },
    { key: 'conversationArtifact', name: '对话文件', intro: '允许 AI 读取、创建、修改、删除当前对话绑定的文本文件，并显式显示文件卡片。与「远程命令」同时开启时，自动激活对话文件与服务器互传工具。', enabled: conversationArtifactEnabled, onValueChange: handleConversationArtifactEnabledChange, meta: '7 个工具' },
    { key: 'conversationWindow', name: '对话窗口查看', intro: '允许 AI 分页查看对话窗口、读取指定楼层，并在单个或全部窗口内进行单关键词、多关键词分页搜索。读取不受隐藏楼层影响。', enabled: conversationWindowEnabled, onValueChange: handleConversationWindowEnabledChange, meta: '7 个工具' },
    { key: 'htmlArtifact', name: 'HTML 预览交互', intro: '允许 AI 打开、观察、点击和编辑当前对话中的 HTML 文件预览。', enabled: htmlArtifactEnabled, onValueChange: handleHtmlArtifactEnabledChange, meta: '11 个工具' },
    { key: 'deviceInfo', name: '设备信息', intro: '读取设备品牌、型号、系统版本和运行状态。', enabled: deviceInfoEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('deviceInfoEnabled', value), meta: '设备原生' },
    { key: 'batteryStatus', name: '电池状态', intro: '读取电量、充电状态和省电模式。', enabled: batteryStatusEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('batteryStatusEnabled', value), meta: '设备原生' },
    { key: 'appUsageStats', name: '应用使用统计', intro: '在系统授权后读取 Android 应用使用时间统计。', enabled: appUsageStatsEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('appUsageStatsEnabled', value), meta: '设备原生' },
    { key: 'calendar', name: '系统日历', intro: '读取、创建、修改和删除系统日历日程。', enabled: calendarEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('calendarEnabled', value), meta: '设备原生' },
    { key: 'notificationReader', name: '通知读取', intro: '读取全部当前通知，或根据应用名称和包名查找。首次使用需授予通知使用权。', enabled: !!nativeToolConfig.notificationReaderEnabled, onValueChange: (value: boolean) => setNativeToolConfig({ notificationReaderEnabled: value }), meta: '2 个工具' },
    { key: 'clipboardReader', name: '剪切板读取', intro: '读取剪切板中最新的文本内容。', enabled: !!nativeToolConfig.clipboardReaderEnabled, onValueChange: (value: boolean) => setNativeToolConfig({ clipboardReaderEnabled: value }), meta: '1 个工具' },
    { key: 'contactsCommunication', name: '联系人与通信', intro: '打开联系人编辑器、短信编辑器或拨号盘；保存、发送和拨号均由用户最终确认。', enabled: !!nativeToolConfig.contactsCommunicationEnabled, onValueChange: (value: boolean) => setNativeToolConfig({ contactsCommunicationEnabled: value }), meta: '3 个工具' },
    { key: 'weather', name: '天气系统', intro: '根据城市、区县或设备当前位置，通过国内天气服务读取实时天气和未来 7 天预报。', enabled: !!nativeToolConfig.weatherEnabled, onValueChange: (value: boolean) => setNativeToolConfig({ weatherEnabled: value }), meta: 'UAPI 国内天气' },
    { key: 'aiVoiceCall', name: '主动通话', intro: '允许 AI 发起语音、视频或共享屏幕通话；接听后 AI 会先开口。', enabled: aiVoiceCallEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('aiVoiceCallEnabled', value), meta: '设备原生' },
    { key: 'aiVoiceCallHangup', name: '主动挂断', intro: '允许 AI 在通话过程中主动结束当前通话；未通话时不会提供这个工具。', enabled: aiVoiceCallHangupEnabled, onValueChange: (value: boolean) => handleNativeToolEnabledChange('aiVoiceCallHangupEnabled', value), meta: '通话中可用' },
  ];
  const builtInToolGroups = [
    { title: '对话与表达', keys: ['askUser', 'messageReaction', 'conversationWindow'] },
    { title: '文件与内容', keys: ['conversationArtifact', 'htmlArtifact'] },
    { title: '网络与网页', keys: ['webSearch', 'hotboard', 'webInteraction'] },
    { title: '个人事务', keys: ['accounting', 'calendar', 'weather', 'contactsCommunication'] },
    { title: '设备信息', keys: ['deviceInfo', 'batteryStatus', 'appUsageStats', 'notificationReader', 'clipboardReader'] },
    { title: 'Bot 与软件联动', keys: ['qqBotTools', 'wechatClawBotTools'] },
    { title: '通话控制', keys: ['aiVoiceCall', 'aiVoiceCallHangup'] },
    { title: '命令与自动化', keys: ['shizukuShell', 'runCommand'] },
  ].map((group) => ({
    title: group.title,
    tools: group.keys
      .map((key) => builtInToolCards.find((tool) => tool.key === key))
      .filter((tool): tool is (typeof builtInToolCards)[number] => !!tool),
  }));

  const selectedOtherFeature = otherFeatureCards.find((tool) => tool.key === selectedBuiltInToolKey) || null;
  const selectedBuiltInTool = selectedOtherFeature
    ? selectedOtherFeature
    : builtInToolCards.find((tool) => tool.key === selectedBuiltInToolKey) || null;
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
            case 'askUser':
              handleSaveNativeTools();
              break;
            case 'messageReaction':
              handleSaveNativeTools();
              break;
            case 'memoryVault':
        handleSaveMemory();
        break;
      case 'webSearch':
        handleSaveWebSearch();
        break;
      case 'hotboard':
        handleSaveHotboard();
        break;
      case 'dailyPaperSources':
        return handleSaveDailyPaperSources();
      case 'locationShare':
        return handleSaveLocationShare();
      case 'runCommand':
        return handleSaveRunCommand();
      case 'webInteraction':
        handleSaveWebInteraction();
        break;
      case 'conversationArtifact':
        handleSaveConversationArtifactTools();
        break;
      case 'conversationWindow':
        setConversationWindowToolConfig({ enabled: conversationWindowEnabled });
        showToast(conversationWindowEnabled ? '对话窗口查看工具已保存' : '对话窗口查看工具已关闭');
        break;
      case 'htmlArtifact':
        handleSaveHtmlArtifactTools();
        break;
      case 'qqBot':
        return handleSaveQqBot();
      case 'qqBotTools':
        saveLocalQqBotTools();
        break;
      case 'wechatClawBotTools':
        saveWechatClawBotTools();
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
            case 'messageReaction':
              setMessageReactionEnabled(false);
              setNativeToolConfig({ messageReactionEnabled: false });
              break;
            case 'askUser':
              setAskUserEnabled(false);
              setNativeToolConfig({ askUserEnabled: false });
              break;
            case 'accounting':
              setAccountingEnabled(false);
              setNativeToolConfig({ accountingEnabled: false });
              break;
            case 'memoryVault':
              setMvEnabled(false);
              setMemoryVaultConfig({ enabled: false });
              break;
            case 'webSearch':
              setWsEnabled(false);
              setWebSearchConfig({ enabled: false });
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
            case 'locationShare':
              setLocationEnabled(false);
              setLocationShareConfig({
                enabled: false,
                provider: 'tencent',
                tencentKey: locationTencentKey.trim(),
              });
              break;
            case 'runCommand':
              setRcEnabled(false);
              setRunCommandConfig({ enabled: false });
              break;
            case 'webInteraction':
              setWiEnabled(false);
              setWebInteractionConfig({ enabled: false });
              break;
            case 'conversationArtifact':
              setConversationArtifactEnabled(false);
              setConversationArtifactToolConfig({ enabled: false });
              break;
            case 'conversationWindow':
              setConversationWindowEnabled(false);
              setConversationWindowToolConfig({ enabled: false });
              break;
            case 'htmlArtifact':
              setHtmlArtifactEnabled(false);
              setHtmlArtifactToolConfig({ enabled: false });
              break;
            case 'qqBot':
              setQqEnabled(false);
              setQqBotConfig({ enabled: false });
              break;
            case 'qqBotTools':
              setLocalQqEnabled(false);
              setQqBotToolConfig({ enabled: false });
              break;
            case 'wechatClawBotTools':
              setWechatClawEnabled(false);
              setWechatClawBotToolConfig({ enabled: false });
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
            case 'notificationReader': setNativeToolConfig({ notificationReaderEnabled: false }); break;
            case 'clipboardReader': setNativeToolConfig({ clipboardReaderEnabled: false }); break;
            case 'contactsCommunication': setNativeToolConfig({ contactsCommunicationEnabled: false }); break;
            case 'weather': setNativeToolConfig({ weatherEnabled: false }); break;
            case 'aiVoiceCall':
              setAiVoiceCallEnabled(false);
              setNativeToolConfig({ aiVoiceCallEnabled: false });
              break;
            case 'aiVoiceCallHangup':
              setAiVoiceCallHangupEnabled(false);
              setNativeToolConfig({ aiVoiceCallHangupEnabled: false });
              break;
            case 'shizukuShell':
              setShizukuShellEnabled(false);
              setNativeToolConfig({ shizukuShellEnabled: false });
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
        },
      },
    ]);
  }

  function renderBuiltInToolEditor(toolKey: string) {
    switch (toolKey) {
      case 'askUser':
        return (
          <>
            <Text style={styles.toolModalDescription}>AI 需要用户补充信息时，可以在输入框上方展示一个或多个问题。用户可选择快捷答案，也可输入自己的回答。</Text>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用选项卡追问</Text>
                <Text style={styles.hint}>关闭后不会向模型提供 ask_user 工具。</Text>
              </View>
              <Switch value={askUserEnabled} onValueChange={(value) => handleNativeToolEnabledChange('askUserEnabled', value)} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
            </View>
            <View style={styles.toolNumberRow}>
              <View style={styles.toolNumberField}>
                <Text style={styles.label}>最少问题数</Text>
                <TextInput style={styles.input} value={askUserMinQuestions} onChangeText={setAskUserMinQuestions} keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
              </View>
              <View style={styles.toolNumberField}>
                <Text style={styles.label}>最多问题数</Text>
                <TextInput style={styles.input} value={askUserMaxQuestions} onChangeText={setAskUserMaxQuestions} keyboardType="number-pad" placeholder="4" placeholderTextColor={colors.textTertiary} />
              </View>
            </View>
            <View style={styles.toolNumberRow}>
              <View style={styles.toolNumberField}>
                <Text style={styles.label}>每题最少选项</Text>
                <TextInput style={styles.input} value={askUserMinOptions} onChangeText={setAskUserMinOptions} keyboardType="number-pad" placeholder="2" placeholderTextColor={colors.textTertiary} />
              </View>
              <View style={styles.toolNumberField}>
                <Text style={styles.label}>每题最多选项</Text>
                <TextInput style={styles.input} value={askUserMaxOptions} onChangeText={setAskUserMaxOptions} keyboardType="number-pad" placeholder="4" placeholderTextColor={colors.textTertiary} />
              </View>
            </View>
            <Text style={styles.hint}>问题数可设为 1–10，选项数可设为 1–8；保存时会自动修正无效范围。</Text>
          </>
        );
      case 'messageReaction':
        return (
          <>
            <Text style={styles.toolModalDescription}>AI 可以给用户消息贴 emoji；用户也可以通过 AI 消息下方的两个回应按键选择 emoji。三个列表可分别配置。</Text>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>允许 AI 给消息贴表情</Text>
                <Text style={styles.hint}>关闭后不向模型提供工具，用户的两个回应面板仍可使用。</Text>
              </View>
              <Switch value={messageReactionEnabled} onValueChange={(value) => handleNativeToolEnabledChange('messageReactionEnabled', value)} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>AI 可使用的 emoji</Text>
              <TextInput style={styles.input} value={aiReactionEmojis} onChangeText={setAiReactionEmojis} placeholder="❤️ 👍 😂 🥰 🎉" placeholderTextColor={colors.textTertiary} />
              <Text style={styles.hint}>AI 工具只能从这个列表选择。</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>第一个按键的 emoji 面板</Text>
              <TextInput style={styles.input} value={positiveReactionEmojis} onChangeText={setPositiveReactionEmojis} placeholder="❤️ 👍 😂 🥰 🎉" placeholderTextColor={colors.textTertiary} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>第二个按键的 emoji 面板</Text>
              <TextInput style={styles.input} value={negativeReactionEmojis} onChangeText={setNegativeReactionEmojis} placeholder="😕 👎 😢 😠 💔" placeholderTextColor={colors.textTertiary} />
            </View>
            <Text style={styles.hint}>使用空格、逗号或换行分隔，自动去重；每组最多保存 24 个。</Text>
          </>
        );
      case 'shizukuShell':
        return (<><Text style={styles.toolModalDescription}>AI 可通过 Shizuku 在本机执行 /system/bin/sh 命令。终端入口始终由用户手动使用，此开关只控制 AI 工具。</Text><Text style={styles.hint}>连接状态：{shizukuStatusText}</Text><View style={styles.platformActions}><Pressable style={styles.platformActionButton} onPress={handleOpenShizukuPairing}><Text style={styles.platformActionText}>打开 Shizuku 配对/启动</Text></Pressable><Pressable style={[styles.platformActionButton, shizukuTesting && styles.importButtonDisabled]} onPress={handleTestShizuku} disabled={shizukuTesting}>{shizukuTesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.platformActionText}>测试连接</Text>}</Pressable></View><View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>允许 AI 执行本机 Shell</Text><Text style={styles.hint}>实际身份取决于 Shizuku 以 ADB shell 还是 Root 模式启动。</Text></View><Switch value={shizukuShellEnabled} onValueChange={(value) => handleNativeToolEnabledChange('shizukuShellEnabled', value)} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>超时时间（毫秒）</Text><TextInput style={styles.input} value={shellTimeoutMs} onChangeText={setShellTimeoutMs} keyboardType="number-pad" placeholder="30000" placeholderTextColor={colors.textTertiary}/></View><View style={styles.field}><Text style={styles.label}>输出上限（字符）</Text><TextInput style={styles.input} value={shellMaxOutputChars} onChangeText={setShellMaxOutputChars} keyboardType="number-pad" placeholder="20000" placeholderTextColor={colors.textTertiary}/></View><View style={styles.field}><Text style={styles.label}>每轮最大调用次数</Text><TextInput style={styles.input} value={shellMaxToolCalls} onChangeText={setShellMaxToolCalls} keyboardType="number-pad" placeholder="10" placeholderTextColor={colors.textTertiary}/></View></>);
      case 'accounting':
        return (<><Text style={styles.toolModalDescription}>AI 可以读取今天的收入与支出、可用分类和付款方式，并新增或删除流水。新增和删除会同步更新付款方式余额。</Text><View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>启用记账管理</Text><Text style={styles.hint}>关闭后 AI 无法读取或修改任何记账数据。</Text></View><Switch value={accountingEnabled} onValueChange={(value) => handleNativeToolEnabledChange('accountingEnabled', value)} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View></>);
      case 'memoryVault':
        return (
          <>
            <Text style={styles.toolModalDescription}>AI 可以搜索、写入设备本地记忆，并直接查询本地日记。无需运行额外服务。</Text>
            <View style={styles.switchRow}><Text style={styles.label}>启用记忆库</Text><Switch value={mvEnabled} onValueChange={handleMemoryVaultEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
            <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>Google Embedding 格式</Text><Text style={styles.hint}>关闭时使用 OpenAI 兼容格式</Text></View><Switch value={mvEmbeddingProvider === 'google'} onValueChange={(value) => {
              setMvEmbeddingProvider(value ? 'google' : 'openai');
              setMvEmbeddingBaseUrl(value ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1');
              setMvEmbeddingModel(value ? 'gemini-embedding-001' : 'text-embedding-3-small');
            }} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
            <View style={styles.field}><Text style={styles.label}>向量 API 地址</Text><TextInput style={styles.input} value={mvEmbeddingBaseUrl} onChangeText={setMvEmbeddingBaseUrl} placeholder={mvEmbeddingProvider === 'google' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1'} placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>向量 API Key</Text><TextInput style={styles.input} value={mvEmbeddingApiKey} onChangeText={setMvEmbeddingApiKey} secureTextEntry autoCapitalize="none" placeholder="API Key" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.field}><Text style={styles.label}>向量模型</Text><TextInput style={styles.input} value={mvEmbeddingModel} onChangeText={setMvEmbeddingModel} autoCapitalize="none" placeholder={mvEmbeddingProvider === 'google' ? 'gemini-embedding-001' : 'text-embedding-3-small'} placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.field}><Text style={styles.label}>日记拆分 API 地址（OpenAI 格式）</Text><TextInput style={styles.input} value={mvSplitBaseUrl} onChangeText={setMvSplitBaseUrl} autoCapitalize="none" placeholder="https://api.openai.com/v1" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.field}><Text style={styles.label}>日记拆分 API Key</Text><TextInput style={styles.input} value={mvSplitApiKey} onChangeText={setMvSplitApiKey} secureTextEntry autoCapitalize="none" placeholder="API Key" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.field}><Text style={styles.label}>日记拆分模型</Text><TextInput style={styles.input} value={mvSplitModel} onChangeText={setMvSplitModel} autoCapitalize="none" placeholder="gpt-4o-mini" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.toolNumberRow}><View style={styles.toolNumberField}><Text style={styles.label}>返回条数</Text><TextInput style={styles.input} value={mvTopK} onChangeText={setMvTopK} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} /></View><View style={styles.toolNumberField}><Text style={styles.label}>令牌预算</Text><TextInput style={styles.input} value={mvTokenBudget} onChangeText={setMvTokenBudget} keyboardType="number-pad" placeholder="2000" placeholderTextColor={colors.textTertiary} /></View></View>
            <View style={styles.field}><Text style={styles.label}>每轮最大调用次数</Text><TextInput style={styles.input} value={mvMaxCalls} onChangeText={setMvMaxCalls} keyboardType="number-pad" placeholder="3" placeholderTextColor={colors.textTertiary} /></View>
            <Pressable style={styles.testButton} onPress={handleTestMemory} disabled={mvTesting}>{mvTesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试向量 API</Text>}</Pressable>
          </>
        );
      case 'webSearch':
        return (<><Text style={styles.toolModalDescription}>AI 可以通过 Tavily 搜索互联网获取实时信息。</Text><View style={styles.switchRow}><Text style={styles.label}>启用联网搜索</Text><Switch value={wsEnabled} onValueChange={handleWebSearchEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>Tavily 密钥</Text><TextInput style={styles.input} value={wsApiKey} onChangeText={setWsApiKey} placeholder="tvly-..." placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View><View style={styles.field}><Text style={styles.label}>搜索结果数量</Text><TextInput style={styles.input} value={wsMaxResults} onChangeText={setWsMaxResults} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} /></View></>);
      case 'hotboard':
        return (<><Text style={styles.toolModalDescription}>AI 可以从已选择的平台类型中查询热榜。</Text><View style={styles.switchRow}><Text style={styles.label}>启用热榜查询</Text><Switch value={hbEnabled} onValueChange={handleHotboardEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>UAPI 密钥</Text><TextInput style={styles.input} value={hbApiKey} onChangeText={setHbApiKey} placeholder="Bearer 令牌" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View><View style={styles.platformActions}><Pressable style={styles.platformActionButton} onPress={selectDefaultHotboardPlatforms}><Text style={styles.platformActionText}>默认</Text></Pressable><Pressable style={styles.platformActionButton} onPress={selectAllHotboardPlatforms}><Text style={styles.platformActionText}>全选</Text></Pressable><Pressable style={styles.platformActionButton} onPress={clearHotboardPlatforms}><Text style={styles.platformActionText}>清空</Text></Pressable></View><View style={styles.platformGrid}>{HOTBOARD_PLATFORMS.map((platform) => { const selected = hbPlatformTypes.includes(platform.type); return (<Pressable key={platform.type} style={[styles.platformChip, selected && styles.platformChipSelected]} onPress={() => toggleHotboardPlatform(platform.type)}><Text style={[styles.platformChipLabel, selected && styles.platformChipLabelSelected]}>{platform.label}</Text><Text style={[styles.platformChipType, selected && styles.platformChipTypeSelected]}>{platform.type}</Text></Pressable>); })}</View></>);
      case 'dailyPaperSources':
        return (
          <>
            <Text style={styles.toolModalDescription}>每日日报会读取已启用的 RSS 源，再交给当前聊天 API 生成中文日报。</Text>
            <View style={styles.switchRow}><Text style={styles.label}>使用内置新闻源</Text><Switch value={dailyUseDefaultSources} onValueChange={handleDailyDefaultSourcesEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
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
                      <Switch value={source.enabled} onValueChange={(value) => handleUpdateDailySource(source.id, { enabled: value })} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
                      <Pressable style={styles.removeSmallButton} onPress={() => handleRemoveDailySource(source.id)}><Text style={styles.removeSmallButtonText}>删除</Text></Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        );
      case 'locationShare':
        return (
          <>
            <Text style={styles.toolModalDescription}>加号菜单可发送当前位置卡片；默认使用腾讯地图解析地址和生成缩略图。</Text>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用位置分享</Text>
                <Text style={styles.hint}>开启后，聊天输入区的加号菜单可以发送当前位置。</Text>
              </View>
              <Switch
                value={locationEnabled}
                onValueChange={setLocationEnabled}
                trackColor={{ false: colors.inputBorder, true: colors.primary }}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>腾讯地图 Key</Text>
              <TextInput
                style={styles.input}
                value={locationTencentKey}
                onChangeText={setLocationTencentKey}
                placeholder="填写腾讯位置服务 WebService Key"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry
                autoCapitalize="none"
              />
              <Text style={styles.hint}>开源版本不内置 Key；请使用者在腾讯位置服务控制台创建自己的 Key，并启用 WebService API。</Text>
            </View>
          </>
        );
      case 'runCommand':
        return (
          <>
            <Text style={styles.toolModalDescription}>AI 会通过 SSH 直连这台专用服务器执行 shell 命令，并返回 stdout/stderr。服务器侧不做命令白名单，适合给 AI 独立隔离的工作机。与「对话文件」同时开启时，会自动激活两个互传工具：把对话文件上传到服务器、把服务器文本文件拉取为对话文件。</Text>
            <View style={styles.switchRow}><Text style={styles.label}>启用远程命令</Text><Switch value={rcEnabled} onValueChange={handleRunCommandEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
            <View style={styles.toolAddPanel}>
              <Text style={styles.sectionTitle}>SSH 配置档案</Text>
              <View style={styles.appearanceThemeSaveRow}>
                <TextInput
                  style={[styles.input, styles.appearanceThemeNameInput]}
                  value={rcProfileName}
                  onChangeText={setRcProfileName}
                  placeholder="配置名称，例如：生产服务器"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  onSubmitEditing={handleSaveRunCommandProfile}
                />
                <Pressable style={styles.appearanceThemeSaveButton} onPress={handleSaveRunCommandProfile}>
                  <Text style={styles.saveButtonText}>保存</Text>
                </Pressable>
              </View>
              {rcProfiles.length === 0 ? (
                <Text style={styles.emptyText}>还没有保存的 SSH 配置</Text>
              ) : (
                <View style={styles.appearanceThemeList}>
                  {rcProfiles.map((profile) => {
                    const isActive = profile.id === activeRunCommandProfileId;
                    const summary = [
                      profile.config.sshUsername && `${profile.config.sshUsername}@${profile.config.sshHost}`,
                      profile.config.sshPort ? `:${profile.config.sshPort}` : '',
                      profile.config.defaultCwd ? ` · ${profile.config.defaultCwd}` : '',
                    ].filter(Boolean).join('');
                    return (
                      <View
                        key={profile.id}
                        style={[
                          styles.appearanceThemeRow,
                          isActive && styles.appearanceThemeRowActive,
                        ]}
                      >
                        <View style={styles.appearanceThemeToggleText}>
                          <Text
                            style={[
                              styles.appearanceThemeName,
                              isActive && styles.appearanceThemeNameActive,
                            ]}
                          >
                            {profile.name}
                          </Text>
                          <Text style={styles.appearanceThemeHint} numberOfLines={1}>
                            {summary || '未填写连接信息'}
                          </Text>
                        </View>
                        <View style={styles.appearanceThemeActions}>
                          <Pressable
                            style={[
                              styles.smallActionButton,
                              isActive && styles.smallActionButtonDisabled,
                            ]}
                            onPress={() => handleApplyRunCommandProfile(profile)}
                            disabled={isActive}
                          >
                            <Text style={[styles.smallActionText, isActive && styles.smallActionTextDisabled]}>
                              应用
                            </Text>
                          </Pressable>
                          <Pressable style={styles.smallActionButton} onPress={() => handleUpdateRunCommandProfile(profile)}>
                            <Text style={styles.smallActionText}>覆盖</Text>
                          </Pressable>
                          <Pressable style={styles.smallActionButton} onPress={() => handleRemoveRunCommandProfile(profile)}>
                            <Text style={styles.smallActionText}>删除</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
            <View style={styles.toolNumberRow}>
              <View style={styles.toolNumberField}><Text style={styles.label}>SSH 主机</Text><TextInput style={styles.input} value={rcSshHost} onChangeText={setRcSshHost} placeholder="ai-server.example.com" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
              <View style={styles.toolNumberField}><Text style={styles.label}>端口</Text><TextInput style={styles.input} value={rcSshPort} onChangeText={setRcSshPort} keyboardType="number-pad" placeholder="22" placeholderTextColor={colors.textTertiary} /></View>
            </View>
            <View style={styles.field}><Text style={styles.label}>用户名</Text><TextInput style={styles.input} value={rcSshUsername} onChangeText={setRcSshUsername} placeholder="ubuntu" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>密码</Text><TextInput style={styles.input} value={rcSshPassword} onChangeText={setRcSshPassword} placeholder="可留空，优先使用私钥" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>私钥</Text><TextInput style={[styles.input, styles.multilineInput]} value={rcSshPrivateKey} onChangeText={setRcSshPrivateKey} placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...'} placeholderTextColor={colors.textTertiary} autoCapitalize="none" multiline textAlignVertical="top" /></View>
            <View style={styles.field}><Text style={styles.label}>私钥口令</Text><TextInput style={styles.input} value={rcSshPassphrase} onChangeText={setRcSshPassphrase} placeholder="无口令可留空" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>默认工作目录</Text><TextInput style={styles.input} value={rcDefaultCwd} onChangeText={setRcDefaultCwd} placeholder="/home/ubuntu/app" placeholderTextColor={colors.textTertiary} autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>AI 操作提示词</Text><TextInput style={[styles.input, styles.multilineInput]} value={rcCustomPrompt} onChangeText={setRcCustomPrompt} placeholder={'例如：进入项目后先阅读 CLAUDE.md；安装或启动服务前检查 package.json；完成后把运行方式、端口和注意事项维护到 CLAUDE.md。'} placeholderTextColor={colors.textTertiary} autoCapitalize="none" multiline textAlignVertical="top" /></View>
            <View style={styles.switchRow}><Text style={styles.label}>严格校验主机密钥</Text><Switch value={rcStrictHostKeyChecking} onValueChange={setRcStrictHostKeyChecking} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
            {rcStrictHostKeyChecking && (
              <View style={styles.field}><Text style={styles.label}>known_hosts</Text><TextInput style={[styles.input, styles.multilineInput]} value={rcKnownHosts} onChangeText={setRcKnownHosts} placeholder="example.com ssh-ed25519 AAAA..." placeholderTextColor={colors.textTertiary} autoCapitalize="none" multiline textAlignVertical="top" /></View>
            )}
            <View style={styles.toolNumberRow}>
              <View style={styles.toolNumberField}><Text style={styles.label}>超时 ms</Text><TextInput style={styles.input} value={rcTimeoutMs} onChangeText={setRcTimeoutMs} keyboardType="number-pad" placeholder="60000" placeholderTextColor={colors.textTertiary} /></View>
              <View style={styles.toolNumberField}><Text style={styles.label}>输出上限</Text><TextInput style={styles.input} value={rcMaxOutputChars} onChangeText={setRcMaxOutputChars} keyboardType="number-pad" placeholder="20000" placeholderTextColor={colors.textTertiary} /></View>
            </View>
            <View style={styles.field}><Text style={styles.label}>每轮最大调用次数</Text><TextInput style={styles.input} value={rcMaxCalls} onChangeText={setRcMaxCalls} keyboardType="number-pad" placeholder="20" placeholderTextColor={colors.textTertiary} /></View>
            <Text style={styles.hint}>建议使用独立低权限或容器化服务器；关闭严格校验时会自动信任首次连接的主机密钥。</Text>
            <Pressable style={styles.testButton} onPress={handleTestRunCommand} disabled={rcTesting}>{rcTesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}</Pressable>
          </>
        );
      case 'qqBotTools':
        return (
          <>
            <Text style={styles.toolModalDescription}>YSClaude 直接连接 QQ 官方 Bot，不需要自建或云端后端。只能读取启用后由 YSClaude 收到和发出的消息。</Text>
            <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>启用 QQ Bot AI 工具</Text><Text style={styles.hint}>提供“查看消息列表”“读取最近消息”和“向指定联系人发送消息”三个工具。</Text></View><Switch value={localQqEnabled} onValueChange={handleLocalQqBotToolsEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
            <View style={styles.field}><Text style={styles.label}>QQ Bot App ID</Text><TextInput style={styles.input} value={localQqAppId} onChangeText={setLocalQqAppId} autoCapitalize="none" placeholder="App ID" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.field}><Text style={styles.label}>QQ Bot App Secret</Text><TextInput style={styles.input} value={localQqSecret} onChangeText={setLocalQqSecret} autoCapitalize="none" secureTextEntry placeholder="App Secret" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.switchRow}><Text style={styles.label}>沙箱环境</Text><Switch value={localQqSandbox} onValueChange={setLocalQqSandbox} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
            <View style={styles.field}><Text style={styles.label}>默认读取消息数（1–100）</Text><TextInput style={styles.input} value={localQqReadLimit} onChangeText={setLocalQqReadLimit} keyboardType="number-pad" placeholder="20" placeholderTextColor={colors.textTertiary} /></View>
            <Text style={styles.hint}>启用后 Android 会显示“YSClaude Bot 正在运行”的常驻通知，以便切到 QQ/微信时继续接收和回复。QQ 不提供任意拉取既有聊天记录；强制停止应用期间的消息可能无法保存。</Text>
          </>
        );
      case 'wechatClawBotTools':
        return (
          <>
            <Text style={styles.toolModalDescription}>YSClaude 直接通过微信 iLink/ClawBot 协议长轮询，不需要自建或云端后端。只能读取启用后由 YSClaude 收到和发出的消息。</Text>
            <Text style={styles.hint}>登录状态：{wechatLoginStatus}</Text>
            <View style={styles.platformActions}>
              <Pressable style={[styles.platformActionButton, wechatLoginBusy && styles.importButtonDisabled]} onPress={handleWechatClawLogin} disabled={wechatLoginBusy}>
                {wechatLoginBusy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.platformActionText}>微信扫码登录</Text>}
              </Pressable>
              {!!wechatClawToken && <Pressable style={styles.platformActionButton} onPress={handleWechatClawLogout}><Text style={styles.platformActionText}>退出登录</Text></Pressable>}
            </View>
            {!!wechatLoginQrContent && (
              <View style={{ alignItems: 'center', paddingVertical: 16, gap: 10 }}>
                <View style={{ backgroundColor: '#FFFFFF', padding: 12, borderRadius: 12 }}>
                  <QRCode value={wechatLoginQrContent} size={220} backgroundColor="#FFFFFF" color="#000000" />
                </View>
                <Text style={styles.hint}>请用绑定账号的微信扫码，并在微信中确认登录。</Text>
              </View>
            )}
            <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>启用微信 ClawBot AI 工具</Text><Text style={styles.hint}>提供“读取最近消息”和“发送消息”两个工具。</Text></View><Switch value={wechatClawEnabled} onValueChange={handleWechatClawBotToolsEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
            <View style={styles.field}><Text style={styles.label}>ClawBot Bot Token</Text><TextInput style={styles.input} value={wechatClawToken} onChangeText={setWechatClawToken} autoCapitalize="none" secureTextEntry placeholder="扫码登录获得的 bot_token" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.field}><Text style={styles.label}>iLink Base URL</Text><TextInput style={styles.input} value={wechatClawBaseUrl} onChangeText={setWechatClawBaseUrl} autoCapitalize="none" placeholder="https://ilinkai.weixin.qq.com" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.field}><Text style={styles.label}>Bot Account ID（可选）</Text><TextInput style={styles.input} value={wechatClawAccountId} onChangeText={setWechatClawAccountId} autoCapitalize="none" placeholder="...@im.bot" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.field}><Text style={styles.label}>默认读取消息数（1–100）</Text><TextInput style={styles.input} value={wechatClawReadLimit} onChangeText={setWechatClawReadLimit} keyboardType="number-pad" placeholder="20" placeholderTextColor={colors.textTertiary} /></View>
            <Text style={styles.hint}>启用后 Android 会显示“YSClaude Bot 正在运行”的常驻通知。微信发送依赖最近入站消息的 context_token，绑定账号至少先给 ClawBot 发过一条消息。</Text>
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
              <Switch value={qqMessageBatchEnabled} onValueChange={setQqMessageBatchEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
            </View>
            <View style={styles.field}><Text style={styles.label}>合并等待秒数</Text><TextInput style={styles.input} value={qqMessageBatchWindowSeconds} onChangeText={setQqMessageBatchWindowSeconds} keyboardType="decimal-pad" placeholder="6" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用表情包</Text>
                <Text style={styles.hint}>同步 AI 表情包到后端，模型可用 &lt;sticker&gt;名称&lt;/sticker&gt; 发送图片表情。当前 {getQqStickerCount()} 个。</Text>
              </View>
              <Switch value={qqStickersEnabled} onValueChange={setQqStickersEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用记忆库工具</Text>
                <Text style={styles.hint}>由后端直接调用云端记忆库，逻辑与主聊天一致。</Text>
              </View>
              <Switch value={qqMemoryVaultEnabled} onValueChange={setQqMemoryVaultEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
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
              <Switch value={qqWebSearchEnabled} onValueChange={setQqWebSearchEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
            </View>
            <View style={styles.field}><Text style={styles.label}>Tavily 密钥</Text><TextInput style={styles.input} value={qqTavilyApiKey} onChangeText={setQqTavilyApiKey} placeholder="tvly-..." placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" /></View>
            <View style={styles.field}><Text style={styles.label}>搜索结果数量</Text><TextInput style={styles.input} value={qqWebSearchMaxResults} onChangeText={setQqWebSearchMaxResults} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} /></View>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.label}>启用自定义 MCP 工具</Text>
                <Text style={styles.hint}>{getQqMcpEnabledServerCount()} 个服务 · {getQqMcpEnabledToolCount()} 个工具。仅支持 Zeabur 后端可访问的 HTTP MCP。</Text>
              </View>
              <Switch value={qqMcpEnabled} onValueChange={setQqMcpEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
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
                  <Switch value={qqTtsEnabled} onValueChange={setQqTtsEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
                </View>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.label}>启用 QQ 机器人</Text>
                    <Text style={styles.hint}>{qqBackendStatus}</Text>
                  </View>
                  <Switch value={qqEnabled} onValueChange={handleQqBotEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
                </View>
                <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>沙箱环境</Text><Text style={styles.hint}>用于 QQ 官方机器人测试环境。</Text></View><Switch value={qqSandbox} onValueChange={setQqSandbox} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
                <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>后端启动时自动连接</Text><Text style={styles.hint}>保存到后端后，服务重启会按此开关连接 QQ 网关。</Text></View><Switch value={qqAutoConnect} onValueChange={setQqAutoConnect} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
                <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>允许私聊</Text><Text style={styles.hint}>接收 QQ 用户与机器人的单独对话。</Text></View><Switch value={qqAllowDirectMessages} onValueChange={setQqAllowDirectMessages} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
                <View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>允许频道/群提及</Text><Text style={styles.hint}>仅处理平台推送的机器人提及消息。</Text></View><Switch value={qqAllowGuildMentions} onValueChange={setQqAllowGuildMentions} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View>
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
                  <Switch value={wechatEnabled} onValueChange={setWechatEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
                </View>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.label}>微信后端自动连接</Text>
                    <Text style={styles.hint}>服务重启后自动恢复微信长轮询；需要 Zeabur 持久化卷保留扫码状态。</Text>
                  </View>
                  <Switch value={wechatAutoConnect} onValueChange={setWechatAutoConnect} trackColor={{ false: colors.inputBorder, true: colors.primary }} />
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
        return (<><Text style={styles.toolModalDescription}>AI 可以在网页面板中打开、观察、点击和等待。</Text><View style={styles.switchRow}><Text style={styles.label}>启用网页交互</Text><Switch value={wiEnabled} onValueChange={handleWebInteractionEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>每轮最大操作次数</Text><TextInput style={styles.input} value={wiMaxCalls} onChangeText={setWiMaxCalls} keyboardType="number-pad" placeholder="8" placeholderTextColor={colors.textTertiary} /></View></>);
      case 'conversationArtifact':
        return (<><Text style={styles.toolModalDescription}>AI 可以访问当前对话绑定的文本文件，创建、读取、替换、按文本修改、删除文件，或把文件显式显示成聊天卡片。文件不会跨对话暴露。与「远程命令」同时开启时，会自动激活两个互传工具：把对话文件上传到服务器、把服务器文本文件拉取为对话文件。</Text><View style={styles.switchRow}><Text style={styles.label}>启用对话文件工具</Text><Switch value={conversationArtifactEnabled} onValueChange={handleConversationArtifactEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>每轮最大操作次数</Text><TextInput style={styles.input} value={conversationArtifactMaxCalls} onChangeText={setConversationArtifactMaxCalls} keyboardType="number-pad" placeholder="8" placeholderTextColor={colors.textTertiary} /></View></>);
      case 'conversationWindow':
        return (<><Text style={styles.toolModalDescription}>AI 可以分页列出对话窗口、统计楼层、读取指定楼层范围，并在单个或全部窗口内搜索。窗口列表和全窗口搜索均采用分页，需要时再继续读取。该工具直接读取原始消息，因此隐藏楼层仍可被 AI 查看。</Text><View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>启用对话窗口查看</Text><Text style={styles.hint}>这是跨对话读取权限，关闭后不会向模型提供相关工具。</Text></View><Switch value={conversationWindowEnabled} onValueChange={handleConversationWindowEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View></>);
      case 'htmlArtifact':
        return (<><Text style={styles.toolModalDescription}>AI 可以把当前对话中的 HTML 文件打开到预览窗口，观察页面、点击元素或坐标、等待、截图，也可以修改源码或 DOM 并保存回文件。</Text><View style={styles.switchRow}><Text style={styles.label}>启用 HTML 预览交互</Text><Switch value={htmlArtifactEnabled} onValueChange={handleHtmlArtifactEnabledChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View><View style={styles.field}><Text style={styles.label}>每轮最大操作次数</Text><TextInput style={styles.input} value={htmlArtifactMaxCalls} onChangeText={setHtmlArtifactMaxCalls} keyboardType="number-pad" placeholder="8" placeholderTextColor={colors.textTertiary} /></View></>);
      default: {
        const nativeRow = builtInToolCards.find((tool) => tool.key === toolKey);
        if (!nativeRow) return null;
        return (<><Text style={styles.toolModalDescription}>{nativeRow.intro}</Text><View style={styles.switchRow}><View style={styles.switchText}><Text style={styles.label}>启用 {nativeRow.name}</Text><Text style={styles.hint}>这是设备原生工具，可能需要 Android 系统权限。</Text></View><Switch value={nativeRow.enabled} onValueChange={nativeRow.onValueChange} trackColor={{ false: colors.inputBorder, true: colors.primary }} /></View></>);
      }
    }
  }



  return (
    <>
      <View style={[styles.segmentedRow, { marginHorizontal: 20, marginTop: 8, marginBottom: 0 }]}>
        {([
          ['builtIn', '内置工具'],
          ['mcp', 'MCP 服务'],
          ['features', '辅助功能'],
        ] as const).map(([key, label]) => {
          const selected = toolSettingsPage === key;
          return (
            <Pressable
              key={key}
              style={[styles.segmentedButton, selected && styles.segmentedButtonActive]}
              onPress={() => setToolSettingsPage(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.segmentedText, selected && styles.segmentedTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {toolSettingsPage === 'builtIn' && <BuiltInToolsSection
          colors={colors}
          groups={builtInToolGroups}
          onSelectTool={setSelectedBuiltInToolKey}
        />}
        {toolSettingsPage === 'mcp' && <McpToolsSection
          colors={colors}
          mcpMaxCalls={mcpMaxCalls}
          mcpServerName={mcpServerName}
          mcpServerUrl={mcpServerUrl}
          mcpServerAuth={mcpServerAuth}
          mcpServers={mcpServers}
          onChangeMaxCalls={handleChangeMcpMaxCalls}
          onChangeServerName={setMcpServerName}
          onChangeServerUrl={setMcpServerUrl}
          onChangeServerAuth={setMcpServerAuth}
          onAddServer={handleAddMcpServer}
          onSelectServer={setSelectedMcpServerId}
          onUpdateServer={handleUpdateMcpServer}
          getEnabledToolCount={getEnabledMcpToolCount}
          getEnabledResourceCount={getEnabledMcpResourceCount}
        />}
        {toolSettingsPage === 'features' && <OtherFeaturesSection
          colors={colors}
          tools={otherFeatureCards}
          onSelectTool={setSelectedBuiltInToolKey}
        />}
      </ScrollView>
      <BuiltInToolModal
        styles={styles}
        selectedTool={selectedBuiltInTool}
        renderEditor={renderBuiltInToolEditor}
        onClose={() => setSelectedBuiltInToolKey(null)}
        onDisable={handleDisableBuiltInTool}
        onSave={handleSaveBuiltInTool}
      />
      <QqConversationModal
        styles={styles}
        colors={colors}
        conversationKey={qqSelectedConversationKey}
        platformLabel={getConversationPlatformLabel(qqSelectedConversationKey)}
        messageCount={qqSelectedConversationMessageCount}
        page={qqSelectedConversationPage}
        totalPages={qqSelectedConversationTotalPages}
        loading={qqConversationLoading}
        deleting={qqMessageDeleting}
        selectedIndexes={qqSelectedMessageIndexes}
        messages={qqSelectedConversationMessages}
        onClose={() => setQqSelectedConversationKey(null)}
        onOpenPage={(page) => qqSelectedConversationKey && handleOpenQqConversation(qqSelectedConversationKey, page)}
        onDeleteSelected={handleDeleteSelectedQqMessages}
        onClearConversation={handleClearSelectedQqConversation}
        onToggleMessage={toggleQqMessageIndex}
      />
      <McpServerModal
        styles={styles}
        selectedServer={selectedMcpServer}
        renderEditor={() => (
          <McpServerEditor
            styles={styles}
            colors={colors}
            selectedMcpServer={selectedMcpServer}
            mcpResourceToolsEnabled={mcpResourceToolsEnabled}
            setMcpResourceToolsEnabled={handleMcpResourceToolsEnabledChange}
            mcpSyncingServerId={mcpSyncingServerId}
            getEnabledMcpToolCount={getEnabledMcpToolCount}
            getEnabledMcpResourceCount={getEnabledMcpResourceCount}
            getPinnedMcpResourceCount={getPinnedMcpResourceCount}
            handleUpdateMcpServer={handleUpdateMcpServer}
            handleUpdateMcpServerToolEnabled={handleUpdateMcpServerToolEnabled}
            handleUpdateMcpServerResource={handleUpdateMcpServerResource}
            setSelectedMcpToolRef={setSelectedMcpToolRef}
            setSelectedMcpResourceRef={setSelectedMcpResourceRef}
            setSelectedMcpPromptRef={setSelectedMcpPromptRef}
            handleSyncMcpServer={handleSyncMcpServer}
          />
        )}
        onClose={() => setSelectedMcpServerId(null)}
        onRemove={handleRemoveMcpServerFromModal}
      />
      <McpToolModal
        styles={styles}
        selectedTool={selectedMcpTool}
        selectedServer={selectedMcpToolServer}
        formatInputSchema={formatMcpToolInputSchema}
        onClose={() => setSelectedMcpToolRef(null)}
      />
      <McpResourceModal
        styles={styles}
        selectedResource={selectedMcpResource}
        selectedServer={selectedMcpResourceServer}
        onClose={() => setSelectedMcpResourceRef(null)}
      />
      <McpPromptModal
        styles={styles}
        colors={colors}
        selectedPrompt={selectedMcpPrompt}
        selectedServer={selectedMcpPromptServer}
        promptArgs={mcpPromptArgs}
        applying={mcpPromptApplying}
        formatArguments={formatMcpPromptArguments}
        onChangePromptArgs={setMcpPromptArgs}
        onApply={handleApplyMcpPrompt}
        onClose={() => setSelectedMcpPromptRef(null)}
      />
    </>
  );


}
