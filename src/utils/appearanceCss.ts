import type { ColorValue, TextStyle, ViewStyle } from 'react-native';

type AppearanceCssTarget =
  | 'userMessage'
  | 'assistantMessage'
  | 'userBubble'
  | 'assistantBubble'
  | 'userText'
  | 'assistantText'
  | 'inputBar'
  | 'inputText'
  | 'inputPlaceholder';

export type AppearanceBlurTint =
  | 'light'
  | 'dark'
  | 'default'
  | 'extraLight'
  | 'regular'
  | 'prominent'
  | 'systemUltraThinMaterial'
  | 'systemThinMaterial'
  | 'systemMaterial'
  | 'systemThickMaterial'
  | 'systemChromeMaterial'
  | 'systemUltraThinMaterialLight'
  | 'systemThinMaterialLight'
  | 'systemMaterialLight'
  | 'systemThickMaterialLight'
  | 'systemChromeMaterialLight'
  | 'systemUltraThinMaterialDark'
  | 'systemThinMaterialDark'
  | 'systemMaterialDark'
  | 'systemThickMaterialDark'
  | 'systemChromeMaterialDark';

export type AppearanceCssRuleStyle = ViewStyle & TextStyle & {
  backdropFilter?: string;
  blurIntensity?: number;
  blurReductionFactor?: number;
  blurTint?: AppearanceBlurTint;
  svgPath?: string;
  svgViewBox?: string;
  tintColor?: ColorValue;
};
export type AppearanceCssStyles = Partial<Record<AppearanceCssTarget, AppearanceCssRuleStyle>> & {
  selectors?: Record<string, AppearanceCssRuleStyle>;
};

const SELECTOR_TARGETS: Record<string, AppearanceCssTarget> = {
  '.user-message': 'userMessage',
  '.assistant-message': 'assistantMessage',
  '.user-bubble': 'userBubble',
  '.assistant-bubble': 'assistantBubble',
  '.user-text': 'userText',
  '.assistant-text': 'assistantText',
  '.input-bar': 'inputBar',
  '.input-container': 'inputBar',
  '.input-text': 'inputText',
  '.input-placeholder': 'inputPlaceholder',
  '.chat-input-placeholder': 'inputPlaceholder',
};

function normalizeSelector(selector: string): string {
  return selector.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getAppearanceCssStyle(
  styles: AppearanceCssStyles,
  ...selectors: string[]
): AppearanceCssRuleStyle | undefined {
  const merged: AppearanceCssRuleStyle = {};

  selectors.forEach((selector) => {
    const normalized = normalizeSelector(selector);
    const selectorStyle = styles.selectors?.[normalized];
    if (selectorStyle) {
      Object.assign(merged, selectorStyle);
    }
  });

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function withoutAppearanceGlassProps(style?: AppearanceCssRuleStyle): AppearanceCssRuleStyle | undefined {
  if (!style) return undefined;
  const { backdropFilter, blurIntensity, blurReductionFactor, blurTint, ...viewStyle } = style;
  return Object.keys(viewStyle).length > 0 ? viewStyle : undefined;
}

function normalizeHexPair(pair: string): string {
  return pair.length === 1 ? `${pair}${pair}` : pair;
}

function hexToRgb(color: string): { r: number; g: number; b: number; a: number } | undefined {
  const hex = color.trim().replace(/^#/, '');
  if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) return undefined;

  const parts = hex.length <= 4
    ? hex.split('').map(normalizeHexPair)
    : hex.match(/.{2}/g);
  if (!parts || parts.length < 3) return undefined;

  const [r, g, b, a = 'ff'] = parts;
  return {
    r: Number.parseInt(r, 16),
    g: Number.parseInt(g, 16),
    b: Number.parseInt(b, 16),
    a: Number.parseInt(a, 16) / 255,
  };
}

function parseRgbColor(color: string): { r: number; g: number; b: number; a: number } | undefined {
  const match = color.trim().match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i);
  if (!match) return undefined;

  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] === undefined ? 1 : Number(match[4]);
  if ([r, g, b].some((part) => part < 0 || part > 255) || a < 0 || a > 1) return undefined;
  return { r, g, b, a };
}

