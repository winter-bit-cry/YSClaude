import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { useSettingsPageColors } from '../../theme/colors';
import {
  type ImageGenerationFaceReference,
  type PromptCacheConfig,
  type StablePromptRole,
  useSettingsStore,
} from '../../stores/settings';
import { useChatStore } from '../../stores/chat';
import { type HiddenRange } from '../../types';
import { getChatDiagnosticsConversation, type ChatDiagnosticsMessage } from '../../db/operations';
import {
  checkPromptCacheRemoteServer,
  disablePromptCacheRemoteKeepalive,
  enablePromptCacheRemoteKeepalive,
  refreshPromptCacheRemoteServerStatus,
  pushRemotePushConfig,
  testRemoteDingTalkPush,
  testRemoteWxPusherPush,
} from '../../services/promptCacheKeepalive';
import { mergeRanges } from '../../utils/ranges';
import { copyFileFromUri } from '../../utils/fileSystem';
import { createSettingsStyles } from './styles';
import { ButtonRow, SelectRow, SettingsGroup, SettingsRow, SwitchRow, TextEditRow } from './ui';

type SettingsTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const IMAGE_GENERATION_FACE_REFERENCE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_GENERATION_FACE_REFERENCE_MIN_SIDE = 64;
const IMAGE_GENERATION_FACE_REFERENCE_MAX_SIDE = 4096;
const IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT = 16;
const PROMPT_CACHE_PUSH_CHANNEL_OPTIONS: Array<{ value: PromptCacheConfig['pushChannel']; label: string }> = [
  { value: 'dingtalk', label: '钉钉' },
  { value: 'wxpusher', label: 'WxPusher' },
];
const STABLE_PROMPT_ROLE_OPTIONS: Array<{ value: StablePromptRole; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'user', label: 'User' },
  { value: 'assistant', label: 'Assistant' },
];

function formatClockMinutes(minutes: number): string {
  const normalized = Math.min(1439, Math.max(0, Math.round(minutes)));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseClockMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
}

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

