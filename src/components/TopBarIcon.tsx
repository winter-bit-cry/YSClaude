import React from 'react';
import { Image, StyleSheet } from 'react-native';
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

const TOP_BAR_ICON_COMPONENTS: Record<TopBarIconKey, IconComponent> = {
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
  size?: number;
  strokeWidth?: number;
}

export function TopBarIcon({
  iconKey,
  color,
  customUri,
  size = 22,
  strokeWidth = 1.9,
}: TopBarIconProps) {
  if (customUri) {
    return (
      <Image
        source={{ uri: customUri }}
        style={[styles.customIcon, { width: size, height: size }]}
        resizeMode="contain"
      />
    );
  }

  const Icon = TOP_BAR_ICON_COMPONENTS[iconKey];
  return <Icon color={color} size={size} strokeWidth={strokeWidth} />;
}

const styles = StyleSheet.create({
  customIcon: {
    overflow: 'hidden',
  },
});
