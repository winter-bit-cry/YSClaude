import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useThemeColors } from '../theme/colors';

type IOSToastProps = {
  message: string | null;
  bottom?: number;
};

export function IOSToast({ message, bottom = 34 }: IOSToastProps) {
  const colors = useThemeColors();
  const progress = useRef(new Animated.Value(0)).current;
  const styles = useMemo(() => createStyles(colors.text), [colors.text]);

  useEffect(() => {
    if (!message) return;
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [message, progress]);

  if (!message) return null;

  return (
    <View pointerEvents="none" style={[styles.host, { bottom }]}>
      <Animated.View
        style={[
          styles.animated,
          {
            opacity: progress,
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.97, 1],
                }),
              },
            ],
          },
        ]}
      >
        <BlurView intensity={55} tint="dark" style={styles.toast}>
          <Text style={styles.text}>{message}</Text>
        </BlurView>
      </Animated.View>
    </View>
  );
}

const createStyles = (_themeTextColor: string) =>
  StyleSheet.create({
    host: {
      position: 'absolute',
      left: 20,
      right: 20,
      zIndex: 1000,
      elevation: 20,
      alignItems: 'center',
    },
    animated: {
      maxWidth: '100%',
      borderRadius: 14,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 0.22,
      shadowRadius: 12,
      elevation: 10,
    },
    toast: {
      maxWidth: '100%',
      overflow: 'hidden',
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.18)',
      backgroundColor: 'rgba(30,30,30,0.72)',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    text: {
      color: '#FFFFFF',
      fontSize: 14,
      lineHeight: 19,
      fontWeight: '600',
      textAlign: 'center',
    },
  });
