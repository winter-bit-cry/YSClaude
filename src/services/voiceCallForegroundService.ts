import { NativeModules, Platform } from 'react-native';
import type { VoiceCallMediaMode } from './voiceCallSession';

interface VoiceCallServiceNativeModule {
  start(mode: VoiceCallMediaMode): Promise<boolean>;
  stop(): Promise<boolean>;
}

const nativeService = NativeModules.VoiceCallService as VoiceCallServiceNativeModule | undefined;

export async function startVoiceCallForegroundService(mode: VoiceCallMediaMode): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!nativeService?.start) throw new Error('通话前台服务未包含在当前 Android 构建中');
  await nativeService.start(mode);
}

export async function stopVoiceCallForegroundService(): Promise<void> {
  if (Platform.OS !== 'android' || !nativeService?.stop) return;
  await nativeService.stop();
}
