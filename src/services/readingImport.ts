import { Directory, File, Paths } from 'expo-file-system';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { ReadingBookFormat, ReadingChapter } from '../types';
import {
  hasAndroidNativeFilePicker,
  pickAndroidReadingBookFile,
  readAndroidTextFile,
} from './androidFilePicker';

export interface ParsedReadingBook {
  title: string;
  author: string;
  format: ReadingBookFormat;
  text: string;
  chapters: ReadingChapter[];
  coverUri?: string;
  fileUri?: string;
}

type ZipEntries = Record<string, Uint8Array>;

export interface PickedReadingBookFile {
  file: File;
  name: string;
  uri: string;
  mimeType?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export async function pickReadingBookDocument(): Promise<PickedReadingBookFile | null> {
  if (hasAndroidNativeFilePicker()) {
    const androidFile = await pickAndroidReadingBookFile();
    if (!androidFile) return null;
    const file = new File(androidFile.uri);
    return {
      file,
      name: androidFile.name,
      uri: androidFile.uri,
      mimeType: androidFile.mimeType,
    };
  }

  const result = await File.pickFileAsync({
    mimeTypes: [
      'text/plain',
      'application/epub+zip',
      'application/zip',
      'application/octet-stream',
      '*/*',
    ],
    multipleFiles: false,
  });

  if (result.canceled) return null;
  const file = result.result;
  return {
    file,
    name: file.name,
    uri: file.uri,
    mimeType: file.type,
  };
}

export async function parseReadingBookAsset(
  asset: PickedReadingBookFile,
  bookId: string
): Promise<ParsedReadingBook> {
  const format = getFormat(asset.name, asset.mimeType);
  if (!format) {
    throw new Error('仅支持 txt 和 epub 文件');
  }

  const fileUri = await copyImportedFile(asset.file, bookId, asset.name);

  if (format === 'txt') {
    const text = await readTextFile(asset.file, asset.uri);
    const cleanText = normalizeBookText(text);
    return {
      title: titleFromFilename(asset.name),
      author: '',
      format,
      text: cleanText,
      chapters: buildTextChapters(cleanText),
      fileUri,
    };
  }

  return {
    ...(await parseEpub(asset.file, bookId)),
    fileUri,
  };
}

function getFormat(name: string, mimeType?: string): ReadingBookFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.txt') || mimeType === 'text/plain') return 'txt';
  if (lower.endsWith('.epub') || mimeType === 'application/epub+zip') return 'epub';
  return null;
}

async function copyImportedFile(file: File, bookId: string, name: string): Promise<string | undefined> {
  try {
    const dir = new Directory(Paths.document, 'reading-books');
    dir.create({ intermediates: true, idempotent: true });
    const ext = extensionFromName(name);
    const destination = new File(dir, `${bookId}${ext}`);
    await file.copy(destination, { overwrite: true });
    return destination.uri;
  } catch (error) {
    console.warn('[reading] copy imported file failed', error);
    return file.uri;
  }
}

