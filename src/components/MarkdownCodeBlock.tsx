import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { NativeViewGestureHandler, ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { WebView } from 'react-native-webview';
import { fonts } from '../theme/fonts';
import { useThemeColors, type ThemeColors } from '../theme/colors';
import { openHtmlArtifact } from '../services/webviewController';

const COLLAPSED_LINE_COUNT = 14;
const LONG_CODE_LINE_COUNT = 18;
const LONG_CODE_LENGTH = 1200;
const CODE_FONT_SIZE = 13;
const CODE_HORIZONTAL_PADDING = 24;

function trimTrailingFenceNewline(content: string): string {
  return content.endsWith('\n') ? content.slice(0, -1) : content;
}

function getLanguageLabel(language?: string): string {
  const label = (language || '').trim().split(/\s+/)[0] || 'code';
  return label.toLowerCase();
}

function isHtmlLanguage(language?: string): boolean {
  const label = getLanguageLabel(language);
  return label === 'html' || label === 'htm' || label === 'xhtml';
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function lineCountOf(content: string): number {
  if (!content) return 0;
  return content.split(/\r\n|\r|\n/).length;
}

function estimateCodeLineWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    width += /[^\u0000-\u00ff]/.test(char) ? CODE_FONT_SIZE : CODE_FONT_SIZE * 0.62;
  }
  return Math.ceil(width);
}

function estimateCodeContentWidth(content: string): number {
  const lines = content.split(/\r\n|\r|\n/);
  const longestLineWidth = lines.reduce((max, line) => Math.max(max, estimateCodeLineWidth(line)), 0);
  return Math.max(1, longestLineWidth + CODE_HORIZONTAL_PADDING);
}