function withColorOpacity(color: string, opacity: number): string {
  if (color === 'transparent') return color;
  const rgba = color.startsWith('#') ? hexToRgb(color) : parseRgbColor(color);
  if (!rgba) return color;
  const nextAlpha = Math.min(1, Math.max(0, rgba.a * opacity));
  return `rgba(${rgba.r},${rgba.g},${rgba.b},${Number(nextAlpha.toFixed(3))})`;
}

export function getAppearancePlaceholderTextColor(
  style: AppearanceCssRuleStyle | undefined,
  fallback: ColorValue,
): ColorValue {
  const color = typeof style?.color === 'string' ? style.color : fallback;
  const opacity = typeof style?.opacity === 'number' ? style.opacity : undefined;
  if (opacity === undefined || typeof color !== 'string') return color;
  return withColorOpacity(color, opacity);
}

export function getAppearanceGlassConfig(style?: AppearanceCssRuleStyle): {
  enabled: boolean;
  intensity: number;
  reductionFactor: number;
  tint: AppearanceBlurTint;
} {
  const backdropFilter = style?.backdropFilter || '';
  const blurMatch = backdropFilter.match(/blur\(\s*(\d+(?:\.\d+)?)(?:px)?\s*\)/i);
  const parsedBlur = blurMatch ? Number(blurMatch[1]) : 0;
  const fallbackIntensity = parsedBlur > 0
    ? Math.min(100, Math.max(1, Math.round(parsedBlur * 4)))
    : 0;
  const intensity = Math.min(100, Math.max(1, Math.round(style?.blurIntensity || fallbackIntensity || 70)));

  return {
    enabled: !!style?.blurIntensity || parsedBlur > 0,
    intensity,
    reductionFactor: Math.min(10, Math.max(1, style?.blurReductionFactor || 4)),
    tint: style?.blurTint || 'light',
  };
}

const COLOR_PROPS = new Set([
  'backgroundColor',
  'borderColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'borderTopColor',
  'color',
  'textShadowColor',
  'tintColor',
]);

const NUMBER_PROPS = new Set([
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
  'borderRightWidth',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderTopWidth',
  'borderWidth',
  'bottom',
  'columnGap',
  'flex',
  'flexBasis',
  'flexGrow',
  'flexShrink',
  'fontSize',
  'gap',
  'height',
  'left',
  'letterSpacing',
  'lineHeight',
  'marginBottom',
  'marginHorizontal',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginVertical',
  'maxHeight',
  'maxWidth',
  'minHeight',
  'minWidth',
  'paddingBottom',
  'paddingHorizontal',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingVertical',
  'right',
  'rowGap',
  'top',
  'width',
]);

const PERCENT_PROPS = new Set([
  'bottom',
  'flexBasis',
  'height',
  'left',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'maxHeight',
  'maxWidth',
  'minHeight',
  'minWidth',
  'right',
  'top',
  'width',
]);

const KEYWORD_PROPS: Record<string, Set<string>> = {
  alignItems: new Set(['baseline', 'center', 'flex-end', 'flex-start', 'stretch']),
  alignSelf: new Set(['auto', 'baseline', 'center', 'flex-end', 'flex-start', 'stretch']),
  display: new Set(['flex', 'none']),
  flexDirection: new Set(['column', 'column-reverse', 'row', 'row-reverse']),
  flexWrap: new Set(['nowrap', 'wrap', 'wrap-reverse']),
  fontStyle: new Set(['italic', 'normal']),
  justifyContent: new Set(['center', 'flex-end', 'flex-start', 'space-around', 'space-between', 'space-evenly']),
  overflow: new Set(['hidden', 'scroll', 'visible']),
  position: new Set(['absolute', 'relative', 'static']),
  textAlign: new Set(['auto', 'center', 'justify', 'left', 'right']),
  textDecorationLine: new Set(['line-through', 'none', 'underline', 'underline line-through']),
  textTransform: new Set(['capitalize', 'lowercase', 'none', 'uppercase']),
};

