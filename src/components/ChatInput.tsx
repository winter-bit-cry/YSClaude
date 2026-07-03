import React, { useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  View,
  TextInput,
  Pressable,
  Text,
  StyleSheet,
  Image,
  Modal,
  ScrollView,
  Dimensions,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { BlurView } from 'expo-blur';
import { lightColors, useThemeColors, type ThemeColors } from '../theme/colors';

import { useSettingsStore } from '../stores/settings';
import { buildStickerDefinitions, normalizeStickerName, type StickerDefinition } from '../utils/stickers';
import { parseAppearanceCss } from '../utils/appearanceCss';
import {
  formatMcpPromptResult,
  formatMcpResourceResult,
  getMcpPrompt,
  readMcpResource,
} from '../services/mcpHttpClient';


let colors = lightColors;
const STICKER_PANEL_HEIGHT = Math.min(420, Dimensions.get('window').height * 0.48);
const MCP_PANEL_HEIGHT = Math.min(560, Dimensions.get('window').height * 0.68);
const MAX_IMAGE_REFERENCE_COUNT = 16;
type McpPanelTab = 'tools' | 'resources' | 'prompts';

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}

function glassBlurIntensity(value: number): number {
  if (value <= 0) return 0;
  return Math.min(100, Math.round(20 + value * 0.7));
}

function getStickerSuggestionQuery(value: string): string {
  const trimmed = normalizeStickerName(value);
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1] || '';
}