function buildPreviewHtml(rawHtml: string): string {
  if (/<(?:!doctype|html|head|body)\b/i.test(rawHtml)) {
    return rawHtml;
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body {
      min-height: 100%;
      margin: 0;
      background: #ffffff;
      color: #111111;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      padding: 16px;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
${rawHtml}
</body>
</html>`;
}

function getCodeTextInheritedStyle(style?: TextStyle): TextStyle | undefined {
  const flatStyle = StyleSheet.flatten(style);
  if (!flatStyle) return undefined;

  const {
    alignSelf: _alignSelf,
    flex: _flex,
    flexGrow: _flexGrow,
    flexShrink: _flexShrink,
    maxWidth: _maxWidth,
    minWidth: _minWidth,
    width: _width,
    ...textStyle
  } = flatStyle;

  return textStyle;
}

interface Props {
  content: string;
  language?: string;
  inheritedStyle?: TextStyle;
  codeStyle?: TextStyle;
  containerStyle?: any;
  messageId?: string;
  htmlBlockIndex?: number;
}

export function MarkdownCodeBlock({
  content,
  language,
  inheritedStyle,
  codeStyle,
  containerStyle,
  messageId,
  htmlBlockIndex,
}: Props) {
  const colors = useThemeColors();
  const dimensions = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const code = trimTrailingFenceNewline(content);
  const inheritedTextStyle = useMemo(() => getCodeTextInheritedStyle(inheritedStyle), [inheritedStyle]);
  const languageLabel = getLanguageLabel(language);
  const htmlBlock = isHtmlLanguage(language);
  const lineCount = lineCountOf(code);
  const longCode = lineCount > LONG_CODE_LINE_COUNT || code.length > LONG_CODE_LENGTH;
  const estimatedContentWidth = useMemo(() => estimateCodeContentWidth(code), [code]);
  const previewHtml = useMemo(() => buildPreviewHtml(code), [code]);
  const modalFrameStyle = [
    styles.previewFrame,
    {
      width: Math.min(dimensions.width - 24, 980),
      height: Math.min(dimensions.height - 48, 760),
    },
  ];

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
    } catch (err: any) {
      Alert.alert('复制失败', err?.message || '无法复制代码内容');
    }
  };

  const handleRenderHtml = async () => {
    if (!messageId || htmlBlockIndex === undefined) {
      setPreviewVisible(true);
      return;
    }

    try {
      await openHtmlArtifact({
        messageId,
        htmlBlockIndex,
        html: code,
        title: `${languageLabel.toUpperCase()} 预览`,
      });
    } catch (err: any) {
      Alert.alert('打开 HTML 失败', err?.message || '无法打开 HTML 预览');
    }
  };

  return (
    <View style={[styles.container, containerStyle]} onTouchStart={(event) => event.stopPropagation()}>
      <View style={styles.header}>
        <Text style={styles.language} numberOfLines={1}>
          {languageLabel}
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            style={[styles.headerButton, copied && styles.copiedButton]}
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel="复制代码"
          >
            {copied ? (
              <Check size={14} color={colors.primary} strokeWidth={2.2} />
            ) : (
              <Copy size={14} color={colors.textSecondary} strokeWidth={2.2} />
            )}
            <Text style={[styles.headerButtonText, copied && styles.copiedButtonText]}>
              {copied ? '已复制' : '复制'}
            </Text>
          </Pressable>
          {longCode && (
            <Pressable style={styles.headerButton} onPress={() => setExpanded((value) => !value)}>
              <Text style={styles.headerButtonText}>{expanded ? '收起' : '展开'}</Text>
            </Pressable>
          )}
          {htmlBlock && (
            <Pressable style={[styles.headerButton, styles.renderButton]} onPress={handleRenderHtml}>
              <Text style={[styles.headerButtonText, styles.renderButtonText]}>渲染</Text>
            </Pressable>
          )}
        </View>
      </View>

      <NativeViewGestureHandler shouldActivateOnStart disallowInterruption>
        <GestureScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          persistentScrollbar
          directionalLockEnabled
          disallowInterruption
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          style={styles.codeScroll}
          contentContainerStyle={[
            styles.codeScrollContent,
            { minWidth: estimatedContentWidth },
          ]}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <Text
            selectable={false}
            numberOfLines={!expanded && longCode ? COLLAPSED_LINE_COUNT : undefined}
            style={[
              inheritedTextStyle,
              codeStyle,
              styles.codeText,
              { minWidth: Math.max(1, estimatedContentWidth - CODE_HORIZONTAL_PADDING) },
            ]}
          >
            {code}
          </Text>
        </GestureScrollView>
      </NativeViewGestureHandler>

      {longCode && !expanded && (
        <View style={styles.fadeHint}>
          <Text style={styles.fadeHintText}>{lineCount} 行，已折叠</Text>
        </View>
      )}

      <Modal
        transparent
        visible={previewVisible}
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.previewOverlay}>
          <View style={modalFrameStyle}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                HTML 预览
              </Text>
              <Pressable style={styles.previewClose} onPress={() => setPreviewVisible(false)}>
                <Text style={styles.previewCloseText}>关闭</Text>
              </Pressable>
            </View>
            <WebView
              originWhitelist={['*']}
              source={{ html: previewHtml, baseUrl: 'https://ysclaude.local/' }}
              style={styles.webview}
              javaScriptEnabled
              domStorageEnabled={false}
              setSupportMultipleWindows={false}
              nestedScrollEnabled
              scalesPageToFit
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: colors.codeBlock,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: 10,
  },
  header: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  language: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.mono,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerButton: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  renderButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  copiedButton: {
    backgroundColor: withAlpha(colors.primary, 0.1),
    borderColor: withAlpha(colors.primary, 0.32),
  },
  headerButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  copiedButtonText: {
    color: colors.primary,
  },
  renderButtonText: {
    color: '#FFFFFF',
  },
  codeScroll: {
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
  },
  codeScrollContent: {
    flexGrow: 0,
    alignItems: 'flex-start',
    paddingHorizontal: CODE_HORIZONTAL_PADDING / 2,
    paddingVertical: 12,
  },
  codeText: {
    flexShrink: 0,
    color: colors.codeText,
    fontSize: CODE_FONT_SIZE,
    lineHeight: 19,
    fontFamily: fonts.mono,
  },
  fadeHint: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  fadeHintText: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  previewOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  previewFrame: {
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  previewTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  previewClose: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  previewCloseText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  webview: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
