import { NativeModules, Platform } from 'react-native';
import { ShizukuFileConfig, ShizukuFileRoot } from '../stores/settings';

const DEFAULT_READ_BYTES = 64 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_CHARS = 1024 * 1024;

export interface ShizukuStatus {
  available: boolean;
  running: boolean;
  permissionGranted: boolean;
  uid?: number;
  versionName?: string;
  version?: number;
  error?: string;
}

interface ShizukuFileModule {
  getStatus: () => Promise<ShizukuStatus>;
  requestPermission: () => Promise<ShizukuStatus>;
  listDirectory: (path: string) => Promise<string>;
  readFile: (path: string, maxBytes: number) => Promise<string>;
  writeFile: (path: string, content: string, append: boolean, createParents: boolean) => Promise<string>;
  replaceText: (path: string, oldText: string, newText: string, replaceAll: boolean) => Promise<string>;
}

const nativeModule = NativeModules.ShizukuFile as ShizukuFileModule | undefined;

export async function getShizukuStatus(): Promise<ShizukuStatus> {
  if (Platform.OS !== 'android' || !nativeModule?.getStatus) {
    return {
      available: false,
      running: false,
      permissionGranted: false,
      error: 'Shizuku 文件访问仅支持 Android development build',
    };
  }
  return nativeModule.getStatus();
}

export async function requestShizukuPermission(): Promise<ShizukuStatus> {
  if (Platform.OS !== 'android' || !nativeModule?.requestPermission) {
    throw new Error('Shizuku 文件访问仅支持 Android development build');
  }
  return nativeModule.requestPermission();
}

function normalizeRootPath(path: string): string {
  const value = path.trim().replace(/\\/g, '/');
  if (!value) throw new Error('路径不能为空');
  if (!value.startsWith('/')) throw new Error('Shizuku 路径必须是 /storage/... 形式的绝对路径');
  if (value.includes('\0')) throw new Error('路径不能包含空字符');
  const segments = value.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) throw new Error('路径不能包含 ..');
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function normalizeRelativePath(path: unknown): string {
  if (path === undefined || path === null || path === '') return '';
  if (typeof path !== 'string') throw new Error('path 必须是字符串');
  const value = path.trim().replace(/\\/g, '/');
  if (!value) return '';
  if (value.startsWith('/') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new Error('path 必须是授权根内的相对路径');
  }
  if (value.includes('\0')) throw new Error('path 不能包含空字符');
  const segments = value.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) throw new Error('path 不能跳出授权根');
  return segments.join('/');
}

function clampReadBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_READ_BYTES;
  return Math.min(Math.floor(parsed), MAX_READ_BYTES);
}

