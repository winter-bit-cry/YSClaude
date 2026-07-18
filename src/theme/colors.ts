import { useColorScheme, type ColorSchemeName } from 'react-native';

export const lightColors = {
  background: '#f9f9f7',
  surface: '#F0EBE4',
  surfaceHover: '#f1eee7',
  border: '#E5E0D8',
  text: '#131313',
  textSecondary: '#6B6B6B',
  textTertiary: '#9B9B9B',
  primary: '#D97706',
  primaryLight: '#FEF3C7',
  userBubble: '#f0efeb',
  assistantBubble: 'transparent',
  bubbleBorder: '#d5d4d2',
  bubbleBorderWidth: 0.5,
  codeBlock: '#ffffff',
  codeText: '#73726e',
  inputBackground: '#FFFFFF',
  inputBorder: '#f8f8f6',
  inputPanelBorder: 'transparent',
  inputPanelBorderWidth: 0,
  inputPanelShadowOpacity: 0.05,
  inputPanelElevation: 2,
  inputControlBackground: '#f0efeb',
  inputControlIcon: '#141413',
  idleResponseBackground: '#000000',
  idleResponseIcon: '#FFFFFF',
  conversationMuted: '#7a7974',
  danger: '#DC2626',
  dangerSurface: '#FEF2F2',
  success: '#16A34A',
  iconGray: '#8B8B8B',
  disclaimer: '#787773',
};

const darkColors = {
  background: '#20201e',
  surface: '#211C17',
  surfaceHover: '#2B241D',
  border: '#3A3027',
  text: '#f9f9f7',
  textSecondary: '#C9BFB2',
  textTertiary: '#8F8478',
  primary: '#D97706',
  primaryLight: '#3A2511',
  userBubble: '#131313',
  assistantBubble: '#131313',
  bubbleBorder: 'transparent',
  bubbleBorderWidth: 0,
  codeBlock: '#1B1713',
  codeText: '#D8CEC0',
  inputBackground: '#2c2c2a',
  inputBorder: '#332A22',
  inputPanelBorder: 'transparent',
  inputPanelBorderWidth: 0,
  inputPanelShadowOpacity: 0.05,
  inputPanelElevation: 2,
  inputControlBackground: '#131313',
  inputControlIcon: '#FFFFFF',
  idleResponseBackground: '#FFFFFF',
  idleResponseIcon: '#000000',
  conversationMuted: '#98958e',
  danger: '#F87171',
  dangerSurface: '#351818',
  success: '#4ADE80',
  iconGray: '#A69A8E',
  disclaimer: '#9B9084',
};

export type ThemeColors = typeof lightColors;

function createSettingsPageColors(base: ThemeColors): ThemeColors {
  return base;
}

export const settingsPageColors: ThemeColors = createSettingsPageColors(lightColors);

function getThemeColors(colorScheme: ColorSchemeName | null | undefined): ThemeColors {
  return colorScheme === 'dark' ? darkColors : lightColors;
}

export function useThemeColors(): ThemeColors {
  return getThemeColors(useColorScheme());
}

export function useSettingsPageColors(): ThemeColors {
  return createSettingsPageColors(useThemeColors());
}

export const colors = lightColors;
