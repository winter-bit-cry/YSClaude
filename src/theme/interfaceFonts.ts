import * as Font from 'expo-font';

export const TIKTOK_SANS_REGULAR = 'TikTokSansRegular';

export async function ensureInterfaceFontsLoaded(): Promise<void> {
  if (Font.isLoaded(TIKTOK_SANS_REGULAR)) return;
  await Font.loadAsync({
    [TIKTOK_SANS_REGULAR]: require('../../assets/TikTok Sans Regular.ttf'),
  });
}
