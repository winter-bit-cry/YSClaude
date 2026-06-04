import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';

import {
  initNotifications,
  startAppStateListener,
  ensurePermission,
} from '../src/services/notifications';
import { WebViewPanel } from '../src/components/WebViewPanel';
import { useSettingsStore } from '../src/stores/settings';
import {
  addFloatingBallToolActionListener,
  hideFloatingBall,
  showFloatingBall,
} from '../src/services/floatingBall';
import { handleFloatingBallToolAction } from '../src/services/floatingToolActions';
import { startDesktopLyricSync, stopDesktopLyricSync } from '../src/services/desktopLyrics';
import { startFocusAppStateListener } from '../src/services/focusAppState';


let colors = lightColors;
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const statusBarStyle = colors.background === '#12100D' ? 'light' : 'dark';

  const [fontsLoaded] = useFonts({
    'Sohne': require('../assets/Sohne-Buch.otf'),
    'Sohne-Bold': require('../assets/Sohne-Halbfett.otf'),
    'SohneMono': require('../assets/SohneMono-Buch.otf'),
    'TiemposText': require('../assets/TiemposText.otf'),
    'TiemposText-Bold': require('../assets/TiemposText-bold.otf'),
  });
  const settingsHydrated = useSettingsStore((state) => state._hydrated);
  const floatingBallEnabled = useSettingsStore((state) => state.floatingBallConfig.enabled);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    if (!settingsHydrated) return;

    if (floatingBallEnabled) {
      showFloatingBall().catch(() => undefined);
    } else {
      hideFloatingBall().catch(() => undefined);
    }
  }, [settingsHydrated, floatingBallEnabled]);

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

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={statusBarStyle} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="history"
          options={{ animation: 'slide_from_left', presentation: 'modal' }}
        />
        <Stack.Screen
          name="settings"
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
          name="reading/index"
          options={{ animation: 'slide_from_right', presentation: 'modal' }}
        />
        <Stack.Screen
          name="reading/[id]"
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{ animation: 'slide_from_right' }}
        />
      </Stack>
      <WebViewPanel />
    </>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});

let styles = createStyles(colors);
