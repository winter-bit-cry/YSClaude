import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Alert, AppState, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Phone, PhoneOff } from 'lucide-react-native';
import { useThemeColors } from '../src/theme/colors';

import {
  initNotifications,
  startAppStateListener,
  ensurePermission,
} from '../src/services/notifications';
import { WebViewPanel } from '../src/components/WebViewPanel';
import { useSettingsStore } from '../src/stores/settings';
import { IncomingShareHandler } from '../src/components/IncomingShareHandler';
import {
  addFloatingBallToolActionListener,
  addVoiceCallFloatingActionListener,
  hideFloatingBall,
  showVoiceCallFloatingBall,
  showScreenCallFloatingBall,
  showFloatingBall,
} from '../src/services/floatingBall';
import { handleFloatingBallToolAction } from '../src/services/floatingToolActions';
import { startDesktopLyricSync, stopDesktopLyricSync } from '../src/services/desktopLyrics';
import { startFocusAppStateListener } from '../src/services/focusAppState';
import { startPromptCacheRemoteSnapshotFlushListener } from '../src/services/promptCacheKeepalive';
import { useChatStore } from '../src/stores/chat';
import { cleanupExpiredVoiceFiles } from '../src/services/voiceFiles';
import { syncTodayWidget } from '../src/services/todayWidget';
import { useVoiceCallStore } from '../src/stores/voiceCall';
import { startIncomingCallRingtone, stopIncomingCallRingtone } from '../src/services/incomingCallRingtone';
import { applyGlobalFont } from '../src/theme/globalFont';


SplashScreen.preventAutoHideAsync();

function formatVoiceCallDuration(startedAt: number | null): string {
  if (!startedAt) return '00:00';
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutesText = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secondsText = (seconds % 60).toString().padStart(2, '0');
  return `${minutesText}:${secondsText}`;
}

