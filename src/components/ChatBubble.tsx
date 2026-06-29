import React, { useMemo, useState, useRef } from 'react';
import type { RefObject } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Alert, TextInput, Modal, Dimensions, ScrollView, ActivityIndicator, type TextStyle } from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import Markdown from '@ronradtke/react-native-markdown-display';
import { BlurView } from 'expo-blur';
import { Message, type GeneratedPicture } from '../types';
import { lightColors, useThemeColors, type ThemeColors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { playTTS, stopTTS } from '../services/tts';
import { saveGeneratedImageToLibrary } from '../services/imageGeneration';
import { openWebView } from '../services/webviewController';
import { getToolLabel } from '../services/tools';
import { StickerContent } from './StickerContent';
import { FishingLogPanel } from './FishingLogPanel';
import { buildStickerDefinitions, hasStickerToken, isStickerOnlyContent } from '../utils/stickers';
import { formatSmartTime } from '../utils/time';
import { getLinkCardInfo, getSingleHttpUrlMessage } from '../utils/sharedLinks';
import { parseDailyPaperCardMessage, type DailyPaperCardPayload } from '../utils/dailyPaperShare';
import { parseAppearanceCss } from '../utils/appearanceCss';


let colors = lightColors;
const SCREEN_WIDTH = Dimensions.get('window').width;
const IMAGE_MAX_WIDTH = SCREEN_WIDTH * 0.65;
const LINK_CARD_MAX_WIDTH = SCREEN_WIDTH * 0.68;
const MESSAGE_AVATAR_SIZE = 36;

function numberOrDefault(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function percentWidth(value: number): `${number}%` {
  return `${value}%`;
}

function glassBlurIntensity(value: number): number {
  if (value <= 0) return 0;
  return Math.min(100, Math.round(20 + value * 0.7));
}

function withoutFontWeight(style?: TextStyle): TextStyle | undefined {
  const flatStyle = StyleSheet.flatten(style);
  if (!flatStyle) return undefined;
  const { fontWeight: _fontWeight, ...rest } = flatStyle;
  return rest;
}

function MarkdownTable({
  children,
  markdownStyles,
}: {
  children: React.ReactNode;
  markdownStyles: any;
}) {
  return (
    <View
      style={markdownStyles.markdownTableViewport}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <GestureScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        directionalLockEnabled
        disallowInterruption
        keyboardShouldPersistTaps="handled"
        style={markdownStyles.markdownTableScroll}
        contentContainerStyle={markdownStyles.markdownTableScrollContent}
      >
        <View style={[markdownStyles._VIEW_SAFE_table, markdownStyles.markdownTable]}>{children}</View>
      </GestureScrollView>
    </View>
  );
}

const markdownRules = {
  table: (node: any, children: React.ReactNode, _parent: any, styles: any) => (
    <MarkdownTable key={node.key} markdownStyles={styles}>{children}</MarkdownTable>
  ),
};

const chatIcons = [
  require('../../assets/chat1.png'),
  require('../../assets/chat2.png'),
  require('../../assets/chat3.png'),
  require('../../assets/chat4.png'),
  require('../../assets/chat5.png'),
  require('../../assets/chat6.png'),
];

interface Props {
  message: Message;
  blurTarget?: RefObject<View | null>;
  previousUserMessage?: Message | null;
  isLastAssistant?: boolean;
  showAssistantFooter?: boolean;
  isHidden?: boolean;
  floorNumber?: number;
  showFloorNumber?: boolean;
  onBubblePress?: () => void;
}

// 把一次工具调用格式化成「动作描述 + 参数」的单行文字。
// 参数取第一个有意义的字段（query/date 等），解析失败时仅显示动作描述。
function formatToolInvocation(name: string, rawArgs: string): string {
  const label = getToolLabel(name);
  let detail = '';
  try {
    const args = JSON.parse(rawArgs || '{}');
    detail = args.query ?? args.types ?? args.date ?? args.url ?? args.title ?? args.start_date ?? args.package_name ?? args.id ?? args.ms ?? args.index ?? args.selector ?? '';
    if (!detail && args.x != null && args.y != null) {
      detail = `${args.x}, ${args.y}`;
    }
    if (detail && typeof detail !== 'string') detail = String(detail);
  } catch {
    detail = '';
  }
  return detail ? `${label}：${detail}` : label;
}

function formatDebugJson(raw: string): string {
  if (!raw) return '{}';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// 思维链胶囊：白底灰边圆角，左侧 clock 图标 + "Thought process"，点击展开/收起内容。
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.thinkingWrap}>
      <Pressable style={styles.thinkingPill} onPress={() => setExpanded((v) => !v)}>
        <Image
          source={require('../../assets/clock.png')}
          style={styles.thinkingIcon}
          resizeMode="contain"
        />
        <Text style={styles.thinkingLabel}>Thought process</Text>
      </Pressable>
      {expanded && (
        <View style={styles.thinkingContent}>
          <Markdown style={thinkingMarkdownStyles} rules={markdownRules}>{thinking}</Markdown>
        </View>
      )}
    </View>
  );
}

// 从 AI 输出中拆出思维链与剩余正文。
// 只处理「第一个」<thinking>，之后正文里再出现的 <thinking> 标签原样保留，
// 避免正文中出现的标签被误当成思维链而吞掉后续文字。
function splitThinking(raw: string): { thinking: string; body: string } {
  if (!raw) return { thinking: '', body: '' };
  const openIdx = raw.search(/<thinking>/i);
  if (openIdx === -1) return { thinking: '', body: raw.trim() };

  const afterOpen = raw.slice(openIdx).replace(/<thinking>/i, '');
  const closeMatch = afterOpen.match(/<\/thinking>/i);

  let thinking: string;
  let body: string;
  if (closeMatch && closeMatch.index !== undefined) {
    // 已闭合：思维链取首个标签对内部，正文为标签前 + 标签后（含其中可能的其它 <thinking>）
    thinking = afterOpen.slice(0, closeMatch.index);
    const tail = afterOpen.slice(closeMatch.index + closeMatch[0].length);
    body = raw.slice(0, openIdx) + tail;
  } else {
    // 流式中尚未闭合：剩余全部视为思维链，正文为标签前部分
    thinking = afterOpen;
    body = raw.slice(0, openIdx);
  }
  return { thinking: thinking.trim(), body: body.trim() };
}

function SharedLinkCard({ url }: { url: string }) {
  const info = getLinkCardInfo(url);

  return (
    <View style={styles.sharedLinkCard}>
      <View style={styles.sharedLinkIconWrap}>
        <Image
          source={require('../../assets/web.png')}
          style={styles.sharedLinkIcon}
          resizeMode="contain"
        />
      </View>
      <View style={styles.sharedLinkTextBlock}>
        <Text style={styles.sharedLinkTitle} numberOfLines={1}>
          {info.title}
        </Text>
        <Text style={styles.sharedLinkSubtitle} numberOfLines={2}>
          {info.subtitle}
        </Text>
      </View>
    </View>
  );
}

