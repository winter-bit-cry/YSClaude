import { useMemo } from 'react';
import { Text, StyleSheet, Pressable, Alert } from 'react-native';
import { lightColors, useThemeColors, type ThemeColors } from '../theme/colors';

import { formatSmartTime } from '../utils/time';


let colors = lightColors;
interface Props {
  timestamp: number;
  onDelete?: () => void;
}

export function TimeDivider({ timestamp, onDelete }: Props) {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const handleLongPress = () => {
    if (!onDelete) return;
    Alert.alert('删除', '确定删除该时间标记？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: onDelete },
    ]);
  };

  return (
    <Pressable onLongPress={handleLongPress} style={styles.row}>
      <Text style={styles.text}>{formatSmartTime(timestamp)}</Text>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  text: {
    fontSize: 12,
    color: colors.textTertiary,
  },
});

let styles = createStyles(colors);
