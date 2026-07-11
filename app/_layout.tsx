import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
  hideFloatingBall,
  showFloatingBall,
} from '../src/services/floatingBall';
import { handleFloatingBallToolAction } from '../src/services/floatingToolActions';
import { startDesktopLyricSync, stopDesktopLyricSync } from '../src/services/desktopLyrics';
import { startFocusAppStateListener } from '../src/services/focusAppState';
import { startPromptCacheRemoteSnapshotFlushListener } from '../src/services/promptCacheKeepalive';
import { useChatStore } from '../src/stores/chat';
import { cleanupExpiredVoiceFiles } from '../src/services/voiceFiles';


SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colors = useThemeColors();
  const statusBarStyle = colors.background === '#12100D' ? 'light' : 'dark';

  const settingsHydrated = useSettingsStore((state) => state._hydrated);
  const floatingBallEnabled = useSettingsStore((state) => state.floatingBallConfig.enabled);
  const floatingBallNormalImageUrisKey = useSettingsStore((state) =>
    (state.floatingBallConfig.normalImageUris || []).join('|') || state.floatingBallConfig.normalImageUri || ''
  );
  const floatingBallEdgeImageUrisKey = useSettingsStore((state) =>
    (state.floatingBallConfig.edgeImageUris || []).join('|') || state.floatingBallConfig.edgeImageUri || ''
  );
  const floatingBallAssetAutoSwitchEnabled = useSettingsStore((state) => !!state.floatingBallConfig.assetAutoSwitchEnabled);
  const floatingBallAssetAutoSwitchIntervalSeconds = useSettingsStore((state) => state.floatingBallConfig.assetAutoSwitchIntervalSeconds || 8);

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

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
    };
    syncRemoteInbox();
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        syncRemoteInbox();
      }
    });
    return () => sub.remove();
  }, [settingsHydrated]);

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
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
          name="focus"
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
          name="game/index"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="game/[id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{ animation: 'slide_from_right' }}
        />
      </Stack>
      <WebViewPanel />
      <IncomingShareHandler />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
});
