import * as Font from 'expo-font';

export const ANTHROPIC_SANS_REGULAR = 'AnthropicSansRegular';

export async function ensureAnthropicSansLoaded(): Promise<void> {
  if (Font.isLoaded(ANTHROPIC_SANS_REGULAR)) return;
  await Font.loadAsync({
    [ANTHROPIC_SANS_REGULAR]: require('../../assets/anthropic-sans-regular.ttf'),
  });
}
