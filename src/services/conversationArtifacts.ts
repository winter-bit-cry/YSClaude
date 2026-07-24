import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  deleteConversationArtifact,
  getConversationArtifact,
  getConversationArtifactCurrentVersion,
  getConversationArtifacts,
  insertConversationArtifact,
  insertConversationArtifactVersion,
} from '../db/operations';
import type {
  ConversationArtifact,
  ConversationArtifactKind,
  ConversationArtifactVersion,
} from '../types';
import {
  hasAndroidNativeFilePicker,
  pickAndroidConversationFile,
  readAndroidTextFile,
} from './androidFilePicker';

const FILE_TOKEN_PATTERN = /\[File:([^\]\r\n]+)\]/g;
const MAX_TEXT_FILE_BYTES = 512 * 1024;
const ARTIFACT_DOWNLOAD_DIR = 'artifact-downloads';

const KIND_EXTENSIONS: Record<ConversationArtifactKind, string[]> = {
  text: ['txt'],
  markdown: ['md', 'markdown'],
  html: ['html', 'htm', 'xhtml'],
  css: ['css'],
  javascript: ['js', 'mjs', 'cjs', 'jsx'],
  typescript: ['ts', 'tsx'],
  json: ['json'],
  csv: ['csv'],
};

const KIND_MIME: Record<ConversationArtifactKind, string> = {
  text: 'text/plain',
  markdown: 'text/markdown',
  html: 'text/html',
  css: 'text/css',
  javascript: 'text/javascript',
  typescript: 'text/typescript',
  json: 'application/json',
  csv: 'text/csv',
};

export interface ConversationArtifactDownloadResult {
  fileName: string;
  uri: string;
  shared: boolean;
}

function extensionOf(name: string): string {
  const clean = name.toLowerCase().split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1) : '';
}

export function inferArtifactKind(name: string, mimeType?: string): ConversationArtifactKind {
  const ext = extensionOf(name);
  for (const [kind, extensions] of Object.entries(KIND_EXTENSIONS)) {
    if (extensions.includes(ext)) return kind as ConversationArtifactKind;
  }
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('html')) return 'html';
  if (mime.includes('json')) return 'json';
  if (mime.includes('csv')) return 'csv';
  if (mime.includes('javascript')) return 'javascript';
  if (mime.includes('typescript')) return 'typescript';
  if (mime.includes('markdown')) return 'markdown';
  if (mime.startsWith('text/')) return 'text';
  return 'text';
}

function isSupportedConversationArtifact(name: string, mimeType?: string): boolean {
  const ext = extensionOf(name);
  if (Object.values(KIND_EXTENSIONS).some((extensions) => extensions.includes(ext))) return true;
  const mime = (mimeType || '').toLowerCase();
  return mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('typescript');
}

export interface SharedConversationArtifactFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number | null;
}

export async function createConversationArtifactFromSharedFile(
  conversationId: string,
  sharedFile: SharedConversationArtifactFile
): Promise<ConversationArtifact> {
  if (!isSupportedConversationArtifact(sharedFile.name, sharedFile.mimeType)) {
    throw new Error(`暂不支持把“${sharedFile.name}”作为 Artifact 上传；目前仅支持文本、Markdown、HTML、CSS、JS/TS、JSON 和 CSV 文件`);
  }
  if (typeof sharedFile.size === 'number' && sharedFile.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`“${sharedFile.name}”超过 512KB，无法上传到 Artifacts`);
  }

  const file = new File(sharedFile.uri);
  const content = await file.text();
  if (byteSizeOf(content) > MAX_TEXT_FILE_BYTES) {
    throw new Error(`“${sharedFile.name}”超过 512KB，无法上传到 Artifacts`);
  }

  return await createConversationArtifactFromContent({
    conversationId,
    name: sharedFile.name,
    mimeType: sharedFile.mimeType,
    content,
    createdBy: 'user',
  });
}

export function formatArtifactToken(artifactId: string): string {
  return `[File:${artifactId}]`;
}

export function parseArtifactTokens(content: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  FILE_TOKEN_PATTERN.lastIndex = 0;
  while ((match = FILE_TOKEN_PATTERN.exec(content)) !== null) {
    ids.push(match[1].trim());
  }
  return [...new Set(ids.filter(Boolean))];
}

function byteSizeOf(text: string): number {
  let size = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      size += 1;
    } else if (code < 0x800) {
      size += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size += 4;
        index += 1;
      } else {
        size += 3;
      }
    } else {
      size += 3;
    }
  }
  return size;
}

function normalizeArtifactName(name: string, kind: ConversationArtifactKind): string {
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  if (clean) return clean;
  return `untitled.${KIND_EXTENSIONS[kind][0] || 'txt'}`;
}

function normalizeDownloadFileName(artifact: ConversationArtifact): string {
  const fallbackName = `artifact-${artifact.id.slice(0, 8)}.${KIND_EXTENSIONS[artifact.kind][0] || 'txt'}`;
  const clean = (artifact.name || fallbackName)
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  const fileName = clean || fallbackName;
  return extensionOf(fileName) ? fileName : `${fileName}.${KIND_EXTENSIONS[artifact.kind][0] || 'txt'}`;
}

