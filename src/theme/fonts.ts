import type { TextStyle } from 'react-native';
import { Platform } from 'react-native';

type FontKey = 'regular' | 'bold' | 'mono' | 'serif' | 'serifBold' | 'serifStrong';
type FontFamily = TextStyle['fontFamily'];
type FontWeight = TextStyle['fontWeight'];

// 不再捆绑任何自定义字体，全部交给系统默认字体渲染。
// 仅 mono 保留系统等宽字体，保证代码块可读性。
const monoFont: FontFamily = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const localFonts: Record<FontKey, boolean> = {
  regular: false,
  bold: false,
  mono: false,
  serif: false,
  serifBold: false,
  serifStrong: false,
};

export const fontWeights: Record<'serifBold' | 'serifStrong', FontWeight> = {
  serifBold: 'normal',
  // 应用自定义字体时会切换为 normal，由独立的 Bold 字体文件提供粗体字形。
  serifStrong: '700',
};

export const fonts: Record<FontKey, FontFamily> = {
  regular: undefined,
  bold: undefined,
  mono: monoFont,
  serif: undefined,
  serifBold: undefined,
  serifStrong: undefined,
};
