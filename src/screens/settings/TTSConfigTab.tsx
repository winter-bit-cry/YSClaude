import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSettingsPageColors } from '../../theme/colors';
import { type STTProvider, type TTSConfig, type TTSProvider, useSettingsStore } from '../../stores/settings';
import { getTTSConfigMissingMessage, isTTSConfigReady, playTTS } from '../../services/tts';
import { createSettingsStyles } from './styles';

type TTSConfigTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const TTS_PROVIDERS: Array<{ key: TTSProvider; label: string }> = [
  { key: 'minimax', label: 'MiniMax' },
  { key: 'fish', label: 'Fish Audio' },
];
const FISH_TTS_MODELS = ['s2-pro', 's1'];
const FISH_TTS_FORMATS: Array<TTSConfig['fishFormat']> = ['mp3', 'wav', 'pcm'];
const STT_PROVIDERS: Array<{ key: STTProvider; label: string }> = [
  { key: 'openai', label: 'OpenAI Whisper' },
  { key: 'fish', label: 'Fish Audio' },
  { key: 'deepgram', label: 'Deepgram' },
];
type VoiceModelTarget = 'tts-minimax' | 'tts-fish' | 'stt-openai' | 'stt-deepgram';

export function TTSConfigTab({ showToast, keyboardBottomInset }: TTSConfigTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const { apiConfigs, activeConfigIndex, ttsConfig, sttConfig, setTTSConfig, setSTTConfig } = useSettingsStore();
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>(ttsConfig.provider);
  const [groupId, setGroupId] = useState(ttsConfig.groupId);
  const [apiKey, setApiKey] = useState(ttsConfig.apiKey);
  const [model, setModel] = useState(ttsConfig.model);
  const [voiceId, setVoiceId] = useState(ttsConfig.voiceId);
  const [speed, setSpeed] = useState(String(ttsConfig.speed));
  const [vol, setVol] = useState(String(ttsConfig.vol));
  const [pitch, setPitch] = useState(String(ttsConfig.pitch));
  const [ttsFishBaseUrl, setTtsFishBaseUrl] = useState(ttsConfig.fishBaseUrl);
  const [ttsFishApiKey, setTtsFishApiKey] = useState(ttsConfig.fishApiKey);
  const [ttsFishReferenceId, setTtsFishReferenceId] = useState(ttsConfig.fishReferenceId);
  const [ttsFishModel, setTtsFishModel] = useState(ttsConfig.fishModel);
  const [ttsFishFormat, setTtsFishFormat] = useState<TTSConfig['fishFormat']>(ttsConfig.fishFormat);
  const [ttsFishSpeed, setTtsFishSpeed] = useState(String(ttsConfig.fishSpeed));
  const [ttsFishVolume, setTtsFishVolume] = useState(String(ttsConfig.fishVolume));
  const [sttProvider, setSttProvider] = useState<STTProvider>(sttConfig.provider);
  const [openAiBaseUrl, setOpenAiBaseUrl] = useState(sttConfig.openAiBaseUrl);
  const [openAiApiKey, setOpenAiApiKey] = useState(sttConfig.openAiApiKey);
  const [openAiModel, setOpenAiModel] = useState(sttConfig.openAiModel);
  const [sttFishBaseUrl, setSttFishBaseUrl] = useState(sttConfig.fishBaseUrl);
  const [sttFishApiKey, setSttFishApiKey] = useState(sttConfig.fishApiKey);
  const [sttFishLanguage, setSttFishLanguage] = useState(sttConfig.fishLanguage);
  const [sttFishIgnoreTimestamps, setSttFishIgnoreTimestamps] = useState(sttConfig.fishIgnoreTimestamps);
  const [deepgramBaseUrl, setDeepgramBaseUrl] = useState(sttConfig.deepgramBaseUrl);
  const [deepgramApiKey, setDeepgramApiKey] = useState(sttConfig.deepgramApiKey);
  const [deepgramModel, setDeepgramModel] = useState(sttConfig.deepgramModel);
  const [deepgramLanguage, setDeepgramLanguage] = useState(sttConfig.deepgramLanguage);
  const [testing, setTesting] = useState(false);
  const [voiceModels, setVoiceModels] = useState<string[]>([]);
  const [voiceModelTarget, setVoiceModelTarget] = useState<VoiceModelTarget>('tts-minimax');
  const [showVoiceModelPicker, setShowVoiceModelPicker] = useState(false);
  const [fetchingModelTarget, setFetchingModelTarget] = useState<VoiceModelTarget | null>(null);

  function handleSave() {
    setTTSConfig({
      provider: ttsProvider,
      groupId: groupId.trim(),
      apiKey: apiKey.trim(),
      model: model.trim() || 'speech-02-hd',
      voiceId: voiceId.trim(),
      speed: parseFloat(speed) || 1,
      vol: parseFloat(vol) || 1,
      pitch: parseFloat(pitch) || 0,
      fishBaseUrl: ttsFishBaseUrl.trim() || 'https://api.fish.audio',
      fishApiKey: ttsFishApiKey.trim(),
      fishReferenceId: ttsFishReferenceId.trim(),
      fishModel: ttsFishModel.trim() || 's2-pro',
      fishFormat: ttsFishFormat,
      fishSpeed: parseFloat(ttsFishSpeed) || 1,
      fishVolume: Number.isFinite(parseFloat(ttsFishVolume)) ? parseFloat(ttsFishVolume) : 0,
    });
    setSTTConfig({
      provider: sttProvider,
      openAiBaseUrl: openAiBaseUrl.trim(),
      openAiApiKey: openAiApiKey.trim(),
      openAiModel: openAiModel.trim() || 'whisper-1',
      fishBaseUrl: sttFishBaseUrl.trim() || 'https://api.fish.audio',
      fishApiKey: sttFishApiKey.trim(),
      fishLanguage: sttFishLanguage.trim() || 'zh',
      fishIgnoreTimestamps: sttFishIgnoreTimestamps,
      deepgramBaseUrl: deepgramBaseUrl.trim() || 'https://api.deepgram.com/v1',
      deepgramApiKey: deepgramApiKey.trim(),
      deepgramModel: deepgramModel.trim() || 'nova-3',
      deepgramLanguage: deepgramLanguage.trim(),
    });
    showToast('语音配置已保存');
  }

  function getCurrentVoiceModel(target: VoiceModelTarget): string {
    switch (target) {
      case 'tts-minimax':
        return model;
      case 'tts-fish':
        return ttsFishModel;
      case 'stt-openai':
        return openAiModel;
      case 'stt-deepgram':
        return deepgramModel;
      default:
        return '';
    }
  }

  function getVoiceModelPickerTitle(target: VoiceModelTarget): string {
    switch (target) {
      case 'tts-minimax':
        return '选择 MiniMax TTS 模型';
      case 'tts-fish':
        return '选择 Fish Audio TTS 模型';
      case 'stt-openai':
        return '选择 OpenAI STT 模型';
      case 'stt-deepgram':
        return '选择 Deepgram STT 模型';
      default:
        return '选择模型';
    }
  }

  function handleSelectVoiceModel(item: string) {
    switch (voiceModelTarget) {
      case 'tts-minimax':
        setModel(item);
        break;
      case 'tts-fish':
        setTtsFishModel(item);
        break;
      case 'stt-openai':
        setOpenAiModel(item);
        break;
      case 'stt-deepgram':
        setDeepgramModel(item);
        break;
    }
    setShowVoiceModelPicker(false);
  }

  async function handleFetchVoiceModels(target: VoiceModelTarget) {
    setFetchingModelTarget(target);
    try {
      const ids = await fetchVoiceModels(target);
      if (ids.length === 0) {
        Alert.alert('提示', '未获取到模型列表');
        return;
      }
      setVoiceModels(ids);
      setVoiceModelTarget(target);
      setShowVoiceModelPicker(true);
    } catch (e: any) {
      Alert.alert('获取失败', e?.message || '无法获取模型列表');
    } finally {
      setFetchingModelTarget(null);
    }
  }

  async function fetchVoiceModels(target: VoiceModelTarget): Promise<string[]> {
    if (target === 'tts-minimax') {
      if (!apiKey.trim()) {
        throw new Error('请先填写 MiniMax API Key');
      }
      const data = await fetchFirstJson(
        ['https://api.minimax.chat/v1/models', 'https://api.minimax.io/v1/models'],
        { Authorization: `Bearer ${apiKey.trim()}` }
      );
      const ids = extractModelIds(data).filter((id) => /speech|audio|tts|t2a/i.test(id));
      return ids.length > 0 ? ids : extractModelIds(data);
    }

    if (target === 'tts-fish') {
      const baseUrl = (ttsFishBaseUrl.trim() || 'https://api.fish.audio').replace(/\/$/, '');
      const data = await fetchJson(`${baseUrl}/openapi.json`, optionalBearerHeaders(ttsFishApiKey));
      const ids = extractFishTTSModelIds(data);
      return ids.length > 0 ? ids : [...FISH_TTS_MODELS];
    }

    if (target === 'stt-openai') {
      const activeConfig = apiConfigs[activeConfigIndex];
      const baseUrl = openAiBaseUrl.trim() || activeConfig?.baseUrl?.trim() || '';
      const key = openAiApiKey.trim() || activeConfig?.apiKey?.trim() || '';
      if (!baseUrl || !key) {
        throw new Error('请先填写 OpenAI STT Base URL 和 API Key，或配置主聊天 API');
      }
      const data = await fetchJson(`${baseUrl.replace(/\/$/, '')}/models`, {
        Authorization: `Bearer ${key}`,
      });
      const ids = extractModelIds(data).filter((id) => /whisper|transcribe|audio/i.test(id));
      return ids.length > 0 ? ids : extractModelIds(data);
    }

    const baseUrl = deepgramBaseUrl.trim() || 'https://api.deepgram.com/v1';
    if (!deepgramApiKey.trim()) {
      throw new Error('请先填写 Deepgram API Key');
    }
    const data = await fetchJson(buildDeepgramModelsUrl(baseUrl), {
      Authorization: `Token ${deepgramApiKey.trim()}`,
    });
    return extractDeepgramSTTModelIds(data);
  }

  async function handleTest() {
    const testConfig: TTSConfig = {
        provider: ttsProvider,
        groupId: groupId.trim(),
        apiKey: apiKey.trim(),
        model: model.trim() || 'speech-02-hd',
        voiceId: voiceId.trim(),
        speed: parseFloat(speed) || 1,
        vol: parseFloat(vol) || 1,
        pitch: parseFloat(pitch) || 0,
        fishBaseUrl: ttsFishBaseUrl.trim() || 'https://api.fish.audio',
        fishApiKey: ttsFishApiKey.trim(),
        fishReferenceId: ttsFishReferenceId.trim(),
        fishModel: ttsFishModel.trim() || 's2-pro',
        fishFormat: ttsFishFormat,
        fishSpeed: parseFloat(ttsFishSpeed) || 1,
        fishVolume: Number.isFinite(parseFloat(ttsFishVolume)) ? parseFloat(ttsFishVolume) : 0,
    };
    if (!isTTSConfigReady(testConfig)) {
      Alert.alert('提示', getTTSConfigMissingMessage(testConfig));
      return;
    }
    setTesting(true);
    try {
      await playTTS('你好，这是一段语音合成测试。', testConfig);
      showToast('TTS 配置有效');
    } catch (e: any) {
      Alert.alert('播放失败', e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>TTS 语音合成</Text>
      <Text style={styles.hint}>用于朗读 AI 回复、悬浮球气泡和电台语音。</Text>

      <View style={styles.field}>
        <Text style={styles.label}>服务商</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
          {TTS_PROVIDERS.map((provider) => (
            <Pressable
              key={provider.key}
              style={[styles.configChip, provider.key === ttsProvider && styles.configChipActive]}
              onPress={() => setTtsProvider(provider.key)}
            >
              <Text style={[styles.configChipText, provider.key === ttsProvider && styles.configChipTextActive]}>
                {provider.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {ttsProvider === 'minimax' ? (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>Group ID</Text>
            <TextInput
              style={styles.input}
              value={groupId}
              onChangeText={setGroupId}
              placeholder="MiniMax Group ID"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>API Key</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="MiniMax API Key"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Voice ID</Text>
            <TextInput
              style={styles.input}
              value={voiceId}
              onChangeText={setVoiceId}
              placeholder="例如：male-qn-qingse"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>模型</Text>
            <View style={styles.modelRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={model}
                onChangeText={setModel}
                placeholder="speech-02-hd"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
              />
              <Pressable
                style={styles.fetchButton}
                onPress={() => handleFetchVoiceModels('tts-minimax')}
                disabled={fetchingModelTarget !== null}
              >
                {fetchingModelTarget === 'tts-minimax'
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <Text style={styles.fetchButtonText}>拉取</Text>}
              </Pressable>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>语速（0.5 ~ 2.0）</Text>
            <TextInput
              style={styles.input}
              value={speed}
              onChangeText={setSpeed}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>音量（0.1 ~ 10）</Text>
            <TextInput
              style={styles.input}
              value={vol}
              onChangeText={setVol}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>音调（-12 ~ 12）</Text>
            <TextInput
              style={styles.input}
              value={pitch}
              onChangeText={setPitch}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </>
      ) : (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>Fish Audio Base URL</Text>
            <TextInput
              style={styles.input}
              value={ttsFishBaseUrl}
              onChangeText={setTtsFishBaseUrl}
              placeholder="https://api.fish.audio"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Fish Audio API Key</Text>
            <TextInput
              style={styles.input}
              value={ttsFishApiKey}
              onChangeText={setTtsFishApiKey}
              placeholder="Fish Audio API Key"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Reference ID</Text>
            <TextInput
              style={styles.input}
              value={ttsFishReferenceId}
              onChangeText={setTtsFishReferenceId}
              placeholder="Fish Audio voice reference id"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>模型</Text>
            <View style={styles.modelRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={ttsFishModel}
                onChangeText={setTtsFishModel}
                placeholder="s2-pro"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
              />
              <Pressable
                style={styles.fetchButton}
                onPress={() => handleFetchVoiceModels('tts-fish')}
                disabled={fetchingModelTarget !== null}
              >
                {fetchingModelTarget === 'tts-fish'
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <Text style={styles.fetchButtonText}>拉取</Text>}
              </Pressable>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>音频格式</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
              {FISH_TTS_FORMATS.map((item) => (
                <Pressable
                  key={item}
                  style={[styles.configChip, item === ttsFishFormat && styles.configChipActive]}
                  onPress={() => setTtsFishFormat(item)}
                >
                  <Text style={[styles.configChipText, item === ttsFishFormat && styles.configChipTextActive]}>{item}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>语速</Text>
            <TextInput
              style={styles.input}
              value={ttsFishSpeed}
              onChangeText={setTtsFishSpeed}
              keyboardType="decimal-pad"
              placeholder="1"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>音量</Text>
            <TextInput
              style={styles.input}
              value={ttsFishVolume}
              onChangeText={setTtsFishVolume}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </>
      )}

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试播放</Text>}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>STT 语音转文字</Text>
      <Text style={styles.hint}>长按语音按键发送语音。</Text>

      <View style={styles.field}>
        <Text style={styles.label}>服务商</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
          {STT_PROVIDERS.map((provider) => (
            <Pressable
              key={provider.key}
              style={[styles.configChip, provider.key === sttProvider && styles.configChipActive]}
              onPress={() => setSttProvider(provider.key)}
            >
              <Text style={[styles.configChipText, provider.key === sttProvider && styles.configChipTextActive]}>
                {provider.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {sttProvider === 'openai' ? (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>OpenAI Base URL</Text>
            <TextInput
              style={styles.input}
              value={openAiBaseUrl}
              onChangeText={setOpenAiBaseUrl}
              placeholder="留空则使用主聊天 API Base URL"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>OpenAI API Key</Text>
            <TextInput
              style={styles.input}
              value={openAiApiKey}
              onChangeText={setOpenAiApiKey}
              placeholder="留空则使用主聊天 API Key"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>OpenAI STT 模型</Text>
            <View style={styles.modelRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={openAiModel}
                onChangeText={setOpenAiModel}
                placeholder="whisper-1"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
              />
              <Pressable
                style={styles.fetchButton}
                onPress={() => handleFetchVoiceModels('stt-openai')}
                disabled={fetchingModelTarget !== null}
              >
                {fetchingModelTarget === 'stt-openai'
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <Text style={styles.fetchButtonText}>拉取</Text>}
              </Pressable>
            </View>
          </View>
        </>
      ) : sttProvider === 'fish' ? (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>Fish Audio Base URL</Text>
            <TextInput
              style={styles.input}
              value={sttFishBaseUrl}
              onChangeText={setSttFishBaseUrl}
              placeholder="https://api.fish.audio"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Fish Audio API Key</Text>
            <TextInput
              style={styles.input}
              value={sttFishApiKey}
              onChangeText={setSttFishApiKey}
              placeholder="Fish Audio API Key"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>语言</Text>
            <TextInput
              style={styles.input}
              value={sttFishLanguage}
              onChangeText={setSttFishLanguage}
              placeholder="zh"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>时间戳</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
              <Pressable
                style={[styles.configChip, sttFishIgnoreTimestamps && styles.configChipActive]}
                onPress={() => setSttFishIgnoreTimestamps(true)}
              >
                <Text style={[styles.configChipText, sttFishIgnoreTimestamps && styles.configChipTextActive]}>忽略时间戳</Text>
              </Pressable>
              <Pressable
                style={[styles.configChip, !sttFishIgnoreTimestamps && styles.configChipActive]}
                onPress={() => setSttFishIgnoreTimestamps(false)}
              >
                <Text style={[styles.configChipText, !sttFishIgnoreTimestamps && styles.configChipTextActive]}>返回分段</Text>
              </Pressable>
            </ScrollView>
          </View>
        </>
      ) : (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>Deepgram Base URL</Text>
            <TextInput
              style={styles.input}
              value={deepgramBaseUrl}
              onChangeText={setDeepgramBaseUrl}
              placeholder="https://api.deepgram.com/v1"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Deepgram API Key</Text>
            <TextInput
              style={styles.input}
              value={deepgramApiKey}
              onChangeText={setDeepgramApiKey}
              placeholder="Deepgram API Key"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Deepgram 模型</Text>
            <View style={styles.modelRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={deepgramModel}
                onChangeText={setDeepgramModel}
                placeholder="nova-3"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
              />
              <Pressable
                style={styles.fetchButton}
                onPress={() => handleFetchVoiceModels('stt-deepgram')}
                disabled={fetchingModelTarget !== null}
              >
                {fetchingModelTarget === 'stt-deepgram'
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <Text style={styles.fetchButtonText}>拉取</Text>}
              </Pressable>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>语言（可选）</Text>
            <TextInput
              style={styles.input}
              value={deepgramLanguage}
              onChangeText={setDeepgramLanguage}
              placeholder="例如 zh / en，留空自动识别"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
          </View>
        </>
      )}

      <View style={styles.actions}>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>保存语音配置</Text>
        </Pressable>
      </View>

      <Modal visible={showVoiceModelPicker} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowVoiceModelPicker(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{getVoiceModelPickerTitle(voiceModelTarget)}</Text>
            <FlatList
              data={voiceModels}
              keyExtractor={(item) => item}
              style={styles.modelList}
              renderItem={({ item }) => {
                const active = item === getCurrentVoiceModel(voiceModelTarget);
                return (
                  <Pressable
                    style={[styles.modelItem, active && styles.modelItemActive]}
                    onPress={() => handleSelectVoiceModel(item)}
                  >
                    <Text style={[styles.modelItemText, active && styles.modelItemTextActive]}>{item}</Text>
                  </Pressable>
                );
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

async function fetchFirstJson(urls: string[], headers: Record<string, string>): Promise<any> {
  let lastError: any;
  for (const url of urls) {
    try {
      return await fetchJson(url, headers);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('无法获取模型列表');
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<any> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  }
  return response.json();
}

function optionalBearerHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function extractModelIds(data: any): string[] {
  const rawItems = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : [];
  const ids: string[] = rawItems
    .map((item: any) => {
      if (typeof item === 'string') return item;
      return item?.id || item?.model || item?.name || item?.canonical_name || '';
    })
    .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id: string) => id.trim());
  return uniqueSorted(ids);
}

function extractFishTTSModelIds(data: any): string[] {
  const enums: string[] = [];
  collectStringEnums(data, enums);
  return uniqueSorted(enums.filter((item) => /^s\d/i.test(item) || item.includes('speech')));
}

function collectStringEnums(value: any, output: string[]) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectStringEnums(item, output));
    return;
  }
  if (Array.isArray(value.enum)) {
    value.enum.forEach((item: unknown) => {
      if (typeof item === 'string') output.push(item);
    });
  }
  Object.values(value).forEach((item) => collectStringEnums(item, output));
}

function buildDeepgramModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim() || 'https://api.deepgram.com/v1');
  const path = url.pathname.replace(/\/$/, '');
  if (!path || path === '/') {
    url.pathname = '/v1/models';
  } else if (path.endsWith('/models')) {
    url.pathname = path;
  } else if (path.endsWith('/listen')) {
    url.pathname = `${path.slice(0, -'/listen'.length)}/models`;
  } else {
    url.pathname = `${path}/models`;
  }
  url.search = '';
  return url.toString();
}

function extractDeepgramSTTModelIds(data: any): string[] {
  const candidates = Array.isArray(data?.stt)
    ? data.stt
    : Array.isArray(data?.speech_to_text)
      ? data.speech_to_text
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.models)
          ? data.models
          : [];
  const ids: string[] = candidates
    .flatMap((item: any) => {
      if (typeof item === 'string') return [item];
      return [
        item?.architecture,
        item?.canonical_name,
        item?.id,
        item?.model,
      ];
    })
    .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id: string) => id.trim())
    .filter((id: string) => !/^aura/i.test(id));
  return uniqueSorted(ids);
}

function uniqueSorted(items: string[]): string[] {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}
