import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { unzipSync, zipSync } from 'fflate';
import { closeDatabaseConnection, getDatabase } from '../db/database';
import { stopTTS } from './tts';
import { useChatStore } from '../stores/chat';
import { useGameStore } from '../stores/game';
import { useMusicStore } from '../stores/music';
import { useRadioStore } from '../stores/radio';

const BACKUP_FORMAT_VERSION = 1;
const DATABASE_NAME = 'ysclaude.db';
const BACKUP_ROOT_DIR = 'backups';
const BACKUP_FILE_DIRS = [
  'top-bar-icons',
  'custom-stickers',
  'chat-backgrounds',
  'chat-input-backgrounds',
  'chat-avatars',
  'chat-input-icons',
  'reading-books',
  'reading-covers',
];

type ZipEntries = Record<string, Uint8Array>;

export interface BackupManifest {
  app: 'YSClaude';
  backupFormat: number;
  createdAt: string;
  appVersion: string;
  database: string;
  files: string[];
}

export interface BackupExportResult {
  fileName: string;
  uri: string;
  size: number;
  shared: boolean;
}

export interface PickedBackup {
  fileName: string;
  manifest: BackupManifest;
  entries: ZipEntries;
  databaseBytes: Uint8Array;
}

export interface RestoreResult {
  manifest: BackupManifest;
  localSnapshotUri: string;
}

function appVersion(): string {
  return Constants.expoConfig?.version || 'unknown';
}

function formatBackupStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('-');
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2));
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function fileUriFromNativePath(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function createManifest(includedDirs: string[]): BackupManifest {
  return {
    app: 'YSClaude',
    backupFormat: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: appVersion(),
    database: DATABASE_NAME,
    files: includedDirs,
  };
}

async function collectDirectoryEntries(
  directoryName: string,
  entries: ZipEntries,
  includedDirs: Set<string>
): Promise<void> {
  const root = new Directory(Paths.document, directoryName);
  if (!root.exists) return;

  includedDirs.add(directoryName);
  await collectDirectoryRecursive(root, `files/${directoryName}`, entries);
}

async function collectDirectoryRecursive(
  directory: Directory,
  zipPrefix: string,
  entries: ZipEntries
): Promise<void> {
  for (const item of directory.list()) {
    if (item instanceof Directory) {
      await collectDirectoryRecursive(item, `${zipPrefix}/${item.name}`, entries);
      continue;
    }
    entries[`${zipPrefix}/${item.name}`] = await item.bytes();
  }
}

async function createBackupPackage(fileName?: string): Promise<BackupExportResult> {
  const db = await getDatabase();
  const databaseBytes = await db.serializeAsync();
  const entries: ZipEntries = {
    [`database/${DATABASE_NAME}`]: databaseBytes,
  };
  const includedDirs = new Set<string>();

  for (const directoryName of BACKUP_FILE_DIRS) {
    await collectDirectoryEntries(directoryName, entries, includedDirs);
  }

  entries['manifest.json'] = encodeJson(createManifest([...includedDirs]));

  const zipBytes = zipSync(entries, { level: 6 });
  const backupsDir = new Directory(Paths.document, BACKUP_ROOT_DIR);
  backupsDir.create({ intermediates: true, idempotent: true });

  const backupFileName = fileName || `ysclaude-backup-${formatBackupStamp()}.zip`;
  const backupFile = new File(backupsDir, backupFileName);
  if (!backupFile.exists) {
    backupFile.create({ intermediates: true, overwrite: true });
  }
  backupFile.write(zipBytes);

  return {
    fileName: backupFileName,
    uri: backupFile.uri,
    size: zipBytes.byteLength,
    shared: false,
  };
}

export async function createAndShareBackup(): Promise<BackupExportResult> {
  const result = await createBackupPackage();
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, {
      dialogTitle: '保存 YSClaude 备份',
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
    });
    return { ...result, shared: true };
  }
  return result;
}

