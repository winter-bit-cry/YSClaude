import React from 'react';
import { Image, StyleSheet, useColorScheme } from 'react-native';
import {
  BookOpen,
  CalendarDays,
  Globe,
  History,
  ListTodo,
  Music2,
  WalletCards,
  Settings,
} from 'lucide-react-native';
import { TOP_BAR_ICON_LABELS, TOP_BAR_ICON_KEYS, type TopBarIconKey } from '../utils/topBarIconTypes';

type IconComponent = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

const TOP_BAR_ICON_COMPONENTS: Partial<Record<TopBarIconKey, IconComponent>> = {
  history: History,
  reading: BookOpen,
  web: Globe,
  accounting: WalletCards,
  focus: ListTodo,
  calendar: CalendarDays,
  music: Music2,
  settings: Settings,
};

export const TOP_BAR_ICON_ITEMS = TOP_BAR_ICON_KEYS.map((key) => ({
  key,
  label: TOP_BAR_ICON_LABELS[key],
  Icon: TOP_BAR_ICON_COMPONENTS[key],
}));

interface TopBarIconProps {
  iconKey: TopBarIconKey;
  color: string;
  customUri?: string;
  darkCustomUri?: string;
  size?: number;
  strokeWidth?: number;
}

export function TopBarIcon({
  iconKey,
  color,
  customUri,
  darkCustomUri,
  size = 22,
  strokeWidth = 1.9,
}: TopBarIconProps) {
  const isDark = useColorScheme() === 'dark';
  const themedUri = isDark ? (darkCustomUri || customUri) : (customUri || darkCustomUri);
  const usesFallbackTheme = isDark ? !darkCustomUri && !!customUri : !customUri && !!darkCustomUri;
  if (themedUri) {
    return (
      <Image
        source={{ uri: themedUri }}
        style={[styles.customIcon, { width: size, height: size }, usesFallbackTheme && { tintColor: color }]}
        resizeMode="contain"
      />
    );
  }

  if (iconKey === 'clawd') {
    return (
      <Image
        source={require('../../assets/clawd.png')}
        style={[styles.customIcon, { width: size, height: size }]}
        resizeMode="contain"
      />
    );
  }

  const Icon = TOP_BAR_ICON_COMPONENTS[iconKey];
  if (!Icon) return null;
  return <Icon color={color} size={size} strokeWidth={strokeWidth} />;
}

const styles = StyleSheet.create({
  customIcon: {
    overflow: 'hidden',
  },
});
