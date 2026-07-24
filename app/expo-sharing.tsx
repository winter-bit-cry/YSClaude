import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '../src/theme/colors';

export default function ExpoSharingRoute() {
  const colors = useThemeColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.text} />
      <Text style={[styles.text, { color: colors.text }]}>正在导入分享内容…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    fontSize: 15,
  },
});
