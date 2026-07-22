import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

export function MusicModuleGesture({
  children,
  onExit,
}: {
  children: ReactNode;
  onExit: () => void;
}) {
  const swipeLeft = Gesture.Pan()
    .hitSlop({ right: 0, width: 28 })
    .activeOffsetX([-60, 100000])
    .failOffsetY([-45, 45])
    .onEnd((event) => {
      if (event.translationX < -100 && event.velocityX < -250) {
        runOnJS(onExit)();
      }
    });

  return (
    <GestureDetector gesture={swipeLeft}>
      <View style={styles.fill}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
