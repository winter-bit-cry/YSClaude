import React, { useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import Markdown from '@ronradtke/react-native-markdown-display';
import { lightColors, useThemeColors, type ThemeColors } from '../theme/colors';

import { fonts } from '../theme/fonts';
import { useSettingsStore } from '../stores/settings';
import type { GeneratedPicture } from '../types';
import { buildStickerDefinitions, getStickerByName, type StickerDefinition } from '../utils/stickers';


let colors = lightColors;
const STICKER_RENDER_SIZE = 112;
interface Props {
  content: string;
  variant: 'user' | 'assistant';
  userTextStyle?: StyleProp<TextStyle>;
  markdownStyle?: any;
  markdownRules?: any;
  stickers?: StickerDefinition[];
  generatedPics?: GeneratedPicture[];
  onPicturePress?: (picture: GeneratedPicture) => void;
  onPictureLongPress?: (picture: GeneratedPicture) => void;
}

type ContentChunk =
  | { type: 'text'; text: string }
  | { type: 'sticker'; sticker: StickerDefinition }
  | { type: 'picture'; picture: GeneratedPicture; prompt: string };

const RICH_TOKEN_PATTERN = /\[(Sticker|Pic):([^\]\r\n]+)\]/g;

function hasMarkdownSyntax(text: string): boolean {
  return (
    /(^|\n)\s*(```|~~~)/.test(text) ||
    /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-*+]\s|\d+\.\s)/.test(text) ||
    /\[[^\]\n]+\]\([^)]+\)/.test(text) ||
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/.test(text)
  );
}

function splitRichContent(
  content: string,
  stickers: StickerDefinition[],
  generatedPics: GeneratedPicture[] | undefined
): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  const pictureByIndex = new Map((generatedPics || []).map((picture) => [picture.tokenIndex, picture]));
  const pattern = new RegExp(RICH_TOKEN_PATTERN);
  let lastIndex = 0;
  let pictureIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      chunks.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }

    const rawToken = match[0];
    const kind = match[1];
    const value = match[2];

    if (kind === 'Sticker') {
      const sticker = getStickerByName(value, stickers);
      chunks.push(sticker ? { type: 'sticker', sticker } : { type: 'text', text: rawToken });
    } else {
      const picture = pictureByIndex.get(pictureIndex);
      chunks.push(picture ? { type: 'picture', picture, prompt: value.trim() } : { type: 'text', text: rawToken });
      pictureIndex += 1;
    }

    lastIndex = match.index + rawToken.length;
  }

  if (lastIndex < content.length) {
    chunks.push({ type: 'text', text: content.slice(lastIndex) });
  }

  return chunks.length > 0 ? chunks : [{ type: 'text', text: content }];
}

function GeneratedPictureCard({
  picture,
  prompt,
  onPress,
  onLongPress,
}: {
  picture: GeneratedPicture;
  prompt: string;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const isDone = picture.status === 'done' && !!picture.imageUri;
  const label =
    picture.status === 'pending'
      ? picture.progressLabel || '生成中'
      : picture.status === 'deleted'
        ? '图片已删除'
        : picture.status === 'failed'
          ? picture.errorMessage || picture.progressLabel || '生成失败'
          : picture.progressLabel || '完成';

  return (
    <Pressable
      style={styles.pictureShell}
      onPress={isDone ? onPress : undefined}
      onLongPress={onLongPress}
      accessibilityLabel={`AI 生成图片：${picture.prompt || prompt}`}
    >
      {isDone ? (
        <View style={styles.generatedPictureWrap}>
          <Image source={{ uri: picture.imageUri! }} style={styles.generatedPicture} resizeMode="cover" />
          {!!label && (
            <View style={styles.pictureDoneBadge}>
              <Text style={styles.pictureDoneBadgeText}>{label}</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.pictureFallback}>
          {picture.status === 'pending' && <ActivityIndicator size="small" color={colors.primary} />}
          <Text style={styles.pictureFallbackText} numberOfLines={5}>
            {picture.prompt || prompt}
          </Text>
          {!!label && <Text style={styles.pictureStatusText} numberOfLines={3}>{label}</Text>}
        </View>
      )}
    </Pressable>
  );
}

export function StickerContent({
  content,
  variant,
  userTextStyle,
  markdownStyle,
  markdownRules,
  stickers,
  generatedPics,
  onPicturePress,
  onPictureLongPress,
}: Props) {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const isUser = variant === 'user';
  const stickerConfig = useSettingsStore((state) => state.stickerConfig);
  const fallbackStickers = useMemo(
    () => buildStickerDefinitions(isUser ? stickerConfig?.userStickers : stickerConfig?.assistantStickers),
    [isUser, stickerConfig?.assistantStickers, stickerConfig?.userStickers]
  );
  const chunks = splitRichContent(content, stickers || fallbackStickers, generatedPics);

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      {chunks.map((chunk, index) => {
        if (chunk.type === 'sticker') {
          return (
            <Image
              key={`sticker-${index}-${chunk.sticker.name}`}
              source={chunk.sticker.image}
              style={styles.sticker}
              resizeMode="contain"
              accessibilityLabel={`表情包：${chunk.sticker.name}`}
            />
          );
        }

        if (chunk.type === 'picture') {
          return (
            <GeneratedPictureCard
              key={`picture-${index}-${chunk.picture.tokenIndex}`}
              picture={chunk.picture}
              prompt={chunk.prompt}
              onPress={() => onPicturePress?.(chunk.picture)}
              onLongPress={() => onPictureLongPress?.(chunk.picture)}
            />
          );
        }

        if (chunk.text.length === 0) return null;

        if (isUser) {
          if (markdownStyle && hasMarkdownSyntax(chunk.text)) {
            return (
              <View key={`text-${index}`} style={styles.userMarkdownFrame}>
                <Markdown style={markdownStyle} rules={markdownRules}>
                  {chunk.text}
                </Markdown>
              </View>
            );
          }

          return (
            <Text key={`text-${index}`} style={[styles.userText, userTextStyle]}>
              {chunk.text}
            </Text>
          );
        }

        return (
          <View key={`text-${index}`} style={styles.assistantMarkdownFrame}>
            <Markdown style={markdownStyle} rules={markdownRules}>
              {chunk.text}
            </Markdown>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    gap: 6,
    maxWidth: '100%',
    minWidth: 0,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
    width: '100%',
    maxWidth: '100%',
  },
  userMarkdownFrame: {
    maxWidth: '100%',
    flexShrink: 1,
  },
  assistantMarkdownFrame: {
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    flexShrink: 1,
  },
  userText: {
    maxWidth: '100%',
    minWidth: 0,
    flexShrink: 1,
    fontSize: 16,
    color: colors.text,
    lineHeight: 22,
    fontFamily: fonts.serifBold,
  },
  sticker: {
    width: STICKER_RENDER_SIZE,
    height: STICKER_RENDER_SIZE,
  },
  pictureShell: {
    width: 240,
    maxWidth: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
  },
  generatedPictureWrap: {
    width: '100%',
    height: '100%',
  },
  generatedPicture: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surface,
  },
  pictureDoneBadge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '86%',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  pictureDoneBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  pictureFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 18,
    backgroundColor: '#FFFFFF',
  },
  pictureFallbackText: {
    fontSize: 15,
    lineHeight: 21,
    color: '#111827',
    textAlign: 'center',
    fontFamily: fonts.serifBold,
  },
  pictureStatusText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
});

let styles = createStyles(colors);
