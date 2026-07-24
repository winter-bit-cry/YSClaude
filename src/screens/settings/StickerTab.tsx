import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useSettingsPageColors } from '../../theme/colors';
import { type CustomSticker, type StickerOwner, useSettingsStore } from '../../stores/settings';
import { buildStickerDefinitions, normalizeStickerName } from '../../utils/stickers';
import { copyFileFromUri } from '../../utils/fileSystem';
import { createSettingsStyles } from './styles';
import { ButtonRow, SelectRow, SettingsGroup, SettingsRow, SwitchRow, TextEditRow, TextInputDialog } from './ui';

type StickerTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const CUSTOM_STICKER_MAX_BYTES = 5 * 1024 * 1024;
const CUSTOM_STICKER_MIN_SIDE = 32;
const CUSTOM_STICKER_MAX_SIDE = 4096;

function stickerImageExtension(asset: ImagePicker.ImagePickerAsset): string {
  const mimeType = asset.mimeType?.toLowerCase();
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';

  const cleanUri = asset.uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.png')) return '.png';
  if (cleanUri.endsWith('.webp')) return '.webp';
  if (cleanUri.endsWith('.gif')) return '.gif';
  if (cleanUri.endsWith('.jpeg')) return '.jpg';
  if (cleanUri.endsWith('.jpg')) return '.jpg';
  return '.png';
}

