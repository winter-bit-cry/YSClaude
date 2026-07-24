import { useEffect, useMemo, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useIncomingShare } from 'expo-sharing';
import type { ResolvedSharePayload, SharePayload } from 'expo-sharing';

import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { extractSharedHttpUrl } from '../utils/sharedLinks';

function buildPayloadSignature(
  payloads: SharePayload[],
  resolvedPayloads: ResolvedSharePayload[]
): string {
  return JSON.stringify({
    raw: payloads.map((payload) => ({
      value: payload.value,
      shareType: payload.shareType,
      mimeType: payload.mimeType,
    })),
    resolved: resolvedPayloads.map((payload) => ({
      value: payload.value,
      shareType: payload.shareType,
      mimeType: payload.mimeType,
      contentUri: payload.contentUri,
      contentType: payload.contentType,
      contentMimeType: payload.contentMimeType,
    })),
  });
}

export function IncomingShareHandler() {
  if (Platform.OS !== 'android') {
    return null;
  }

  const router = useRouter();
  const settingsHydrated = useSettingsStore((state) => state._hydrated);
  const addSharedLinkToLatestConversation = useChatStore(
    (state) => state.addSharedLinkToLatestConversation
  );
  const addSharedFilesToLatestConversation = useChatStore(
    (state) => state.addSharedFilesToLatestConversation
  );
  const loadConversation = useChatStore((state) => state.loadConversation);
  const {
    sharedPayloads,
    resolvedSharedPayloads,
    clearSharedPayloads,
    isResolving,
  } = useIncomingShare();
  const handledSignatureRef = useRef<string | null>(null);

  const signature = useMemo(
    () => buildPayloadSignature(sharedPayloads, []),
    [sharedPayloads]
  );

  useEffect(() => {
    if (!settingsHydrated || sharedPayloads.length === 0) return;
    if (handledSignatureRef.current === signature) return;

    if (isResolving) return;

    const files = resolvedSharedPayloads
      .filter((payload) => payload.contentUri && payload.contentType !== 'website' && payload.contentType !== 'text')
      .map((payload, index) => ({
        uri: payload.contentUri!,
        name: payload.originalName || `shared-file-${index + 1}`,
        mimeType: payload.contentMimeType || payload.mimeType,
        size: payload.contentSize,
      }));
    const url = files.length === 0
      ? extractSharedHttpUrl(sharedPayloads, resolvedSharedPayloads)
      : null;

    if (files.length === 0 && !url) {
      handledSignatureRef.current = signature;
      clearSharedPayloads();
      router.replace('/');
      return;
    }

    handledSignatureRef.current = signature;
    let cancelled = false;

    (async () => {
      const conversationId = files.length > 0
        ? await addSharedFilesToLatestConversation(files)
        : await addSharedLinkToLatestConversation(url!);
      if (cancelled) return;
      await loadConversation(conversationId);
      if (cancelled) return;
      router.replace('/');
      clearSharedPayloads();
    })().catch((error) => {
      console.warn('[share] failed to save incoming content', error);
      Alert.alert('文件转发失败', error instanceof Error ? error.message : '无法读取分享的文件');
      clearSharedPayloads();
      router.replace('/');
    });

    return () => {
      cancelled = true;
    };
  }, [
    addSharedFilesToLatestConversation,
    addSharedLinkToLatestConversation,
    clearSharedPayloads,
    isResolving,
    loadConversation,
    resolvedSharedPayloads,
    router,
    settingsHydrated,
    sharedPayloads,
    signature,
  ]);

  return null;
}