export async function pickBackupFile(): Promise<PickedBackup | null> {
  const picked = await File.pickFileAsync({
    mimeTypes: ['application/zip', 'application/octet-stream', '*/*'],
    multipleFiles: false,
  });

  if (picked.canceled || !picked.result) return null;

  const bytes = await picked.result.bytes();
  const entries = unzipSync(bytes);
  const manifestBytes = entries['manifest.json'];
  const databaseBytes = entries[`database/${DATABASE_NAME}`];

  if (!manifestBytes || !databaseBytes) {
    throw new Error('这不是有效的 YSClaude 备份包：缺少 manifest 或数据库。');
  }

  const manifest = JSON.parse(decodeText(manifestBytes)) as BackupManifest;
  validateManifest(manifest, databaseBytes);

  return {
    fileName: picked.result.name,
    manifest,
    entries,
    databaseBytes,
  };
}

function validateManifest(manifest: BackupManifest, databaseBytes: Uint8Array): void {
  if (manifest.app !== 'YSClaude') {
    throw new Error('这不是 YSClaude 的备份包。');
  }
  if (manifest.backupFormat !== BACKUP_FORMAT_VERSION) {
    throw new Error(`暂不支持备份格式版本 ${manifest.backupFormat}。`);
  }
  const sqliteHeader = decodeText(databaseBytes.slice(0, 16));
  if (!sqliteHeader.startsWith('SQLite format 3')) {
    throw new Error('备份包里的数据库文件无效。');
  }
}

async function stopRuntimeWork(): Promise<void> {
  useChatStore.getState().stopStreaming();
  useGameStore.getState().stopGenerating();
  useRadioStore.setState((state) => ({
    active: false,
    loading: false,
    ending: false,
    phase: 'idle',
    runId: state.runId + 1,
    status: 'AI 电台已停止',
  }));
  await stopTTS().catch(() => undefined);
  await useMusicStore.getState().pause().catch(() => undefined);
}

export async function restoreBackup(backup: PickedBackup): Promise<RestoreResult> {
  await stopRuntimeWork();
  const snapshot = await createBackupPackage(`ysclaude-before-restore-${formatBackupStamp()}.zip`);
  const db = await getDatabase();
  const databasePath = db.databasePath;
  await closeDatabaseConnection();

  const databaseFile = new File(fileUriFromNativePath(databasePath));
  if (!databaseFile.exists) {
    databaseFile.create({ intermediates: true, overwrite: true });
  }
  databaseFile.write(backup.databaseBytes);
  deleteFileIfExists(`${databaseFile.uri}-wal`);
  deleteFileIfExists(`${databaseFile.uri}-shm`);

  restoreDocumentFiles(backup.entries);

  return {
    manifest: backup.manifest,
    localSnapshotUri: snapshot.uri,
  };
}

function deleteFileIfExists(uri: string): void {
  const file = new File(uri);
  if (file.exists) {
    file.delete();
  }
}

function restoreDocumentFiles(entries: ZipEntries): void {
  for (const directoryName of BACKUP_FILE_DIRS) {
    const directory = new Directory(Paths.document, directoryName);
    if (directory.exists) {
      directory.delete();
    }
  }

  for (const [entryName, bytes] of Object.entries(entries)) {
    if (!entryName.startsWith('files/')) continue;
    const relativePath = entryName.slice('files/'.length);
    if (!relativePath || relativePath.includes('..')) continue;
    writeDocumentFile(relativePath, bytes);
  }
}

function writeDocumentFile(relativePath: string, bytes: Uint8Array): void {
  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;

  let parent = new Directory(Paths.document);
  for (const part of parts) {
    parent = new Directory(parent, part);
    if (!parent.exists) {
      parent.create({ intermediates: true, idempotent: true });
    }
  }

  const file = new File(parent, fileName);
  if (!file.exists) {
    file.create({ intermediates: true, overwrite: true });
  }
  file.write(bytes);
}
