import React, { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  FlatList,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
  type ListRenderItem,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedKeyboard,
  KeyboardState,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';

import { fonts } from '../src/theme/fonts';
import { useChatStore } from '../src/stores/chat';
import { ChatBubble } from '../src/components/ChatBubble';
import { ChatInput } from '../src/components/ChatInput';
import { ModelSelector } from '../src/components/ModelSelector';
import { TimeDivider } from '../src/components/TimeDivider';
import { Message } from '../src/types';
import { TIME_GAP_THRESHOLD_MS } from '../src/utils/time';
import { pickGreeting } from '../src/utils/greetings';
import { showWebViewPanel } from '../src/services/webviewController';
import {
  getConversationMessageDates,
  getFirstMessageInDateRange,
} from '../src/db/operations';


let colors = lightColors;
const INPUT_BAR_FALLBACK_HEIGHT = 128;
const MESSAGE_BOTTOM_GAP = 16;
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

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

export default function ChatScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const isDarkTheme = colors.background === '#12100D';
  const headerImageTintStyle = isDarkTheme ? styles.invertedImageIcon : undefined;

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    conversationId,
    messages,
    hiddenRanges,
    hasOlderMessages,
    isLoadingOlderMessages,
    messageFloorOffset,
    pendingScrollMessageId,
    isStreaming,
    error,
    addUserMessage,
    loadOlderMessages,
    loadConversationAroundMessage,
    clearPendingScrollMessage,
    enableWebCruise,
    triggerResponse,
    stopStreaming,
  } = useChatStore();
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [monthJumpVisible, setMonthJumpVisible] = useState(false);
  const [monthJumpText, setMonthJumpText] = useState('');
  const [chatDateKeys, setChatDateKeys] = useState<Set<string>>(new Set());
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [dismissedDividers, setDismissedDividers] = useState<Set<string>>(new Set());
  const [visibleFloorMessageId, setVisibleFloorMessageId] = useState<string | null>(null);
  const [inputBarHeight, setInputBarHeight] = useState(INPUT_BAR_FALLBACK_HEIGHT);
  const [isInitialPositioning, setIsInitialPositioning] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFollowUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPositioningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const keyboardLiftRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const messageIdsRef = useRef<string[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const initialPositioningConversationRef = useRef<string | null>(null);
  const hasListLaidOutRef = useRef(false);
  const floorVisibleAtTouchStartRef = useRef(false);

  const keyboard = useAnimatedKeyboard();

  const openCalendar = useCallback(async () => {
    if (!conversationId) return;
    const lastMessage = messages[messages.length - 1];
    setCalendarMonth(startOfMonth(lastMessage ? new Date(lastMessage.createdAt) : new Date()));
    setCalendarVisible(true);
    setCalendarLoading(true);
    try {
      const dates = await getConversationMessageDates(conversationId);
      setChatDateKeys(new Set(dates));
    } finally {
      setCalendarLoading(false);
    }
  }, [conversationId, messages]);

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
          offset: Math.max(0, contentHeight - listHeight + keyboardLiftRef.current),
          animated,
        });
        return;
      }

      flatListRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const scheduleScrollToEnd = useCallback((delay = 24, followUp = false) => {
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

  const updateKeyboardLiftAndScroll = useCallback((lift: number) => {
    keyboardLiftRef.current = Math.ceil(Math.max(lift, 0));
    scheduleScrollToEnd(24, true);
  }, [scheduleScrollToEnd]);

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
    };
  }, []);

  useLayoutEffect(() => {
    if (!conversationId || messages.length === 0 || pendingScrollMessageId) {
      setIsInitialPositioning(false);
      initialPositioningConversationRef.current = conversationId;
      return;
    }

    if (conversationId !== initialPositioningConversationRef.current) {
      initialPositioningConversationRef.current = conversationId;
      shouldStickToBottomRef.current = true;
      setIsInitialPositioning(true);
    }
  }, [conversationId, messages.length, pendingScrollMessageId]);

  const finishInitialPositioning = useCallback(() => {
    if (initialPositioningTimerRef.current !== null) {
      clearTimeout(initialPositioningTimerRef.current);
    }
    scrollToEnd(false);
    initialPositioningTimerRef.current = setTimeout(() => {
      initialPositioningTimerRef.current = null;
      setIsInitialPositioning(false);
    }, 40);
  }, [scrollToEnd]);

  useEffect(() => {
    if (!isInitialPositioning) return;
    if (contentHeightRef.current > 0 && listHeightRef.current > 0) {
      finishInitialPositioning();
    }
  }, [finishInitialPositioning, isInitialPositioning]);

  const handleScreenTouchStart = useCallback(() => {
    floorVisibleAtTouchStartRef.current = visibleFloorMessageId !== null;
    if (visibleFloorMessageId !== null) {
      setVisibleFloorMessageId(null);
    }
  }, [visibleFloorMessageId]);

  const handleBubblePress = useCallback((messageId: string) => {
    if (floorVisibleAtTouchStartRef.current) return;
    setVisibleFloorMessageId(messageId);
  }, []);

  useAnimatedReaction(
    () => ({
      state: keyboard.state.value,
      lift: Math.max(keyboard.height.value - insets.bottom, 0),
    }),
    (current, previous) => {
      if (
        current.state === KeyboardState.OPEN &&
        previous?.state !== KeyboardState.OPEN
      ) {
        runOnJS(updateKeyboardLiftAndScroll)(current.lift);
      }

      if (
        current.state === KeyboardState.CLOSED &&
        previous?.state !== KeyboardState.CLOSED
      ) {
        runOnJS(updateKeyboardLiftAndScroll)(0);
      }
    },
  );

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

    if (!pendingScrollMessageId && appended) {
      shouldStickToBottomRef.current = true;
      scheduleScrollToEnd(32, true);
    }
  }, [conversationId, messages, pendingScrollMessageId, scheduleScrollToEnd]);

  useEffect(() => {
    if (!pendingScrollMessageId && messageIdsRef.current.length > 0 && shouldStickToBottomRef.current) {
      scheduleScrollToEnd(32, true);
    }
  }, [inputBarHeight, pendingScrollMessageId, scheduleScrollToEnd]);

  useEffect(() => {
    if (!pendingScrollMessageId) return;
    const index = messages.findIndex((message) => message.id === pendingScrollMessageId);
    if (index < 0) return;

    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });
      clearPendingScrollMessage();
    }, 80);

    return () => clearTimeout(timer);
  }, [clearPendingScrollMessage, messages, pendingScrollMessageId]);

  useFocusEffect(
    useCallback(() => {
      if (!pendingScrollMessageId && messageIdsRef.current.length > 0 && shouldStickToBottomRef.current) {
        scheduleScrollToEnd(32, true);
      }
    }, [conversationId, pendingScrollMessageId, scheduleScrollToEnd])
  );

  const handleInputLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      setInputBarHeight((current) =>
        Math.abs(current - nextHeight) > 1 ? nextHeight : current
      );
    }
  }, []);

  const handleListLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0 && Math.abs(listHeightRef.current - nextHeight) > 1) {
      listHeightRef.current = nextHeight;
      if (!isInitialPositioning && (!hasListLaidOutRef.current || shouldStickToBottomRef.current)) {
        scheduleScrollToEnd(24);
      }
      hasListLaidOutRef.current = true;
    }
  }, [isInitialPositioning, scheduleScrollToEnd]);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    const nextHeight = Math.ceil(height);
    const heightChanged = Math.abs(contentHeightRef.current - nextHeight) > 1;
    contentHeightRef.current = nextHeight;

    if (isInitialPositioning && nextHeight > 0 && listHeightRef.current > 0) {
      finishInitialPositioning();
      return;
    }

    if (heightChanged && shouldStickToBottomRef.current) {
      scheduleScrollToEnd(24);
    }
  }, [finishInitialPositioning, isInitialPositioning, scheduleScrollToEnd]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceToBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    shouldStickToBottomRef.current = distanceToBottom <= 80;
  }, []);

  const messageContentStyle = useMemo(
    () => [
      styles.messageContent,
      { paddingBottom: inputBarHeight + MESSAGE_BOTTOM_GAP },
    ],
    [inputBarHeight]
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

  const hiddenFloorSet = useMemo(() => {
    const set = new Set<number>();
    for (const r of hiddenRanges) {
      for (let i = r.from; i <= r.to; i++) set.add(i);
    }
    return set;
  }, [hiddenRanges]);

  const animatedContainerStyle = useAnimatedStyle(() => {
    const kbHeight = keyboard.height.value;
    const lift = kbHeight > 0 ? Math.max(kbHeight - insets.bottom, 0) : 0;
    return {
      paddingBottom: lift,
    };
  });

  const animatedInputStyle = useAnimatedStyle(() => {
    const kbHeight = keyboard.height.value;
    const lift = kbHeight > 0 ? Math.max(kbHeight - insets.bottom, 0) : 0;
    return {
      bottom: lift,
    };
  });

  const renderMessageItem = useCallback<ListRenderItem<Message>>(
    ({ item, index }) => {
      const prev = index > 0 ? messages[index - 1] : null;
      const showDivider =
        (!prev || item.createdAt - prev.createdAt >= TIME_GAP_THRESHOLD_MS) &&
        !dismissedDividers.has(item.id);
      const floor = floorMap.get(item.id);
      const isHidden = floor !== undefined && hiddenFloorSet.has(floor);

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
          <ChatBubble
            message={item}
            previousUserMessage={prev?.role === 'user' ? prev : null}
            isHidden={isHidden}
            floorNumber={floor}
            showFloorNumber={visibleFloorMessageId === item.id && floor !== undefined}
            onBubblePress={
              floor !== undefined ? () => handleBubblePress(item.id) : undefined
            }
            isLastAssistant={
              item.role === 'assistant' &&
              index === messages.length - 1
            }
          />
        </>
      );
    },
    [dismissedDividers, floorMap, handleBubblePress, hiddenFloorSet, messages, visibleFloorMessageId]
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

  return (
    <Animated.View
      style={[styles.container, animatedContainerStyle]}
      onTouchStart={handleScreenTouchStart}
    >
      <View style={styles.header}>
        <View style={styles.headerLeftGroup}>
          <Pressable style={styles.headerButton} onPress={() => router.push('/history')}>
            <View style={styles.hamburgerLines}>
              <View style={styles.hamburgerLine} />
              <View style={styles.hamburgerLine} />
              <View style={[styles.hamburgerLine, styles.hamburgerLineShort]} />
            </View>
          </Pressable>
          <Pressable style={styles.headerButton} onPress={() => router.push('/reading')}>
            <Image source={require('../assets/reading.png')} style={[styles.readingIcon, headerImageTintStyle]} resizeMode="contain" />
          </Pressable>
          <Pressable style={styles.headerButton} onPress={showWebViewPanel}>
            <Image source={require('../assets/web.png')} style={[styles.webIcon, headerImageTintStyle]} resizeMode="contain" />
          </Pressable>
        </View>
        <View style={styles.headerRightGroup}>
          <Pressable style={styles.headerButton} onPress={() => router.push('/focus')}>
            <Image source={require('../assets/todo.png')} style={[styles.todoIcon, headerImageTintStyle]} resizeMode="contain" />
          </Pressable>
          <Pressable style={styles.headerButton} onPress={openCalendar} disabled={!conversationId}>
            <Image source={require('../assets/calendar.png')} style={[styles.calendarIcon, headerImageTintStyle]} resizeMode="contain" />
          </Pressable>
          <Pressable style={styles.headerButton} onPress={() => router.push('/music')}>
            <Image source={require('../assets/music.png')} style={[styles.musicIcon, headerImageTintStyle]} resizeMode="contain" />
          </Pressable>
          <Pressable style={styles.headerButton} onPress={() => router.push('/settings')}>
            <Image source={require('../assets/setting.png')} style={[styles.settingIcon, headerImageTintStyle]} resizeMode="contain" />
          </Pressable>
        </View>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        renderItem={renderMessageItem}
        style={[styles.messageList, isInitialPositioning && styles.messageListHidden]}
        contentContainerStyle={messageContentStyle}
        onLayout={handleListLayout}
        onContentSizeChange={handleContentSizeChange}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({
              index,
              animated: true,
              viewPosition: 0.5,
            });
          }, 120);
        }}
        ListHeaderComponent={renderOlderMessagesHeader}
        ListEmptyComponent={<EmptyState />}
      />

      <Animated.View
        style={[styles.inputFloating, animatedInputStyle]}
        pointerEvents="box-none"
        onLayout={handleInputLayout}
      >
        <ChatInput
          onSend={async (text, imageUri) => {
            await addUserMessage(text, imageUri);
          }}
          onTriggerResponse={triggerResponse}
          onEnableWebCruise={enableWebCruise}
          disabled={isStreaming}
          isStreaming={isStreaming}
          onStop={stopStreaming}
          onModelPress={() => setShowModelSelector(true)}
        />
      </Animated.View>

      {showModelSelector && (
        <ModelSelector onClose={() => setShowModelSelector(false)} />
      )}

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
                return (
                  <Pressable
                    key={key}
                    style={styles.calendarCell}
                    onPress={() => jumpToDate(key)}
                    disabled={!hasMessages}
                  >
                    <Text style={[styles.calendarDayText, !hasMessages && styles.calendarDayTextDisabled]}>
                      {cell.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

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
    </Animated.View>
  );
}