const PROPERTY_ALIASES: Record<string, string> = {
  'background': 'backgroundColor',
  'background-color': 'backgroundColor',
  '-webkit-backdrop-filter': 'backdropFilter',
  'backdrop-filter': 'backdropFilter',
  'box-shadow': 'boxShadow',
  'blur-intensity': 'blurIntensity',
  'blur-reduction-factor': 'blurReductionFactor',
  'blur-tint': 'blurTint',
  'border-bottom-color': 'borderBottomColor',
  'border-bottom-left-radius': 'borderBottomLeftRadius',
  'border-bottom-right-radius': 'borderBottomRightRadius',
  'border-bottom-width': 'borderBottomWidth',
  'border-color': 'borderColor',
  'border-left-color': 'borderLeftColor',
  'border-left-width': 'borderLeftWidth',
  'border-radius': 'borderRadius',
  'border-right-color': 'borderRightColor',
  'border-right-width': 'borderRightWidth',
  'border-top-color': 'borderTopColor',
  'border-top-left-radius': 'borderTopLeftRadius',
  'border-top-right-radius': 'borderTopRightRadius',
  'border-top-width': 'borderTopWidth',
  'border-width': 'borderWidth',
  'column-gap': 'columnGap',
  'flex-basis': 'flexBasis',
  'flex-direction': 'flexDirection',
  'flex-grow': 'flexGrow',
  'flex-shrink': 'flexShrink',
  'flex-wrap': 'flexWrap',
  'font-size': 'fontSize',
  'font-style': 'fontStyle',
  'font-weight': 'fontWeight',
  'justify-content': 'justifyContent',
  'letter-spacing': 'letterSpacing',
  'line-height': 'lineHeight',
  'margin-bottom': 'marginBottom',
  'margin-left': 'marginLeft',
  'margin-right': 'marginRight',
  'margin-top': 'marginTop',
  'max-height': 'maxHeight',
  'max-width': 'maxWidth',
  'min-height': 'minHeight',
  'min-width': 'minWidth',
  'padding-bottom': 'paddingBottom',
  'padding-left': 'paddingLeft',
  'padding-right': 'paddingRight',
  'padding-top': 'paddingTop',
  'row-gap': 'rowGap',
  'svg-path': 'svgPath',
  'svg-view-box': 'svgViewBox',
  'text-align': 'textAlign',
  'text-decoration-line': 'textDecorationLine',
  'text-shadow-color': 'textShadowColor',
  'text-transform': 'textTransform',
  'tint-color': 'tintColor',
};

function camelizeProperty(property: string): string {
  const normalized = property.trim().toLowerCase();
  return PROPERTY_ALIASES[normalized] || normalized.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function isColorValue(value: string): boolean {
  return (
    value === 'transparent' ||
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(value)
  );
}

function parseNumericValue(value: string, allowPercent: boolean): number | string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (allowPercent && /^-?\d+(?:\.\d+)?%$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(?:px|dp)?$/);
  if (!match) return undefined;
  const next = Number(match[1]);
  return Number.isFinite(next) ? next : undefined;
}

function parseBoxValue(value: string): number[] | undefined {
  const parts = value.trim().split(/\s+/).slice(0, 4);
  if (parts.length === 0) return undefined;
  const numbers = parts.map((part) => parseNumericValue(part, false));
  if (numbers.some((item) => typeof item !== 'number')) return undefined;
  return numbers as number[];
}

function isSvgPathValue(value: string): boolean {
  return value.length <= 700 && /^[MmZzLlHhVvCcSsQqTtAaEe0-9\s,.\-+]+$/.test(value);
}

function isSvgViewBoxValue(value: string): boolean {
  return value.length <= 80 && /^-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?$/.test(value);
}

function assignBoxStyle(style: Record<string, unknown>, base: 'margin' | 'padding', value: string) {
  const numbers = parseBoxValue(value);
  if (!numbers) return;
  const [top, right = top, bottom = top, left = right] = numbers;
  style[`${base}Top`] = top;
  style[`${base}Right`] = right;
  style[`${base}Bottom`] = bottom;
  style[`${base}Left`] = left;
}

function assignBorderRadius(style: Record<string, unknown>, value: string) {
  const numbers = parseBoxValue(value);
  if (!numbers) return;
  const [topLeft, topRight = topLeft, bottomRight = topLeft, bottomLeft = topRight] = numbers;
  style.borderTopLeftRadius = topLeft;
  style.borderTopRightRadius = topRight;
  style.borderBottomRightRadius = bottomRight;
  style.borderBottomLeftRadius = bottomLeft;
}

