import type { RefObject } from 'react';
import { Platform, type StyleProp, type View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import type { AppearanceBlurTint } from '../utils/appearanceCss';

export interface AppearanceGlassConfig {
  enabled: boolean;
  intensity: number;
  reductionFactor: number;
  tint: AppearanceBlurTint;
}

interface Props {
  config: AppearanceGlassConfig;
  blurTarget?: RefObject<View | null>;
  style?: StyleProp<ViewStyle>;
}

export function AppearanceBlurView({ config, blurTarget, style }: Props) {
  if (!config.enabled) return null;

  return (
    <BlurView
      pointerEvents="none"
      intensity={config.intensity}
      tint={config.tint}
      blurTarget={blurTarget}
      blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
      blurReductionFactor={config.reductionFactor}
      style={style}
    />
  );
}