function EmptyState() {
  const greeting = useMemo(() => pickGreeting(), []);
  return (
    <View style={styles.emptyContainer}>
      <Image source={require('../assets/claudelogo.png')} style={styles.emptyLogo} resizeMode="contain" />
      <Text style={styles.emptyText}>{greeting}</Text>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hamburgerLines: {
    width: 20,
    height: 16,
    justifyContent: 'space-between',
  },
  hamburgerLine: {
    width: 18,
    height: 2,
    backgroundColor: colors.text,
    borderRadius: 1,
  },
  hamburgerLineShort: {
    width: 9,
  },
  settingIcon: {
    width: 22,
    height: 22,
  },
  calendarIcon: {
    width: 23,
    height: 23,
  },
  todoIcon: {
    width: 23,
    height: 23,
  },
  musicIcon: {
    width: 23,
    height: 23,
  },
  readingIcon: {
    width: 24,
    height: 24,
  },
  webIcon: {
    width: 24,
    height: 24,
  },
  invertedImageIcon: {
    tintColor: colors.text,
  },
  errorBanner: {
    backgroundColor: colors.dangerSurface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    borderRadius: 8,
  },
  errorText: {
    fontSize: 13,
    color: colors.danger,
  },
  messageList: {
    flex: 1,
  },
  messageListHidden: {
    opacity: 0,
  },
  messageContent: {
    paddingTop: 8,
    flexGrow: 1,
  },
  loadOlderContainer: {
    alignItems: 'center',
    paddingTop: 8,
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
  inputFloating: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
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
    fontFamily: fonts.serifBold,
  },
});

let styles = createStyles(colors);
