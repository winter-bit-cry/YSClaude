import React, { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  FlatList,
  ScrollView,
  AppState,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
  Modal,
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
  type ListRenderItem,
  type AppStateStatus,
  type ImageStyle,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useAnimatedKeyboard,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurTargetView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';

import { TopBarIcon } from '../src/components/TopBarIcon';
import type { TopBarIconKey } from '../src/utils/topBarIconTypes';
import { useChatStore } from '../src/stores/chat';
import { usePeriodStore } from '../src/stores/period';
import { useSettingsStore } from '../src/stores/settings';
import { ChatBubble } from '../src/components/ChatBubble';
import { ChatInput } from '../src/components/ChatInput';
import { AppearanceBlurView } from '../src/components/AppearanceBlurView';
import { AskUserCard } from '../src/components/AskUserCard';
import { ModelSelector } from '../src/components/ModelSelector';
import { TimeDivider } from '../src/components/TimeDivider';
import { IOSToast } from '../src/components/IOSToast';
import { IncomingLetter, Message } from '../src/types';
import { formatFullTime, TIME_GAP_THRESHOLD_MS } from '../src/utils/time';
import { pickGreeting } from '../src/utils/greetings';
import { getAppearanceCssStyle, getAppearanceGlassConfig, parseAppearanceCss, withoutAppearanceGlassProps } from '../src/utils/appearanceCss';
import {
  buildPeriodDateSet,
  calculatePeriodPrediction,
  findPeriodRecordForDate,
  getDateKeysInRange,
} from '../src/utils/periods';
import { showWebViewPanel } from '../src/services/webviewController';
import {
  getFirstMessageInDateRange,
  markIncomingLetterShown,
} from '../src/db/operations';
import { ensureTodayIncomingLetters } from '../src/services/incomingLetters';
import {
  flushPromptCacheRemoteSnapshotNow,
  getPromptCacheRemoteSnapshotStatus,
  refreshPromptCacheRemoteServerStatus,
  subscribePromptCacheRemoteSnapshotStatus,
  type PromptCacheRemoteSnapshotStatus,
} from '../src/services/promptCacheKeepalive';
import { isAndroidVoiceCallAvailable, type VoiceCallSnapshot } from '../src/services/voiceCallSession';
import { getPendingAskUserRequest } from '../src/utils/askUser';
import { useVoiceCallStore } from '../src/stores/voiceCall';
import type { VoiceCallMode } from '../src/stores/voiceCall';


let colors = lightColors;
const INPUT_BAR_FALLBACK_HEIGHT = 128;
const MESSAGE_BOTTOM_GAP = 16;
const MESSAGE_TOP_GAP = 104;
const LOAD_MORE_EDGE_THRESHOLD = 96;
const PROGRAMMATIC_JUMP_SUPPRESS_MS = 1200;
const TOP_BAR_SIDE_BUTTON_COUNT = 4;
const TOP_BAR_HORIZONTAL_INSET = 12;
const TOP_BAR_DEFAULT_BUTTON_SIZE = 40;
const TOP_BAR_MIN_BUTTON_SIZE = 32;
const TOP_BAR_DEFAULT_GAP = 4;
const AUTO_SCROLL_THROTTLE_MS = 72;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const CLAWD_STATUS_AUTO_CLOSE_MS = 5200;
function ChatMessageEntrance({
  animate,
  children,
}: {
  animate: boolean;
  children: React.ReactNode;
}) {
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) {
      progress.value = 1;
      return;
    }

    progress.value = 0;
    progress.value = withTiming(1, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [animate, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * 10 },
      { scale: 0.985 + progress.value * 0.015 },
    ],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

function formatVoiceCallStatus(snapshot: VoiceCallSnapshot): string {
  if (snapshot.error) return snapshot.error;
  switch (snapshot.status) {
    case 'connecting':
      return '正在连接语音通话';
    case 'listening':
      return snapshot.partialTranscript || '正在听你说';
    case 'thinking':
      return snapshot.lastUserText ? `你：${snapshot.lastUserText}` : '正在思考';
    case 'speaking':
      return snapshot.speakingText ? `AI：${snapshot.speakingText}` : '正在说话';
    case 'stopping':
      return '正在挂断';
    case 'error':
      return snapshot.error || '语音通话出错';
    default:
      return 'Deepgram STT + MiniMax TTS';
  }
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateRangeForKey(key: string): { startAt: number; endAt: number } {
  const [year, month, day] = key.split('-').map((part) => parseInt(part, 10));
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

function formatCalendarMonth(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function parseCalendarMonthInput(value: string): Date | null {
  const text = value.trim();
  const match = text.match(/^(\d{4})\D+(\d{1,2})\D*$/) || text.match(/^(\d{4})(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return new Date(year, month - 1, 1);
}

function buildCalendarCells(month: Date): Array<Date | null> {
  const first = startOfMonth(month);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function withAlpha(color: string, alpha: number): string {
  const boundedAlpha = Math.min(1, Math.max(0, alpha));
  const normalized = color.trim();
  const hex = normalized.replace('#', '');

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const red = parseInt(hex[0] + hex[0], 16);
    const green = parseInt(hex[1] + hex[1], 16);
    const blue = parseInt(hex[2] + hex[2], 16);
    return `rgba(${red}, ${green}, ${blue}, ${boundedAlpha})`;
  }

  if (/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(hex)) {
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${boundedAlpha})`;
  }

  const rgbMatch = normalized.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${boundedAlpha})`;
  }

  return boundedAlpha === 0 ? 'rgba(0, 0, 0, 0)' : normalized;
}

function getNumericStyleValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getTopBarCssBottom(style?: ViewStyle): number {
  const hasCustomHeight = typeof style?.height === 'number' && Number.isFinite(style.height);
  const top = getNumericStyleValue(style?.top, 0);
  const height = getNumericStyleValue(style?.height, MESSAGE_TOP_GAP);
  const minHeight = getNumericStyleValue(style?.minHeight, 0);
  return Math.max(0, top + Math.max(hasCustomHeight ? height : MESSAGE_TOP_GAP, minHeight));
}

function formatRemoteSnapshotState(status: PromptCacheRemoteSnapshotStatus): string {
  if (status.state === 'syncing') return '同步中';
  if (status.state === 'pending') return '待同步';
  if (status.state === 'failed') return '同步失败';
  if (status.state === 'synced' && status.source === 'server') return '服务端快照';
  if (status.state === 'synced') return '已同步';
  return '暂无快照';
}

function formatRemoteSnapshotTime(status: PromptCacheRemoteSnapshotStatus): string {
  if (status.nextSyncAt) return `预计同步 ${formatFullTime(status.nextSyncAt)}`;
  if (status.syncedAt) return `最近同步 ${formatFullTime(status.syncedAt)}`;
  if (status.lastSyncAttemptAt) return `最近尝试 ${formatFullTime(status.lastSyncAttemptAt)}`;
  if (status.queuedAt) return `入队时间 ${formatFullTime(status.queuedAt)}`;
  if (status.serverUpdatedAt) return `服务端更新 ${formatFullTime(status.serverUpdatedAt)}`;
  if (status.serverStatusFetchedAt) return `服务端状态 ${formatFullTime(status.serverStatusFetchedAt)}`;
  return '等待 1h cache 命中后的成功请求';
}

function formatRemoteServerStatus(status: PromptCacheRemoteSnapshotStatus): string | null {
  if (!status.serverStatus) return null;
  if (status.serverStatus === 'active') return '服务器保活中';
  if (status.serverStatus === 'disabled') {
    return status.serverDisabledReason
      ? `服务器已停用：${status.serverDisabledReason}`
      : '服务器已停用';
  }
  return `服务器状态：${status.serverStatus}`;
}

function formatRemoteSnapshotSourceMeta(status: PromptCacheRemoteSnapshotStatus): string {
  const source = status.source === 'server' ? '服务端' : '本地';
  if (status.state === 'syncing') return `${source} · 正在上传`;
  if (status.queueCount > 0) return `${source} · 队列 ${status.queueCount}/5`;
  return `${source} · 无待同步队列`;
}

function formatSnapshotHash(hash: string | null): string | null {
  return hash ? hash.slice(0, 10) : null;
}

function roleLabel(role: string): string {
  if (role === 'user') return '你';
  if (role === 'assistant') return 'AI';
  if (role === 'system') return '系统';
  return '工具';
}

export default function ChatScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const topBarResponsiveMetrics = useMemo(() => {
    const reservedCenterHalf = TOP_BAR_DEFAULT_BUTTON_SIZE / 2;
    const availableSideWidth = Math.max(
      0,
      windowWidth / 2 - reservedCenterHalf - TOP_BAR_HORIZONTAL_INSET
    );
    const defaultSideWidth = TOP_BAR_SIDE_BUTTON_COUNT * TOP_BAR_DEFAULT_BUTTON_SIZE
      + (TOP_BAR_SIDE_BUTTON_COUNT - 1) * TOP_BAR_DEFAULT_GAP;

    if (availableSideWidth >= defaultSideWidth) {
      return {
        buttonStyle: undefined,
        groupStyle: undefined,
        iconSize: 22,
        clawdIconStyle: undefined,
      };
    }

    const gap = Math.max(
      0,
      Math.min(
        TOP_BAR_DEFAULT_GAP,
        (availableSideWidth - TOP_BAR_SIDE_BUTTON_COUNT * TOP_BAR_MIN_BUTTON_SIZE)
          / (TOP_BAR_SIDE_BUTTON_COUNT - 1)
      )
    );
    const buttonSize = Math.max(
      TOP_BAR_MIN_BUTTON_SIZE,
      Math.min(
        TOP_BAR_DEFAULT_BUTTON_SIZE,
        (availableSideWidth - (TOP_BAR_SIDE_BUTTON_COUNT - 1) * gap)
          / TOP_BAR_SIDE_BUTTON_COUNT
      )
    );
    const iconSize = Math.max(18, Math.min(22, buttonSize - 14));
    const clawdSize = Math.max(24, Math.min(30, buttonSize - 6));

    return {
      buttonStyle: {
        width: buttonSize,
        height: buttonSize,
        borderRadius: Math.min(8, buttonSize / 5),
      },
      groupStyle: { gap },
      iconSize,
      clawdIconStyle: {
        width: clawdSize,
        height: clawdSize,
      },
    };
  }, [windowWidth]);
  const appearanceConfig = useSettingsStore((state) => state.appearanceConfig);
  const customCssStyles = useMemo(
    () => parseAppearanceCss(appearanceConfig?.customCss),
    [appearanceConfig?.customCss]
  );
  const cssStyle = useCallback(
    (...selectors: string[]) => getAppearanceCssStyle(customCssStyles, ...selectors),
    [customCssStyles]
  );
  const imageCssStyle = useCallback(
    (...selectors: string[]) => cssStyle(...selectors) as ImageStyle | undefined,
    [cssStyle]
  );
  const hotboardConfig = useSettingsStore((state) => state.hotboardConfig);
  const settingsHydrated = useSettingsStore((state) => state._hydrated);
  const incomingLetterEnabled = useSettingsStore((state) => !!state.incomingLetterConfig?.enabled);
  const topBarIconUris = appearanceConfig?.topBarIconUris || {};
  const topBarIconDarkUris = appearanceConfig?.topBarIconDarkUris || {};
  const topBarIconHidden = appearanceConfig?.topBarIconHidden || {};
  const topBarIconsHidden = !!appearanceConfig?.topBarIconsHidden;
  const topBarFadeHidden = !!appearanceConfig?.topBarFadeHidden;
  const topBarFadeColorSetting = appearanceConfig?.topBarFadeColor;
  const topBarBackgroundImageUri = appearanceConfig?.topBarBackgroundImageUri;
  const chatBackgroundImageUri = appearanceConfig?.chatBackgroundImageUri;
  const chatBackgroundColor = appearanceConfig?.chatBackgroundColor || colors.background;
  const topBarCssStyle = cssStyle('.top-bar', '.chat-top-bar');
  const topBarGlass = getAppearanceGlassConfig(topBarCssStyle);
  const topBarBackgroundCssStyle = imageCssStyle('.top-bar-background', '.chat-top-bar-background');
  const topBarFadeCssStyle = cssStyle('.top-bar-fade', '.chat-top-bar-fade');
  const topBarCssBottom = useMemo(
    () => getTopBarCssBottom(topBarCssStyle),
    [topBarCssStyle]
  );
  const [topBarMeasuredBottom, setTopBarMeasuredBottom] = useState(0);
  const appearanceBlurTargetRef = useRef<View | null>(null);
  const messageTopInset = Math.max(topBarCssBottom, topBarMeasuredBottom);
  const messageTopFadeStyle = useMemo(
    () => ({ height: messageTopInset }),
    [messageTopInset]
  );
  const topBarFadeColor = typeof topBarFadeCssStyle?.backgroundColor === 'string'
    ? topBarFadeCssStyle.backgroundColor
    : topBarFadeColorSetting || colors.background;
  const { backgroundColor: _topBarFadeBackgroundColor, ...topBarFadeViewCssStyle } = topBarFadeCssStyle || {};
  const topBarLeftCssStyle = cssStyle('.top-bar-left', '.top-bar-left-group');
  const topBarRightCssStyle = cssStyle('.top-bar-right', '.top-bar-right-group');
  const topBarCenterCssStyle = cssStyle('.top-bar-center', '.top-bar-center-slot');
  const topBarCenterButtonCssStyle = cssStyle('.top-bar-center-button', '.top-bar-clawd-button');
  const clawdIconCssStyle = imageCssStyle('.top-bar-icon', '.top-bar-clawd-icon');
  const {
    conversationId,
    messages,
    hiddenRanges,
    hiddenMessageIds,
    hasOlderMessages,
    isLoadingOlderMessages,
    hasNewerMessages,
    isLoadingNewerMessages,
    messageFloorOffset,
    pendingScrollMessageId,
    openToBottomRequestId,
    isStreaming,
    isRemoteInboxSyncing,
    remoteInboxSyncConversationId,
    error,
    addUserMessage,
    addLocationMessage,
    addVoiceMessage,
    attachConversationFile,
    loadOlderMessages,
    loadNewerMessages,
    loadConversationAroundMessage,
    clearPendingScrollMessage,
    enableWebCruise,
    triggerResponse,
    stopStreaming,
  } = useChatStore();
  const {
    periodRecords,
    addPeriodRecord,
    editPeriodRecord,
    removePeriodRecord,
  } = usePeriodStore();
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [monthJumpVisible, setMonthJumpVisible] = useState(false);
  const [monthJumpText, setMonthJumpText] = useState('');
  const [chatDateKeys] = useState<Set<string>>(new Set());
  const [dailyPaperDateKeys] = useState<Set<string>>(new Set());
  const calendarLoading = false;
  const [dateActionKey, setDateActionKey] = useState<string | null>(null);
  const [dismissedDividers, setDismissedDividers] = useState<Set<string>>(new Set());
  const [visibleFloorMessageId, setVisibleFloorMessageId] = useState<string | null>(null);
  const [inputBarHeight, setInputBarHeight] = useState(INPUT_BAR_FALLBACK_HEIGHT);
  const [enteringMessageIds, setEnteringMessageIds] = useState<Set<string>>(new Set());
  const [isInitialPositioning, setIsInitialPositioning] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [incomingLetter, setIncomingLetter] = useState<IncomingLetter | null>(null);
  const [clawdStatusVisible, setClawdStatusVisible] = useState(false);
  const [remoteSnapshotStatus, setRemoteSnapshotStatus] = useState(() => getPromptCacheRemoteSnapshotStatus());
  const [refreshingRemoteServerStatus, setRefreshingRemoteServerStatus] = useState(false);
  const [callTypeSheetVisible, setCallTypeSheetVisible] = useState(false);
  const [dismissedAskUserMessageId, setDismissedAskUserMessageId] = useState<string | null>(null);
  const voiceCallSnapshot = useVoiceCallStore((state) => state.snapshot);
  const startVoiceCall = useVoiceCallStore((state) => state.startCall);
  const pendingAskUserRequest = useMemo(
    () => getPendingAskUserRequest(messages),
    [messages]
  );
  const visibleAskUserRequest =
    pendingAskUserRequest?.messageId === dismissedAskUserMessageId ? null : pendingAskUserRequest;

  function resolveTopBarIconStyle(iconKey: TopBarIconKey) {
    const rawStyle = cssStyle('.top-bar-icon', `.top-bar-${iconKey}-icon`);
    if (!rawStyle) {
      return {
        wrapperStyle: undefined,
        color: colors.text,
        size: undefined,
      };
    }

    const {
      color,
      fontSize,
      fontStyle,
      fontWeight,
      letterSpacing,
      lineHeight,
      textAlign,
      textDecorationLine,
      textShadowColor,
      textTransform,
      ...wrapperStyle
    } = rawStyle;
    const size = typeof rawStyle.width === 'number'
      ? rawStyle.width
      : typeof rawStyle.height === 'number'
        ? rawStyle.height
        : undefined;

    return {
      wrapperStyle,
      color: typeof color === 'string' ? color : colors.text,
      size,
    };
  }

  function renderTopBarIcon(iconKey: TopBarIconKey) {
    const iconStyle = resolveTopBarIconStyle(iconKey);
    return (
      <View pointerEvents="none" style={[styles.topBarIconSlot, iconStyle.wrapperStyle]}>
        <TopBarIcon
          iconKey={iconKey}
          color={iconStyle.color}
          customUri={topBarIconUris[iconKey]}
          darkCustomUri={topBarIconDarkUris[iconKey]}
          size={iconStyle.size ?? topBarResponsiveMetrics.iconSize}
        />
      </View>
    );
  }

  function topBarButtonStyle(iconKey: TopBarIconKey) {
    return cssStyle('.top-bar-button', `.top-bar-${iconKey}-button`);
  }
  const [flushingRemoteSnapshot, setFlushingRemoteSnapshot] = useState(false);
  const showRemoteInboxLoading = !!conversationId
    && isRemoteInboxSyncing
    && remoteInboxSyncConversationId === conversationId;
  const flatListRef = useRef<FlatList<Message>>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFollowUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPositioningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollFollowUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clawdStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newerMessagesAutoScrollResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enteringMessageTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const listHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const lastAutoScrollAtRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const suppressNextContentAutoScrollRef = useRef(false);
  const suppressEndReachedUntilRef = useRef(0);
  const olderMessagesAutoLoadRef = useRef(false);
  const messageIdsRef = useRef<string[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const pendingScrollMessageIdRef = useRef<string | null>(null);
  const initialPositioningConversationRef = useRef<string | null>(null);
  const isInitialPositioningRef = useRef(false);
  const handledOpenToBottomRequestRef = useRef(0);
  const hasListLaidOutRef = useRef(false);
  const floorVisibleAtTouchStartRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const restoreBottomOnActiveRef = useRef(false);
  const incomingLetterCheckRef = useRef(false);
  const shownIncomingLetterIdsRef = useRef<Set<string>>(new Set());

  const keyboard = useAnimatedKeyboard();
  const periodDateKeys = useMemo(() => buildPeriodDateSet(periodRecords), [periodRecords]);
  const periodPrediction = useMemo(() => calculatePeriodPrediction(periodRecords), [periodRecords]);
  const predictedPeriodDateKeys = useMemo(() => {
    if (!periodPrediction) return new Set<string>();
    return new Set(getDateKeysInRange(periodPrediction.startDate, periodPrediction.endDate));
  }, [periodPrediction]);
  const pendingPeriodRecord = useMemo(
    () => periodRecords.find((record) => !record.endDate) || null,
    [periodRecords]
  );

  const checkIncomingLetters = useCallback(async () => {
    if (!settingsHydrated || !incomingLetterEnabled || incomingLetterCheckRef.current) return;
    incomingLetterCheckRef.current = true;
    try {
      const letters = await ensureTodayIncomingLetters();
      const nextLetter = letters.find((letter) => !shownIncomingLetterIdsRef.current.has(letter.id));
      if (nextLetter) {
        shownIncomingLetterIdsRef.current.add(nextLetter.id);
        setIncomingLetter(nextLetter);
      }
    } catch (error) {
      console.warn('[IncomingLetter] check failed:', error);
    } finally {
      incomingLetterCheckRef.current = false;
    }
  }, [incomingLetterEnabled, settingsHydrated]);

  const closeIncomingLetter = useCallback(async () => {
    const letter = incomingLetter;
    setIncomingLetter(null);
    if (letter && !letter.shownAt) {
      try {
        await markIncomingLetterShown(letter.id);
      } catch (error) {
        console.warn('[IncomingLetter] mark shown failed:', error);
      }
    }
  }, [incomingLetter]);

  useEffect(() => {
    checkIncomingLetters().catch(() => undefined);
  }, [checkIncomingLetters]);

  const jumpToDate = useCallback(async (dateKey: string) => {
    if (!conversationId || !chatDateKeys.has(dateKey)) return;
    const { startAt, endAt } = dateRangeForKey(dateKey);
    const firstMessage = await getFirstMessageInDateRange(conversationId, startAt, endAt);
    if (!firstMessage) return;
    setCalendarVisible(false);
    await loadConversationAroundMessage(conversationId, firstMessage.id);
  }, [chatDateKeys, conversationId, loadConversationAroundMessage]);

  const openMonthJump = useCallback(() => {
    setMonthJumpText(`${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}`);
    setMonthJumpVisible(true);
  }, [calendarMonth]);

  const confirmMonthJump = useCallback(() => {
    const nextMonth = parseCalendarMonthInput(monthJumpText);
    if (!nextMonth) return;
    setCalendarMonth(nextMonth);
    setMonthJumpVisible(false);
  }, [monthJumpText]);

  const handleDateLongPress = useCallback((key: string) => {
    setDateActionKey(key);
  }, []);

  const openDailyPaper = useCallback((key: string) => {
    setDateActionKey(null);
    setCalendarVisible(false);
    router.push(`/daily-paper/${key}`);
  }, [router]);

  const handleRecordPeriodDate = useCallback(async (key: string) => {
    setDateActionKey(null);
    if (pendingPeriodRecord) {
      if (key <= pendingPeriodRecord.startDate) {
        Alert.alert('选择结束日', `请长按 ${pendingPeriodRecord.startDate} 之后的日期作为结束日。`);
        return;
      }
      await editPeriodRecord(pendingPeriodRecord.id, { endDate: key });
      return;
    }

    const record = findPeriodRecordForDate(periodRecords, key);
    if (record?.endDate) {
      Alert.alert('删除记录', `确定删除 ${record.startDate} 至 ${record.endDate} 的生理期记录？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            removePeriodRecord(record.id).catch(() => undefined);
          },
        },
      ]);
      return;
    }

    await addPeriodRecord(key, null);
  }, [addPeriodRecord, editPeriodRecord, pendingPeriodRecord, periodRecords, removePeriodRecord]);

  const scrollToEnd = useCallback((animated = false) => {
    shouldStickToBottomRef.current = true;

    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const contentHeight = contentHeightRef.current;
      const listHeight = listHeightRef.current;

      if (contentHeight > 0 && listHeight > 0) {
        flatListRef.current?.scrollToOffset({
          offset: Math.max(0, contentHeight - listHeight),
          animated,
        });
        return;
      }

      flatListRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const scheduleScrollToEnd = useCallback((delay = 24, followUp = false, throttled = false) => {
    if (throttled) {
      const now = Date.now();
      const elapsed = now - lastAutoScrollAtRef.current;
      if (elapsed < AUTO_SCROLL_THROTTLE_MS) {
        delay = Math.max(delay, AUTO_SCROLL_THROTTLE_MS - elapsed);
      }
      lastAutoScrollAtRef.current = now + delay;
    }

    if (scrollSettleTimerRef.current !== null) {
      clearTimeout(scrollSettleTimerRef.current);
    }

    scrollSettleTimerRef.current = setTimeout(() => {
      scrollSettleTimerRef.current = null;
      scrollToEnd(false);

      if (followUp) {
        if (scrollFollowUpTimerRef.current !== null) {
          clearTimeout(scrollFollowUpTimerRef.current);
        }
        scrollFollowUpTimerRef.current = setTimeout(() => {
          scrollFollowUpTimerRef.current = null;
          scrollToEnd(false);
        }, 90);
      }
    }, delay);
  }, [scrollToEnd]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
      if (scrollSettleTimerRef.current !== null) {
        clearTimeout(scrollSettleTimerRef.current);
      }
      if (scrollFollowUpTimerRef.current !== null) {
        clearTimeout(scrollFollowUpTimerRef.current);
      }
      if (initialPositioningTimerRef.current !== null) {
        clearTimeout(initialPositioningTimerRef.current);
      }
      if (pendingScrollStartTimerRef.current !== null) {
        clearTimeout(pendingScrollStartTimerRef.current);
      }
      if (pendingScrollFollowUpTimerRef.current !== null) {
        clearTimeout(pendingScrollFollowUpTimerRef.current);
      }
      if (pendingScrollSettleTimerRef.current !== null) {
        clearTimeout(pendingScrollSettleTimerRef.current);
      }
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
      if (clawdStatusTimerRef.current !== null) {
        clearTimeout(clawdStatusTimerRef.current);
      }
      if (newerMessagesAutoScrollResetTimerRef.current !== null) {
        clearTimeout(newerMessagesAutoScrollResetTimerRef.current);
      }
      enteringMessageTimersRef.current.forEach((timer) => clearTimeout(timer));
      enteringMessageTimersRef.current.clear();
    };
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1800);
  }, []);

  const openVoiceCall = useCallback(async () => {
    if (voiceCallSnapshot.active) {
      router.push('/voice-call');
      return;
    }

    if (!isAndroidVoiceCallAvailable()) {
      Alert.alert('语音通话不可用', '实时语音通话目前只支持 Android 自定义构建。');
      return;
    }

    setCallTypeSheetVisible(true);
  }, [router, voiceCallSnapshot.active]);

  const startSelectedCall = useCallback(async (mode: VoiceCallMode) => {
    setCallTypeSheetVisible(false);
    try {
      await startVoiceCall({ mode });
      showToast(mode === 'video' ? '视频通话已开始' : mode === 'screen' ? '共享屏幕通话已开始' : '语音通话已开始');
      router.push('/voice-call');
    } catch (error: any) {
      Alert.alert('通话启动失败', error?.message || '请检查 STT 和 TTS 配置');
    }
  }, [router, showToast, startVoiceCall]);

  const closeClawdStatus = useCallback(() => {
    if (clawdStatusTimerRef.current !== null) {
      clearTimeout(clawdStatusTimerRef.current);
      clawdStatusTimerRef.current = null;
    }
    setClawdStatusVisible(false);
  }, []);

  const openClawdStatus = useCallback(() => {
    if (clawdStatusTimerRef.current !== null) {
      clearTimeout(clawdStatusTimerRef.current);
    }
    setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
    setClawdStatusVisible(true);
    clawdStatusTimerRef.current = setTimeout(() => {
      setClawdStatusVisible(false);
      clawdStatusTimerRef.current = null;
    }, CLAWD_STATUS_AUTO_CLOSE_MS);
  }, []);

  const handleRefreshRemoteServerStatus = useCallback(async () => {
    if (refreshingRemoteServerStatus) return;
    setRefreshingRemoteServerStatus(true);
    try {
      const ok = await refreshPromptCacheRemoteServerStatus(conversationId);
      showToast(ok ? '已刷新服务器快照状态' : '服务器状态读取失败');
    } catch (error: any) {
      showToast(error?.message || '服务器状态读取失败');
    } finally {
      setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
      setRefreshingRemoteServerStatus(false);
    }
  }, [conversationId, refreshingRemoteServerStatus, showToast]);

  const handleFlushRemoteSnapshotNow = useCallback(async () => {
    if (flushingRemoteSnapshot || remoteSnapshotStatus.queueCount <= 0) return;
    setFlushingRemoteSnapshot(true);
    try {
      const ok = await flushPromptCacheRemoteSnapshotNow();
      showToast(ok ? '快照已同步到远程服务' : '快照同步失败');
    } catch (error: any) {
      showToast(error?.message || '快照同步失败');
    } finally {
      setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
      setFlushingRemoteSnapshot(false);
    }
  }, [flushingRemoteSnapshot, remoteSnapshotStatus.queueCount, showToast]);

  useEffect(() => {
    return subscribePromptCacheRemoteSnapshotStatus(() => {
      setRemoteSnapshotStatus(getPromptCacheRemoteSnapshotStatus());
    });
  }, []);

  const clearEnteringMessageAnimations = useCallback(() => {
    enteringMessageTimersRef.current.forEach((timer) => clearTimeout(timer));
    enteringMessageTimersRef.current.clear();
    setEnteringMessageIds((current) => (current.size === 0 ? current : new Set()));
  }, []);

  useEffect(() => {
    pendingScrollMessageIdRef.current = pendingScrollMessageId;
  }, [pendingScrollMessageId]);

  const handleEnableWebCruise = useCallback(async () => {
    if (!hotboardConfig?.enabled) {
      showToast('请先在 Tool 设置中开启 AI 网页巡游热榜');
      return;
    }
    if (!hotboardConfig.apiKey.trim()) {
      showToast('请先在 Tool 设置中填写 UAPI API Key');
      return;
    }
    await enableWebCruise();
  }, [enableWebCruise, hotboardConfig, showToast]);

  const finishInitialPositioning = useCallback(() => {
    if (initialPositioningTimerRef.current !== null) {
      clearTimeout(initialPositioningTimerRef.current);
    }
    scrollToEnd(false);
    initialPositioningTimerRef.current = setTimeout(() => {
      initialPositioningTimerRef.current = null;
      isInitialPositioningRef.current = false;
      setIsInitialPositioning(false);
      scheduleScrollToEnd(32, true);
    }, 40);
  }, [scheduleScrollToEnd, scrollToEnd]);

  const beginInitialPositioning = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    if (scrollSettleTimerRef.current !== null) {
      clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = null;
    }
    if (scrollFollowUpTimerRef.current !== null) {
      clearTimeout(scrollFollowUpTimerRef.current);
      scrollFollowUpTimerRef.current = null;
    }
    if (initialPositioningTimerRef.current !== null) {
      clearTimeout(initialPositioningTimerRef.current);
      initialPositioningTimerRef.current = null;
    }

    contentHeightRef.current = 0;
    shouldStickToBottomRef.current = true;
    isInitialPositioningRef.current = true;
    setIsInitialPositioning(true);

    initialPositioningTimerRef.current = setTimeout(() => {
      finishInitialPositioning();
    }, 180);
  }, [finishInitialPositioning]);

  useLayoutEffect(() => {
    if (!conversationId || messages.length === 0 || pendingScrollMessageId) {
      if (initialPositioningTimerRef.current !== null) {
        clearTimeout(initialPositioningTimerRef.current);
        initialPositioningTimerRef.current = null;
      }
      isInitialPositioningRef.current = false;
      setIsInitialPositioning(false);
      initialPositioningConversationRef.current = conversationId;
      return;
    }

    const conversationChanged = conversationId !== initialPositioningConversationRef.current;
    const hasOpenRequest = openToBottomRequestId > handledOpenToBottomRequestRef.current;

    if (hasOpenRequest) {
      handledOpenToBottomRequestRef.current = openToBottomRequestId;
    }

    if (conversationChanged) {
      initialPositioningConversationRef.current = conversationId;
      beginInitialPositioning();
      return;
    }

    if (hasOpenRequest) {
      scheduleScrollToEnd(32, true);
    }
  }, [
    beginInitialPositioning,
    conversationId,
    messages.length,
    openToBottomRequestId,
    pendingScrollMessageId,
    scheduleScrollToEnd,
  ]);

  useEffect(() => {
    if (!isInitialPositioning) return;
    if (contentHeightRef.current > 0 && listHeightRef.current > 0) {
      finishInitialPositioning();
    }
  }, [finishInitialPositioning, isInitialPositioning]);

  const prepareBottomRestore = useCallback(() => {
    if (
      restoreBottomOnActiveRef.current ||
      isInitialPositioningRef.current ||
      pendingScrollMessageIdRef.current ||
      messageIdsRef.current.length === 0 ||
      !shouldStickToBottomRef.current
    ) {
      return;
    }

    restoreBottomOnActiveRef.current = true;
    isInitialPositioningRef.current = true;
    setIsInitialPositioning(true);
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'background' || nextState === 'inactive') {
        prepareBottomRestore();
        return;
      }

      if (
        nextState === 'active' &&
        restoreBottomOnActiveRef.current &&
        (previousState === 'background' || previousState === 'inactive')
      ) {
        restoreBottomOnActiveRef.current = false;
        finishInitialPositioning();
      }

      if (
        nextState === 'active' &&
        (previousState === 'background' || previousState === 'inactive')
      ) {
        checkIncomingLetters().catch(() => undefined);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [checkIncomingLetters, finishInitialPositioning, prepareBottomRestore]);

  const handleScreenTouchStart = useCallback(() => {
    const shouldKeepBottom = shouldStickToBottomRef.current;
    floorVisibleAtTouchStartRef.current = visibleFloorMessageId !== null;
    if (visibleFloorMessageId !== null) {
      setVisibleFloorMessageId(null);
      if (shouldKeepBottom) {
        scheduleScrollToEnd(24, true);
      }
    }
  }, [scheduleScrollToEnd, visibleFloorMessageId]);

  const handleBubblePress = useCallback((messageId: string) => {
    if (floorVisibleAtTouchStartRef.current) return;
    const shouldKeepBottom = shouldStickToBottomRef.current;
    setVisibleFloorMessageId(messageId);
    if (shouldKeepBottom) {
      scheduleScrollToEnd(24, true);
    }
  }, [scheduleScrollToEnd]);

  useEffect(() => {
    const nextIds = messages.map((message) => message.id);
    const prevIds = messageIdsRef.current;
    const prevConversationId = conversationIdRef.current;
    const conversationChanged = conversationId !== prevConversationId;
    const appended =
      nextIds.length > prevIds.length &&
      prevIds.every((id, index) => nextIds[index] === id);

    messageIdsRef.current = nextIds;
    conversationIdRef.current = conversationId;

    if (nextIds.length === 0) {
      shouldStickToBottomRef.current = true;
      return;
    }

    if (!pendingScrollMessageId && appended && suppressNextContentAutoScrollRef.current) {
      shouldStickToBottomRef.current = false;
      return;
    }

    if (!pendingScrollMessageId && appended) {
      shouldStickToBottomRef.current = true;
      if (isInitialPositioningRef.current) return;
      if (!conversationChanged && prevIds.length > 0) {
        const enteringIds = nextIds.slice(prevIds.length);
        setEnteringMessageIds((current) => {
          const next = new Set(current);
          enteringIds.forEach((id) => next.add(id));
          return next;
        });
        enteringIds.forEach((id) => {
          const existingTimer = enteringMessageTimersRef.current.get(id);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          const timer = setTimeout(() => {
            enteringMessageTimersRef.current.delete(id);
            setEnteringMessageIds((current) => {
              if (!current.has(id)) return current;
              const next = new Set(current);
              next.delete(id);
              return next;
            });
          }, 420);
          enteringMessageTimersRef.current.set(id, timer);
        });
      }
      scheduleScrollToEnd(32, true);
    }
  }, [conversationId, messages, pendingScrollMessageId, scheduleScrollToEnd]);

  useEffect(() => {
    if (
      !isInitialPositioningRef.current &&
      !pendingScrollMessageId &&
      messageIdsRef.current.length > 0 &&
      shouldStickToBottomRef.current
    ) {
      scheduleScrollToEnd(32, true);
    }
  }, [inputBarHeight, pendingScrollMessageId, scheduleScrollToEnd]);

  useEffect(() => {
    if (!pendingScrollMessageId) return;
    const index = messages.findIndex((message) => message.id === pendingScrollMessageId);
    if (index < 0) return;

    if (pendingScrollStartTimerRef.current !== null) {
      clearTimeout(pendingScrollStartTimerRef.current);
    }
    if (pendingScrollFollowUpTimerRef.current !== null) {
      clearTimeout(pendingScrollFollowUpTimerRef.current);
    }
    if (pendingScrollSettleTimerRef.current !== null) {
      clearTimeout(pendingScrollSettleTimerRef.current);
    }

    shouldStickToBottomRef.current = false;
    suppressNextContentAutoScrollRef.current = true;
    suppressEndReachedUntilRef.current = Date.now() + PROGRAMMATIC_JUMP_SUPPRESS_MS;

    const scrollToPendingMessage = (animated: boolean) => {
      flatListRef.current?.scrollToIndex({
        index,
        animated,
        viewPosition: 0.5,
      });
    };

    pendingScrollStartTimerRef.current = setTimeout(() => {
      pendingScrollStartTimerRef.current = null;
      scrollToPendingMessage(true);

      pendingScrollFollowUpTimerRef.current = setTimeout(() => {
        pendingScrollFollowUpTimerRef.current = null;
        if (pendingScrollMessageIdRef.current === pendingScrollMessageId) {
          scrollToPendingMessage(false);
        }
      }, 180);

      pendingScrollSettleTimerRef.current = setTimeout(() => {
        pendingScrollSettleTimerRef.current = null;
        if (pendingScrollMessageIdRef.current === pendingScrollMessageId) {
          clearPendingScrollMessage();
        }
        suppressNextContentAutoScrollRef.current = false;
      }, 520);
    }, 80);

    return () => {
      if (pendingScrollStartTimerRef.current !== null) {
        clearTimeout(pendingScrollStartTimerRef.current);
        pendingScrollStartTimerRef.current = null;
      }
      if (pendingScrollFollowUpTimerRef.current !== null) {
        clearTimeout(pendingScrollFollowUpTimerRef.current);
        pendingScrollFollowUpTimerRef.current = null;
      }
      if (pendingScrollSettleTimerRef.current !== null) {
        clearTimeout(pendingScrollSettleTimerRef.current);
        pendingScrollSettleTimerRef.current = null;
      }
    };
  }, [clearPendingScrollMessage, messages, pendingScrollMessageId]);

  useFocusEffect(
    useCallback(() => {
      clearEnteringMessageAnimations();
      if (restoreBottomOnActiveRef.current) {
        restoreBottomOnActiveRef.current = false;
        finishInitialPositioning();
        return () => {
          prepareBottomRestore();
        };
      }

      if (
        !isInitialPositioningRef.current &&
        !pendingScrollMessageId &&
        messageIdsRef.current.length > 0 &&
        shouldStickToBottomRef.current
      ) {
        scheduleScrollToEnd(32, true);
      }
      return () => {
        prepareBottomRestore();
      };
    }, [
      clearEnteringMessageAnimations,
      finishInitialPositioning,
      prepareBottomRestore,
      scheduleScrollToEnd,
    ])
  );

  const handleInputLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      setInputBarHeight((current) =>
        Math.abs(current - nextHeight) > 1 ? nextHeight : current
      );
    }
  }, []);

  const handleTopBarLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    const nextBottom = Math.ceil(Math.max(0, y + height));
    setTopBarMeasuredBottom((current) =>
      Math.abs(current - nextBottom) > 1 ? nextBottom : current
    );
  }, []);

  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0 && Math.abs(listHeightRef.current - nextHeight) > 1) {
      listHeightRef.current = nextHeight;
      if (!isInitialPositioningRef.current && (!hasListLaidOutRef.current || shouldStickToBottomRef.current)) {
        scheduleScrollToEnd(24);
      }
      hasListLaidOutRef.current = true;
    }
  }, [scheduleScrollToEnd]);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    const nextHeight = Math.ceil(height);
    const heightChanged = Math.abs(contentHeightRef.current - nextHeight) > 1;
    contentHeightRef.current = nextHeight;

    if (isInitialPositioningRef.current && nextHeight > 0 && listHeightRef.current > 0) {
      finishInitialPositioning();
      return;
    }

    if (heightChanged && suppressNextContentAutoScrollRef.current) {
      suppressNextContentAutoScrollRef.current = false;
      if (newerMessagesAutoScrollResetTimerRef.current !== null) {
        clearTimeout(newerMessagesAutoScrollResetTimerRef.current);
        newerMessagesAutoScrollResetTimerRef.current = null;
      }
      return;
    }

    if (heightChanged && shouldStickToBottomRef.current) {
      scheduleScrollToEnd(24, false, true);
    }
  }, [finishInitialPositioning, scheduleScrollToEnd]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isInitialPositioningRef.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceToTop = contentOffset.y;
    const distanceToBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    shouldStickToBottomRef.current = distanceToBottom <= 80;

    if (
      distanceToTop <= LOAD_MORE_EDGE_THRESHOLD &&
      !pendingScrollMessageIdRef.current &&
      hasOlderMessages &&
      !isLoadingOlderMessages &&
      !olderMessagesAutoLoadRef.current
    ) {
      olderMessagesAutoLoadRef.current = true;
      void loadOlderMessages().finally(() => {
        olderMessagesAutoLoadRef.current = false;
      });
    }
  }, [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages]);

  const messageContentStyle = useMemo(
    () => [
      styles.messageContent,
      { paddingTop: messageTopInset },
      { paddingBottom: inputBarHeight + MESSAGE_BOTTOM_GAP },
    ],
    [inputBarHeight, messageTopInset]
  );

  const visibleMessages = useMemo(
    () => messages.filter(
      (message) => !message.content.startsWith('[YS_REACTION]')
    ),
    [messages]
  );

  const floorMap = useMemo(() => {
    const map = new Map<string, number>();
    let floor = messageFloorOffset;
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        floor++;
        map.set(msg.id, floor);
      }
    }
    return map;
  }, [messageFloorOffset, messages]);

  const latestAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id;
    }
    return null;
  }, [messages]);

  const hiddenFloorSet = useMemo(() => {
    const set = new Set<number>();
    for (const r of hiddenRanges) {
      for (let i = r.from; i <= r.to; i++) set.add(i);
    }
    return set;
  }, [hiddenRanges]);

  const hiddenMessageIdSet = useMemo(
    () => new Set(hiddenMessageIds),
    [hiddenMessageIds]
  );

  const animatedMessageStyle = useAnimatedStyle(() => {
    const kbHeight = keyboard.height.value;
    const lift = kbHeight > 0 ? Math.max(kbHeight - insets.bottom, 0) : 0;
    return {
      transform: [{ translateY: -lift }],
    };
  });

  const animatedInputStyle = useAnimatedStyle(() => {
    const kbHeight = keyboard.height.value;
    const lift = kbHeight > 0 ? Math.max(kbHeight - insets.bottom, 0) : 0;
    return {
      transform: [{ translateY: -lift }],
    };
  });

  const handleToolDetailScrollActiveChange = useCallback((active: boolean) => {
    flatListRef.current?.setNativeProps({ scrollEnabled: !active });
  }, []);

  const renderMessageItem = useCallback<ListRenderItem<Message>>(
    ({ item, index }) => {
      const prev = index > 0 ? visibleMessages[index - 1] : null;
      const next = index < visibleMessages.length - 1 ? visibleMessages[index + 1] : null;
      const isSeparatedByTime =
        !prev || item.createdAt - prev.createdAt >= TIME_GAP_THRESHOLD_MS;
      const isFollowedBySameRole =
        (item.role === 'user' || item.role === 'assistant') &&
        next?.role === item.role &&
        next.createdAt - item.createdAt < TIME_GAP_THRESHOLD_MS;
      const showDivider =
        isSeparatedByTime &&
        !dismissedDividers.has(item.id);
      const showAvatarHeader =
        (item.role === 'user' || item.role === 'assistant') &&
        (prev?.role !== item.role || isSeparatedByTime);
      const isPrecededBySameRole =
        (item.role === 'user' || item.role === 'assistant') &&
        prev?.role === item.role &&
        item.createdAt - prev.createdAt < TIME_GAP_THRESHOLD_MS;
      const sideAvatarDisplayMode = appearanceConfig?.sideAvatarDisplayMode || 'every';
      const showSideAvatar =
        sideAvatarDisplayMode === 'first'
          ? !isPrecededBySameRole
          : sideAvatarDisplayMode === 'last'
            ? !isFollowedBySameRole
            : true;
      const floor = floorMap.get(item.id);
      const isHidden =
        hiddenMessageIdSet.has(item.id) ||
        (floor !== undefined && hiddenFloorSet.has(floor));

      return (
        <>
          {showDivider && (
            <TimeDivider
              timestamp={item.createdAt}
              onDelete={() =>
                setDismissedDividers((current) => new Set(current).add(item.id))
              }
            />
          )}
          <ChatMessageEntrance animate={enteringMessageIds.has(item.id)}>
            <ChatBubble
              blurTarget={appearanceBlurTargetRef}
              message={item}
              previousUserMessage={prev?.role === 'user' ? prev : null}
              isHidden={isHidden}
              floorNumber={floor}
              showFloorNumber={visibleFloorMessageId === item.id && floor !== undefined}
              showAvatarHeader={showAvatarHeader}
              showSideAvatar={showSideAvatar}
              showBubbleTail={!isFollowedBySameRole}
              onBubblePress={floor !== undefined ? handleBubblePress : undefined}
              onToolDetailScrollActiveChange={handleToolDetailScrollActiveChange}
              isLastAssistant={
                item.role === 'assistant' &&
                item.id === latestAssistantMessageId
              }
              showAssistantFooter={
                item.role === 'assistant' &&
                item.id === latestAssistantMessageId
              }
            />
          </ChatMessageEntrance>
        </>
      );
    },
    [appearanceConfig?.sideAvatarDisplayMode, dismissedDividers, enteringMessageIds, floorMap, handleBubblePress, handleToolDetailScrollActiveChange, hiddenFloorSet, hiddenMessageIdSet, latestAssistantMessageId, visibleMessages, visibleFloorMessageId]
  );

  const renderOlderMessagesHeader = useCallback(() => {
    if (!hasOlderMessages) return null;
    return (
      <View style={styles.loadOlderContainer}>
        <Pressable
          style={[styles.loadOlderButton, isLoadingOlderMessages && styles.loadOlderButtonDisabled]}
          onPress={loadOlderMessages}
          disabled={isLoadingOlderMessages}
        >
          {isLoadingOlderMessages ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.loadOlderText}>加载更早消息</Text>
          )}
        </Pressable>
      </View>
    );
  }, [hasOlderMessages, isLoadingOlderMessages, loadOlderMessages]);

  const handleLoadNewerMessages = useCallback(async () => {
    if (!hasNewerMessages || isLoadingNewerMessages) return;
    if (
      pendingScrollMessageIdRef.current ||
      Date.now() < suppressEndReachedUntilRef.current
    ) {
      return;
    }

    suppressNextContentAutoScrollRef.current = true;
    if (newerMessagesAutoScrollResetTimerRef.current !== null) {
      clearTimeout(newerMessagesAutoScrollResetTimerRef.current);
    }

    try {
      await loadNewerMessages();
    } finally {
      newerMessagesAutoScrollResetTimerRef.current = setTimeout(() => {
        suppressNextContentAutoScrollRef.current = false;
        newerMessagesAutoScrollResetTimerRef.current = null;
      }, 1000);
    }
  }, [hasNewerMessages, isLoadingNewerMessages, loadNewerMessages]);

  const renderNewerMessagesFooter = useCallback(() => {
    if (!hasNewerMessages) return null;
    return (
      <View style={styles.loadNewerContainer}>
        <Pressable
          style={[styles.loadOlderButton, isLoadingNewerMessages && styles.loadOlderButtonDisabled]}
          onPress={handleLoadNewerMessages}
          disabled={isLoadingNewerMessages}
        >
          {isLoadingNewerMessages ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.loadOlderText}>加载更新消息</Text>
          )}
        </Pressable>
      </View>
    );
  }, [handleLoadNewerMessages, hasNewerMessages, isLoadingNewerMessages]);

  const renderMessageListFooter = useCallback(() => {
    if (!hasNewerMessages && !showRemoteInboxLoading) return null;
    return (
      <>
        {renderNewerMessagesFooter()}
        {showRemoteInboxLoading ? (
          <View style={styles.remoteInboxLoadingContainer}>
            <View style={styles.remoteInboxLoadingPill}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.remoteInboxLoadingText}>正在接收 AI 消息...</Text>
            </View>
          </View>
        ) : null}
      </>
    );
  }, [hasNewerMessages, renderNewerMessagesFooter, showRemoteInboxLoading]);

  const handleEndReached = useCallback(() => {
    if (!hasNewerMessages || isLoadingNewerMessages) return;
    void handleLoadNewerMessages();
  }, [handleLoadNewerMessages, hasNewerMessages, isLoadingNewerMessages]);

  const messageListNode = (
    <FlatList
      ref={flatListRef}
      data={visibleMessages}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      renderItem={renderMessageItem}
      style={[styles.messageList, isInitialPositioning && styles.messageListHidden]}
      contentContainerStyle={messageContentStyle}
      onLayout={handleListLayout}
      onContentSizeChange={handleContentSizeChange}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.2}
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={32}
      windowSize={9}
      removeClippedSubviews={false}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        if (!pendingScrollMessageIdRef.current) return;
        suppressEndReachedUntilRef.current = Date.now() + PROGRAMMATIC_JUMP_SUPPRESS_MS;
        flatListRef.current?.scrollToOffset({
          offset: Math.max(0, averageItemLength * index),
          animated: false,
        });
        setTimeout(() => {
          if (!pendingScrollMessageIdRef.current) return;
          flatListRef.current?.scrollToIndex({
            index,
            animated: false,
            viewPosition: 0.5,
          });
        }, 120);
      }}
      ListHeaderComponent={renderOlderMessagesHeader}
      ListFooterComponent={renderMessageListFooter}
      ListEmptyComponent={<EmptyState />}
    />
  );
  const remoteServerStatusText = formatRemoteServerStatus(remoteSnapshotStatus);
  const remoteSnapshotHash = formatSnapshotHash(remoteSnapshotStatus.serverSnapshotHash);
  const remoteSnapshotMeta = [
    remoteSnapshotStatus.model ? `模型 ${remoteSnapshotStatus.model}` : null,
    remoteSnapshotStatus.messageCount > 0 ? `${remoteSnapshotStatus.messageCount} 条消息` : null,
    remoteSnapshotHash ? `#${remoteSnapshotHash}` : null,
  ].filter(Boolean).join(' · ');
  const remoteSnapshotLastMessage = remoteSnapshotStatus.lastMessageTail
    ? `${roleLabel(remoteSnapshotStatus.lastMessageRole || '')}：${remoteSnapshotStatus.lastMessageTail}`
    : '暂无快照消息预览';
  const remoteServerNextKeepalive = remoteSnapshotStatus.serverNextKeepaliveAt
    ? `下次保活 ${formatFullTime(remoteSnapshotStatus.serverNextKeepaliveAt)}`
    : null;
  const remoteServerFetchedAt = remoteSnapshotStatus.serverStatusFetchedAt
    ? `服务器状态 ${formatFullTime(remoteSnapshotStatus.serverStatusFetchedAt)}`
    : null;
  const remoteServerDetail = remoteSnapshotStatus.serverStatusError
    || remoteSnapshotStatus.serverLastError
    || remoteServerNextKeepalive
    || remoteServerFetchedAt;

  return (
    <Animated.View
      style={styles.container}
      onTouchStart={handleScreenTouchStart}
    >
      <BlurTargetView ref={appearanceBlurTargetRef} style={styles.backgroundLayer}>
        <View style={[styles.backgroundBase, { backgroundColor: chatBackgroundColor }]} />
        {chatBackgroundImageUri && (
          <Image source={{ uri: chatBackgroundImageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
      </BlurTargetView>
      <View style={[styles.header, withoutAppearanceGlassProps(topBarCssStyle)]} onLayout={handleTopBarLayout}>
        <AppearanceBlurView
          config={topBarGlass}
          blurTarget={appearanceBlurTargetRef}
          style={StyleSheet.absoluteFill}
        />
        {topBarBackgroundImageUri && (
          <Image
            source={{ uri: topBarBackgroundImageUri }}
            style={[styles.headerBackgroundImage, topBarBackgroundCssStyle]}
            resizeMode="cover"
          />
        )}
        {!topBarFadeHidden && (
          <LinearGradient
            pointerEvents="none"
            colors={[
              topBarFadeColor,
              withAlpha(topBarFadeColor, 0.92),
              withAlpha(topBarFadeColor, 0),
            ]}
            locations={[0, 0.68, 1]}
            style={[styles.headerFade, topBarFadeViewCssStyle]}
          />
        )}
        <View style={[styles.headerLeftGroup, topBarResponsiveMetrics.groupStyle, topBarLeftCssStyle]}>
          <Pressable style={[styles.headerButton, topBarResponsiveMetrics.buttonStyle, topBarButtonStyle('history')]} onPress={() => router.push('/history')}>
            {!topBarIconsHidden && !topBarIconHidden.history && renderTopBarIcon('history')}
          </Pressable>
          <Pressable style={[styles.headerButton, topBarResponsiveMetrics.buttonStyle, topBarButtonStyle('reading')]} onPress={() => router.push('/reading')}>
            {!topBarIconsHidden && !topBarIconHidden.reading && renderTopBarIcon('reading')}
          </Pressable>
          <Pressable style={[styles.headerButton, topBarResponsiveMetrics.buttonStyle, topBarButtonStyle('web')]} onPress={showWebViewPanel}>
            {!topBarIconsHidden && !topBarIconHidden.web && renderTopBarIcon('web')}
          </Pressable>
          <Pressable style={[styles.headerButton, topBarResponsiveMetrics.buttonStyle, topBarButtonStyle('accounting')]} onPress={() => router.push('/accounting')}>
            {!topBarIconsHidden && !topBarIconHidden.accounting && renderTopBarIcon('accounting')}
          </Pressable>
        </View>
        <View style={[styles.headerRightGroup, topBarResponsiveMetrics.groupStyle, topBarRightCssStyle]}>
          <Pressable style={[styles.headerButton, topBarResponsiveMetrics.buttonStyle, topBarButtonStyle('focus')]} onPress={() => router.push('/focus')}>
            {!topBarIconsHidden && !topBarIconHidden.focus && renderTopBarIcon('focus')}
          </Pressable>
          <Pressable style={[styles.headerButton, topBarResponsiveMetrics.buttonStyle, topBarButtonStyle('calendar')]} onPress={() => router.push('/calendar')}>
            {!topBarIconsHidden && !topBarIconHidden.calendar && renderTopBarIcon('calendar')}
          </Pressable>
          <Pressable style={[styles.headerButton, topBarResponsiveMetrics.buttonStyle, topBarButtonStyle('music')]} onPress={() => router.push('/music')}>
            {!topBarIconsHidden && !topBarIconHidden.music && renderTopBarIcon('music')}
          </Pressable>
          <Pressable style={[styles.headerButton, topBarResponsiveMetrics.buttonStyle, topBarButtonStyle('settings')]} onPress={() => router.push('/settings')}>
            {!topBarIconsHidden && !topBarIconHidden.settings && renderTopBarIcon('settings')}
          </Pressable>
        </View>
        <View pointerEvents="box-none" style={[styles.headerCenterSlot, topBarCenterCssStyle]}>
          <Pressable style={[styles.headerCenterButton, topBarCenterButtonCssStyle]} onPress={openClawdStatus}>
            {!topBarIconsHidden && !topBarIconHidden.clawd && (
              <Image
                source={topBarIconUris.clawd ? { uri: topBarIconUris.clawd } : require('../assets/clawd.png')}
                style={[styles.clawdHeaderIcon, topBarResponsiveMetrics.clawdIconStyle, clawdIconCssStyle]}
                resizeMode="contain"
              />
            )}
          </Pressable>
        </View>
      </View>

      {clawdStatusVisible && (
        <Pressable style={styles.clawdStatusOverlay} onPress={closeClawdStatus}>
          <View style={styles.clawdStatusPanel} onStartShouldSetResponder={() => true}>
            <View style={styles.clawdStatusHeader}>
              <View style={styles.clawdStatusTitleBlock}>
                <Text style={styles.clawdStatusEyebrow}>缓存保活</Text>
                <Text style={styles.clawdStatusTitle} numberOfLines={1}>
                  {formatRemoteSnapshotState(remoteSnapshotStatus)}
                </Text>
              </View>
              <Text style={styles.clawdStatusBadge} numberOfLines={1}>
                {formatRemoteSnapshotSourceMeta(remoteSnapshotStatus)}
              </Text>
            </View>

            <Text style={styles.clawdStatusLine} numberOfLines={1}>
              {formatRemoteSnapshotTime(remoteSnapshotStatus)}
            </Text>
            {!!remoteSnapshotMeta && (
              <Text style={styles.clawdStatusLine} numberOfLines={1}>
                {remoteSnapshotMeta}
              </Text>
            )}
            <Text style={styles.clawdStatusPreview} numberOfLines={2}>
              {remoteSnapshotLastMessage}
            </Text>
            {!!remoteServerStatusText && (
              <Text style={styles.clawdStatusServer} numberOfLines={1}>
                {remoteServerStatusText}
              </Text>
            )}
            {!!remoteServerDetail && (
              <Text style={styles.clawdStatusLine} numberOfLines={1}>
                {remoteServerDetail}
              </Text>
            )}

            <View style={styles.clawdStatusActions}>
              <Pressable
                style={[styles.clawdStatusActionButton, refreshingRemoteServerStatus && styles.clawdStatusActionDisabled]}
                onPress={handleRefreshRemoteServerStatus}
                disabled={refreshingRemoteServerStatus}
              >
                {refreshingRemoteServerStatus ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.clawdStatusActionText}>刷新服务器状态</Text>
                )}
              </Pressable>
              <Pressable
                style={[
                  styles.clawdStatusActionButton,
                  styles.clawdStatusActionPrimary,
                  (flushingRemoteSnapshot || remoteSnapshotStatus.queueCount <= 0) && styles.clawdStatusActionDisabled,
                ]}
                onPress={handleFlushRemoteSnapshotNow}
                disabled={flushingRemoteSnapshot || remoteSnapshotStatus.queueCount <= 0}
              >
                {flushingRemoteSnapshot ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.clawdStatusActionPrimaryText}>立即同步</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Animated.View style={[styles.messageLift, animatedMessageStyle]}>
        {topBarFadeHidden ? (
          <MaskedView
            style={styles.messageMask}
            maskElement={
              <View style={styles.messageMaskElement}>
                <LinearGradient
                  colors={['rgba(0,0,0,0)', 'rgba(0,0,0,1)']}
                  locations={[0, 1]}
                  style={[styles.messageMaskFade, messageTopFadeStyle]}
                />
                <View style={styles.messageMaskSolid} />
              </View>
            }
          >
            {messageListNode}
          </MaskedView>
        ) : (
          messageListNode
        )}
      </Animated.View>

      <Animated.View
        style={[styles.inputFloating, animatedInputStyle]}
        pointerEvents="box-none"
        onLayout={handleInputLayout}
      >
        {false && isAndroidVoiceCallAvailable() && (
          <View style={styles.voiceCallBar}>
            <View style={styles.voiceCallTextBlock}>
              <Text style={styles.voiceCallTitle} numberOfLines={1}>
                {voiceCallSnapshot.active ? '语音通话中' : '语音通话'}
              </Text>
              <Text
                style={[
                  styles.voiceCallStatus,
                  voiceCallSnapshot.error && styles.voiceCallStatusError,
                ]}
                numberOfLines={1}
              >
                {formatVoiceCallStatus(voiceCallSnapshot)}
              </Text>
            </View>
            <Pressable
              style={[
                styles.voiceCallButton,
                voiceCallSnapshot.active && styles.voiceCallButtonActive,
              ]}
              onPress={() => void openVoiceCall()}
            >
              <Text
                style={[
                  styles.voiceCallButtonText,
                  voiceCallSnapshot.active && styles.voiceCallButtonTextActive,
                ]}
              >
                {voiceCallSnapshot.active ? '挂断' : '开始'}
              </Text>
            </Pressable>
          </View>
        )}
        {visibleAskUserRequest && (
          <AskUserCard
            request={visibleAskUserRequest}
            disabled={isStreaming}
            onDismiss={() => setDismissedAskUserMessageId(visibleAskUserRequest.messageId)}
            onSubmit={async (content) => {
              await addUserMessage(content);
              if (useChatStore.getState().error) return;
              await triggerResponse();
            }}
          />
        )}
        <ChatInput
          blurTarget={appearanceBlurTargetRef}
          onSend={async (text, imageUri, imageGenerationReferenceUris) => {
            await addUserMessage(text, imageUri, imageGenerationReferenceUris);
          }}
          onSendVoice={async (recording) => {
            await addVoiceMessage(recording);
          }}
          onSendLocation={addLocationMessage}
          onTriggerResponse={triggerResponse}
          onEnableWebCruise={handleEnableWebCruise}
          onAttachFile={attachConversationFile}
          onStartVoiceCall={openVoiceCall}
          voiceCallAvailable={isAndroidVoiceCallAvailable()}
          voiceCallActive={voiceCallSnapshot.active}
          disabled={isStreaming}
          isStreaming={isStreaming}
          onStop={stopStreaming}
          onModelPress={() => setShowModelSelector(true)}
        />
      </Animated.View>

      <Modal visible={callTypeSheetVisible} transparent animationType="slide" onRequestClose={() => setCallTypeSheetVisible(false)}>
        <Pressable style={styles.callSheetBackdrop} onPress={() => setCallTypeSheetVisible(false)}>
          <View style={styles.callSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.callSheetHandle} />
            <Text style={styles.callSheetTitle}>选择通话方式</Text>
            {([
              ['voice', '语音通话', '仅使用麦克风'],
              ['video', '视频通话', '前置摄像头与语音'],
              ['screen', '共享屏幕', '共享屏幕画面与语音'],
            ] as const).map(([mode, title, subtitle]) => (
              <Pressable key={mode} style={styles.callSheetOption} onPress={() => void startSelectedCall(mode)}>
                <View style={styles.callSheetOptionIcon}><Text style={styles.callSheetOptionEmoji}>{mode === 'voice' ? '☎' : mode === 'video' ? '▣' : '▱'}</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.callSheetOptionTitle}>{title}</Text><Text style={styles.callSheetOptionSubtitle}>{subtitle}</Text></View>
              </Pressable>
            ))}
            <Pressable style={styles.callSheetCancel} onPress={() => setCallTypeSheetVisible(false)}><Text style={styles.callSheetCancelText}>取消</Text></Pressable>
          </View>
        </Pressable>
      </Modal>

      {showModelSelector && (
        <ModelSelector onClose={() => setShowModelSelector(false)} />
      )}

      <IOSToast message={toastMessage} bottom={Math.max(insets.bottom + 18, inputBarHeight + insets.bottom + 14)} />

      <Modal visible={!!incomingLetter} transparent animationType="fade" onRequestClose={closeIncomingLetter}>
        <View style={styles.letterOverlay}>
          <Pressable style={styles.letterBackdrop} onPress={closeIncomingLetter} />
          <View style={styles.letterPanel}>
            {incomingLetter && (
              <>
                <Text style={styles.letterEyebrow}>{incomingLetter.dateKey}</Text>
                <Text style={styles.letterTitle}>{incomingLetter.title || incomingLetter.occasionTitle || '有一封信给你'}</Text>
                <ScrollView style={styles.letterScroll} contentContainerStyle={styles.letterBody}>
                  <Text selectable style={styles.letterContent}>
                    {incomingLetter.content}
                  </Text>
                </ScrollView>
                <View style={styles.letterActions}>
                  <Pressable style={styles.letterCloseButton} onPress={closeIncomingLetter}>
                    <Text style={styles.letterCloseText}>收下</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={calendarVisible} transparent animationType="fade" onRequestClose={() => setCalendarVisible(false)}>
        <Pressable style={styles.calendarOverlay} onPress={() => setCalendarVisible(false)}>
          <View style={styles.calendarPanel} onStartShouldSetResponder={() => true}>
            <View style={styles.calendarHeader}>
              <Pressable
                style={styles.calendarNavButton}
                onPress={() => setCalendarMonth((current) => addMonths(current, -1))}
              >
                <Text style={styles.calendarNavText}>‹</Text>
              </Pressable>
              <Pressable style={styles.calendarTitleButton} onPress={openMonthJump}>
                <Text style={styles.calendarTitle}>{formatCalendarMonth(calendarMonth)}</Text>
              </Pressable>
              <Pressable
                style={styles.calendarNavButton}
                onPress={() => setCalendarMonth((current) => addMonths(current, 1))}
              >
                <Text style={styles.calendarNavText}>›</Text>
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAY_LABELS.map((label) => (
                <Text key={label} style={styles.weekdayText}>{label}</Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {buildCalendarCells(calendarMonth).map((cell, index) => {
                if (!cell) {
                  return <View key={`empty-${index}`} style={styles.calendarCell} />;
                }
                const key = dateKey(cell);
                const hasMessages = chatDateKeys.has(key);
                const hasDailyPaper = dailyPaperDateKeys.has(key);
                const isActualPeriod = periodDateKeys.has(key);
                const isPredictedPeriod = !isActualPeriod && predictedPeriodDateKeys.has(key);
                return (
                  <Pressable
                    key={key}
                    style={styles.calendarCell}
                    onPress={() => {
                      if (hasMessages) {
                        jumpToDate(key);
                      }
                    }}
                    onLongPress={() => {
                      handleDateLongPress(key);
                    }}
                    delayLongPress={360}
                  >
                    <View style={styles.calendarDayWrap}>
                      <Text
                        style={[
                          styles.calendarDayText,
                          !hasMessages && styles.calendarDayTextDisabled,
                          isPredictedPeriod && styles.calendarDayTextPredicted,
                          isActualPeriod && styles.calendarDayTextPeriod,
                        ]}
                      >
                        {cell.getDate()}
                      </Text>
                      {hasDailyPaper && <View style={styles.dailyPaperDot} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.calendarHint}>短按跳转聊天，长按开始记录；再次长按开始后的日期结束</Text>

            {calendarLoading && (
              <View style={styles.calendarLoadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.calendarLoadingText}>正在读取日期...</Text>
              </View>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={monthJumpVisible} transparent animationType="fade" onRequestClose={() => setMonthJumpVisible(false)}>
        <Pressable style={styles.monthJumpOverlay} onPress={() => setMonthJumpVisible(false)}>
          <View style={styles.monthJumpPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.monthJumpTitle}>跳转月份</Text>
            <TextInput
              style={styles.monthJumpInput}
              value={monthJumpText}
              onChangeText={setMonthJumpText}
              autoFocus
              keyboardType="numbers-and-punctuation"
              placeholder="例如 2026-06"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={confirmMonthJump}
            />
            <View style={styles.monthJumpActions}>
              <Pressable style={styles.monthJumpCancel} onPress={() => setMonthJumpVisible(false)}>
                <Text style={styles.monthJumpCancelText}>取消</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.monthJumpConfirm,
                  !parseCalendarMonthInput(monthJumpText) && styles.monthJumpConfirmDisabled,
                ]}
                onPress={confirmMonthJump}
                disabled={!parseCalendarMonthInput(monthJumpText)}
              >
                <Text style={styles.monthJumpConfirmText}>跳转</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!dateActionKey} transparent animationType="fade" onRequestClose={() => setDateActionKey(null)}>
        <Pressable style={styles.dateActionOverlay} onPress={() => setDateActionKey(null)}>
          <View style={styles.dateActionPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.dateActionTitle}>{dateActionKey}</Text>
            <Pressable
              style={styles.dateActionItem}
              onPress={() => {
                if (dateActionKey) {
                  handleRecordPeriodDate(dateActionKey).catch(() => undefined);
                }
              }}
            >
              <Text style={styles.dateActionText}>记录</Text>
              <Text style={styles.dateActionHint}>记录或结束生理期</Text>
            </Pressable>
            <View style={styles.dateActionDivider} />
            <Pressable
              style={styles.dateActionItem}
              onPress={() => {
                if (dateActionKey) openDailyPaper(dateActionKey);
              }}
            >
              <Text style={styles.dateActionText}>日报</Text>
              <Text style={styles.dateActionHint}>生成和查看这一天的新闻日报</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

function EmptyState() {
  const customGreetings = useSettingsStore((state) => state.appearanceConfig?.customGreetings);
  const welcomeLogoImageUri = useSettingsStore((state) => state.appearanceConfig?.welcomeLogoImageUri);
  const useDefaultGreetings = useSettingsStore((state) => state.appearanceConfig?.useDefaultGreetings);
  const defaultGreetingName = useSettingsStore((state) => state.appearanceConfig?.defaultGreetingName);
  const greeting = useMemo(
    () =>
      pickGreeting(customGreetings, {
        useDefaultGreetings,
        defaultGreetingName,
      }),
    [customGreetings, defaultGreetingName, useDefaultGreetings]
  );
  return (
    <View style={styles.emptyContainer}>
      <Image
        source={welcomeLogoImageUri ? { uri: welcomeLogoImageUri } : require('../assets/claudelogo.png')}
        style={styles.emptyLogo}
        resizeMode="contain"
      />
      <Text style={styles.emptyText}>{greeting}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backgroundLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  backgroundBase: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    height: 96,
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 8,
    overflow: 'hidden',
  },
  headerBackgroundImage: {
    ...StyleSheet.absoluteFill,
  },
  headerFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  headerLeftGroup: {
    position: 'absolute',
    top: 48,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 2,
  },
  headerRightGroup: {
    position: 'absolute',
    top: 48,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 2,
  },
  headerCenterSlot: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    height: 40,
    alignItems: 'center',
    zIndex: 2,
  },
  headerCenterButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  topBarIconSlot: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  clawdHeaderIcon: {
    width: 30,
    height: 30,
  },
  clawdStatusOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 30,
    paddingTop: 92,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  clawdStatusPanel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 12,
    padding: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  clawdStatusHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  clawdStatusTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  clawdStatusEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  clawdStatusTitle: {
    marginTop: 3,
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  clawdStatusBadge: {
    maxWidth: 132,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  clawdStatusLine: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  clawdStatusPreview: {
    marginTop: 9,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  clawdStatusServer: {
    marginTop: 9,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.primary,
  },
  clawdStatusActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  clawdStatusActionButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  clawdStatusActionPrimary: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  clawdStatusActionDisabled: {
    opacity: 0.55,
  },
  clawdStatusActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  clawdStatusActionPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  errorBanner: {
    backgroundColor: colors.dangerSurface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 96,
    marginHorizontal: 16,
    borderRadius: 8,
    zIndex: 6,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
  letterOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,19,0.38)',
    paddingHorizontal: 22,
  },
  letterBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  letterPanel: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '82%',
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  letterEyebrow: {
    paddingHorizontal: 20,
    paddingTop: 20,
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  letterTitle: {
    paddingHorizontal: 20,
    paddingTop: 6,
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  letterScroll: {
    flexShrink: 1,
  },
  letterBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  letterContent: {
    fontSize: 15,
    lineHeight: 25,
    color: colors.text,
  },
  letterActions: {
    padding: 16,
    alignItems: 'flex-end',
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  letterCloseButton: {
    minHeight: 38,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterCloseText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  messageLift: {
    flex: 1,
  },
  messageList: {
    flex: 1,
  },
  messageMask: {
    flex: 1,
  },
  messageMaskElement: {
    flex: 1,
  },
  messageMaskFade: {
    height: 104,
  },
  messageMaskSolid: {
    flex: 1,
    backgroundColor: '#000000',
  },
  messageListHidden: {
    opacity: 0,
  },
  messageContent: {
    paddingTop: MESSAGE_TOP_GAP,
    flexGrow: 1,
  },
  loadOlderContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
  },
  loadNewerContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 12,
  },
  loadOlderButton: {
    minHeight: 34,
    paddingHorizontal: 16,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadOlderButtonDisabled: {
    opacity: 0.7,
  },
  loadOlderText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.primary,
  },
  remoteInboxLoadingContainer: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 14,
  },
  remoteInboxLoadingPill: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  remoteInboxLoadingText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,20,19,0.26)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  calendarPanel: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  calendarNavButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarNavText: {
    fontSize: 26,
    lineHeight: 28,
    color: colors.text,
  },
  calendarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  calendarTitleButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekdayText: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarDayText: {
    minWidth: 30,
    height: 30,
    lineHeight: 30,
    textAlign: 'center',
    borderRadius: 15,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  calendarDayTextDisabled: {
    color: colors.textTertiary,
    fontWeight: '500',
  },
  calendarDayTextPredicted: {
    backgroundColor: 'rgba(220,38,38,0.14)',
    color: colors.danger,
    fontWeight: '700',
  },
  calendarDayTextPeriod: {
    backgroundColor: colors.danger,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  calendarDayWrap: {
    minWidth: 34,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dailyPaperDot: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  calendarHint: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textTertiary,
  },
  calendarLoadingRow: {
    minHeight: 28,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  calendarLoadingText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  monthJumpOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,20,19,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  monthJumpPanel: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  monthJumpTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  monthJumpInput: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  monthJumpActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  monthJumpCancel: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthJumpCancelText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  monthJumpConfirm: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthJumpConfirmDisabled: {
    opacity: 0.45,
  },
  monthJumpConfirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  dateActionOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,20,19,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  dateActionPanel: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.background,
    borderRadius: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateActionTitle: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  dateActionItem: {
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  dateActionText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  dateActionHint: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textTertiary,
  },
  dateActionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: 12,
  },
  voiceCallBar: {
    marginHorizontal: 12,
    marginBottom: 8,
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.inputBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  voiceCallTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  voiceCallTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  voiceCallStatus: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
  },
  voiceCallStatusError: {
    color: colors.danger,
  },
  voiceCallButton: {
    minWidth: 64,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.primaryLight,
  },
  voiceCallButtonActive: {
    backgroundColor: colors.dangerSurface,
  },
  voiceCallButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  voiceCallButtonTextActive: {
    color: colors.danger,
  },
  inputFloating: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  callSheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  callSheet: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
  },
  callSheetHandle: {
    width: 38,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  callSheetTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  callSheetOption: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  callSheetOptionIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  callSheetOptionEmoji: { color: colors.primary, fontSize: 22, fontWeight: '700' },
  callSheetOptionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  callSheetOptionSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  callSheetCancel: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, marginTop: 8 },
  callSheetCancelText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyLogo: {
    width: 48,
    height: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 22,
    color: colors.text,
    fontFamily: fonts.regular,
    fontWeight: 'normal',
  },
});

let styles = createStyles(colors);
