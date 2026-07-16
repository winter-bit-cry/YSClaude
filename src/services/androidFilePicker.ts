import { NativeModules, Platform } from 'react-native';

export interface AndroidPickedFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

interface AndroidFilePickerModule {
  pickReadingBook: () => Promise<AndroidPickedFile | null>;
  pickConversationFile: () => Promise<AndroidPickedFile | null>;
  readTextFile: (uri: string) => Promise<string>;
}

const nativeModule = NativeModules.AndroidFilePicker as AndroidFilePickerModule | undefined;

export function hasAndroidNativeFilePicker(): boolean {
  return Platform.OS === 'android' && !!nativeModule?.pickReadingBook;
}

export async function pickAndroidReadingBookFile(): Promise<AndroidPickedFile | null> {
  if (Platform.OS !== 'android' || !nativeModule?.pickReadingBook) {
    return null;
  }

  return nativeModule.pickReadingBook();
}

export async function pickAndroidConversationFile(): Promise<AndroidPickedFile | null> {
  if (Platform.OS !== 'android' || !nativeModule?.pickConversationFile) return null;
  return nativeModule.pickConversationFile();
}

export async function readAndroidTextFile(uri: string): Promise<string | null> {
  if (Platform.OS !== 'android' || !nativeModule?.readTextFile) return null;
  return nativeModule.readTextFile(uri);
}
