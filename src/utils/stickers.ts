import { ImageSourcePropType } from 'react-native';
import type { CustomSticker } from '../stores/settings';

export type StickerCatalog = 'assistant' | 'user';

export interface StickerDefinition {
  id: string;
  name: string;
  token: string;
  image: ImageSourcePropType;
}

const STICKER_PATTERN = /\[Sticker:([^\]\r\n]+)\]/g;

export type StickerContentChunk =
  | { type: 'text'; text: string }
  | { type: 'sticker'; sticker: StickerDefinition };

export function normalizeStickerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function createStickerToken(name: string): string {
  return `[Sticker:${normalizeStickerName(name)}]`;
}

function getStickerImageSource(sticker: CustomSticker): ImageSourcePropType | null {
  if (sticker.uri) return { uri: sticker.uri };
  return null;
}

export function buildStickerDefinitions(stickers: CustomSticker[] | undefined): StickerDefinition[] {
  const seenNames = new Set<string>();

  return (stickers || []).reduce<StickerDefinition[]>((definitions, sticker) => {
    const name = normalizeStickerName(sticker.name);
    const image = getStickerImageSource(sticker);
    if (!name || !image || seenNames.has(name)) return definitions;
    seenNames.add(name);
    definitions.push({
      id: sticker.id,
      name,
      token: createStickerToken(name),
      image,
    });
    return definitions;
  }, []);
}

export function getStickerByName(
  name: string,
  stickers: StickerDefinition[]
): StickerDefinition | undefined {
  const normalizedName = normalizeStickerName(name);
  return stickers.find((sticker) => sticker.name === normalizedName);
}

export function splitStickerContent(
  content: string,
  stickers: StickerDefinition[]
): StickerContentChunk[] {
  const chunks: StickerContentChunk[] = [];
  let lastIndex = 0;
  const pattern = new RegExp(STICKER_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      chunks.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }

    const rawToken = match[0];
    const sticker = getStickerByName(match[1], stickers);
    chunks.push(sticker ? { type: 'sticker', sticker } : { type: 'text', text: rawToken });
    lastIndex = match.index + rawToken.length;
  }

  if (lastIndex < content.length) {
    chunks.push({ type: 'text', text: content.slice(lastIndex) });
  }

  return chunks.length > 0 ? chunks : [{ type: 'text', text: content }];
}

export function hasStickerToken(content: string, stickers: StickerDefinition[]): boolean {
  return splitStickerContent(content, stickers).some((chunk) => chunk.type === 'sticker');
}

export function isStickerOnlyContent(content: string, stickers: StickerDefinition[]): boolean {
  const chunks = splitStickerContent(content, stickers);
  return chunks.some((chunk) => chunk.type === 'sticker') &&
    chunks.every((chunk) => chunk.type === 'sticker' || chunk.text.trim().length === 0);
}

export function buildStickerSystemInstruction(stickers: CustomSticker[] | undefined): string | null {
  const names = buildStickerDefinitions(stickers).map((sticker) => sticker.name);
  if (names.length === 0) return null;

  return `你可以发送表情包。可用表情包：${names.join('、')}。发送时只需要在回复中写对应文本，例如 [Sticker:${names[0]}]；用户端会自动显示为图片。`;
}