async function copyStickerImage(asset: ImagePicker.ImagePickerAsset, prefix: string): Promise<string> {
  const dir = new Directory(Paths.document, 'custom-stickers');
  dir.create({ intermediates: true, idempotent: true });

  const destination = new File(dir, `${prefix}-${randomUUID()}${stickerImageExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

function validateStickerAsset(asset: ImagePicker.ImagePickerAsset): string | null {
  if (asset.fileSize && asset.fileSize > CUSTOM_STICKER_MAX_BYTES) {
    return '图片不能超过 5MB';
  }
  if (
    asset.width < CUSTOM_STICKER_MIN_SIDE ||
    asset.height < CUSTOM_STICKER_MIN_SIDE
  ) {
    return `图片边长至少 ${CUSTOM_STICKER_MIN_SIDE}px`;
  }
  if (
    asset.width > CUSTOM_STICKER_MAX_SIDE ||
    asset.height > CUSTOM_STICKER_MAX_SIDE
  ) {
    return `图片边长不能超过 ${CUSTOM_STICKER_MAX_SIDE}px`;
  }
  return null;
}

function parseStickerImportLine(line: string): { name: string; uri: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(.+?)[\s:：]+(https?:\/\/\S+)$/i);
  if (!match) return null;
  const rawName = match[1]?.trim();
  const uri = match[2]?.trim();
  const name = normalizeStickerName(rawName);
  if (!name || !uri) return null;
  return { name, uri };
}

export function StickerTab({ showToast, keyboardBottomInset }: StickerTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const {
    stickerConfig,
    setAiStickersEnabled,
    setStickerSuggestionsEnabled,
    addSticker,
    updateSticker,
    removeSticker,
  } = useSettingsStore();
  const [stickerOwner, setStickerOwner] = useState<StickerOwner>('user');
  const [stickerName, setStickerName] = useState('');
  const [bulkImportText, setBulkImportText] = useState('');
  const [pickingSticker, setPickingSticker] = useState<string | null>(null);
  const [renamingSticker, setRenamingSticker] = useState<CustomSticker | null>(null);
  const userStickers = stickerConfig?.userStickers || [];
  const assistantStickers = stickerConfig?.assistantStickers || [];
  const aiStickersEnabled = stickerConfig?.aiStickersEnabled ?? true;
  const stickerSuggestionsEnabled = stickerConfig?.stickerSuggestionsEnabled ?? true;
  const currentStickers = stickerOwner === 'user' ? userStickers : assistantStickers;

  function getStickerList(owner: StickerOwner): CustomSticker[] {
    return owner === 'user' ? userStickers : assistantStickers;
  }

  function validateStickerName(owner: StickerOwner, name: string, ignoreId?: string): string | null {
    const normalizedName = normalizeStickerName(name);
    if (!normalizedName) return '请先填写表情包名称';
    const duplicated = getStickerList(owner).some(
      (sticker) => sticker.id !== ignoreId && normalizeStickerName(sticker.name) === normalizedName
    );
    if (duplicated) return '同一组里已经有这个名称了';
    return null;
  }

  async function pickStickerAsset(): Promise<ImagePicker.ImagePickerAsset | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]?.uri) return null;

    const asset = result.assets[0];
    const validationError = validateStickerAsset(asset);
    if (validationError) {
      Alert.alert('图片不适合作为表情包', validationError);
      return null;
    }
    return asset;
  }

  async function handleAddSticker() {
    const owner = stickerOwner;
    const normalizedName = normalizeStickerName(stickerName);
    const nameError = validateStickerName(owner, normalizedName);
    if (nameError) {
      Alert.alert('无法添加表情包', nameError);
      return;
    }

    setPickingSticker(`${owner}-new`);
    try {
      const asset = await pickStickerAsset();
      if (!asset) return;

      const uri = await copyStickerImage(asset, `${owner}-sticker`);
      addSticker(owner, {
        id: `sticker-${randomUUID()}`,
        name: normalizedName,
        uri,
        createdAt: Date.now(),
      });
      setStickerName('');
      showToast(owner === 'user' ? '我的表情包已添加' : 'AI 表情包已添加');
    } catch (error: any) {
      Alert.alert('添加表情包失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingSticker(null);
    }
  }

  async function handleReplaceStickerImage(owner: StickerOwner, sticker: CustomSticker) {
    if (pickingSticker) return;
    setPickingSticker(sticker.id);
    try {
      const asset = await pickStickerAsset();
      if (!asset) return;

      const uri = await copyStickerImage(asset, `${owner}-sticker`);
      updateSticker(owner, sticker.id, { uri });
      showToast('表情包图片已更新');
    } catch (error: any) {
      Alert.alert('替换表情包失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingSticker(null);
    }
  }

  function handleRenameStickerSave(owner: StickerOwner, sticker: CustomSticker, value: string) {
    const normalizedName = normalizeStickerName(value);
    const nameError = validateStickerName(owner, normalizedName, sticker.id);
    if (nameError) {
      Alert.alert('表情包名称不可用', nameError);
      return;
    }
    updateSticker(owner, sticker.id, { name: normalizedName });
    showToast('表情包名称已更新');
  }

  function handleRemoveSticker(owner: StickerOwner, sticker: CustomSticker) {
    Alert.alert('删除表情包', `确定删除「${sticker.name || '未命名'}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removeSticker(owner, sticker.id);
          showToast('表情包已删除');
        },
      },
    ]);
  }

  function handleBulkImport() {
    const owner = stickerOwner;
    const existingNames = new Set(getStickerList(owner).map((sticker) => normalizeStickerName(sticker.name)));
    const importedNames = new Set<string>();
    const parsed = bulkImportText
      .split(/\r?\n/)
      .map(parseStickerImportLine)
      .filter((item): item is { name: string; uri: string } => !!item);
    let importedCount = 0;
    let skippedCount = 0;

    parsed.forEach((item) => {
      if (existingNames.has(item.name) || importedNames.has(item.name)) {
        skippedCount += 1;
        return;
      }
      importedNames.add(item.name);
      addSticker(owner, {
        id: `sticker-${randomUUID()}`,
        name: item.name,
        uri: item.uri,
        createdAt: Date.now(),
      });
      importedCount += 1;
    });

    if (importedCount === 0) {
      Alert.alert('没有可导入的表情包', '请按“名称 链接”一行一个填写，名称和链接之间可用空格、中文冒号或英文冒号。');
      return;
    }

    setBulkImportText('');
    showToast(skippedCount > 0 ? `已导入 ${importedCount} 个，跳过 ${skippedCount} 个重名` : `已导入 ${importedCount} 个表情包`);
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <SettingsGroup
        header="表情包管理"
        footer="表情包全部由用户自定义添加；上传图片或批量导入链接后才会显示。"
      >
        <SwitchRow
          label="AI 使用表情包"
          sublabel="关闭后不再向 AI 的 Prompt 注入表情包使用说明"
          value={aiStickersEnabled}
          onValueChange={(value) => {
            setAiStickersEnabled(value);
            showToast(value ? 'AI 使用表情包已开启' : 'AI 使用表情包已关闭');
          }}
        />
        <SwitchRow
          label="输入时推荐表情包"
          sublabel="在聊天输入框上方显示和文字匹配的「我的表情包」"
          value={stickerSuggestionsEnabled}
          onValueChange={(value) => {
            setStickerSuggestionsEnabled(value);
            showToast(value ? '表情包推荐已开启' : '表情包推荐已关闭');
          }}
        />
        <SelectRow
          label="当前分组"
          options={[
            { value: 'user', label: `我的表情包（${userStickers.length}）` },
            { value: 'assistant', label: `AI 表情包（${assistantStickers.length}）` },
          ]}
          value={stickerOwner}
          onSelect={(value) => setStickerOwner(value as StickerOwner)}
        />
      </SettingsGroup>

      <SettingsGroup
        header="添加表情包"
        footer="批量导入格式：「名称 链接」一行一个，名称和链接之间可用空格、中文冒号或英文冒号。"
      >
        <TextEditRow
          label="表情包名称"
          value={stickerName}
          placeholder="未填写"
          dialogDescription="先填写名称，再点击「上传图片」选择图片"
          onSave={(value) => setStickerName(value)}
        />
        <ButtonRow
          label="上传图片"
          onPress={handleAddSticker}
          loading={pickingSticker === `${stickerOwner}-new`}
          disabled={pickingSticker !== null}
        />
        <TextEditRow
          label="链接批量导入"
          value={bulkImportText}
          placeholder="未填写"
          multiline
          inputPlaceholder={'好喜欢 https://example.com/a.png\n得逞：https://example.com/b.webp\n哭哭: https://example.com/c.jpg'}
          onSave={(value) => setBulkImportText(value)}
        />
        <ButtonRow label="导入链接" onPress={handleBulkImport} disabled={!bulkImportText.trim()} />
      </SettingsGroup>

      <SettingsGroup
        header="当前清单"
        footer={currentStickers.length === 0 ? '这一组已经没有表情包了。' : '点击名称可重命名。'}
      >
        {currentStickers.map((sticker) => {
          const isPicking = pickingSticker === sticker.id;
          const definition = buildStickerDefinitions([sticker])[0];
          return (
            <SettingsRow
              key={sticker.id}
              label={sticker.name || '未命名'}
              onPress={() => {
                setRenamingSticker(sticker);
              }}
              left={
                <View style={styles.customStickerPreview}>
                  {definition ? (
                    <Image source={definition.image} style={styles.customStickerImage} resizeMode="contain" />
                  ) : (
                    <Text style={styles.appearanceImagePlaceholder}>ST</Text>
                  )}
                </View>
              }
              right={
                <View style={styles.appearanceIconActions}>
                  <Pressable
                    style={[styles.smallActionButton, isPicking && styles.smallActionButtonDisabled]}
                    onPress={() => handleReplaceStickerImage(stickerOwner, sticker)}
                    disabled={pickingSticker !== null}
                  >
                    {isPicking ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>换图</Text>}
                  </Pressable>
                  <Pressable
                    style={styles.smallActionButton}
                    onPress={() => handleRemoveSticker(stickerOwner, sticker)}
                  >
                    <Text style={styles.smallActionText}>删除</Text>
                  </Pressable>
                </View>
              }
            />
          );
        })}
      </SettingsGroup>

      <TextInputDialog
        visible={!!renamingSticker}
        title="重命名表情包"
        initialValue={renamingSticker?.name || ''}
        placeholder="表情包名称"
        onCancel={() => setRenamingSticker(null)}
        onSave={(value) => {
          if (renamingSticker) {
            handleRenameStickerSave(stickerOwner, renamingSticker, value);
          }
          setRenamingSticker(null);
        }}
      />
    </ScrollView>
  );
}