export default function RootLayout() {
  const colors = useThemeColors();
  const statusBarStyle = colors.background === '#20201e' ? 'light' : 'dark';

  const settingsHydrated = useSettingsStore((state) => state._hydrated);
  const globalFontUri = useSettingsStore((state) => state.appearanceConfig?.globalFontUri);
  const globalBoldFontUri = useSettingsStore((state) => state.appearanceConfig?.globalBoldFontUri);
  const [fontReady, setFontReady] = useState(false);
  const [fontRenderKey, setFontRenderKey] = useState(0);
  const floatingBallEnabled = useSettingsStore((state) => state.floatingBallConfig.enabled);
  const floatingBallNormalImageUrisKey = useSettingsStore((state) =>
    (state.floatingBallConfig.normalImageUris || []).join('|') || state.floatingBallConfig.normalImageUri || ''
  );
  const floatingBallEdgeImageUrisKey = useSettingsStore((state) =>
    (state.floatingBallConfig.edgeImageUris || []).join('|') || state.floatingBallConfig.edgeImageUri || ''
  );
  const floatingBallAssetAutoSwitchEnabled = useSettingsStore((state) => !!state.floatingBallConfig.assetAutoSwitchEnabled);
  const floatingBallAssetAutoSwitchIntervalSeconds = useSettingsStore((state) => state.floatingBallConfig.assetAutoSwitchIntervalSeconds || 8);
  const todayWidgetConfigKey = useSettingsStore((state) => JSON.stringify(state.todayWidgetConfig));
  const widgetAppearanceKey = useSettingsStore((state) =>
    [
      state.appearanceConfig?.userDisplayName || '',
      state.appearanceConfig?.userAvatarImageUri || '',
    ].join('|')
  );
  const voiceCallSnapshot = useVoiceCallStore((state) => state.snapshot);
  const voiceCallMinimized = useVoiceCallStore((state) => state.minimized);
  const voiceCallMode = useVoiceCallStore((state) => state.mode);

  useEffect(() => {
    if (!settingsHydrated) return;
    let active = true;
    setFontReady(false);
    applyGlobalFont(globalFontUri, globalBoldFontUri)
      .catch(() => applyGlobalFont())
      .finally(() => {
        if (!active) return;
        setFontRenderKey((key) => key + 1);
        setFontReady(true);
        SplashScreen.hideAsync();
      });
    return () => {
      active = false;
    };
  }, [settingsHydrated, globalFontUri, globalBoldFontUri]);

  useEffect(() => {
    if (!settingsHydrated) return;

    if (floatingBallEnabled) {
      showFloatingBall().catch(() => undefined);
    } else {
      hideFloatingBall().catch(() => undefined);
    }
  }, [
    settingsHydrated,
    floatingBallEnabled,
    floatingBallNormalImageUrisKey,
    floatingBallEdgeImageUrisKey,
    floatingBallAssetAutoSwitchEnabled,
    floatingBallAssetAutoSwitchIntervalSeconds,
  ]);

  useEffect(() => {
    const sub = addFloatingBallToolActionListener((action) => {
      handleFloatingBallToolAction(action).catch(() => undefined);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = addVoiceCallFloatingActionListener(() => {
      router.push('/voice-call');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!voiceCallSnapshot.active || !voiceCallMinimized) return;
    const syncDuration = () => {
      const duration = formatVoiceCallDuration(voiceCallSnapshot.startedAt);
      const show = voiceCallMode === 'screen' ? showScreenCallFloatingBall : showVoiceCallFloatingBall;
      show(duration).catch(() => undefined);
    };
    syncDuration();
    const timer = setInterval(syncDuration, 1000);
    return () => clearInterval(timer);
  }, [voiceCallMinimized, voiceCallMode, voiceCallSnapshot.active, voiceCallSnapshot.startedAt]);

  useEffect(() => {
    startDesktopLyricSync();
    return () => stopDesktopLyricSync();
  }, []);

  useEffect(() => {
    // 设置通知 handler 和 Android 通知渠道
    initNotifications();
    // 开始追踪前后台状态
    const unsub = startAppStateListener();
    // 提前请求通知权限（Android 12 及以下自动授权，无对话框）
    ensurePermission();
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = startFocusAppStateListener();
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = startPromptCacheRemoteSnapshotFlushListener();
    return unsub;
  }, []);

  useEffect(() => {
    // 必须等 settings 完成持久化恢复：否则 getRemoteConfig() 拿不到远程服务地址，
    // 首次同步会静默空跑，表现为"打开 App 后要刷新很多次才能看到 AI 主动消息"。
    if (!settingsHydrated) return;

    const syncRemoteInbox = () => {
      useChatStore.getState().syncPromptCacheRemoteInbox().catch(() => undefined);
      cleanupExpiredVoiceFiles().catch(() => undefined);
      syncTodayWidget().catch(() => undefined);
    };
    syncRemoteInbox();
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        syncRemoteInbox();
      }
    });
    return () => sub.remove();
  }, [settingsHydrated, todayWidgetConfigKey, widgetAppearanceKey]);

  if (!settingsHydrated || !fontReady) return null;

  return (
    <GestureHandlerRootView key={fontRenderKey} style={styles.gestureRoot}>
      <StatusBar style={statusBarStyle} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="history"
          options={{
            animation: 'slide_from_left',
            presentation: 'transparentModal',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="chat-diagnostics"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="api-usage"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="api-achievements"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="music"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="music-playlists"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="voice-call"
          options={{ animation: 'fade', presentation: 'fullScreenModal' }}
        />
        <Stack.Screen
          name="focus"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="calendar"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="daily-paper/[date]"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="reading/index"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="reading/[id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="accounting"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{ animation: 'slide_from_right' }}
        />
      </Stack>
      <WebViewPanel />
      <IncomingShareHandler />
      <IncomingVoiceCallModal />
    </GestureHandlerRootView>
  );
}

function IncomingVoiceCallModal() {
  const incomingCall = useVoiceCallStore((state) => state.incomingCall);
  const acceptIncomingCall = useVoiceCallStore((state) => state.acceptIncomingCall);
  const rejectIncomingCall = useVoiceCallStore((state) => state.rejectIncomingCall);
  const appearanceConfig = useSettingsStore((state) => state.appearanceConfig);
  const assistantName = (appearanceConfig?.assistantDisplayName || 'Claude').trim() || 'Claude';
  const assistantAvatarUri = appearanceConfig?.assistantAvatarImageUri;
  const incomingCallType = incomingCall?.mode === 'video'
    ? '视频通话'
    : incomingCall?.mode === 'screen'
      ? '共享屏幕通话'
      : '语音通话';
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!incomingCall) {
      stopIncomingCallRingtone().catch(() => undefined);
      setBusy(false);
      return;
    }
    startIncomingCallRingtone().catch(() => undefined);
    return () => {
      stopIncomingCallRingtone().catch(() => undefined);
    };
  }, [incomingCall?.id]);

  const handleAccept = async () => {
    if (!incomingCall || busy) return;
    setBusy(true);
    await stopIncomingCallRingtone().catch(() => undefined);
    try {
      await acceptIncomingCall();
      router.push('/voice-call');
    } catch (error: any) {
      Alert.alert('通话启动失败', error?.message || '请检查 STT 和 TTS 配置');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!incomingCall || busy) return;
    setBusy(true);
    await stopIncomingCallRingtone().catch(() => undefined);
    await rejectIncomingCall().catch(() => undefined);
    setBusy(false);
  };

  return (
    <Modal
      visible={!!incomingCall}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleReject}
    >
      <View style={styles.incomingCallBackdrop}>
        <View style={styles.incomingCallPanel}>
          <Text style={styles.incomingCallStatus}>{incomingCallType}来电</Text>
          <View style={styles.incomingCallAvatar}>
            {assistantAvatarUri ? (
              <Image source={{ uri: assistantAvatarUri }} style={styles.incomingCallAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.incomingCallAvatarFallback}>AI</Text>
            )}
          </View>
          <Text style={styles.incomingCallName} numberOfLines={1}>{assistantName}</Text>
          <Text style={styles.incomingCallHint} numberOfLines={2}>
            {incomingCall?.reason || `想和你进行${incomingCallType}`}
          </Text>
          <View style={styles.incomingCallActions}>
            <Pressable
              style={[styles.incomingCallAction, styles.incomingCallReject, busy && styles.incomingCallDisabled]}
              onPress={handleReject}
              disabled={busy}
            >
              <PhoneOff size={30} color="#FFFFFF" strokeWidth={2.4} />
            </Pressable>
            <Pressable
              style={[styles.incomingCallAction, styles.incomingCallAccept, busy && styles.incomingCallDisabled]}
              onPress={handleAccept}
              disabled={busy}
            >
              <Phone size={30} color="#FFFFFF" strokeWidth={2.4} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  incomingCallBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  incomingCallPanel: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 14,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    backgroundColor: '#202020',
    boxShadow: '0 16px 36px rgba(0,0,0,0.35)',
  },
  incomingCallStatus: {
    color: '#a8a8a8',
    fontSize: 15,
  },
  incomingCallAvatar: {
    width: 92,
    height: 92,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3a3a3a',
  },
  incomingCallAvatarImage: {
    width: '100%',
    height: '100%',
  },
  incomingCallAvatarFallback: {
    color: '#d8d8d8',
    fontSize: 32,
    fontWeight: '800',
  },
  incomingCallName: {
    maxWidth: '100%',
    color: '#f4f4f4',
    fontSize: 22,
    fontWeight: '700',
  },
  incomingCallHint: {
    color: '#b8b8b8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  incomingCallActions: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 18,
  },
  incomingCallAction: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incomingCallReject: {
    backgroundColor: '#e74c3c',
  },
  incomingCallAccept: {
    backgroundColor: '#26a65b',
  },
  incomingCallDisabled: {
    opacity: 0.58,
  },
});
