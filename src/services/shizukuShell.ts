import { NativeModules, Platform } from 'react-native';

export type ShizukuStatus = { installed: boolean; permissionGranted: boolean; uid: number };
export type ShellResult = { stdout: string; stderr: string; exitCode: number; timedOut: boolean; truncated: boolean; durationMs: number };
export type ShizukuInputResult = { success: boolean; message: string };

const module = NativeModules.ShizukuShell as undefined | {
  status(): Promise<ShizukuStatus>;
  requestPermission(): Promise<boolean>;
  openManager(): Promise<boolean>;
  execute(command: string, timeoutMs: number, maxOutputChars: number): Promise<ShellResult>;
  captureScreen(): Promise<string>;
  isInputMethodReady(): Promise<boolean>;
  activateInputMethod(): Promise<boolean>;
  restoreInputMethod(): Promise<boolean>;
  commitInputMethodText(text: string): Promise<ShizukuInputResult>;
  performInputMethodAction(action: string): Promise<ShizukuInputResult>;
  deleteInputMethodText(beforeLength: number, afterLength: number): Promise<ShizukuInputResult>;
};

function requireModule() {
  if (Platform.OS !== 'android' || !module) throw new Error('Shizuku Shell 仅支持 Android 原生版本');
  return module;
}

export const getShizukuStatus = () => requireModule().status();
export const requestShizukuPermission = () => requireModule().requestPermission();
export const openShizukuManager = () => requireModule().openManager();
export const executeShizukuShell = (command: string, timeoutMs = 30000, maxOutputChars = 20000) =>
  requireModule().execute(command, timeoutMs, maxOutputChars);
export const captureShizukuScreen = () => requireModule().captureScreen();
export const isShizukuInputMethodReady = () => requireModule().isInputMethodReady();
export const activateShizukuInputMethod = () => requireModule().activateInputMethod();
export const restoreShizukuInputMethod = () => requireModule().restoreInputMethod();
export const commitShizukuInputMethodText = (value: string) => requireModule().commitInputMethodText(value);
export const performShizukuInputMethodAction = (action: string) => requireModule().performInputMethodAction(action);
export const deleteShizukuInputMethodText = (before: number, after: number) => requireModule().deleteInputMethodText(before, after);