async function readTextFile(file: File, uri: string): Promise<string> {
  const androidText = await readAndroidTextFile(uri);
  if (androidText !== null) return androidText;

  try {
    return await file.text();
  } catch {
    const bytes = await file.bytes();
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function parseEpub(file: File, bookId: string): Promise<ParsedReadingBook> {
  const bytes = await file.bytes();
  const zip = unzipSync(bytes);
  const containerXml = readZipText(zip, 'META-INF/container.xml');
  if (!containerXml) throw new Error('无法读取 EPUB 容器信息');

  const container = xmlParser.parse(containerXml);
  const rootFile = first(arrayify(container?.container?.rootfiles?.rootfile));
  const opfPath = attr(rootFile, 'full-path');
  if (!opfPath) throw new Error('EPUB 缺少 OPF 文件');

  const opfXml = readZipText(zip, opfPath);
  if (!opfXml) throw new Error('无法读取 EPUB 元数据');

  const opf = xmlParser.parse(opfXml);
  const pkg = opf?.package;
  const metadata = pkg?.metadata || {};
  const manifestItems = arrayify(pkg?.manifest?.item);
  const spineItems = arrayify(pkg?.spine?.itemref);
  const basePath = directoryOf(opfPath);

  const manifest = new Map<string, any>();
  for (const item of manifestItems) {
    const id = attr(item, 'id');
    if (id) manifest.set(id, item);
  }

  const title = pickText(metadata.title) || titleFromFilename(file.name);
  const author = pickText(metadata.creator);
  const coverUri = await extractEpubCover(zip, manifestItems, metadata, basePath, bookId);

  const chapters: ReadingChapter[] = [];
  const parts: string[] = [];

  for (const itemref of spineItems) {
    const idref = attr(itemref, 'idref');
    if (!idref) continue;
    const item = manifest.get(idref);
    const href = attr(item, 'href');
    if (!href) continue;

    const entryPath = resolveZipPath(basePath, href);
    const html = readZipText(zip, entryPath);
    if (!html) continue;

    const chapterTitle = extractHtmlTitle(html) || attr(item, 'id') || `章节 ${chapters.length + 1}`;
    const chapterText = htmlToText(html);
    if (!chapterText) continue;

    const start = parts.join('\n\n').length;
    chapters.push({
      id: idref,
      title: chapterTitle,
      start,
    });
    parts.push(chapterText);
  }

  const text = normalizeBookText(parts.join('\n\n'));
  return {
    title,
    author,
    format: 'epub',
    text,
    chapters: chapters.length > 0 ? chapters : buildFallbackChapters(text),
    coverUri,
  };
}

async function extractEpubCover(
  zip: ZipEntries,
  manifestItems: any[],
  metadata: any,
  basePath: string,
  bookId: string
): Promise<string | undefined> {
  const metaItems = arrayify(metadata.meta);
  const coverId = attr(metaItems.find((item) => attr(item, 'name') === 'cover'), 'content');
  const coverItem =
    manifestItems.find((item) => attr(item, 'id') === coverId) ||
    manifestItems.find((item) => String(attr(item, 'properties')).includes('cover-image')) ||
    manifestItems.find((item) => String(attr(item, 'media-type')).startsWith('image/'));

  const href = attr(coverItem, 'href');
  if (!href) return undefined;

  const entryPath = resolveZipPath(basePath, href);
  const imageBytes = zip[entryPath];
  if (!imageBytes) return undefined;

  try {
    const dir = new Directory(Paths.document, 'reading-covers');
    dir.create({ intermediates: true, idempotent: true });
    const destination = new File(dir, `${bookId}${extensionFromName(href) || '.jpg'}`);
    destination.write(imageBytes);
    return destination.uri;
  } catch (error) {
    console.warn('[reading] cover extract failed', error);
    return undefined;
  }
}

function readZipText(zip: ZipEntries, path: string): string | null {
  const normalized = normalizeZipPath(path);
  const entry = zip[normalized];
  if (!entry) return null;
  return new TextDecoder('utf-8').decode(entry);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\s*(h[1-6]|p|div|section|article|li|blockquote|br)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHtmlTitle(html: string): string {
  const heading = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
  const title = heading || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return htmlToText(title).replace(/\s+/g, ' ').trim();
}

function normalizeBookText(text: string): string {
  return decodeEntities(text)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity] ?? match;
  });
}

function buildFallbackChapters(text: string): ReadingChapter[] {
  return text ? [{ id: 'start', title: '正文', start: 0 }] : [];
}

function buildTextChapters(text: string): ReadingChapter[] {
  if (!text) return [];
  const chapters: ReadingChapter[] = [];
  const chapterPattern =
    /^(?:\s*)((?:第[零〇一二三四五六七八九十百千万\d]+[章节回卷部集篇].{0,40})|(?:Chapter\s+\d+.{0,40})|(?:CHAPTER\s+\d+.{0,40}))\s*$/gm;

  let match: RegExpExecArray | null;
  while ((match = chapterPattern.exec(text)) !== null) {
    const title = (match[1] || '').trim();
    if (!title) continue;
    chapters.push({
      id: `txt-${chapters.length + 1}`,
      title,
      start: match.index,
    });
  }

  if (chapters.length === 0) return buildFallbackChapters(text);
  if (chapters[0].start > 0) {
    chapters.unshift({ id: 'txt-preface', title: '序章', start: 0 });
  }
  return chapters;
}

function titleFromFilename(nameOrUri: string): string {
  const name = decodeURIComponent(nameOrUri.split(/[\\/]/).pop() || '未命名书籍');
  return name.replace(/\.(txt|epub)$/i, '') || '未命名书籍';
}

function extensionFromName(name: string): string {
  const clean = name.split(/[?#]/)[0] || '';
  const match = clean.match(/\.[a-z0-9]+$/i);
  return match ? match[0].toLowerCase() : '';
}

function directoryOf(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function resolveZipPath(basePath: string, href: string): string {
  return normalizeZipPath([basePath, href].filter(Boolean).join('/'));
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of decodeURIComponent(path).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function arrayify<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function first<T>(items: T[]): T | undefined {
  return items[0];
}

function attr(node: any, name: string): string {
  if (!node || typeof node !== 'object') return '';
  const value = node[`@_${name}`];
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function pickText(value: any): string {
  const item = first(arrayify(value));
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object') {
    const text = item['#text'];
    return typeof text === 'string' ? text.trim() : '';
  }
  return '';
}
