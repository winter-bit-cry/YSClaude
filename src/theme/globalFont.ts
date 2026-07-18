import * as Font from 'expo-font';
import { Text } from 'react-native';
import { fonts, fontWeights } from './fonts';
import { ensureAnthropicSansLoaded } from './anthropicFonts';

export const GLOBAL_FONT_REGULAR_FAMILY = 'YSClaudeGlobalFontRegular';
export const GLOBAL_FONT_BOLD_FAMILY = 'YSClaudeGlobalFontBold';

type ComponentWithDefaultProps = {
  defaultProps?: { style?: unknown };
};

let loadedRegularFontUri: string | undefined | null = null;
let loadedBoldFontUri: string | undefined | null = null;
const textBaseDefaultProps = (Text as unknown as ComponentWithDefaultProps).defaultProps;

function setComponentDefaultFont(
  component: ComponentWithDefaultProps,
  baseDefaultProps: ComponentWithDefaultProps['defaultProps'],
  fontFamily?: string
) {
  const current = baseDefaultProps || {};
  component.defaultProps = {
    ...current,
    style: fontFamily ? [current.style, { fontFamily }] : current.style,
  };
}

function setExportedFonts(regularFontFamily?: string, boldFontFamily?: string) {
  const resolvedBoldFamily = boldFontFamily || regularFontFamily;
  fonts.regular = regularFontFamily;
  fonts.bold = resolvedBoldFamily;
  fonts.serif = regularFontFamily;
  fonts.serifBold = resolvedBoldFamily;
  fonts.serifStrong = resolvedBoldFamily;
  fontWeights.serifBold = 'normal';
  fontWeights.serifStrong = regularFontFamily ? 'normal' : '700';
}

async function unloadFont(fontFamily: string): Promise<void> {
  if (Font.isLoaded(fontFamily)) {
    await Font.unloadAsync(fontFamily);
  }
}

export async function applyGlobalFont(regularUri?: string, boldUri?: string): Promise<void> {
  await ensureAnthropicSansLoaded();
  if (loadedRegularFontUri === regularUri && loadedBoldFontUri === boldUri) return;

  await Promise.all([
    unloadFont(GLOBAL_FONT_REGULAR_FAMILY),
    unloadFont(GLOBAL_FONT_BOLD_FAMILY),
  ]);
  loadedRegularFontUri = null;
  loadedBoldFontUri = null;

  if (regularUri) {
    const fontMap: Record<string, string> = {
      [GLOBAL_FONT_REGULAR_FAMILY]: regularUri,
    };
    if (boldUri) fontMap[GLOBAL_FONT_BOLD_FAMILY] = boldUri;
    await Font.loadAsync(fontMap);
    setExportedFonts(
      GLOBAL_FONT_REGULAR_FAMILY,
      boldUri ? GLOBAL_FONT_BOLD_FAMILY : undefined
    );
    setComponentDefaultFont(
      Text as unknown as ComponentWithDefaultProps,
      textBaseDefaultProps,
      GLOBAL_FONT_REGULAR_FAMILY
    );
  } else {
    setExportedFonts();
    setComponentDefaultFont(Text as unknown as ComponentWithDefaultProps, textBaseDefaultProps);
  }

  loadedRegularFontUri = regularUri;
  loadedBoldFontUri = regularUri ? boldUri : undefined;
}