async function copyAppearanceImage(
  asset: ImagePicker.ImagePickerAsset,
  directoryName: string,
  prefix: string
): Promise<string> {
  const dir = new Directory(Paths.document, directoryName);
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, `${prefix}-${randomUUID()}${topBarIconExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
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

export function ChatSettingsTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const {
    maxOutputTokens,
    tokenWarningThreshold,
    systemPrompt,
    stablePromptRole,
    stripThinking,
    promptCacheConfig,
    imageGenerationConfig,
    imageGenerationPrompt,
    setSystemPrompt,
    setStablePromptRole,
    setMaxOutputTokens,
    setTokenWarningThreshold,
    setStripThinking,
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
  } = useChatStore();
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [tokensStr, setTokensStr] = useState(maxOutputTokens ? String(maxOutputTokens) : '');
  const [tokenWarningStr, setTokenWarningStr] = useState(
    tokenWarningThreshold ? String(tokenWarningThreshold) : ''
  );
  const [promptText, setPromptText] = useState(systemPrompt);
  const [imagePromptText, setImagePromptText] = useState(imageGenerationPrompt || '');
  const [pickingFaceReferences, setPickingFaceReferences] = useState(false);
  const [quietStartText, setQuietStartText] = useState(formatClockMinutes(promptCacheConfig?.quietStartMinutes ?? 23 * 60));
  const [quietEndText, setQuietEndText] = useState(formatClockMinutes(promptCacheConfig?.quietEndMinutes ?? 7 * 60));
  const [remoteServerUrlText, setRemoteServerUrlText] = useState(promptCacheConfig?.remoteServerUrl || '');
  const [remoteAuthTokenText, setRemoteAuthTokenText] = useState(promptCacheConfig?.remoteAuthToken || '');
  const [dingTalkWebhookText, setDingTalkWebhookText] = useState(promptCacheConfig?.dingTalkWebhook || '');
  const [dingTalkSecretText, setDingTalkSecretText] = useState(promptCacheConfig?.dingTalkSecret || '');
  const [dingTalkAtMobilesText, setDingTalkAtMobilesText] = useState(promptCacheConfig?.dingTalkAtMobiles || '');
  const [testingDingTalkPush, setTestingDingTalkPush] = useState(false);
  const [wxPusherAppTokenText, setWxPusherAppTokenText] = useState(promptCacheConfig?.wxPusherAppToken || '');
  const [wxPusherUidText, setWxPusherUidText] = useState(promptCacheConfig?.wxPusherUid || '');
  const [wxPusherTopicIdsText, setWxPusherTopicIdsText] = useState(promptCacheConfig?.wxPusherTopicIds || '');
  const [testingWxPusherPush, setTestingWxPusherPush] = useState(false);
  const [checkingRemoteKeepalive, setCheckingRemoteKeepalive] = useState(false);
  const [switchingRemoteKeepalive, setSwitchingRemoteKeepalive] = useState(false);
  const [hiddenDiagnosticMessages, setHiddenDiagnosticMessages] = useState<ChatDiagnosticsMessage[]>([]);

  useEffect(() => {
    setImagePromptText(imageGenerationPrompt || '');
  }, [imageGenerationPrompt]);

  useEffect(() => {
    setQuietStartText(formatClockMinutes(promptCacheConfig?.quietStartMinutes ?? 23 * 60));
    setQuietEndText(formatClockMinutes(promptCacheConfig?.quietEndMinutes ?? 7 * 60));
  }, [promptCacheConfig?.quietEndMinutes, promptCacheConfig?.quietStartMinutes]);

  useEffect(() => {
    setRemoteServerUrlText(promptCacheConfig?.remoteServerUrl || '');
    setRemoteAuthTokenText(promptCacheConfig?.remoteAuthToken || '');
    setDingTalkWebhookText(promptCacheConfig?.dingTalkWebhook || '');
    setDingTalkSecretText(promptCacheConfig?.dingTalkSecret || '');
    setDingTalkAtMobilesText(promptCacheConfig?.dingTalkAtMobiles || '');
    setWxPusherAppTokenText(promptCacheConfig?.wxPusherAppToken || '');
    setWxPusherUidText(promptCacheConfig?.wxPusherUid || '');
    setWxPusherTopicIdsText(promptCacheConfig?.wxPusherTopicIds || '');
  }, [
    promptCacheConfig?.remoteAuthToken,
    promptCacheConfig?.remoteServerUrl,
    promptCacheConfig?.dingTalkWebhook,
    promptCacheConfig?.dingTalkSecret,
    promptCacheConfig?.dingTalkAtMobiles,
    promptCacheConfig?.wxPusherAppToken,
    promptCacheConfig?.wxPusherUid,
    promptCacheConfig?.wxPusherTopicIds,
  ]);

  useEffect(() => {
    refreshPromptCacheRemoteServerStatus(conversationId).catch(() => undefined);
  }, [conversationId, promptCacheConfig?.remoteAuthToken, promptCacheConfig?.remoteServerUrl]);

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

  function handleSavePromptCacheQuietHours(
    nextQuietStart = quietStartText,
    nextQuietEnd = quietEndText,
  ) {
    const startMinutes = parseClockMinutes(nextQuietStart);
    const endMinutes = parseClockMinutes(nextQuietEnd);
    if (startMinutes === null || endMinutes === null) {
      Alert.alert('提示', '请输入 HH:mm 格式的时间，例如 23:00');
      setQuietStartText(formatClockMinutes(promptCacheConfig?.quietStartMinutes ?? 23 * 60));
      setQuietEndText(formatClockMinutes(promptCacheConfig?.quietEndMinutes ?? 7 * 60));
      return;
    }
    if (startMinutes === endMinutes) {
      Alert.alert('提示', '开始和结束时间不能相同');
      return;
    }
    setPromptCacheConfig({
      quietStartMinutes: startMinutes,
      quietEndMinutes: endMinutes,
    });
    setQuietStartText(formatClockMinutes(startMinutes));
    setQuietEndText(formatClockMinutes(endMinutes));
    showToast('远程保活勿扰时段已保存');
  }

  function handleSaveRemoteKeepaliveConfig(overrides?: { serverUrl?: string; authToken?: string }) {
    setPromptCacheConfig({
      remoteServerUrl: (overrides?.serverUrl ?? remoteServerUrlText).trim(),
      remoteAuthToken: (overrides?.authToken ?? remoteAuthTokenText).trim(),
      pushChannel: promptCacheConfig?.pushChannel || 'dingtalk',
      dingTalkWebhook: dingTalkWebhookText.trim(),
      dingTalkSecret: dingTalkSecretText.trim(),
      dingTalkAtMobiles: dingTalkAtMobilesText.trim(),
      wxPusherAppToken: wxPusherAppTokenText.trim(),
      wxPusherUid: wxPusherUidText.trim(),
      wxPusherTopicIds: wxPusherTopicIdsText.trim(),
      keepaliveMode: 'remote',
    });
    showToast('远程保活配置已保存');
  }

  async function handleToggleRemoteKeepalive(value: boolean) {
    if (switchingRemoteKeepalive) return;
    const serverUrl = remoteServerUrlText.trim();
    const authToken = remoteAuthTokenText.trim();
    if (value && !serverUrl) {
      Alert.alert('提示', '请先填写远程保活服务地址');
      return;
    }

    setPromptCacheConfig({
      keepaliveMode: 'remote',
      remoteKeepaliveEnabled: value,
      remoteServerUrl: serverUrl,
      remoteAuthToken: authToken,
    });
    setSwitchingRemoteKeepalive(true);
    try {
      if (value) {
        const result = await enablePromptCacheRemoteKeepalive(conversationId);
        await refreshPromptCacheRemoteServerStatus(conversationId);
        showToast(result.ok ? '远程保活已开启并同步服务端' : (result.error || '远程保活已开启，等待下次快照同步'));
      } else {
        const ok = conversationId ? await disablePromptCacheRemoteKeepalive(conversationId) : true;
        await refreshPromptCacheRemoteServerStatus(conversationId);
        showToast(ok ? '远程保活已关闭并同步服务端' : '远程保活已关闭，服务端同步失败');
      }
    } catch (error: any) {
      showToast(error?.message || '远程保活开关同步失败');
    } finally {
      setSwitchingRemoteKeepalive(false);
    }
  }

  function currentPushConfig(): PromptCacheConfig {
    return {
      ...promptCacheConfig,
      dingTalkWebhook: dingTalkWebhookText.trim(),
      dingTalkSecret: dingTalkSecretText.trim(),
      dingTalkAtMobiles: dingTalkAtMobilesText.trim(),
      wxPusherAppToken: wxPusherAppTokenText.trim(),
      wxPusherUid: wxPusherUidText.trim(),
      wxPusherTopicIds: wxPusherTopicIdsText.trim(),
    };
  }

  function handleSaveDingTalkConfig(
    nextWebhook = dingTalkWebhookText,
    nextSecret = dingTalkSecretText,
    nextAtMobiles = dingTalkAtMobilesText,
  ) {
    const webhook = nextWebhook.trim();
    const secret = nextSecret.trim();
    const atMobiles = nextAtMobiles.trim();
    setPromptCacheConfig({
      pushChannel: webhook ? 'dingtalk' : promptCacheConfig?.pushChannel,
      dingTalkWebhook: webhook,
      dingTalkSecret: secret,
      dingTalkAtMobiles: atMobiles,
    });
    if (webhook) {
      pushRemotePushConfig({
        ...currentPushConfig(),
        pushChannel: 'dingtalk',
      }).catch(() => undefined);
    }
    showToast(webhook ? '钉钉推送配置已保存' : '钉钉推送已关闭');
  }

  async function handleTestDingTalkPush() {
    if (testingDingTalkPush) return;
    const webhook = dingTalkWebhookText.trim();
    if (!webhook) {
      showToast('请先填写钉钉机器人 Webhook');
      return;
    }
    setPromptCacheConfig({
      pushChannel: 'dingtalk',
      dingTalkWebhook: webhook,
      dingTalkSecret: dingTalkSecretText.trim(),
      dingTalkAtMobiles: dingTalkAtMobilesText.trim(),
    });
    setTestingDingTalkPush(true);
    try {
      const result = await testRemoteDingTalkPush(currentPushConfig());
      showToast(result.ok ? '钉钉测试推送已发送，请查看钉钉群消息' : (result.error || '钉钉测试推送失败'));
    } catch (error: any) {
      showToast(error?.message || '钉钉测试推送失败');
    } finally {
      setTestingDingTalkPush(false);
    }
  }

  function handleSaveWxPusherConfig(
    nextAppToken = wxPusherAppTokenText,
    nextUid = wxPusherUidText,
    nextTopicIds = wxPusherTopicIdsText,
  ) {
    const appToken = nextAppToken.trim();
    const uid = nextUid.trim();
    const topicIds = nextTopicIds.trim();
    setPromptCacheConfig({
      pushChannel: appToken && (uid || topicIds) ? 'wxpusher' : promptCacheConfig?.pushChannel,
      wxPusherAppToken: appToken,
      wxPusherUid: uid,
      wxPusherTopicIds: topicIds,
    });
    if (appToken && (uid || topicIds)) {
      pushRemotePushConfig({
        ...currentPushConfig(),
        pushChannel: 'wxpusher',
      }).catch(() => undefined);
    }
    showToast(appToken && (uid || topicIds) ? 'WxPusher 推送配置已保存' : 'WxPusher 推送已关闭');
  }

  async function handleTestWxPusherPush() {
    if (testingWxPusherPush) return;
    const appToken = wxPusherAppTokenText.trim();
    const uid = wxPusherUidText.trim();
    const topicIds = wxPusherTopicIdsText.trim();
    if (!appToken || (!uid && !topicIds)) {
      showToast('请先填写 WxPusher AppToken 和 UID/Topic ID');
      return;
    }
    setPromptCacheConfig({
      pushChannel: 'wxpusher',
      wxPusherAppToken: appToken,
      wxPusherUid: uid,
      wxPusherTopicIds: topicIds,
    });
    setTestingWxPusherPush(true);
    try {
      const result = await testRemoteWxPusherPush(currentPushConfig());
      showToast(result.ok ? 'WxPusher 测试推送已发送，请查看微信通知' : (result.error || 'WxPusher 测试推送失败'));
    } catch (error: any) {
      showToast(error?.message || 'WxPusher 测试推送失败');
    } finally {
      setTestingWxPusherPush(false);
    }
  }

  async function handleCheckRemoteKeepaliveServer() {
    if (checkingRemoteKeepalive) return;
    setPromptCacheConfig({
      remoteServerUrl: remoteServerUrlText.trim(),
      remoteAuthToken: remoteAuthTokenText.trim(),
    });
    setCheckingRemoteKeepalive(true);
    try {
      const ok = await checkPromptCacheRemoteServer();
      if (ok) {
        await refreshPromptCacheRemoteServerStatus(conversationId);
      }
      showToast(ok ? '远程保活服务连接正常' : '远程保活服务无响应');
    } catch (error: any) {
      showToast(error?.message || '远程保活服务连接失败');
    } finally {
      setCheckingRemoteKeepalive(false);
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
      <SettingsGroup
        header="System Prompt"
        footer="使用 Claude Code OAuth 反代且开启 cloak 时，发送身份建议选 User，避免稳定提示词和收藏日记被上游 system cloaking 清洗。"
      >
        <TextEditRow
          label="System Prompt"
          sublabel="此内容会放在所有消息最前面发送给 AI"
          value={promptText}
          placeholder="未设置"
          multiline
          inputPlaceholder="You are a helpful assistant."
          onSave={(value) => {
            setPromptText(value);
            setSystemPrompt(value.trim());
            showToast('System Prompt 已保存');
          }}
        />
        <SelectRow
          label="发送身份"
          options={STABLE_PROMPT_ROLE_OPTIONS}
          value={stablePromptRole || 'system'}
          onSelect={(value) => {
            setStablePromptRole(value as StablePromptRole);
            const label = STABLE_PROMPT_ROLE_OPTIONS.find((item) => item.value === value)?.label;
            showToast(`System Prompt 将以 ${label} 身份发送`);
          }}
        />
      </SettingsGroup>

      <SettingsGroup
        header="生图配置"
        footer="AI 回复中的 [Pic:图片描述] 会与基础提示词组合后发送给生图 API；这里不会作为真实图片发回给聊天 AI。"
      >
        <TextEditRow
          label="生图基础提示词"
          value={imagePromptText}
          placeholder="未设置"
          multiline
          inputPlaceholder="例如：高质量图片，画面清晰，主体明确，无水印。"
          onSave={(value) => {
            setImagePromptText(value);
            setImageGenerationPrompt(value.trim());
            showToast('生图提示词已保存');
          }}
        />
      </SettingsGroup>

      <SettingsGroup
        header="锁脸参考图"
        footer={`启用的参考图会自动用于文生图/图生图，和输入框临时参考图一起传给生图 API。已启用 ${enabledFaceReferenceCount} / ${faceReferences.length} 张，最多 ${IMAGE_GENERATION_FACE_REFERENCE_SELECTION_LIMIT} 张。`}
      >
        <ButtonRow
          label="上传参考图"
          onPress={handlePickFaceReferences}
          loading={pickingFaceReferences}
          disabled={pickingFaceReferences}
        />
        {faceReferences.length === 0 ? (
          <SettingsRow label="暂无锁脸参考图" />
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
                      trackColor={{ false: colors.inputBorder, true: colors.primary }}
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
      </SettingsGroup>

      {/* 消息条数 */}
      <SettingsGroup header="当前对话">
        <SettingsRow
          label="已加载消息"
          value={`${messageCount > 0 ? `${loadedFloorFrom}-${loadedFloorTo}` : '0'} 条`}
        />
      </SettingsGroup>

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
      <SettingsGroup
        header="AI 输出限制"
        footer="限制 AI 单次回复的最大 token 数；预警在一次发送的 total tokens 超过阈值时弹窗提醒压缩总结对话。留空则不限制/关闭。"
      >
        <TextEditRow
          label="最大输出 Tokens"
          value={tokensStr}
          placeholder="不限制"
          keyboardType="number-pad"
          dialogDescription="留空则不限制"
          validate={(text) => {
            const val = text.trim();
            if (!val) return null;
            const num = parseInt(val, 10);
            return isNaN(num) || num <= 0 ? '请输入有效的正整数' : null;
          }}
          onSave={(text) => {
            const val = text.trim();
            setTokensStr(val);
            if (!val) {
              setMaxOutputTokens(null);
              showToast('输出字数不限制');
            } else {
              const num = parseInt(val, 10);
              setMaxOutputTokens(num);
              showToast(`AI 最大输出 ${num} tokens`);
            }
          }}
        />
        <TextEditRow
          label="Token 预警阈值"
          value={tokenWarningStr}
          placeholder="关闭预警"
          keyboardType="number-pad"
          dialogDescription="留空则关闭预警"
          validate={(text) => {
            const val = text.trim();
            if (!val) return null;
            const num = parseInt(val, 10);
            return isNaN(num) || num <= 0 ? '请输入有效的正整数' : null;
          }}
          onSave={(text) => {
            const val = text.trim();
            setTokenWarningStr(val);
            if (!val) {
              setTokenWarningThreshold(null);
              showToast('Token 预警已关闭');
            } else {
              const num = parseInt(val, 10);
              setTokenWarningThreshold(num);
              showToast(`Token 预警 ${num}`);
            }
          }}
        />
        <SwitchRow
          label="不发送思维链"
          sublabel="AI 历史消息中的思维链内容不会发送给 AI，但仍会正常存储和显示，可节省 token"
          value={stripThinking}
          onValueChange={setStripThinking}
        />
      </SettingsGroup>

      <SettingsGroup
        header="Prompt 缓存远程保活"
        footer="远程服务会保存最后一次成功使用 1h cache 的请求快照，并按 55 分钟自动调用保活。自托管时会在服务端保存 API Key 和对话快照。基础开关、缓存时间和渠道已集中到 API 配置。"
      >
        <SwitchRow
          label="远程保活"
          sublabel="开启后同步当前或已有 1h cache 快照到服务端；关闭会立即停用服务端保活"
          value={!!promptCacheConfig?.remoteKeepaliveEnabled}
          onValueChange={(value) => void handleToggleRemoteKeepalive(value)}
          disabled={switchingRemoteKeepalive}
        />
        <TextEditRow
          label="服务地址"
          value={remoteServerUrlText}
          inputPlaceholder="http://你的服务器:8789"
          onSave={(value) => {
            setRemoteServerUrlText(value);
            handleSaveRemoteKeepaliveConfig({ serverUrl: value });
          }}
        />
        <TextEditRow
          label="访问令牌"
          value={remoteAuthTokenText}
          secure
          inputPlaceholder="KEEPALIVE_AUTH_TOKEN"
          onSave={(value) => {
            setRemoteAuthTokenText(value);
            handleSaveRemoteKeepaliveConfig({ authToken: value });
          }}
        />
        <ButtonRow
          label="测试远程服务"
          onPress={handleCheckRemoteKeepaliveServer}
          loading={checkingRemoteKeepalive}
        />
        <SwitchRow
          label="远程自主活动"
          sublabel="开启后服务端保活时会告知 AI 已过去的时间，由它自主决定是否留言或记录活动；关闭则仅做缓存续期。修改将在下一次快照同步后生效。"
          value={promptCacheConfig?.remoteAgentTickEnabled !== false}
          onValueChange={(value) => {
            setPromptCacheConfig({ remoteAgentTickEnabled: value });
            showToast(value ? '远程自主活动已开启' : '远程自主活动已关闭');
          }}
        />
      </SettingsGroup>

      <SettingsGroup header="主动推送">
        <SelectRow
          label="推送渠道"
          options={PROMPT_CACHE_PUSH_CHANNEL_OPTIONS}
          value={promptCacheConfig?.pushChannel || 'dingtalk'}
          onSelect={(value) => {
            setPromptCacheConfig({ pushChannel: value as PromptCacheConfig['pushChannel'] });
            pushRemotePushConfig({
              ...currentPushConfig(),
              pushChannel: value as PromptCacheConfig['pushChannel'],
            }).catch(() => undefined);
          }}
        />
      </SettingsGroup>

      <SettingsGroup
        header="钉钉推送"
        footer="AI 主动留言时通过钉钉群机器人发送到钉钉 App。建议在钉钉里建一个只给自己的提醒群，机器人安全设置使用加签。"
      >
        <TextEditRow
          label="机器人 Webhook"
          value={dingTalkWebhookText}
          inputPlaceholder="https://oapi.dingtalk.com/robot/send?access_token=..."
          onSave={(value) => {
            setDingTalkWebhookText(value);
            handleSaveDingTalkConfig(value);
          }}
        />
        <TextEditRow
          label="加签 Secret"
          value={dingTalkSecretText}
          placeholder="可选"
          secure
          inputPlaceholder="SECxxxxxxxxxxxxxxxxxxxxxxxx"
          onSave={(value) => {
            setDingTalkSecretText(value);
            handleSaveDingTalkConfig();
          }}
        />
        <TextEditRow
          label="@ 手机号"
          value={dingTalkAtMobilesText}
          placeholder="可选"
          inputPlaceholder="13800138000,13900139000"
          onSave={(value) => {
            setDingTalkAtMobilesText(value);
            handleSaveDingTalkConfig();
          }}
        />
        <ButtonRow label="测试钉钉推送" onPress={handleTestDingTalkPush} loading={testingDingTalkPush} />
      </SettingsGroup>

      <SettingsGroup
        header="WxPusher 推送"
        footer="适合在一加等杀后台严格的手机上作为稳定回退；通知来自 WxPusher/微信，点击后可跳转到 YSClaude 对话。"
      >
        <TextEditRow
          label="AppToken"
          value={wxPusherAppTokenText}
          secure
          inputPlaceholder="AT_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          onSave={(value) => {
            setWxPusherAppTokenText(value);
            handleSaveWxPusherConfig();
          }}
        />
        <TextEditRow
          label="UID"
          value={wxPusherUidText}
          inputPlaceholder="UID_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          onSave={(value) => {
            setWxPusherUidText(value);
            handleSaveWxPusherConfig();
          }}
        />
        <TextEditRow
          label="Topic IDs"
          value={wxPusherTopicIdsText}
          placeholder="可选"
          inputPlaceholder="123,456"
          onSave={(value) => {
            setWxPusherTopicIdsText(value);
            handleSaveWxPusherConfig();
          }}
        />
        <ButtonRow label="测试 WxPusher 推送" onPress={handleTestWxPusherPush} loading={testingWxPusherPush} />
      </SettingsGroup>

      <SettingsGroup
        header="非保活时段"
        footer="远程保活点落在该时段内时，取消本轮保活。"
      >
        <SwitchRow
          label="启用非保活时段"
          value={!!promptCacheConfig?.quietHoursEnabled}
          onValueChange={(value) => {
            setPromptCacheConfig({ quietHoursEnabled: value });
            showToast(value ? '远程保活勿扰已开启' : '远程保活勿扰已关闭');
          }}
        />
        {!!promptCacheConfig?.quietHoursEnabled && (
          <TextEditRow
            label="开始时间"
            value={quietStartText}
            inputPlaceholder="23:00"
            dialogDescription="HH:mm 格式，例如 23:00"
            validate={(text) => (parseClockMinutes(text) === null ? '请输入 HH:mm 格式的时间' : null)}
            onSave={(value) => {
              setQuietStartText(value);
              handleSavePromptCacheQuietHours(value, quietEndText);
            }}
          />
        )}
        {!!promptCacheConfig?.quietHoursEnabled && (
          <TextEditRow
            label="结束时间"
            value={quietEndText}
            inputPlaceholder="07:00"
            dialogDescription="HH:mm 格式，例如 07:00"
            validate={(text) => (parseClockMinutes(text) === null ? '请输入 HH:mm 格式的时间' : null)}
            onSave={(value) => {
              setQuietEndText(value);
              handleSavePromptCacheQuietHours(quietStartText, value);
            }}
          />
        )}
      </SettingsGroup>

    </ScrollView>
  );
}
