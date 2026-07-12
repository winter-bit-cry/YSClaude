import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useSettingsPageColors } from '../../theme/colors';
import { useSettingsStore } from '../../stores/settings';
import { syncTodayWidget } from '../../services/todayWidget';
import { copyFileFromUri } from '../../utils/fileSystem';
import { createSettingsStyles } from './styles';

type TodayWidgetTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const WIDGET_AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const WIDGET_AVATAR_MIN_SIDE = 64;
const WIDGET_AVATAR_MAX_SIDE = 4096;

function widgetAvatarExtension(asset: ImagePicker.ImagePickerAsset): string {
  const mimeType = asset.mimeType?.toLowerCase();
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/png') return '.png';
  const cleanUri = asset.uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.jpg') || cleanUri.endsWith('.jpeg')) return '.jpg';
  if (cleanUri.endsWith('.webp')) return '.webp';
  return '.png';
}

function validateWidgetAvatar(asset: ImagePicker.ImagePickerAsset): string | null {
  if (asset.fileSize && asset.fileSize > WIDGET_AVATAR_MAX_BYTES) return '图片不能超过 4MB';
  if (asset.width < WIDGET_AVATAR_MIN_SIDE || asset.height < WIDGET_AVATAR_MIN_SIDE) {
    return `图片边长至少 ${WIDGET_AVATAR_MIN_SIDE}px`;
  }
  if (asset.width > WIDGET_AVATAR_MAX_SIDE || asset.height > WIDGET_AVATAR_MAX_SIDE) {
    return `图片边长不能超过 ${WIDGET_AVATAR_MAX_SIDE}px`;
  }
  return null;
}

async function copyWidgetAvatar(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const dir = new Directory(Paths.document, 'today-widget');
  dir.create({ intermediates: true, idempotent: true });
  const destination = new File(dir, `avatar-${randomUUID()}${widgetAvatarExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

export function TodayWidgetTab({ showToast, keyboardBottomInset }: TodayWidgetTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const { todayWidgetConfig, appearanceConfig, setTodayWidgetConfig } = useSettingsStore();
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const effectiveAvatarUri = todayWidgetConfig.avatarUri || appearanceConfig?.userAvatarImageUri;
  const effectiveDisplayName = todayWidgetConfig.displayName || appearanceConfig?.userDisplayName || 'You';
  const effectiveHandle = todayWidgetConfig.handle || 'ysclaude';

  async function pickAvatar() {
    if (pickingAvatar) return;
    setPickingAvatar(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]?.uri) return;

      const asset = result.assets[0];
      const validationError = validateWidgetAvatar(asset);
      if (validationError) {
        Alert.alert('图片不适合作为小组件头像', validationError);
        return;
      }

      const uri = await copyWidgetAvatar(asset);
      setTodayWidgetConfig({ avatarUri: uri });
      await syncTodayWidget();
      showToast('小组件头像已更新');
    } catch (error: any) {
      Alert.alert('选择头像失败', error?.message || '无法读取所选图片');
    } finally {
      setPickingAvatar(false);
    }
  }

  async function syncWidget() {
    setSyncing(true);
    try {
      await syncTodayWidget();
      showToast('小组件已同步');
    } catch (error: any) {
      Alert.alert('同步失败', error?.message || '请重新安装包含小组件的 Android 包');
    } finally {
      setSyncing(false);
    }
  }

  function updateConfig(patch: Parameters<typeof setTodayWidgetConfig>[0]) {
    setTodayWidgetConfig(patch);
    setTimeout(() => syncTodayWidget().catch(() => undefined), 0);
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>Android 小组件</Text>
      <Text style={styles.hint}>桌面小组件会显示今天的应用内待办，主题颜色跟随系统日夜间。</Text>

      <View style={styles.appearanceAssetRow}>
        <View style={[styles.appearanceImagePreview, { borderRadius: 29 }]}>
          {effectiveAvatarUri ? (
            <Image source={{ uri: effectiveAvatarUri }} style={styles.appearanceImageThumb} resizeMode="cover" />
          ) : (
            <Text style={styles.appearanceImagePlaceholder}>YS</Text>
          )}
        </View>
        <View style={styles.appearanceIconText}>
          <Text style={styles.label}>头像</Text>
          <Text style={styles.hint}>{todayWidgetConfig.avatarUri ? '已使用小组件专属头像' : '默认跟随聊天用户头像'}</Text>
        </View>
        <View style={styles.appearanceIconActions}>
          <Pressable
            style={[styles.smallActionButton, pickingAvatar && styles.smallActionButtonDisabled]}
            onPress={pickAvatar}
            disabled={pickingAvatar}
          >
            {pickingAvatar ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.smallActionText}>替换</Text>}
          </Pressable>
          <Pressable
            style={[styles.smallActionButton, !todayWidgetConfig.avatarUri && styles.smallActionButtonDisabled]}
            onPress={() => updateConfig({ avatarUri: undefined })}
            disabled={!todayWidgetConfig.avatarUri}
          >
            <Text style={[styles.smallActionText, !todayWidgetConfig.avatarUri && styles.smallActionTextDisabled]}>默认</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>显示名</Text>
        <TextInput
          style={styles.input}
          value={todayWidgetConfig.displayName}
          onChangeText={(value) => updateConfig({ displayName: value })}
          placeholder={effectiveDisplayName}
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Handle</Text>
        <TextInput
          style={styles.input}
          value={todayWidgetConfig.handle}
          onChangeText={(value) => updateConfig({ handle: value })}
          placeholder={effectiveHandle}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>4x4 签名</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={todayWidgetConfig.quote}
          onChangeText={(value) => updateConfig({ quote: value })}
          placeholder="One thing at a time."
          placeholderTextColor={colors.textTertiary}
          multiline
        />
      </View>

      <View style={styles.previewBox}>
        <Text style={styles.previewHint}>预览数据</Text>
        <View style={styles.previewItem}>
          <Text style={styles.previewLabel}>{effectiveDisplayName} @{effectiveHandle.replace(/^@+/, '')}</Text>
          <Text style={styles.previewText}>中间列表会自动读取今天在「日历」里创建的待办。</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={[styles.saveButton, syncing && styles.importButtonDisabled]} onPress={syncWidget} disabled={syncing}>
          {syncing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.saveButtonText}>立即同步小组件</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}