function DailyPaperForwardCard({ paper }: { paper: DailyPaperCardPayload }) {
  return (
    <View style={styles.dailyPaperCard}>
      <Text style={styles.dailyPaperEyebrow}>每日日报 · {paper.dateKey}</Text>
      <Text style={styles.dailyPaperTitle} numberOfLines={2}>{paper.title}</Text>
      <Text style={styles.dailyPaperSummary} numberOfLines={3}>{paper.summary || '点击查看完整日报'}</Text>
      <Text style={styles.dailyPaperMeta}>{paper.sourceCount || paper.sources.length} 个来源 · 点击看全文</Text>
    </View>
  );
}

export const ChatBubble = React.memo(function ChatBubble({
  message,
  blurTarget,
  previousUserMessage,
  isLastAssistant,
  showAssistantFooter,
  isHidden,
  floorNumber,
  showFloorNumber,
  onBubblePress,
}: Props) {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  thinkingMarkdownStyles = useMemo(() => createThinkingMarkdownStyles(colors), [colors]);
  const appearanceConfig = useSettingsStore((state) => state.appearanceConfig);
  const stickerConfig = useSettingsStore((state) => state.stickerConfig);
  const customCssStyles = useMemo(
    () => parseAppearanceCss(appearanceConfig?.customCss),
    [appearanceConfig?.customCss]
  );
  const isDarkTheme = colors.background === '#12100D';
  const glassTint = isDarkTheme ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight';
  const bubbleGlassBackground = isDarkTheme ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.08)';
  const bubbleGlassOverlay = isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.12)';
  const userBubbleColor = appearanceConfig?.userBubbleColor || colors.userBubble;
  const userBubbleTransparent = !!appearanceConfig?.userBubbleTransparent;
  const userBubbleRadius = numberOrDefault(appearanceConfig?.userBubbleRadius, 20, 0, 36);
  const userBubbleBlurIntensity = numberOrDefault(appearanceConfig?.userBubbleBlurIntensity, 0, 0, 100);
  const userBubbleWidthPercent = numberOrDefault(appearanceConfig?.userBubbleWidthPercent, 75, 45, 100);
  const assistantBubbleStyle = appearanceConfig?.assistantBubbleStyle || 'plain';
  const assistantBubbleColor = appearanceConfig?.assistantBubbleColor || colors.userBubble;
  const assistantBubbleTransparent = !!appearanceConfig?.assistantBubbleTransparent;
  const assistantBubbleRadius = numberOrDefault(appearanceConfig?.assistantBubbleRadius, 20, 0, 36);
  const assistantBubbleBlurIntensity = numberOrDefault(appearanceConfig?.assistantBubbleBlurIntensity, 0, 0, 100);
  const assistantBubbleWidthPercent = numberOrDefault(appearanceConfig?.assistantBubbleWidthPercent, 75, 45, 100);
  const assistantFooterHidden = !!appearanceConfig?.assistantFooterHidden;
  const assistantActionsHidden = !!appearanceConfig?.assistantActionsHidden;
  const assistantFooterColor = appearanceConfig?.assistantFooterColor || colors.textTertiary;
  const userFontSize = numberOrDefault(appearanceConfig?.userFontSize, 16, 12, 24);
  const assistantFontSize = numberOrDefault(appearanceConfig?.assistantFontSize, 16, 12, 24);
  const userTextColor = appearanceConfig?.userTextColor || colors.text;
  const assistantTextColor = appearanceConfig?.assistantTextColor || colors.text;
  const assistantTextStrokeColor = appearanceConfig?.assistantTextStrokeColor || colors.background;
  const assistantTextStrokeWidth = numberOrDefault(appearanceConfig?.assistantTextStrokeWidth, 0, 0, 8);
  const userTextStyle = useMemo(
    () => [
      {
        color: userTextColor,
        fontSize: userFontSize,
        lineHeight: Math.round(userFontSize * 1.38),
      },
      customCssStyles.userText,
    ],
    [customCssStyles.userText, userFontSize, userTextColor]
  );
  const userMarkdownStyles = useMemo(
    () => createUserMarkdownStyles(colors, userFontSize, userTextColor, customCssStyles.userText),
    [colors, customCssStyles.userText, userFontSize, userTextColor]
  );
  markdownStyles = useMemo(
    () => createMarkdownStyles(
      colors,
      assistantFontSize,
      assistantTextColor,
      assistantTextStrokeColor,
      assistantTextStrokeWidth,
      customCssStyles.assistantText
    ),
    [
      assistantFontSize,
      assistantTextColor,
      assistantTextStrokeColor,
      assistantTextStrokeWidth,
      colors,
      customCssStyles.assistantText,
    ]
  );

  const isUser = message.role === 'user';
  const messageStickers = useMemo(
    () => buildStickerDefinitions(isUser ? stickerConfig?.userStickers : stickerConfig?.assistantStickers),
    [isUser, stickerConfig?.assistantStickers, stickerConfig?.userStickers]
  );
  const messageAvatarsVisible = !!appearanceConfig?.messageAvatarsVisible;
  const messageMetaVisible = appearanceConfig?.messageMetaVisible ?? true;
  const messageAvatarRadius = numberOrDefault(appearanceConfig?.messageAvatarRadius, 18, 0, 20);
  const userDisplayName = (appearanceConfig?.userDisplayName || 'You').trim() || 'You';
  const assistantDisplayName = (appearanceConfig?.assistantDisplayName || 'Claude').trim() || 'Claude';
  const avatarImageUri = isUser ? appearanceConfig?.userAvatarImageUri : appearanceConfig?.assistantAvatarImageUri;
  const avatarName = isUser ? userDisplayName : assistantDisplayName;
  const avatarFallback = isUser ? 'U' : 'AI';
  const messageHasSticker = hasStickerToken(message.content, messageStickers);
  const messageIsStickerOnly = isStickerOnlyContent(message.content, messageStickers);
  const sharedLinkUrl = isUser ? getSingleHttpUrlMessage(message.content) : null;
  const dailyPaperCard = isUser ? parseDailyPaperCardMessage(message.content) : null;
  const editMessage = useChatStore((state) => state.editMessage);
  const removeMessage = useChatStore((state) => state.removeMessage);
  const removeToolInvocation = useChatStore((state) => state.removeToolInvocation);
  const regenerateGeneratedPicture = useChatStore((state) => state.regenerateGeneratedPicture);
  const deleteGeneratedPictureOnly = useChatStore((state) => state.deleteGeneratedPictureOnly);
  const deleteGeneratedPictureAndPrompt = useChatStore((state) => state.deleteGeneratedPictureAndPrompt);
  const addHiddenRange = useChatStore((state) => state.addHiddenRange);
  const restoreHiddenRange = useChatStore((state) => state.restoreHiddenRange);
  const setMessageHidden = useChatStore((state) => state.setMessageHidden);
  const regenerate = useChatStore((state) => state.regenerate);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editText, setEditText] = useState('');
  // 当前编辑目标消息的 id
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  // 用户气泡长按浮出的操作菜单是否显示
  const [menuVisible, setMenuVisible] = useState(false);
  const [assistantMenuVisible, setAssistantMenuVisible] = useState(false);
  const [pictureActionTarget, setPictureActionTarget] = useState<GeneratedPicture | null>(null);
  const [pictureActionBusy, setPictureActionBusy] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ uri: string; title?: string } | null>(null);
  const [dailyPaperVisible, setDailyPaperVisible] = useState(false);
  // 长按时测量得到的气泡屏幕坐标，用于把菜单锚定到气泡上方
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const bubbleRef = useRef<View>(null);
  const floorText = floorNumber !== undefined ? `#${floorNumber}` : null;
  const canToggleFloorHidden = floorNumber !== undefined;
  const hiddenToggleText = isHidden ? '恢复' : '隐藏';
  const avatarMetaText = [floorText, formatSmartTime(message.createdAt)].filter(Boolean).join(' · ');
  const floorLabel = !messageAvatarsVisible && showFloorNumber && floorText ? floorText : null;
  const avatarNode = messageAvatarsVisible ? (
    avatarImageUri ? (
      <Image
        source={{ uri: avatarImageUri }}
        style={[
          styles.messageAvatarImage,
          { borderRadius: messageAvatarRadius },
        ]}
        resizeMode="cover"
      />
    ) : (
      <View
        style={[
          styles.messageAvatarFallback,
          { borderRadius: messageAvatarRadius },
        ]}
      >
        <Text style={styles.messageAvatarFallbackText}>{avatarFallback}</Text>
      </View>
    )
  ) : null;
  const avatarHeader = messageAvatarsVisible ? (
    <View
      style={[
        styles.messageAvatarHeader,
        isUser ? styles.messageAvatarHeaderUser : styles.messageAvatarHeaderAssistant,
      ]}
    >
      {!isUser && avatarNode}
      {isUser && messageMetaVisible && <Text style={styles.messageAvatarMeta}>{avatarMetaText}</Text>}
      <Text style={styles.messageAvatarName} numberOfLines={1}>
        {avatarName}
      </Text>
      {!isUser && messageMetaVisible && <Text style={styles.messageAvatarMeta}>{avatarMetaText}</Text>}
      {isUser && avatarNode}
    </View>
  ) : null;

  if (message.role === 'system') {
    return (
      <Pressable
        style={styles.systemRow}
        onLongPress={() => {
          Alert.alert('删除', '确定删除这条系统消息？', [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => removeMessage(message.id) },
          ]);
        }}
      >
        <Text style={styles.systemText}>{message.content}</Text>
      </Pressable>
    );
  }

  function handleUserLongPress() {
    // 测量气泡在屏幕中的位置，再据此定位菜单
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ x, y, width, height });
      setMenuVisible(true);
    });
  }

  function openUserEdit() {
    setMenuVisible(false);
    setEditTargetId(message.id);
    setEditText(message.content);
    setEditModalVisible(true);
  }

  function deleteUserMessage() {
    setMenuVisible(false);
    removeMessage(message.id);
  }

  function openSharedLinkCard() {
    if (!sharedLinkUrl) return;
    openWebView(sharedLinkUrl).catch((error) => {
      Alert.alert('打开失败', error?.message || '无法打开链接');
    });
  }

  function toggleCurrentFloorHidden(closeMenu: () => void) {
    closeMenu();
    if (!canToggleFloorHidden || floorNumber === undefined) return;

    const operation = isHidden
      ? Promise.all([
          restoreHiddenRange({ from: floorNumber, to: floorNumber }),
          setMessageHidden(message.id, false),
        ])
      : addHiddenRange({ from: floorNumber, to: floorNumber });

    operation.catch((error) => {
      Alert.alert(isHidden ? '恢复失败' : '隐藏失败', error?.message || '操作失败');
    });
  }

  // 编辑弹窗（两个分支共用）
  const editModal = (
    <Modal visible={editModalVisible} transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={() => setEditModalVisible(false)}>
        <View style={styles.modal} onStartShouldSetResponder={() => true}>
          <Text style={styles.modalTitle}>
            {editTargetId === message.id && !isUser ? '编辑 AI 消息' : '编辑用户消息'}
          </Text>
          <TextInput
            style={styles.modalInput}
            value={editText}
            onChangeText={setEditText}
            multiline
            autoFocus
          />
          <View style={styles.modalButtons}>
            <Pressable style={styles.modalCancel} onPress={() => setEditModalVisible(false)}>
              <Text style={styles.modalCancelText}>取消</Text>
            </Pressable>
            <Pressable style={styles.modalConfirm} onPress={handleSaveEdit}>
              <Text style={styles.modalConfirmText}>保存</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
  const imagePreviewModal = (
    <Modal
      transparent
      visible={!!previewImage}
      animationType="fade"
      onRequestClose={() => setPreviewImage(null)}
    >
      <Pressable style={styles.imagePreviewOverlay} onPress={() => setPreviewImage(null)}>
        <View style={styles.imagePreviewFrame} onStartShouldSetResponder={() => true}>
          <Image
            source={{ uri: previewImage?.uri || '' }}
            style={styles.imagePreview}
            resizeMode="contain"
          />
          {!!previewImage?.title && (
            <Text style={styles.imagePreviewTitle} numberOfLines={2}>
              {previewImage.title}
            </Text>
          )}
          <Pressable style={styles.imagePreviewClose} onPress={() => setPreviewImage(null)}>
            <Text style={styles.imagePreviewCloseText}>关闭</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
  const dailyPaperModal = (
    <Modal
      transparent
      visible={dailyPaperVisible}
      animationType="fade"
      onRequestClose={() => setDailyPaperVisible(false)}
    >
      <Pressable style={styles.dailyPaperModalOverlay} onPress={() => setDailyPaperVisible(false)}>
        <View style={styles.dailyPaperModal} onStartShouldSetResponder={() => true}>
          <Text style={styles.dailyPaperModalTitle}>{dailyPaperCard?.title || '每日日报'}</Text>
          <Text style={styles.dailyPaperModalDate}>{dailyPaperCard?.dateKey || ''}</Text>
          <ScrollView style={styles.dailyPaperModalBody}>
            <Text selectable style={styles.dailyPaperModalText}>{dailyPaperCard?.body || ''}</Text>
            {!!dailyPaperCard?.sources.length && (
              <View style={styles.dailyPaperModalSources}>
                <Text style={styles.dailyPaperModalSourceTitle}>来源</Text>
                {dailyPaperCard.sources.map((source, index) => (
                  <Text key={`${source.url}-${index}`} selectable style={styles.dailyPaperModalSourceText}>
                    {index + 1}. {source.title}{source.sourceName ? ` · ${source.sourceName}` : ''}{source.url ? `\n${source.url}` : ''}
                  </Text>
                ))}
              </View>
            )}
          </ScrollView>
          <Pressable style={styles.imagePreviewClose} onPress={() => setDailyPaperVisible(false)}>
            <Text style={styles.imagePreviewCloseText}>关闭</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );

  if (isUser) {
    // 菜单宽度估算，用于让菜单右对齐气泡右缘
    const MENU_WIDTH = 216;
    const MENU_HEIGHT = 44;
    const menuLeft = Math.max(8, menuAnchor.x + menuAnchor.width - MENU_WIDTH);
    const menuTop = Math.max(8, menuAnchor.y - MENU_HEIGHT - 8);
    const shouldBlurUserBubble = !messageIsStickerOnly && userBubbleBlurIntensity > 0;
    const userBubbleBaseStyle = [
      styles.userBubble,
      {
        backgroundColor: userBubbleTransparent
          ? 'transparent'
          : shouldBlurUserBubble
            ? bubbleGlassBackground
            : userBubbleColor,
        borderRadius: userBubbleRadius,
      },
      shouldBlurUserBubble && styles.userBubbleGlass,
      messageHasSticker && styles.userBubbleWithSticker,
      messageIsStickerOnly && styles.userStickerOnlyBubble,
      customCssStyles.userBubble,
    ];

    return (
      <View style={[styles.userRow, isHidden && styles.hiddenRow]}>
        <View
          style={[
            styles.userColumn,
            { maxWidth: percentWidth(userBubbleWidthPercent) },
            customCssStyles.userBubble?.maxWidth !== undefined && { maxWidth: customCssStyles.userBubble.maxWidth },
            customCssStyles.userMessage,
          ]}
        >
          {avatarHeader}
          {floorLabel && <Text style={styles.floorLabelRight}>{floorLabel}</Text>}
          {isHidden && <Text style={styles.hiddenLabelRight}>已隐藏</Text>}
          {message.imageUri && (
            <Pressable
              ref={!message.content ? bubbleRef : undefined}
              onPress={() => setPreviewImage({ uri: message.imageUri!, title: '用户发送的图片' })}
              onLongPress={!message.content ? handleUserLongPress : undefined}
            >
              <Image
                source={{ uri: message.imageUri }}
                style={styles.userImage}
                resizeMode="cover"
              />
            </Pressable>
          )}
          {message.imageGenerationReferenceUris && message.imageGenerationReferenceUris.length > 0 && (
            <View style={styles.referenceImagesBlock}>
              <Text style={styles.referenceImagesLabel}>生图参考图</Text>
              <View style={styles.referenceImagesList}>
                {message.imageGenerationReferenceUris.slice(0, 16).map((uri, index) => (
                  <Pressable
                    key={`${uri}-${index}`}
                    onPress={() => setPreviewImage({ uri, title: `生图参考图 ${index + 1}` })}
                  >
                    <Image source={{ uri }} style={styles.referenceImageThumb} resizeMode="cover" />
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {message.content.length > 0 && (
            <Pressable
              ref={bubbleRef}
              onPress={dailyPaperCard ? () => setDailyPaperVisible(true) : sharedLinkUrl ? openSharedLinkCard : onBubblePress}
              onLongPress={handleUserLongPress}
              style={userBubbleBaseStyle}
            >
              {shouldBlurUserBubble && (
                <BlurView
                  blurTarget={blurTarget}
                  blurMethod="dimezisBlurView"
                  blurReductionFactor={1}
                  intensity={glassBlurIntensity(userBubbleBlurIntensity)}
                  tint={glassTint}
                  style={StyleSheet.absoluteFill}
                />
              )}
              {shouldBlurUserBubble && (
                <>
                  <View pointerEvents="none" style={[styles.glassSurfaceOverlay, { backgroundColor: bubbleGlassOverlay }]} />
                  <View pointerEvents="none" style={styles.glassTopHighlight} />
                  <View pointerEvents="none" style={styles.glassInnerGlow} />
                </>
              )}
              {dailyPaperCard ? (
                <DailyPaperForwardCard paper={dailyPaperCard} />
              ) : sharedLinkUrl ? (
                <SharedLinkCard url={sharedLinkUrl} />
              ) : (
                <StickerContent
                  content={message.content}
                  variant="user"
                  userTextStyle={userTextStyle}
                  markdownStyle={userMarkdownStyles}
                  stickers={messageStickers}
                />
              )}
            </Pressable>
          )}
          {message.content.length === 0 && !message.imageUri && !(message.imageGenerationReferenceUris?.length) && (
            <Pressable
              ref={bubbleRef}
              onPress={onBubblePress}
              onLongPress={handleUserLongPress}
              style={userBubbleBaseStyle}
            >
              {shouldBlurUserBubble && (
                <BlurView
                  blurTarget={blurTarget}
                  blurMethod="dimezisBlurView"
                  blurReductionFactor={1}
                  intensity={glassBlurIntensity(userBubbleBlurIntensity)}
                  tint={glassTint}
                  style={StyleSheet.absoluteFill}
                />
              )}
              {shouldBlurUserBubble && (
                <>
                  <View pointerEvents="none" style={[styles.glassSurfaceOverlay, { backgroundColor: bubbleGlassOverlay }]} />
                  <View pointerEvents="none" style={styles.glassTopHighlight} />
                  <View pointerEvents="none" style={styles.glassInnerGlow} />
                </>
              )}
              <Text style={[styles.userText, userTextStyle]}>{message.content}</Text>
            </Pressable>
          )}
        </View>

        {/* 长按操作菜单 */}
        <Modal transparent visible={menuVisible} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
          <Pressable style={styles.menuDismissOverlay} onPress={() => setMenuVisible(false)}>
            <View style={[styles.bubbleMenu, { left: menuLeft, top: menuTop }]}>
              <Pressable style={styles.bubbleMenuItem} onPress={openUserEdit}>
                <Text style={styles.bubbleMenuText}>编辑</Text>
              </Pressable>
              <View style={styles.bubbleMenuDivider} />
              <Pressable
                style={[styles.bubbleMenuItem, !canToggleFloorHidden && styles.bubbleMenuItemDisabled]}
                onPress={() => toggleCurrentFloorHidden(() => setMenuVisible(false))}
                disabled={!canToggleFloorHidden}
              >
                <Text style={[styles.bubbleMenuText, !canToggleFloorHidden && styles.bubbleMenuTextDisabled]}>
                  {hiddenToggleText}
                </Text>
              </Pressable>
              <View style={styles.bubbleMenuDivider} />
              <Pressable style={styles.bubbleMenuItem} onPress={deleteUserMessage}>
                <Text style={[styles.bubbleMenuText, styles.bubbleMenuTextDanger]}>删除</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        {editModal}
        {imagePreviewModal}
        {dailyPaperModal}
      </View>
    );
  }

  const userMsgBefore = previousUserMessage ?? null;

  // 拆分思维链与正文：<thinking> 内容进胶囊，正文只渲染剩余部分
  const { thinking, body } = splitThinking(message.content);

  function handleAction(index: number) {
    switch (index) {
      case 0: // 编辑 AI 消息
        setEditTargetId(message.id);
        setEditText(message.content);
        setEditModalVisible(true);
        break;
      case 1: // 删除 AI 消息
        Alert.alert('删除', '确定删除该 AI 消息？', [
          { text: '取消', style: 'cancel' },
          { text: '删除', style: 'destructive', onPress: () => removeMessage(message.id) },
        ]);
        break;
      case 2: // TTS 播放
        const ttsConfig = useSettingsStore.getState().ttsConfig;
        if (!ttsConfig.apiKey || !ttsConfig.groupId) {
          Alert.alert('提示', '请先在设置 > TTS 配置中填写 Group ID 和 API Key');
        } else {
          playTTS(message.content, ttsConfig).catch((e) =>
            Alert.alert('TTS 失败', e.message)
          );
        }
        break;
      case 3: // 编辑用户消息
        if (userMsgBefore) {
          setEditTargetId(userMsgBefore.id);
          setEditText(userMsgBefore.content);
          setEditModalVisible(true);
        }
        break;
      case 4: // 删除用户消息
        if (userMsgBefore) {
          Alert.alert('删除', '确定删除该用户消息？', [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => removeMessage(userMsgBefore.id) },
          ]);
        }
        break;
      case 5: // 重新生成
        if (isLastAssistant) regenerate();
        break;
    }
  }

  function handleAssistantLongPress() {
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      setMenuAnchor({ x, y, width, height });
      setAssistantMenuVisible(true);
    });
  }

  function handleGeneratedPictureLongPress(picture: GeneratedPicture) {
    setPictureActionTarget(picture);
  }

  function handleGeneratedPicturePress(picture: GeneratedPicture) {
    if (!picture.imageUri) return;
    setPreviewImage({ uri: picture.imageUri, title: picture.prompt || 'AI 生成图片' });
  }

  async function runPictureAction(action: 'regenerate' | 'delete-image' | 'delete-token' | 'download') {
    const target = pictureActionTarget;
    if (!target || pictureActionBusy) return;
    setPictureActionBusy(true);
    try {
      if (action === 'regenerate') {
        await regenerateGeneratedPicture(message.id, target.tokenIndex);
      } else if (action === 'delete-image') {
        await deleteGeneratedPictureOnly(message.id, target.tokenIndex);
      } else if (action === 'delete-token') {
        await deleteGeneratedPictureAndPrompt(message.id, target.tokenIndex);
      } else {
        if (!target.imageUri) {
          throw new Error('这张图片还没有可下载的文件');
        }
        await saveGeneratedImageToLibrary(target.imageUri);
      }
      setPictureActionTarget(null);
    } catch (error: any) {
      Alert.alert('操作失败', error?.message || '图片操作失败');
    } finally {
      setPictureActionBusy(false);
    }
  }

  function handleAssistantMenuAction(index: number) {
    setAssistantMenuVisible(false);
    handleAction(index);
  }

  function handleSaveEdit() {
    if (editTargetId && editText.trim()) {
      editMessage(editTargetId, editText.trim());
    }
    setEditModalVisible(false);
    setEditTargetId(null);
  }

  const assistantBubbleEnabled = assistantBubbleStyle === 'bubble';
  const shouldBlurAssistantBubble = assistantBubbleEnabled && !messageIsStickerOnly && assistantBubbleBlurIntensity > 0;
  const assistantContentStyle = assistantBubbleEnabled
    ? [
        styles.assistantBubble,
        {
          maxWidth: percentWidth(assistantBubbleWidthPercent),
          backgroundColor: assistantBubbleTransparent
            ? 'transparent'
            : shouldBlurAssistantBubble
              ? bubbleGlassBackground
              : assistantBubbleColor,
          borderRadius: assistantBubbleRadius,
        },
        shouldBlurAssistantBubble && styles.userBubbleGlass,
        messageHasSticker && styles.userBubbleWithSticker,
        messageIsStickerOnly && styles.userStickerOnlyBubble,
        customCssStyles.assistantBubble,
      ]
    : [styles.assistantContent, customCssStyles.assistantBubble];
  const ASSISTANT_MENU_WIDTH = Math.min(340, SCREEN_WIDTH - 16);
  const assistantMenuLeft = Math.min(
    Math.max(8, menuAnchor.x),
    SCREEN_WIDTH - ASSISTANT_MENU_WIDTH - 8
  );
  const assistantMenuTop = Math.max(8, menuAnchor.y + menuAnchor.height + 8);

  return (
    <View style={[styles.assistantRow, customCssStyles.assistantMessage, isHidden && styles.hiddenBubble]}>
      {avatarHeader}
      {floorLabel && <Text style={styles.floorLabelLeft}>{floorLabel}</Text>}
      {isHidden && <Text style={styles.hiddenLabelLeft}>已隐藏</Text>}
      <FishingLogPanel invocations={message.toolInvocations} />
      {/* 工具调用记录：显示在 AI 回复文字上方，每次调用一行 */}
      {message.toolInvocations && message.toolInvocations.length > 0 && (
        <View style={styles.toolList}>
          {message.toolInvocations.map((inv, i) => (
            <Pressable
              key={i}
              onPress={() => setExpandedTools((state) => ({ ...state, [i]: !state[i] }))}
              onLongPress={() => {
                Alert.alert('删除', '确定删除该工具调用记录？', [
                  { text: '取消', style: 'cancel' },
                  { text: '删除', style: 'destructive', onPress: () => removeToolInvocation(message.id, i) },
                ]);
              }}
            >
              <View style={styles.toolRow}>
                <Image
                  source={require('../../assets/clock.png')}
                  style={styles.toolIconLeft}
                  resizeMode="contain"
                />
                <Text style={styles.toolText} numberOfLines={1}>
                  {formatToolInvocation(inv.name, inv.args)}{inv.status === 'running' ? '（执行中）' : ''}
                </Text>
                <Text style={styles.toolChevron}>{expandedTools[i] ? '⌃' : '⌄'}</Text>
              </View>
              {expandedTools[i] && (
                <View style={styles.toolDetailBox}>
                  <Text style={styles.toolDetailLabel}>参数</Text>
                  <Text style={styles.toolDetailText} selectable>{formatDebugJson(inv.args)}</Text>
                  <Text style={styles.toolDetailLabel}>结果</Text>
                  <Text style={styles.toolDetailText} selectable>{inv.result || '尚未返回结果'}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      )}
      {/* 思维链：<thinking> 包裹的内容拆出，正文只渲染剩余部分 */}
      {thinking.length > 0 && <ThinkingBlock thinking={thinking} />}
      <Pressable
        ref={bubbleRef}
        style={assistantContentStyle}
        onPress={onBubblePress}
        onLongPress={handleAssistantLongPress}
      >
        {shouldBlurAssistantBubble && (
          <BlurView
            blurTarget={blurTarget}
            blurMethod="dimezisBlurView"
            blurReductionFactor={1}
            intensity={glassBlurIntensity(assistantBubbleBlurIntensity)}
            tint={glassTint}
            style={StyleSheet.absoluteFill}
          />
        )}
        {shouldBlurAssistantBubble && (
          <>
            <View pointerEvents="none" style={[styles.glassSurfaceOverlay, { backgroundColor: bubbleGlassOverlay }]} />
            <View pointerEvents="none" style={styles.glassTopHighlight} />
            <View pointerEvents="none" style={styles.glassInnerGlow} />
          </>
        )}
        <StickerContent
          content={body || ' '}
          variant="assistant"
          markdownStyle={markdownStyles}
          markdownRules={markdownRules}
          stickers={messageStickers}
          generatedPics={message.generatedPics}
          onPicturePress={handleGeneratedPicturePress}
          onPictureLongPress={handleGeneratedPictureLongPress}
        />
      </Pressable>
      <Modal
        transparent
        visible={assistantMenuVisible}
        animationType="fade"
        onRequestClose={() => setAssistantMenuVisible(false)}
      >
        <Pressable style={styles.menuDismissOverlay} onPress={() => setAssistantMenuVisible(false)}>
          <View style={[styles.bubbleMenu, styles.assistantActionMenu, { left: assistantMenuLeft, top: assistantMenuTop, width: ASSISTANT_MENU_WIDTH }]}>
            <Pressable style={[styles.bubbleMenuItem, styles.assistantActionMenuItem]} onPress={() => handleAssistantMenuAction(0)}>
              <Text style={styles.bubbleMenuText}>编辑</Text>
            </Pressable>
            <View style={styles.bubbleMenuDivider} />
            <Pressable
              style={[
                styles.bubbleMenuItem,
                styles.assistantActionMenuItem,
                !canToggleFloorHidden && styles.bubbleMenuItemDisabled,
              ]}
              onPress={() => toggleCurrentFloorHidden(() => setAssistantMenuVisible(false))}
              disabled={!canToggleFloorHidden}
            >
              <Text style={[styles.bubbleMenuText, !canToggleFloorHidden && styles.bubbleMenuTextDisabled]}>
                {hiddenToggleText}
              </Text>
            </Pressable>
            <View style={styles.bubbleMenuDivider} />
            <Pressable style={[styles.bubbleMenuItem, styles.assistantActionMenuItem]} onPress={() => handleAssistantMenuAction(1)}>
              <Text style={[styles.bubbleMenuText, styles.bubbleMenuTextDanger]}>删除</Text>
            </Pressable>
            <View style={styles.bubbleMenuDivider} />
            <Pressable style={[styles.bubbleMenuItem, styles.assistantActionMenuItem]} onPress={() => handleAssistantMenuAction(2)}>
              <Text style={styles.bubbleMenuText}>语音播放</Text>
            </Pressable>
            <View style={styles.bubbleMenuDivider} />
            <Pressable
              style={[
                styles.bubbleMenuItem,
                styles.assistantActionMenuItem,
                !isLastAssistant && styles.bubbleMenuItemDisabled,
              ]}
              onPress={() => handleAssistantMenuAction(5)}
              disabled={!isLastAssistant}
            >
              <Text style={[styles.bubbleMenuText, !isLastAssistant && styles.bubbleMenuTextDisabled]}>重生成</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <Modal
        transparent
        visible={!!pictureActionTarget}
        animationType="fade"
        onRequestClose={() => setPictureActionTarget(null)}
      >
        <Pressable style={styles.menuDismissOverlay} onPress={() => setPictureActionTarget(null)}>
          <View style={styles.pictureActionSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.pictureActionTitle} numberOfLines={2}>
              {pictureActionTarget?.prompt || 'AI 生成图片'}
            </Text>
            <Pressable
              style={styles.pictureActionItem}
              onPress={() => runPictureAction('regenerate')}
              disabled={pictureActionBusy}
            >
              {pictureActionBusy ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.pictureActionText}>重新生成图片</Text>}
            </Pressable>
            <Pressable
              style={styles.pictureActionItem}
              onPress={() => runPictureAction('download')}
              disabled={pictureActionBusy || pictureActionTarget?.status !== 'done'}
            >
              <Text style={[styles.pictureActionText, pictureActionTarget?.status !== 'done' && styles.pictureActionTextDisabled]}>
                下载到相册
              </Text>
            </Pressable>
            <Pressable
              style={styles.pictureActionItem}
              onPress={() => runPictureAction('delete-image')}
              disabled={pictureActionBusy}
            >
              <Text style={[styles.pictureActionText, styles.pictureActionTextDanger]}>只删除图片</Text>
            </Pressable>
            <Pressable
              style={styles.pictureActionItem}
              onPress={() => runPictureAction('delete-token')}
              disabled={pictureActionBusy}
            >
              <Text style={[styles.pictureActionText, styles.pictureActionTextDanger]}>删除图片和 [Pic] 文本</Text>
            </Pressable>
            <Pressable
              style={styles.pictureActionCancel}
              onPress={() => setPictureActionTarget(null)}
              disabled={pictureActionBusy}
            >
              <Text style={styles.pictureActionCancelText}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      {message.content.length > 0 && (
        <>
          {!assistantActionsHidden && (
            <View style={styles.actions}>
              {chatIcons.map((icon, i) => (
                <Pressable key={i} style={styles.actionButton} onPress={() => handleAction(i)}>
                  <Image source={icon} style={[styles.actionImage, { tintColor: assistantFooterColor }]} resizeMode="contain" />
                </Pressable>
              ))}
            </View>
          )}
          {!assistantFooterHidden && showAssistantFooter && (
            <View style={styles.logoRow}>
              <Image source={require('../../assets/claudelogo.png')} style={styles.logoImage} resizeMode="contain" />
              <Text style={[styles.disclaimerText, { color: assistantFooterColor }]}>
                Claude is AI and can make mistakes.{'\n'}Please double-check responses.
              </Text>
            </View>
          )}
        </>
      )}

      {editModal}
      {imagePreviewModal}
    </View>
  );
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    marginVertical: 8,
    minWidth: 0,
  },
  // 用户气泡列：让「已隐藏」标签右对齐于气泡上方
  userColumn: {
    alignItems: 'flex-end',
    maxWidth: '75%',
    minWidth: 0,
  },
  messageAvatarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
    maxWidth: '100%',
  },
  messageAvatarHeaderUser: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
  },
  messageAvatarHeaderAssistant: {
    alignSelf: 'flex-start',
    justifyContent: 'flex-start',
  },
  messageAvatarImage: {
    width: MESSAGE_AVATAR_SIZE,
    height: MESSAGE_AVATAR_SIZE,
    backgroundColor: colors.surface,
  },
  messageAvatarFallback: {
    width: MESSAGE_AVATAR_SIZE,
    height: MESSAGE_AVATAR_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageAvatarFallbackText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  messageAvatarName: {
    flexShrink: 1,
    maxWidth: 160,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  messageAvatarMeta: {
    flexShrink: 0,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textTertiary,
    fontFamily: fonts.mono,
  },
  // 已隐藏楼层：整体降低透明度作区分
  hiddenRow: {
    opacity: 0.4,
  },
  hiddenBubble: {
    opacity: 0.4,
  },
  hiddenLabelRight: {
    fontSize: 10,
    color: colors.textTertiary,
    marginBottom: 3,
    textAlign: 'right',
  },
  hiddenLabelLeft: {
    fontSize: 10,
    color: colors.textTertiary,
    marginBottom: 3,
    textAlign: 'left',
  },
  floorLabelRight: {
    fontSize: 11,
    color: colors.primary,
    fontFamily: fonts.mono,
    marginBottom: 3,
    textAlign: 'right',
  },
  floorLabelLeft: {
    fontSize: 11,
    color: colors.primary,
    fontFamily: fonts.mono,
    marginBottom: 3,
    textAlign: 'left',
  },
  // 长按菜单：全屏透明关闭层 + 锚定气泡上方的菜单
  menuDismissOverlay: {
    flex: 1,
  },
  bubbleMenu: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  assistantActionMenu: {
    width: 292,
  },
  bubbleMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  assistantActionMenuItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  pictureActionSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pictureActionTitle: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  pictureActionItem: {
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  pictureActionText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  pictureActionTextDisabled: {
    color: colors.textTertiary,
  },
  pictureActionTextDanger: {
    color: colors.danger,
  },
  pictureActionCancel: {
    minHeight: 46,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.inputBackground,
    marginTop: 6,
  },
  pictureActionCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  imagePreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  imagePreviewFrame: {
    width: '100%',
    height: '90%',
    maxWidth: 920,
    maxHeight: '92%',
    gap: 12,
    alignItems: 'center',
  },
  imagePreview: {
    width: '100%',
    flex: 1,
    minHeight: 220,
    borderRadius: 14,
    backgroundColor: '#0B0B0B',
  },
  imagePreviewTitle: {
    alignSelf: 'stretch',
    color: '#F5F5F5',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  imagePreviewClose: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  bubbleMenuItemDisabled: {
    opacity: 0.45,
  },
  bubbleMenuText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  bubbleMenuTextDisabled: {
    color: colors.textTertiary,
  },
  bubbleMenuTextDanger: {
    color: colors.danger,
  },
  bubbleMenuDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: colors.inputBorder,
  },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  userBubbleGlass: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.42)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  glassSurfaceOverlay: {
    ...StyleSheet.absoluteFill,
  },
  glassTopHighlight: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  glassInnerGlow: {
    position: 'absolute',
    left: 1,
    right: 1,
    top: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  userBubbleWithSticker: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  sharedLinkCard: {
    width: Math.min(300, LINK_CARD_MAX_WIDTH),
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sharedLinkIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sharedLinkIcon: {
    width: 22,
    height: 22,
    tintColor: colors.primary,
  },
  sharedLinkTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  sharedLinkTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  sharedLinkSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  dailyPaperCard: {
    width: Math.min(310, LINK_CARD_MAX_WIDTH),
    gap: 6,
  },
  dailyPaperEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  dailyPaperTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    color: colors.text,
  },
  dailyPaperSummary: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  dailyPaperMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textTertiary,
  },
  dailyPaperModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  dailyPaperModal: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '86%',
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  dailyPaperModalTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  dailyPaperModalDate: {
    marginTop: 4,
    marginBottom: 10,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  dailyPaperModalBody: {
    maxHeight: 460,
  },
  dailyPaperModalText: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.text,
  },
  dailyPaperModalSources: {
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  dailyPaperModalSourceTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  dailyPaperModalSourceText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  userStickerOnlyBubble: {
    backgroundColor: 'transparent',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  userImage: {
    width: IMAGE_MAX_WIDTH,
    height: IMAGE_MAX_WIDTH,
    borderRadius: 16,
    marginBottom: 6,
  },
  referenceImagesBlock: {
    width: IMAGE_MAX_WIDTH,
    marginBottom: 6,
    alignItems: 'flex-end',
  },
  referenceImagesLabel: {
    marginBottom: 4,
    fontSize: 11,
    color: colors.textTertiary,
    fontWeight: '600',
  },
  referenceImagesList: {
    width: IMAGE_MAX_WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
  },
  referenceImageThumb: {
    width: 54,
    height: 54,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  userText: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 22,
    fontFamily: fonts.serifBold,
  },
  systemRow: {
    alignItems: 'center',
    paddingHorizontal: 16,
    marginVertical: 8,
  },
  systemText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  assistantRow: {
    paddingHorizontal: 16,
    marginVertical: 8,
  },
  assistantContent: {
    width: '100%',
    maxWidth: '100%',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    maxWidth: '75%',
    paddingVertical: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  // 工具调用记录列表（位于回复文字上方）
  toolList: {
    marginBottom: 8,
    gap: 6,
  },
  // 单行工具调用：左图标 + 中间文字 + 右箭头，左对齐
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolIconLeft: {
    width: 13,
    height: 13,
    marginRight: 8,
  },
  toolText: {
    flexShrink: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  toolChevron: {
    marginLeft: 6,
    fontSize: 13,
    color: colors.textTertiary,
  },
  toolDetailBox: {
    marginLeft: 21,
    marginTop: 6,
    marginBottom: 2,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolDetailLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    marginBottom: 4,
  },
  toolDetailText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginBottom: 8,
    fontFamily: fonts.mono,
  },
  toolIconRight: {
    width: 11,
    height: 11,
    marginLeft: 4,
  },
  // 思维链：胶囊 + 展开内容
  thinkingWrap: {
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  // 白底灰边圆角胶囊，左侧 clock 图标 + 文字
  thinkingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  thinkingIcon: {
    width: 14,
    height: 14,
    marginRight: 7,
  },
  thinkingLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  // 展开后的思维链内容容器
  thinkingContent: {
    marginTop: 6,
    paddingLeft: 4,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  actions: {
    flexDirection: 'row',
    marginTop: -4,
    gap: 2,
  },
  actionButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  actionImage: {
    width: 16,
    height: 16,
  },
  logoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  logoImage: {
    width: 28,
    height: 28,
  },
  disclaimerText: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'right',
    lineHeight: 16,
  },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  modal: {
    backgroundColor: colors.background, borderRadius: 16, padding: 24, width: '85%',
  },
  modalTitle: {
    fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 16,
  },
  modalInput: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 10, padding: 12, fontSize: 15, color: colors.text,
    minHeight: 100, maxHeight: 240, textAlignVertical: 'top', marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 12,
  },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  modalCancelText: { fontSize: 15, color: colors.textSecondary },
  modalConfirm: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary,
  },
  modalConfirmText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
});

const createThinkingMarkdownStyles = (colors: ThemeColors) => StyleSheet.create({
  body: { width: '100%', fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
  code_inline: {
    backgroundColor: colors.surface, color: colors.primary,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, fontSize: 13, fontFamily: 'monospace',
  },
  fence: { backgroundColor: colors.codeBlock, borderRadius: 10, padding: 12, marginVertical: 8 },
  code_block: { color: colors.codeText, fontSize: 12, fontFamily: 'monospace' },
  link: { color: colors.primary },
  markdownTableViewport: { alignSelf: 'stretch', width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', marginVertical: 8 },
  markdownTableScroll: { alignSelf: 'stretch', width: '100%', maxWidth: '100%', minWidth: 0, flexShrink: 1 },
  markdownTableScrollContent: { flexGrow: 0, alignItems: 'flex-start' },
  markdownTable: { alignSelf: 'flex-start', flexShrink: 0 },
  table: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
  thead: { flexShrink: 0 },
  tbody: { flexShrink: 0 },
  tr: { flexDirection: 'row', alignSelf: 'flex-start', flexShrink: 0, borderBottomWidth: 1, borderColor: colors.border },
  th: { width: 112, minWidth: 112, flexShrink: 0, paddingVertical: 7, paddingHorizontal: 9, backgroundColor: colors.surface },
  td: { width: 112, minWidth: 112, flexShrink: 0, paddingVertical: 7, paddingHorizontal: 9 },
});

const createUserMarkdownStyles = (
  colors: ThemeColors,
  fontSize = 16,
  textColor = colors.text,
  customTextStyle?: TextStyle
) => {
  const customTextStyleWithoutFontWeight = withoutFontWeight(customTextStyle);

  return StyleSheet.create({
  body: {
    fontSize,
    color: textColor,
    lineHeight: Math.round(fontSize * 1.38),
    fontFamily: fonts.serifBold,
    fontWeight: 'normal',
    ...customTextStyleWithoutFontWeight,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 0,
  },
  strong: {
    fontFamily: fonts.serifBold,
    fontWeight: 'normal',
    color: textColor,
  },
  em: {
    color: textColor,
  },
  code_inline: {
    backgroundColor: withAlpha(textColor, 0.1),
    color: textColor,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: Math.max(12, fontSize - 1),
    fontFamily: 'monospace',
  },
  bullet_list: {
    marginVertical: 0,
  },
  ordered_list: {
    marginVertical: 0,
  },
  list_item: {
    marginVertical: 1,
  },
  link: {
    color: colors.primary,
  },
  });
};

const createMarkdownStyles = (
  colors: ThemeColors,
  fontSize = 16,
  textColor = colors.text,
  strokeColor = colors.background,
  strokeWidth = 0,
  customTextStyle?: TextStyle
) => {
  const customTextStyleWithoutFontWeight = withoutFontWeight(customTextStyle);
  const strokeStyle = strokeWidth > 0
    ? {
        textShadowColor: strokeColor,
        textShadowRadius: strokeWidth,
        textShadowOffset: { width: 0, height: 0 },
      }
    : {};

  return StyleSheet.create({
  body: { width: '100%', fontSize, color: textColor, lineHeight: Math.round(fontSize * 1.5), fontFamily: fonts.serifBold, fontWeight: 'normal', ...strokeStyle, ...customTextStyleWithoutFontWeight },
  code_inline: {
    backgroundColor: colors.surface, color: colors.primary,
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, fontSize: 14, fontFamily: 'monospace',
  },
  fence: { backgroundColor: colors.codeBlock, borderRadius: 10, padding: 14, marginVertical: 10 },
  code_block: { color: colors.codeText, fontSize: 13, fontFamily: 'monospace' },
  heading1: { fontSize: 22, fontFamily: fonts.serifBold, fontWeight: 'normal', marginVertical: 8, color: textColor, ...strokeStyle },
  heading2: { fontSize: 18, fontFamily: fonts.serifBold, fontWeight: 'normal', marginVertical: 6, color: textColor, ...strokeStyle },
  heading3: { fontSize: 16, fontFamily: fonts.serifBold, fontWeight: 'normal', marginVertical: 4, color: textColor, ...strokeStyle },
  strong: { fontFamily: fonts.serifBold, fontWeight: 'normal', ...strokeStyle },
  blockquote: {
    borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: 12, marginVertical: 8, opacity: 0.8,
  },
  list_item: { marginVertical: 2, ...strokeStyle },
  link: { color: colors.primary },
  markdownTableViewport: { alignSelf: 'stretch', width: '100%', maxWidth: '100%', minWidth: 0, overflow: 'hidden', marginVertical: 10 },
  markdownTableScroll: { alignSelf: 'stretch', width: '100%', maxWidth: '100%', minWidth: 0, flexShrink: 1 },
  markdownTableScrollContent: { flexGrow: 0, alignItems: 'flex-start' },
  markdownTable: { alignSelf: 'flex-start', flexShrink: 0 },
  table: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
  thead: { flexShrink: 0 },
  tbody: { flexShrink: 0 },
  tr: { flexDirection: 'row', alignSelf: 'flex-start', flexShrink: 0, borderBottomWidth: 1, borderColor: colors.border },
  th: { width: 128, minWidth: 128, flexShrink: 0, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.surface, color: textColor, fontWeight: 'normal', ...strokeStyle },
  td: { width: 128, minWidth: 128, flexShrink: 0, paddingVertical: 8, paddingHorizontal: 10, color: textColor, fontWeight: 'normal', ...strokeStyle },
  });
};

let styles = createStyles(colors);
let thinkingMarkdownStyles = createThinkingMarkdownStyles(colors);
let markdownStyles = createMarkdownStyles(colors);