export async function createConversationArtifactFromContent({
  conversationId,
  name,
  mimeType,
  kind,
  content,
  createdBy,
}: {
  conversationId: string;
  name: string;
  mimeType?: string;
  kind?: ConversationArtifactKind;
  content: string;
  createdBy: 'user' | 'assistant';
}): Promise<ConversationArtifact> {
  const now = Date.now();
  const normalizedKind = kind || inferArtifactKind(name, mimeType);
  const artifactId = randomUUID();
  const versionId = randomUUID();
  const size = byteSizeOf(content);
  const artifact: ConversationArtifact = {
    id: artifactId,
    conversationId,
    name: normalizeArtifactName(name, normalizedKind),
    mimeType: mimeType || KIND_MIME[normalizedKind],
    kind: normalizedKind,
    currentVersionId: versionId,
    createdBy,
    createdAt: now,
    updatedAt: now,
    size,
  };
  const version: ConversationArtifactVersion = {
    id: versionId,
    artifactId,
    version: 1,
    content,
    createdBy,
    createdAt: now,
    size,
  };
  await insertConversationArtifact(artifact, version);
  return artifact;
}

export async function pickConversationArtifactFile(conversationId: string): Promise<ConversationArtifact | null> {
  const useAndroidPicker = hasAndroidNativeFilePicker();
  const androidFile = useAndroidPicker ? await pickAndroidConversationFile() : null;
  if (useAndroidPicker && !androidFile) return null;
  const picked = useAndroidPicker ? null : await File.pickFileAsync({
    mimeTypes: [
      'text/*',
      'application/json',
      'application/javascript',
      'application/typescript',
      'text/html',
      'text/css',
      'text/csv',
      '*/*',
    ],
    multipleFiles: false,
  });

  if (!androidFile && (picked?.canceled || !picked?.result)) return null;
  const file = androidFile ? new File(androidFile.uri) : picked?.result;
  if (!file) return null;
  const fileName = androidFile?.name || file.name;
  const mimeType = androidFile?.mimeType || file.type || undefined;
  if (!isSupportedConversationArtifact(fileName, mimeType)) {
    throw new Error('暂只支持文本、Markdown、HTML、CSS、JS/TS、JSON 和 CSV 文件');
  }
  const fileSize = typeof androidFile?.size === 'number'
    ? androidFile.size
    : typeof file.size === 'number'
      ? file.size
      : null;
  if (fileSize !== null && fileSize > MAX_TEXT_FILE_BYTES) {
    throw new Error('文件过大，当前最多支持 512KB 的文本文件');
  }
  const content = (await readAndroidTextFile(file.uri)) ?? (await file.text());
  if (byteSizeOf(content) > MAX_TEXT_FILE_BYTES) {
    throw new Error('文件过大，当前最多支持 512KB 的文本文件');
  }
  return await createConversationArtifactFromContent({
    conversationId,
    name: fileName,
    mimeType,
    content,
    createdBy: 'user',
  });
}

export async function listConversationArtifacts(conversationId: string): Promise<ConversationArtifact[]> {
  return await getConversationArtifacts(conversationId);
}

export async function readConversationArtifact(
  conversationId: string,
  artifactId: string
): Promise<{ artifact: ConversationArtifact; version: ConversationArtifactVersion }> {
  const result = await getConversationArtifactCurrentVersion(conversationId, artifactId);
  if (!result) throw new Error('找不到当前对话中的文件');
  return result;
}

export async function replaceConversationArtifactContent({
  conversationId,
  artifactId,
  content,
  createdBy,
}: {
  conversationId: string;
  artifactId: string;
  content: string;
  createdBy: 'user' | 'assistant';
}): Promise<ConversationArtifactVersion> {
  const artifact = await getConversationArtifact(conversationId, artifactId);
  if (!artifact) throw new Error('找不到当前对话中的文件');
  return await insertConversationArtifactVersion(conversationId, artifactId, {
    id: randomUUID(),
    artifactId,
    content,
    createdBy,
    createdAt: Date.now(),
    size: byteSizeOf(content),
  });
}

export async function downloadConversationArtifactFile({
  artifact,
  content,
}: {
  artifact: ConversationArtifact;
  content: string;
}): Promise<ConversationArtifactDownloadResult> {
  const dir = new Directory(Paths.document, ARTIFACT_DOWNLOAD_DIR);
  dir.create({ intermediates: true, idempotent: true });

  const fileName = normalizeDownloadFileName(artifact);
  const file = new File(dir, fileName);
  file.create({ intermediates: true, overwrite: true });
  file.write(content);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: '保存 Artifact',
      mimeType: artifact.mimeType || KIND_MIME[artifact.kind] || 'text/plain',
      UTI: 'public.text',
    });
    return { fileName, uri: file.uri, shared: true };
  }

  return { fileName, uri: file.uri, shared: false };
}

export async function deleteConversationArtifactFile(
  conversationId: string,
  artifactId: string
): Promise<ConversationArtifact> {
  const artifact = await deleteConversationArtifact(conversationId, artifactId);
  if (!artifact) throw new Error('找不到当前对话中的文件');
  return artifact;
}

export function patchArtifactText(content: string, find: string, replace: string, all = false): string {
  if (!find) throw new Error('缺少要查找的文本');
  if (!content.includes(find)) throw new Error('文件中没有找到要替换的文本');
  return all ? content.split(find).join(replace) : content.replace(find, replace);
}