function extensionFromPickedImage(asset: ImagePicker.ImagePickerAsset): string {
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime.includes('jpeg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  const name = (asset.fileName || asset.uri || '').toLowerCase().split('?')[0];
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return '.jpg';
  if (name.endsWith('.png')) return '.png';
  if (name.endsWith('.webp')) return '.webp';
  return '.png';
}

async function copyImageGenerationReference(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const dir = new Directory(Paths.document, 'image-generation-references');
  dir.create({ intermediates: true, idempotent: true });
  const destination = new File(dir, `ref-${Date.now().toString(36)}-${randomUUID()}${extensionFromPickedImage(asset)}`);
  await copyAsync({ from: asset.uri, to: destination.uri });
  return destination.uri;
}

interface Props {
  blurTarget?: RefObject<View | null>;
  onSend: (text: string, imageUri?: string, imageGenerationReferenceUris?: string[]) => void | Promise<void>;
  onTriggerResponse: () => void | Promise<void>;
  onEnableWebCruise?: () => void | Promise<void>;
  onKeepPromptCacheAlive?: () => void | Promise<void>;
  isPromptCacheKeepaliveRunning?: boolean;
  onOpenFishingPanel?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  onModelPress?: () => void;
}

export function ChatInput({
  blurTarget,
  onSend,
  onTriggerResponse,
  onEnableWebCruise,
  onKeepPromptCacheAlive,
  isPromptCacheKeepaliveRunning,
  onOpenFishingPanel,
  disabled,
  isStreaming,
  onStop,
  onModelPress,
}: Props) {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const isDarkTheme = colors.background === '#12100D';

  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingImageRefs, setPendingImageRefs] = useState<string[]>([]);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [stickerPickerVisible, setStickerPickerVisible] = useState(false);
  const [optionsMenuVisible, setOptionsMenuVisible] = useState(false);
  const [mcpPanelVisible, setMcpPanelVisible] = useState(false);
  const [mcpSelectedServerId, setMcpSelectedServerId] = useState<string | null>(null);
  const [mcpTab, setMcpTab] = useState<McpPanelTab>('resources');
  const [mcpPromptArgs, setMcpPromptArgs] = useState<Record<string, string>>({});
  const [mcpBusyKey, setMcpBusyKey] = useState<string | null>(null);
  const shouldInvertResponseIcon = isDarkTheme && (isStreaming || !isInputFocused);
  const responseTouchStartedRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const insets = useSafeAreaInsets();
  const { apiConfigs, activeConfigIndex, appearanceConfig, stickerConfig, mcpToolConfig, setMcpToolConfig } = useSettingsStore();
  const customCssStyles = useMemo(
    () => parseAppearanceCss(appearanceConfig?.customCss),
    [appearanceConfig?.customCss]
  );
  const current = apiConfigs[activeConfigIndex];
  const currentModel = current?.name || current?.model || '未配置';
  const mcpServers = mcpToolConfig?.servers || [];
  const selectedMcpServer =
    mcpServers.find((server) => server.id === mcpSelectedServerId) ||
    mcpServers.find((server) => server.enabled) ||
    mcpServers[0] ||
    null;
  const userStickers = useMemo(
    () => buildStickerDefinitions(stickerConfig?.userStickers),
    [stickerConfig?.userStickers]
  );
  const stickerSuggestionsEnabled = stickerConfig?.stickerSuggestionsEnabled ?? true;
  const suggestedStickers = useMemo<StickerDefinition[]>(() => {
    if (!stickerSuggestionsEnabled || disabled || isStreaming || stickerPickerVisible || optionsMenuVisible) {
      return [];
    }
    const query = getStickerSuggestionQuery(text);
    if (!query) return [];

    return userStickers
      .filter((sticker) => sticker.name.includes(query))
      .slice(0, 8);
  }, [
    disabled,
    isStreaming,
    optionsMenuVisible,
    stickerPickerVisible,
    stickerSuggestionsEnabled,
    text,
    userStickers,
  ]);

  const inputIconUris = appearanceConfig?.inputIconUris || {};
  const inputStyle = appearanceConfig?.inputStyle || 'default';
  const inputBackgroundImageUri = appearanceConfig?.inputBackgroundImageUri;
  const inputBackgroundTransparent = !!appearanceConfig?.inputBackgroundTransparent;
  const inputBlurIntensity = clampNumber(appearanceConfig?.inputBlurIntensity, 72, 0, 100);
  const inputBorderRadius = clampNumber(appearanceConfig?.inputBorderRadius, 24, 0, 36);
  const inputPanelRadius = typeof customCssStyles.inputBar?.borderRadius === 'number'
    ? customCssStyles.inputBar.borderRadius
    : inputBorderRadius;
  const isCompactInput = inputStyle === 'compact';
  const isGlassInput = inputStyle === 'glass' || isCompactInput;
  const glassBlur = glassBlurIntensity(inputBlurIntensity);
  const glassTint = isDarkTheme ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight';
  const glassAlpha = isDarkTheme ? 0.06 + (inputBlurIntensity / 100) * 0.06 : 0.04 + (inputBlurIntensity / 100) * 0.08;
  const hasCustomInputSurface = isGlassInput || !!inputBackgroundImageUri || inputBackgroundTransparent;
  const inputPanelBackground = inputBackgroundTransparent
    ? 'transparent'
    : isGlassInput || inputBackgroundImageUri
    ? (isDarkTheme ? `rgba(255,255,255,${glassAlpha})` : `rgba(255,255,255,${glassAlpha})`)
    : colors.inputBackground;
  const inputOverlayBackground = inputBackgroundTransparent
    ? 'transparent'
    : isGlassInput
      ? (isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.12)')
      : colors.background === '#12100D'
        ? 'rgba(18,16,13,0.08)'
        : 'rgba(255,255,255,0.08)';

  const pickImage = async () => {
    setOptionsMenuVisible(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPendingImage(result.assets[0].uri);
    }
  };

  const pickImageReferences = async () => {
    setOptionsMenuVisible(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: MAX_IMAGE_REFERENCE_COUNT,
        orderedSelection: true,
      });
      if (!result.canceled) {
        const assets = result.assets.slice(0, MAX_IMAGE_REFERENCE_COUNT);
        const uris = await Promise.all(assets.map(copyImageGenerationReference));
        setPendingImageRefs(uris);
      }
    } catch (error: any) {
      Alert.alert('选择生图参考图失败', error?.message || '无法读取所选图片');
    }
  };

  const removeImageReference = (uri: string) => {
    setPendingImageRefs((current) => current.filter((item) => item !== uri));
  };

  const handleEnableWebCruise = async () => {
    if (disabled || isStreaming) return;
    setOptionsMenuVisible(false);
    await onEnableWebCruise?.();
  };

  const handleKeepPromptCacheAlive = async () => {
    if (disabled || isStreaming || isPromptCacheKeepaliveRunning) return;
    setOptionsMenuVisible(false);
    await onKeepPromptCacheAlive?.();
  };

  const handleOpenMcpPanel = () => {
    setOptionsMenuVisible(false);
    setMcpPanelVisible(true);
    if (!mcpSelectedServerId && selectedMcpServer) {
      setMcpSelectedServerId(selectedMcpServer.id);
    }
  };

  const handleOpenFishingPanel = () => {
    setOptionsMenuVisible(false);
    onOpenFishingPanel?.();
  };

  const appendToInput = (content: string) => {
    setText((current) => {
      const prefix = current.trimEnd();
      return prefix ? `${prefix}\n\n${content}` : content;
    });
  };

  const hasEnabledMcpAbility = (servers: typeof mcpServers) =>
    servers.some(
      (server) =>
        server.enabled &&
        (
          (server.tools || []).some((tool) => tool.enabled !== false) ||
          (server.resources || []).some((resource) => resource.enabled !== false && resource.pinned)
        )
    );

  const handleToggleMcpResourcePinned = (serverId: string, uri: string, pinned: boolean) => {
    const nextServers = mcpServers.map((server) => {
      if (server.id !== serverId) return server;
      return {
        ...server,
        resources: (server.resources || []).map((resource) =>
          resource.uri === uri ? { ...resource, pinned } : resource
        ),
        updatedAt: Date.now(),
      };
    });
    setMcpToolConfig({
      servers: nextServers,
      enabled: hasEnabledMcpAbility(nextServers) || !!mcpToolConfig?.resourceToolsEnabled,
    });
  };

  const handleInsertMcpResource = async (
    server: NonNullable<typeof selectedMcpServer>,
    resource: NonNullable<NonNullable<typeof selectedMcpServer>['resources']>[number]
  ) => {
    const busyKey = `resource:${server.id}:${resource.uri}`;
    setMcpBusyKey(busyKey);
    try {
      const result = await readMcpResource(
        { url: server.url, authorization: server.authorization },
        resource.uri
      );
      const content = formatMcpResourceResult(result);
      appendToInput([
        `MCP Resource：${resource.title || resource.name || resource.uri}`,
        `来源：${server.name}`,
        `URI：${resource.uri}`,
        '',
        content,
      ].join('\n'));
      setMcpPanelVisible(false);
    } catch (error: any) {
      Alert.alert('读取失败', error?.message || '无法读取 MCP 资源');
    } finally {
      setMcpBusyKey(null);
    }
  };

  const defaultPromptArgsText = (prompt: NonNullable<NonNullable<typeof selectedMcpServer>['prompts']>[number]) => {
    const args: Record<string, string> = {};
    for (const arg of prompt.arguments || []) {
      if (arg.required) args[arg.name] = '';
    }
    return Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : '{}';
  };

  const handleApplyMcpPrompt = async (
    server: NonNullable<typeof selectedMcpServer>,
    prompt: NonNullable<NonNullable<typeof selectedMcpServer>['prompts']>[number]
  ) => {
    const key = `${server.id}:${prompt.name}`;
    const busyKey = `prompt:${key}`;
    setMcpBusyKey(busyKey);
    try {
      const rawArgs = mcpPromptArgs[key] ?? defaultPromptArgsText(prompt);
      const args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      const result = await getMcpPrompt(
        { url: server.url, authorization: server.authorization },
        prompt.name,
        args
      );
      appendToInput([
        `MCP Prompt：${prompt.title || prompt.name}`,
        `来源：${server.name}`,
        '',
        formatMcpPromptResult(result),
      ].join('\n'));
      setMcpPanelVisible(false);
    } catch (error: any) {
      Alert.alert('应用失败', error?.message || '无法读取 MCP 提示词');
    } finally {
      setMcpBusyKey(null);
    }
  };

  const handleSend = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed && !pendingImage && pendingImageRefs.length === 0) return;
    if (disabled) return;
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;
    const submittedImage = pendingImage || undefined;
    const submittedImageRefs = pendingImageRefs.length > 0 ? pendingImageRefs : undefined;
    setText('');
    setPendingImage(null);
    setPendingImageRefs([]);
    try {
      await onSend(trimmed, submittedImage, submittedImageRefs);
    } catch (err) {
      setText(value);
      setPendingImage(submittedImage || null);
      setPendingImageRefs(submittedImageRefs || []);
      throw err;
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const handleChangeText = (next: string) => {
    if (
      next.length === text.length + 1 &&
      next.startsWith(text) &&
      next.endsWith('\n')
    ) {
      void handleSend(text);
      return;
    }
    setText(next);
  };

  const handleGetResponsePressIn = async () => {
    responseTouchStartedRef.current = true;
    if (isStreaming) {
      onStop?.();
      return;
    }
    await onTriggerResponse();
  };

  const handleGetResponsePress = async () => {
    if (responseTouchStartedRef.current) {
      responseTouchStartedRef.current = false;
      return;
    }
    if (isStreaming) {
      onStop?.();
      return;
    }
    await onTriggerResponse();
  };

  const handleSendSticker = async (token: string) => {
    if (disabled || isStreaming) return;
    setStickerPickerVisible(false);
    setText('');
    setPendingImage(null);
    setPendingImageRefs([]);
    await onSend(token);
  };

  const getResponseIcon = () => {
    if (isStreaming) {
      return inputIconUris.stop ? { uri: inputIconUris.stop } : require('../../assets/stopsend.png');
    }
    if (isInputFocused) {
      return inputIconUris.sendFocused ? { uri: inputIconUris.sendFocused } : require('../../assets/getresponse2.png');
    }
    return inputIconUris.sendIdle ? { uri: inputIconUris.sendIdle } : require('../../assets/getresponse1.png');
  };

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {suggestedStickers.length > 0 && (
        <View style={styles.suggestionPanel}>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionList}
          >
            {suggestedStickers.map((sticker) => (
              <Pressable
                key={sticker.id}
                style={styles.suggestionItem}
                onPress={() => void handleSendSticker(sticker.token)}
              >
                <Image source={sticker.image} style={styles.suggestionImage} resizeMode="contain" />
                <Text style={styles.suggestionName} numberOfLines={1}>{sticker.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      <View
        style={[
          styles.container,
          { backgroundColor: inputPanelBackground, borderRadius: inputPanelRadius },
          hasCustomInputSurface && styles.customContainer,
          isGlassInput && styles.glassContainer,
          isCompactInput && styles.compactContainer,
          customCssStyles.inputBar,
        ]}
      >
        {inputBackgroundImageUri && (
          <Image source={{ uri: inputBackgroundImageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        )}
        {isGlassInput && (
          <BlurView
            blurTarget={blurTarget}
            blurMethod="dimezisBlurView"
            blurReductionFactor={1}
            intensity={glassBlur}
            tint={glassTint}
            style={StyleSheet.absoluteFill}
          />
        )}
        {hasCustomInputSurface && (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: inputOverlayBackground }]} />
        )}
        {isGlassInput && (
          <>
            <View pointerEvents="none" style={styles.glassTopHighlight} />
            <View
              pointerEvents="none"
              style={[
                styles.glassInnerSheen,
                {
                  borderTopLeftRadius: Math.max(0, inputPanelRadius - 1),
                  borderTopRightRadius: Math.max(0, inputPanelRadius - 1),
                },
              ]}
            />
          </>
        )}
        {pendingImage && !isCompactInput && (
          <View style={styles.previewRow}>
            <View style={styles.previewWrap}>
              <Image source={{ uri: pendingImage }} style={styles.previewImage} resizeMode="cover" />
              <Pressable style={styles.previewClose} onPress={() => setPendingImage(null)}>
                <Text style={styles.previewCloseText}>✕</Text>
              </Pressable>
            </View>
          </View>
        )}
        {pendingImageRefs.length > 0 && !isCompactInput && (
          <View style={styles.referencePreviewRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.referencePreviewList}
            >
              {pendingImageRefs.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.referencePreviewWrap}>
                  <Image source={{ uri }} style={styles.referencePreviewImage} resizeMode="cover" />
                  <Pressable style={styles.previewClose} onPress={() => removeImageReference(uri)}>
                    <Text style={styles.previewCloseText}>x</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
        {isCompactInput ? (
          <View style={styles.compactRow}>
            <Pressable style={styles.optionsButton} onPress={() => setOptionsMenuVisible(true)}>
              <Image
                source={inputIconUris.options ? { uri: inputIconUris.options } : require('../../assets/optionsbutton.png')}
                style={styles.optionsImage}
                resizeMode="contain"
              />
            </Pressable>
            {pendingImage && (
              <View style={styles.compactPreviewWrap}>
                <Image source={{ uri: pendingImage }} style={styles.compactPreviewImage} resizeMode="cover" />
                <Pressable style={styles.compactPreviewClose} onPress={() => setPendingImage(null)}>
                  <Text style={styles.compactPreviewCloseText}>x</Text>
                </Pressable>
              </View>
            )}
            {pendingImageRefs.length > 0 && (
              <View style={styles.compactReferencePill}>
                <Text style={styles.compactReferenceText}>{pendingImageRefs.length} 参考图</Text>
                <Pressable onPress={() => setPendingImageRefs([])}>
                  <Text style={styles.compactReferenceClear}>x</Text>
                </Pressable>
              </View>
            )}
            <TextInput
              style={[styles.input, styles.compactInput, customCssStyles.inputText]}
              value={text}
              onChangeText={handleChangeText}
              onSubmitEditing={() => void handleSend(text)}
              placeholder="Reply to Claude..."
              placeholderTextColor={colors.textTertiary}
              multiline={false}
              submitBehavior="submit"
              returnKeyType="send"
              maxLength={10000}
              scrollEnabled={false}
              editable={!disabled}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
            />
            <View style={styles.rightButtons}>
              <Pressable style={styles.stickerButton} onPress={() => setStickerPickerVisible(true)}>
                <Image
                  source={inputIconUris.sticker ? { uri: inputIconUris.sticker } : require('../../assets/sticker.png')}
                  style={styles.stickerButtonImage}
                  resizeMode="contain"
                />
              </Pressable>
              <Pressable
                style={styles.sendButton}
                onPressIn={() => void handleGetResponsePressIn()}
                onPress={() => void handleGetResponsePress()}
              >
                <Image
                  source={getResponseIcon()}
                  style={[styles.sendImage, shouldInvertResponseIcon && styles.invertedImageIcon]}
                  resizeMode="contain"
                />
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <TextInput
              style={[styles.input, customCssStyles.inputText]}
              value={text}
              onChangeText={handleChangeText}
              onSubmitEditing={() => void handleSend(text)}
              placeholder="Reply to Claude..."
              placeholderTextColor={colors.textTertiary}
              multiline
              submitBehavior="submit"
              returnKeyType="send"
              maxLength={10000}
              scrollEnabled
              editable={!disabled}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
            />
            <View style={styles.toolbar}>
          <Pressable style={styles.optionsButton} onPress={() => setOptionsMenuVisible(true)}>
            <Image
              source={inputIconUris.options ? { uri: inputIconUris.options } : require('../../assets/optionsbutton.png')}
              style={styles.optionsImage}
              resizeMode="contain"
            />
          </Pressable>

          <Pressable style={styles.modelPill} onPress={onModelPress}>
            <Text style={styles.modelText} numberOfLines={1}>{currentModel}</Text>
          </Pressable>

          <View style={styles.rightButtons}>
            <Pressable style={styles.stickerButton} onPress={() => setStickerPickerVisible(true)}>
              <Image
                source={inputIconUris.sticker ? { uri: inputIconUris.sticker } : require('../../assets/sticker.png')}
                style={styles.stickerButtonImage}
                resizeMode="contain"
              />
            </Pressable>
            <Pressable
              style={styles.sendButton}
              onPressIn={() => void handleGetResponsePressIn()}
              onPress={() => void handleGetResponsePress()}
            >
              <Image
                source={getResponseIcon()}
                style={[styles.sendImage, shouldInvertResponseIcon && styles.invertedImageIcon]}
                resizeMode="contain"
              />
            </Pressable>
          </View>
            </View>
          </>
        )}
      </View>

      <Modal transparent visible={stickerPickerVisible} animationType="fade" onRequestClose={() => setStickerPickerVisible(false)}>
        <Pressable style={styles.stickerOverlay} onPress={() => setStickerPickerVisible(false)}>
          <View style={styles.stickerPanel} onStartShouldSetResponder={() => true}>
            <ScrollView
              style={styles.stickerScroll}
              contentContainerStyle={styles.stickerGrid}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              persistentScrollbar
            >
              {userStickers.length === 0 ? (
                <View style={styles.stickerEmpty}>
                  <Text style={styles.stickerEmptyText}>还没有自定义表情包</Text>
                  <Text style={styles.stickerEmptyHint}>到设置里的表情包页添加自己的表情包</Text>
                </View>
              ) : (
                userStickers.map((sticker) => (
                  <Pressable
                    key={sticker.id}
                    style={styles.stickerItem}
                    onPress={() => void handleSendSticker(sticker.token)}
                  >
                    <Image source={sticker.image} style={styles.stickerImage} resizeMode="contain" />
                    <Text style={styles.stickerName} numberOfLines={1}>{sticker.name}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal transparent visible={optionsMenuVisible} animationType="fade" onRequestClose={() => setOptionsMenuVisible(false)}>
        <Pressable style={styles.optionsOverlay} onPress={() => setOptionsMenuVisible(false)}>
          <View style={styles.optionsPanel} onStartShouldSetResponder={() => true}>
            <Pressable style={styles.optionItem} onPress={() => void handleEnableWebCruise()}>
              <Text style={styles.optionText}>AI网页巡游</Text>
            </Pressable>
            <View style={styles.optionDivider} />
            <Pressable
              style={[styles.optionItem, isPromptCacheKeepaliveRunning && styles.optionItemDisabled]}
              onPress={() => void handleKeepPromptCacheAlive()}
              disabled={!!isPromptCacheKeepaliveRunning}
            >
              <Text style={[styles.optionText, isPromptCacheKeepaliveRunning && styles.optionTextDisabled]}>
                {isPromptCacheKeepaliveRunning ? '缓存保活中...' : '缓存保活'}
              </Text>
            </Pressable>
            <View style={styles.optionDivider} />
            <Pressable style={styles.optionItem} onPress={handleOpenMcpPanel}>
              <Text style={styles.optionText}>MCP 管理</Text>
            </Pressable>
            <View style={styles.optionDivider} />
            <Pressable style={styles.optionItem} onPress={handleOpenFishingPanel}>
              <Text style={styles.optionText}>钓鱼面板</Text>
            </Pressable>
            <View style={styles.optionDivider} />
            <Pressable style={styles.optionItem} onPress={() => void pickImage()}>
              <Text style={styles.optionText}>图片</Text>
            </Pressable>
            <View style={styles.optionDivider} />
            <Pressable style={styles.optionItem} onPress={() => void pickImageReferences()}>
              <Text style={styles.optionText}>生图参考图</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal transparent visible={mcpPanelVisible} animationType="fade" onRequestClose={() => setMcpPanelVisible(false)}>
        <KeyboardAvoidingView
          style={styles.mcpKeyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Math.max(insets.bottom, 12)}
        >
          <View style={styles.mcpOverlay}>
            <Pressable style={styles.mcpBackdrop} onPress={() => setMcpPanelVisible(false)} />
            <View style={styles.mcpPanel}>
              <View style={styles.mcpHeader}>
                <View style={styles.mcpHeaderText}>
                  <Text style={styles.mcpTitle}>MCP 管理</Text>
                  <Text style={styles.mcpHint}>选择资源或提示词插入输入框；固定资源会自动附加到后续回复上下文。</Text>
                </View>
                <Pressable style={styles.mcpCloseButton} onPress={() => setMcpPanelVisible(false)}>
                  <Text style={styles.mcpCloseText}>关闭</Text>
                </Pressable>
              </View>

              {mcpServers.length === 0 ? (
                <View style={styles.mcpEmpty}>
                  <Text style={styles.mcpEmptyTitle}>尚未添加 MCP 服务</Text>
                  <Text style={styles.mcpEmptyHint}>到设置的工具设置页添加并同步远程 MCP 服务。</Text>
                </View>
              ) : (
                <View style={styles.mcpBody}>
                  <ScrollView
                    style={styles.mcpServerTabScroller}
                    horizontal
                    showsHorizontalScrollIndicator
                    persistentScrollbar
                    contentContainerStyle={styles.mcpServerTabs}
                  >
                    {mcpServers.map((server) => {
                      const active = selectedMcpServer?.id === server.id;
                      return (
                        <Pressable
                          key={server.id}
                          style={[styles.mcpServerTab, active && styles.mcpServerTabActive]}
                          onPress={() => setMcpSelectedServerId(server.id)}
                        >
                          <Text style={[styles.mcpServerTabText, active && styles.mcpServerTabTextActive]} numberOfLines={1}>
                            {server.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.mcpSegmented}>
                    {(['resources', 'prompts', 'tools'] as McpPanelTab[]).map((tab) => {
                      const label = tab === 'resources' ? 'Resources' : tab === 'prompts' ? 'Prompts' : 'Tools';
                      return (
                        <Pressable
                          key={tab}
                          style={[styles.mcpSegmentButton, mcpTab === tab && styles.mcpSegmentButtonActive]}
                          onPress={() => setMcpTab(tab)}
                        >
                          <Text style={[styles.mcpSegmentText, mcpTab === tab && styles.mcpSegmentTextActive]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <ScrollView
                    style={styles.mcpList}
                    contentContainerStyle={styles.mcpListContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator
                    persistentScrollbar
                  >
                    {!selectedMcpServer ? null : mcpTab === 'resources' ? (
                      (selectedMcpServer.resources || []).length === 0 ? (
                        <Text style={styles.mcpEmptyInline}>这个服务还没有同步 Resources。</Text>
                      ) : (
                        (selectedMcpServer.resources || []).map((resource) => {
                          const busyKey = `resource:${selectedMcpServer.id}:${resource.uri}`;
                          return (
                            <View key={resource.uri} style={styles.mcpItem}>
                              <View style={styles.mcpItemText}>
                                <Text style={styles.mcpItemTitle}>{resource.title || resource.name || resource.uri}</Text>
                                {!!resource.description && <Text style={styles.mcpItemDescription} numberOfLines={2}>{resource.description}</Text>}
                                <Text style={styles.mcpItemMeta} numberOfLines={1}>{resource.uri}</Text>
                                <Text style={styles.mcpItemStatus}>{resource.pinned ? '已固定到上下文' : '未固定'}</Text>
                              </View>
                              <View style={styles.mcpItemActions}>
                                <Pressable
                                  style={styles.mcpSmallButton}
                                  onPress={() => void handleInsertMcpResource(selectedMcpServer, resource)}
                                  disabled={mcpBusyKey === busyKey}
                                >
                                  <Text style={styles.mcpSmallButtonText}>{mcpBusyKey === busyKey ? '读取中' : '插入'}</Text>
                                </Pressable>
                                <Pressable
                                  style={[styles.mcpSmallButton, resource.pinned && styles.mcpSmallButtonActive]}
                                  onPress={() => handleToggleMcpResourcePinned(selectedMcpServer.id, resource.uri, !resource.pinned)}
                                >
                                  <Text style={[styles.mcpSmallButtonText, resource.pinned && styles.mcpSmallButtonTextActive]}>
                                    {resource.pinned ? '取消固定' : '固定'}
                                  </Text>
                                </Pressable>
                              </View>
                            </View>
                          );
                        })
                      )
                    ) : mcpTab === 'prompts' ? (
                      (selectedMcpServer.prompts || []).length === 0 ? (
                        <Text style={styles.mcpEmptyInline}>这个服务还没有同步 Prompts。</Text>
                      ) : (
                        (selectedMcpServer.prompts || []).map((prompt) => {
                          const key = `${selectedMcpServer.id}:${prompt.name}`;
                          const busyKey = `prompt:${key}`;
                          const argsText = mcpPromptArgs[key] ?? defaultPromptArgsText(prompt);
                          return (
                            <View key={prompt.name} style={styles.mcpPromptItem}>
                              <Text style={styles.mcpItemTitle}>{prompt.title || prompt.name}</Text>
                              {!!prompt.description && <Text style={styles.mcpItemDescription}>{prompt.description}</Text>}
                              {(prompt.arguments || []).length > 0 && (
                                <Text style={styles.mcpItemMeta}>
                                  参数：{(prompt.arguments || []).map((arg) => arg.required ? `${arg.name}*` : arg.name).join(', ')}
                                </Text>
                              )}
                              <TextInput
                                style={styles.mcpPromptArgsInput}
                                value={argsText}
                                onChangeText={(value) => setMcpPromptArgs((current) => ({ ...current, [key]: value }))}
                                multiline
                                textAlignVertical="top"
                                autoCapitalize="none"
                                placeholder="{}"
                                placeholderTextColor={colors.textTertiary}
                              />
                              <Pressable
                                style={styles.mcpPrimaryButton}
                                onPress={() => void handleApplyMcpPrompt(selectedMcpServer, prompt)}
                                disabled={mcpBusyKey === busyKey}
                              >
                                <Text style={styles.mcpPrimaryButtonText}>{mcpBusyKey === busyKey ? '应用中' : '应用到输入框'}</Text>
                              </Pressable>
                            </View>
                          );
                        })
                      )
                    ) : (
                      (selectedMcpServer.tools || []).length === 0 ? (
                        <Text style={styles.mcpEmptyInline}>这个服务还没有同步 Tools。</Text>
                      ) : (
                        (selectedMcpServer.tools || []).map((tool) => (
                          <View key={tool.name} style={styles.mcpItem}>
                            <View style={styles.mcpItemText}>
                              <Text style={styles.mcpItemTitle}>{tool.title || tool.name}</Text>
                              {!!tool.description && <Text style={styles.mcpItemDescription} numberOfLines={2}>{tool.description}</Text>}
                              <Text style={styles.mcpItemStatus}>{tool.enabled !== false ? 'AI 可自动调用' : '已关闭'}</Text>
                            </View>
                          </View>
                        ))
                      )
                    )}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  wrapper: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 4,
    backgroundColor: 'transparent',
  },
  container: {
    backgroundColor: colors.inputBackground,
    borderRadius: 24,
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  customContainer: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  glassContainer: {
    borderColor: 'rgba(255,255,255,0.38)',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  compactContainer: {
    minHeight: 52,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  compactRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  glassTopHighlight: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.70)',
  },
  glassInnerSheen: {
    position: 'absolute',
    left: 1,
    right: 1,
    top: 1,
    height: 32,
    borderTopLeftRadius: 23,
    borderTopRightRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  suggestionPanel: {
    minHeight: 84,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  suggestionList: {
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  suggestionItem: {
    width: 72,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 6,
  },
  suggestionImage: {
    width: 42,
    height: 42,
  },
  suggestionName: {
    width: '100%',
    marginTop: 3,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  previewRow: {
    marginBottom: 8,
  },
  previewWrap: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
  },
  previewImage: {
    width: 72,
    height: 72,
  },
  referencePreviewRow: {
    marginBottom: 8,
  },
  referencePreviewList: {
    gap: 8,
    paddingRight: 2,
  },
  referencePreviewWrap: {
    width: 58,
    height: 58,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
  },
  referencePreviewImage: {
    width: 58,
    height: 58,
  },
  previewClose: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCloseText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    fontSize: 16,
    color: colors.text,
    fontFamily: 'Sohne',
    maxHeight: 120,
    minHeight: 28,
    paddingVertical: 0,
  },
  compactInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    maxHeight: 36,
    paddingHorizontal: 6,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  optionsButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionsImage: {
    width: 28,
    height: 28,
  },
  modelPill: {
    backgroundColor: colors.surfaceHover,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 8,
    maxWidth: 180,
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
  },
  modelText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    width: '100%',
  },
  rightButtons: {
    flexDirection: 'row',
    marginLeft: 'auto',
    alignItems: 'center',
    gap: 8,
  },
  stickerButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickerButtonImage: {
    width: 30,
    height: 30,
  },
  sendButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendImage: {
    width: 30,
    height: 30,
  },
  compactPreviewWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
  },
  compactPreviewImage: {
    width: 34,
    height: 34,
  },
  compactPreviewClose: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.52)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactPreviewCloseText: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
  compactReferencePill: {
    height: 30,
    maxWidth: 96,
    borderRadius: 15,
    paddingLeft: 10,
    paddingRight: 8,
    backgroundColor: colors.surfaceHover,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactReferenceText: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  compactReferenceClear: {
    fontSize: 12,
    lineHeight: 14,
    color: colors.textTertiary,
    fontWeight: '700',
  },
  invertedImageIcon: {
    tintColor: colors.text,
  },
  stickerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  stickerPanel: {
    marginHorizontal: 12,
    marginBottom: 96,
    backgroundColor: colors.inputBackground,
    borderRadius: 20,
    padding: 12,
    height: STICKER_PANEL_HEIGHT,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  stickerScroll: {
    flex: 1,
  },
  stickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 4,
  },
  stickerEmpty: {
    width: '100%',
    minHeight: STICKER_PANEL_HEIGHT - 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  stickerEmptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  stickerEmptyHint: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  stickerItem: {
    width: '30%',
    minWidth: 86,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.surfaceHover,
  },
  stickerImage: {
    width: 64,
    height: 64,
  },
  stickerName: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
  },
  optionsOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  optionsPanel: {
    marginLeft: 18,
    marginBottom: 96,
    minWidth: 148,
    backgroundColor: colors.inputBackground,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  optionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionItemDisabled: {
    opacity: 0.55,
  },
  optionText: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  optionTextDisabled: {
    color: colors.textTertiary,
  },
  optionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.inputBorder,
    marginHorizontal: 10,
  },
  mcpOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  mcpBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  mcpPanel: {
    marginHorizontal: 12,
    marginBottom: 96,
    height: MCP_PANEL_HEIGHT,
    backgroundColor: colors.inputBackground,
    borderRadius: 20,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  mcpKeyboardAvoider: {
    flex: 1,
  },
  mcpHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  mcpHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  mcpTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  mcpHint: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  mcpCloseButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: colors.surfaceHover,
  },
  mcpCloseText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  mcpServerTabs: {
    gap: 8,
    paddingBottom: 4,
    paddingRight: 4,
    alignItems: 'center',
  },
  mcpServerTabScroller: {
    maxHeight: 38,
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 10,
  },
  mcpBody: {
    flex: 1,
    minHeight: 0,
  },
  mcpServerTab: {
    maxWidth: 120,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceHover,
    justifyContent: 'center',
  },
  mcpServerTabActive: {
    backgroundColor: colors.primaryLight,
  },
  mcpServerTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  mcpServerTabTextActive: {
    color: colors.primary,
  },
  mcpSegmented: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  mcpSegmentButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceHover,
  },
  mcpSegmentButtonActive: {
    backgroundColor: colors.primary,
  },
  mcpSegmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  mcpSegmentTextActive: {
    color: '#FFFFFF',
  },
  mcpList: {
    flex: 1,
    minHeight: 0,
  },
  mcpListContent: {
    gap: 10,
    paddingBottom: 12,
  },
  mcpItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mcpPromptItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mcpItemText: {
    flex: 1,
    minWidth: 0,
  },
  mcpItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  mcpItemDescription: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  mcpItemMeta: {
    marginTop: 5,
    fontSize: 11,
    color: colors.textTertiary,
  },
  mcpItemStatus: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  mcpItemActions: {
    flexShrink: 0,
    gap: 8,
  },
  mcpSmallButton: {
    minWidth: 72,
    minHeight: 32,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  mcpSmallButtonActive: {
    backgroundColor: colors.primary,
  },
  mcpSmallButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  mcpSmallButtonTextActive: {
    color: '#FFFFFF',
  },
  mcpPromptArgsInput: {
    minHeight: 72,
    marginTop: 8,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  mcpPrimaryButton: {
    minHeight: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  mcpPrimaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  mcpEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  mcpEmptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  mcpEmptyHint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  mcpEmptyInline: {
    paddingVertical: 28,
    textAlign: 'center',
    fontSize: 13,
    color: colors.textTertiary,
  },
});

let styles = createStyles(colors);
