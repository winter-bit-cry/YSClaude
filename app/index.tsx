import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  FlatList,
  Text,
  Pressable,
  StyleSheet,
  Image,
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
import { colors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import { useChatStore } from '../src/stores/chat';
import { ChatBubble } from '../src/components/ChatBubble';
import { ChatInput } from '../src/components/ChatInput';
import { ModelSelector } from '../src/components/ModelSelector';
import { TimeDivider } from '../src/components/TimeDivider';
import { Message } from '../src/types';
import { TIME_GAP_THRESHOLD_MS } from '../src/utils/time';
import { pickGreeting } from '../src/utils/greetings';
import { getPendingWebCruiseNotice } from '../src/utils/webCruise';

const INPUT_BAR_FALLBACK_HEIGHT = 128;
const MESSAGE_BOTTOM_GAP = 16;

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    conversationId,
    messages,
    hiddenRanges,
    isStreaming,
    error,
    addUserMessage,
    enableWebCruise,
    triggerResponse,
    stopStreaming,
  } = useChatStore();
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [dismissedDividers, setDismissedDividers] = useState<Set<string>>(new Set());
  const [inputBarHeight, setInputBarHeight] = useState(INPUT_BAR_FALLBACK_HEIGHT);
  const flatListRef = useRef<FlatList<Message>>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFollowUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const keyboardLiftRef = useRef(0);

  const keyboard = useAnimatedKeyboard();

  const scrollToEnd = useCallback((animated = false) => {
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
    };
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
    if (messages.length > 0) {
      scheduleScrollToEnd(32, true);
    }
  }, [conversationId, inputBarHeight, messages.length, scheduleScrollToEnd]);

  useFocusEffect(
    useCallback(() => {
      if (messages.length > 0) {
        scheduleScrollToEnd(32, true);
      }
    }, [messages.length, scheduleScrollToEnd])
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
      scheduleScrollToEnd(24);
    }
  }, [scheduleScrollToEnd]);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeightRef.current = Math.ceil(height);
    scheduleScrollToEnd(24);
  }, [scheduleScrollToEnd]);

  const messageContentStyle = useMemo(
    () => [
      styles.messageContent,
      { paddingBottom: inputBarHeight + MESSAGE_BOTTOM_GAP },
    ],
    [inputBarHeight]
  );

  const floorMap = useMemo(() => {
    const map = new Map<string, number>();
    let floor = 0;
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        floor++;
        map.set(msg.id, floor);
      }
    }
    return map;
  }, [messages]);

  const hiddenFloorSet = useMemo(() => {
    const set = new Set<number>();
    for (const r of hiddenRanges) {
      for (let i = r.from; i <= r.to; i++) set.add(i);
    }
    return set;
  }, [hiddenRanges]);

  const webCruisePending = useMemo(
    () => !!getPendingWebCruiseNotice(messages),
    [messages]
  );

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
            isLastAssistant={
              item.role === 'assistant' &&
              index === messages.length - 1
            }
          />
        </>
      );
    },
    [dismissedDividers, floorMap, hiddenFloorSet, messages]
  );

  return (
    <Animated.View style={[styles.container, animatedContainerStyle]}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.push('/history')}>
          <View style={styles.hamburgerLines}>
            <View style={styles.hamburgerLine} />
            <View style={styles.hamburgerLine} />
            <View style={[styles.hamburgerLine, styles.hamburgerLineShort]} />
          </View>
        </Pressable>
        <Pressable style={styles.headerButton} onPress={() => router.push('/settings')}>
          <Image source={require('../assets/setting.png')} style={styles.settingIcon} resizeMode="contain" />
        </Pressable>
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
        style={styles.messageList}
        contentContainerStyle={messageContentStyle}
        onLayout={handleListLayout}
        onContentSizeChange={handleContentSizeChange}
        ListEmptyComponent={<EmptyState />}
      />

      <Animated.View
        style={[styles.inputFloating, animatedInputStyle]}
        pointerEvents="box-none"
        onLayout={handleInputLayout}
      >
        <ChatInput
          onSend={addUserMessage}
          onTriggerResponse={triggerResponse}
          onEnableWebCruise={enableWebCruise}
          disabled={isStreaming}
          isStreaming={isStreaming}
          webCruisePending={webCruisePending}
          onStop={stopStreaming}
          onModelPress={() => setShowModelSelector(true)}
        />
      </Animated.View>

      {showModelSelector && (
        <ModelSelector onClose={() => setShowModelSelector(false)} />
      )}
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

const styles = StyleSheet.create({
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
  errorBanner: {
    backgroundColor: '#FEF2F2',
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
  messageContent: {
    paddingTop: 8,
    flexGrow: 1,
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