function normalizeContent(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是字符串`);
  if (value.length > MAX_WRITE_CHARS) throw new Error(`${fieldName} 超过长度限制: ${value.length} > ${MAX_WRITE_CHARS}`);
  return value;
}

function normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  return value === true || value === 'true';
}

function getRoot(config: ShizukuFileConfig, rootId?: unknown): ShizukuFileRoot {
  if (!config.enabled) throw new Error('Shizuku 文件访问未启用，请先在 Tool 设置中打开');
  if (config.roots.length === 0) throw new Error('未添加 Shizuku 授权路径');
  if (typeof rootId !== 'string' || !rootId.trim()) return config.roots[0];
  const root = config.roots.find((item) => item.id === rootId.trim());
  if (!root) throw new Error(`未找到 Shizuku 授权路径: ${String(rootId)}`);
  return root;
}

function resolveTargetPath(root: ShizukuFileRoot, rawPath: unknown): { rootPath: string; relativePath: string; targetPath: string } {
  const rootPath = normalizeRootPath(root.path);
  const relativePath = normalizeRelativePath(rawPath);
  const targetPath = relativePath ? `${rootPath}/${relativePath}` : rootPath;
  return { rootPath, relativePath, targetPath };
}

export function listShizukuRoots(config: ShizukuFileConfig): string {
  if (!config.enabled) throw new Error('Shizuku 文件访问未启用，请先在 Tool 设置中打开');
  return JSON.stringify({
    access: 'read_write',
    roots: config.roots.map((root) => ({
      id: root.id,
      name: root.name,
      path: root.path,
    })),
  }, null, 2);
}

export async function writeShizukuFile(args: Record<string, any>, config: ShizukuFileConfig): Promise<string> {
  if (!nativeModule?.writeFile) throw new Error('Shizuku 原生模块未加载，请重新安装 development build');
  const root = getRoot(config, args.root_id ?? args.rootId);
  const target = resolveTargetPath(root, args.path);
  if (!target.relativePath) throw new Error('写文件必须指定授权根内的相对文件路径');
  const content = normalizeContent(args.content, 'content');
  const append = normalizeBoolean(args.append, false);
  const createParents = normalizeBoolean(args.create_parent_dirs ?? args.createParentDirs, true);
  const output = await nativeModule.writeFile(target.targetPath, content, append, createParents);
  return JSON.stringify({
    rootId: root.id,
    rootName: root.name,
    rootPath: target.rootPath,
    path: target.relativePath,
    append,
    createParents,
    output,
  }, null, 2);
}

export async function replaceShizukuText(args: Record<string, any>, config: ShizukuFileConfig): Promise<string> {
  if (!nativeModule?.replaceText) throw new Error('Shizuku 原生模块未加载，请重新安装 development build');
  const root = getRoot(config, args.root_id ?? args.rootId);
  const target = resolveTargetPath(root, args.path);
  if (!target.relativePath) throw new Error('修改文件必须指定授权根内的相对文件路径');
  const oldText = normalizeContent(args.old_text ?? args.oldText, 'old_text');
  if (!oldText) throw new Error('old_text 不能为空');
  const newText = normalizeContent(args.new_text ?? args.newText, 'new_text');
  const replaceAll = normalizeBoolean(args.replace_all ?? args.replaceAll, false);
  const output = await nativeModule.replaceText(target.targetPath, oldText, newText, replaceAll);
  return JSON.stringify({
    rootId: root.id,
    rootName: root.name,
    rootPath: target.rootPath,
    path: target.relativePath,
    replaceAll,
    output,
  }, null, 2);
}

export async function listShizukuDirectory(args: Record<string, any>, config: ShizukuFileConfig): Promise<string> {
  if (!nativeModule?.listDirectory) throw new Error('Shizuku 原生模块未加载，请重新安装 development build');
  const root = getRoot(config, args.root_id ?? args.rootId);
  const target = resolveTargetPath(root, args.path);
  const output = await nativeModule.listDirectory(target.targetPath);
  return JSON.stringify({
    rootId: root.id,
    rootName: root.name,
    rootPath: target.rootPath,
    path: target.relativePath,
    output,
  }, null, 2);
}

export async function readShizukuFile(args: Record<string, any>, config: ShizukuFileConfig): Promise<string> {
  if (!nativeModule?.readFile) throw new Error('Shizuku 原生模块未加载，请重新安装 development build');
  const root = getRoot(config, args.root_id ?? args.rootId);
  const target = resolveTargetPath(root, args.path);
  const maxBytes = clampReadBytes(args.max_bytes ?? args.maxBytes);
  const output = await nativeModule.readFile(target.targetPath, maxBytes);
  return JSON.stringify({
    rootId: root.id,
    rootName: root.name,
    rootPath: target.rootPath,
    path: target.relativePath,
    maxBytes,
    content: output,
    truncatedByByteLimit: output.length >= maxBytes,
  }, null, 2);
}

export function createShizukuRoot(path: string, name?: string): ShizukuFileRoot {
  const normalized = normalizeRootPath(path);
  const fallbackName = normalized.split('/').filter(Boolean).pop() || normalized;
  return {
    id: `shizuku-root-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || fallbackName,
    path: normalized,
    addedAt: Date.now(),
  };
}