function parseDeclaration(property: string, value: string): Record<string, unknown> {
  const style: Record<string, unknown> = {};
  const prop = camelizeProperty(property);
  const cleanValue = value.trim();
  const lowerValue = cleanValue.toLowerCase();

  if (!prop || !cleanValue) return style;
  if (cleanValue.length > 120 && prop !== 'svgPath') return style;

  if (prop === 'margin' || prop === 'padding') {
    assignBoxStyle(style, prop, cleanValue);
    return style;
  }

  if (prop === 'borderRadius' && cleanValue.trim().split(/\s+/).length > 1) {
    assignBorderRadius(style, cleanValue);
    return style;
  }

  if (prop === 'opacity') {
    const next = Number(lowerValue);
    if (Number.isFinite(next)) {
      style.opacity = Math.min(1, Math.max(0, next));
    }
    return style;
  }

  if (prop === 'boxShadow') {
    if (lowerValue === 'none' || /^[\d\s.,()%#a-z-]+$/i.test(cleanValue)) {
      style.boxShadow = cleanValue;
    }
    return style;
  }

  if (prop === 'backdropFilter') {
    if (/^blur\(\s*\d+(?:\.\d+)?(?:px)?\s*\)$/i.test(cleanValue)) {
      style.backdropFilter = cleanValue;
    }
    return style;
  }

  if (prop === 'blurIntensity') {
    const next = Number(lowerValue);
    if (Number.isFinite(next)) {
      style.blurIntensity = Math.min(100, Math.max(1, Math.round(next)));
    }
    return style;
  }

  if (prop === 'blurTint') {
    if (/^[a-z][a-z0-9]*$/i.test(cleanValue)) {
      style.blurTint = cleanValue;
    }
    return style;
  }

  if (prop === 'blurReductionFactor') {
    const next = parseNumericValue(cleanValue, false);
    if (typeof next === 'number') {
      style.blurReductionFactor = Math.min(10, Math.max(1, next));
    }
    return style;
  }

  if (prop === 'svgPath') {
    if (isSvgPathValue(cleanValue)) {
      style.svgPath = cleanValue;
    }
    return style;
  }

  if (prop === 'svgViewBox') {
    if (isSvgViewBoxValue(cleanValue)) {
      style.svgViewBox = cleanValue;
    }
    return style;
  }

  if (prop === 'fontWeight') {
    if (lowerValue === 'normal' || lowerValue === 'bold' || /^[1-9]00$/.test(lowerValue)) {
      style.fontWeight = lowerValue;
    }
    return style;
  }

  if (COLOR_PROPS.has(prop) && isColorValue(lowerValue)) {
    style[prop] = cleanValue;
    return style;
  }

  if (NUMBER_PROPS.has(prop)) {
    const next = parseNumericValue(cleanValue, PERCENT_PROPS.has(prop));
    if (next !== undefined) {
      style[prop] = next;
    }
    return style;
  }

  const keywords = KEYWORD_PROPS[prop];
  if (keywords?.has(lowerValue)) {
    style[prop] = lowerValue;
  }

  return style;
}

function parseRuleBody(body: string): Record<string, unknown> {
  return body.split(';').reduce<Record<string, unknown>>((style, declaration) => {
    const separator = declaration.indexOf(':');
    if (separator <= 0) return style;
    const property = declaration.slice(0, separator);
    const value = declaration.slice(separator + 1);
    return { ...style, ...parseDeclaration(property, value) };
  }, {});
}

export function parseAppearanceCss(css?: string): AppearanceCssStyles {
  if (!css?.trim()) return {};

  const styles: AppearanceCssStyles = {};
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '').slice(0, 12000);
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(source))) {
    const selectors = match[1]
      .split(',')
      .map((selector) => selector.trim().toLowerCase())
      .filter(Boolean);
    const ruleStyle = parseRuleBody(match[2]);
    if (Object.keys(ruleStyle).length === 0) continue;

    selectors.forEach((selector) => {
      const normalizedSelector = normalizeSelector(selector);
      styles.selectors = {
        ...(styles.selectors || {}),
        [normalizedSelector]: {
          ...(styles.selectors?.[normalizedSelector] || {}),
          ...ruleStyle,
        },
      };

      const target = SELECTOR_TARGETS[normalizedSelector];
      if (target) {
        styles[target] = {
          ...(styles[target] || {}),
          ...ruleStyle,
        };
      }
    });
  }

  return styles;
}
