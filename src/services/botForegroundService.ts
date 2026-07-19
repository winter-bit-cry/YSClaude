import { NativeModules, Platform } from 'react-native';

interface BotForegroundServiceNativeModule {
  start(channels: string): Promise<boolean>;
  stop(): Promise<boolean>;
}

const nativeService = NativeModules.BotForegroundService as
  | BotForegroundServiceNativeModule
  | undefined;

export async function syncBotForegroundService(
  qqEnabled: boolean,
  wechatEnabled: boolean
): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!qqEnabled && !wechatEnabled) {
    await nativeService?.stop?.();
    return;
  }
  if (!nativeService?.start) {
    throw new Error('当前 Android 构建未包含 Bot 后台服务，请重新构建安装应用');
  }
  const channels = [
    qqEnabled ? 'QQ Bot' : '',
    wechatEnabled ? '微信 ClawBot' : '',
  ].filter(Boolean).join(' / ');
  await nativeService.start(channels);
}
