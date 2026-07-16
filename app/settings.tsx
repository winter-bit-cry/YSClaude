import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsPageColors, useSettingsPageColors } from '../src/theme/colors';
import { createSettingsStyles } from '../src/screens/settings/styles';
import { WelcomePageTab } from '../src/screens/settings/WelcomePageTab';
import { TTSConfigTab } from '../src/screens/settings/TTSConfigTab';
import { FloatingBallTab } from '../src/screens/settings/FloatingBallTab';
import { IncomingLetterTab } from '../src/screens/settings/IncomingLetterTab';
import { StickerTab } from '../src/screens/settings/StickerTab';
import { AppearanceTab } from '../src/screens/settings/AppearanceTab';
import { APIConfigTab } from '../src/screens/settings/APIConfigTab';
import { ChatSettingsTab } from '../src/screens/settings/ChatSettingsTab';
import { DiaryTab } from '../src/screens/settings/DiaryTab';
import { ToolConfigTab } from '../src/screens/settings/ToolConfigTab';
import { TodayWidgetTab } from '../src/screens/settings/TodayWidgetTab';
import { IOSToast } from '../src/components/IOSToast';

import { useKeyboardHeight } from '../src/hooks/useKeyboardHeight';


let colors = settingsPageColors;
const TABS = ['API 配置', '对话设置', '语音配置', '工具设置', '日记', '来信', '悬浮球', '表情包', '欢迎页', '美化'] as const;

const SETTINGS_TABS = [...TABS.slice(0, 7), '小组件', ...TABS.slice(7)] as const;

export default function SettingsScreen() {
  colors = useSettingsPageColors();
  styles = useMemo(() => createSettingsStyles(colors), [colors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [activeTab, setActiveTab] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  function showToast(message: string) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1800);
  }

  return (
    <View style={[styles.container, { paddingBottom: keyboardHeight }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title}>设置</Text>
        </View>
        <View style={styles.backButton} />
      </View>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {SETTINGS_TABS.map((tab, i) => (
          <Pressable
            key={tab}
            style={[styles.tab, i === activeTab && styles.tabActive]}
            onPress={() => setActiveTab(i)}
          >
            <Text style={[styles.tabText, i === activeTab && styles.tabTextActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {activeTab === 0 && <APIConfigTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 1 && <ChatSettingsTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 2 && <TTSConfigTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 3 && <ToolConfigTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 4 && <DiaryTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 5 && <IncomingLetterTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 6 && <FloatingBallTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 7 && <TodayWidgetTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 8 && <StickerTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 9 && <WelcomePageTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}
      {activeTab === 10 && <AppearanceTab showToast={showToast} keyboardBottomInset={keyboardHeight} />}

      <IOSToast message={toastMessage} bottom={keyboardHeight + 34} />
    </View>
  );
}

let styles = createSettingsStyles(colors);
