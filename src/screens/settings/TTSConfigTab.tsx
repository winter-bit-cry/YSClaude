import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSettingsPageColors } from '../../theme/colors';
import {
  type STTProvider,
  type TTSConfig,
  type TTSProvider,
  type VoiceCallEngine,
  useSettingsStore,
} from '../../stores/settings';
import { getTTSConfigMissingMessage, isTTSConfigReady, playTTS } from '../../services/tts';
import {
  ButtonRow,
  SelectRow,
  SettingsGroup,
  SettingsRow,
  SwitchRow,
  TextEditRow,
} from './ui';

type TTSConfigTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

const TTS_PROVIDERS: Array<{ value: TTSProvider; label: string }> = [
  { value: 'minimax', label: 'MiniMax' },
  { value: 'fish', label: 'Fish Audio' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'cartesia', label: 'Cartesia' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
];

const STT_PROVIDERS: Array<{ value: STTProvider; label: string }> = [
  { value: 'openai', label: 'OpenAI Whisper' },
  { value: 'fish', label: 'Fish Audio' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'aliyun', label: 'Aliyun' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
];

const CALL_ENGINES: Array<{ value: VoiceCallEngine; label: string; sublabel: string }> = [
  { value: 'livekit', label: 'LiveKit Agents', sublabel: '阿里 STT + 聊天 LLM + Cartesia TTS' },
  { value: 'elevenlabs', label: 'ElevenLabs', sublabel: 'ElevenLabs Conversational AI' },
];

const MINIMAX_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo',
].map((value) => ({ value, label: value }));

const FISH_MODELS = ['s2-pro', 's1'].map((value) => ({ value, label: value }));
const CARTESIA_MODELS = ['sonic-3.5', 'sonic-3', 'sonic-latest'].map((value) => ({ value, label: value }));
const FISH_FORMATS = ['mp3', 'wav', 'pcm'].map((value) => ({ value, label: value.toUpperCase() }));

function positiveNumber(text: string): string | null {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? null : '请输入有效的正数';
}

function rangedNumber(min: number, max: number) {
  return (text: string): string | null => {
    const value = Number(text);
    return Number.isFinite(value) && value >= min && value <= max
      ? null
      : `请输入 ${min} 到 ${max} 之间的数字`;
  };
}

export function TTSConfigTab({ showToast, keyboardBottomInset }: TTSConfigTabProps) {
  const colors = useSettingsPageColors();
  const {
    apiConfigs,
    activeConfigIndex,
    ttsConfig,
    sttConfig,
    voiceCallTTSProvider,
    voiceCallSTTProvider,
    voiceCallEngine,
    liveKitVoiceCallConfig,
    voiceCallBackgroundImageUri,
    setTTSConfig,
    setSTTConfig,
    setVoiceCallTTSProvider,
    setVoiceCallSTTProvider,
    setVoiceCallEngine,
    setLiveKitVoiceCallConfig,
    setVoiceCallBackgroundImageUri,
  } = useSettingsStore();

  const [editingTTSProvider, setEditingTTSProvider] = useState<TTSProvider>(ttsConfig.provider);
  const [editingSTTProvider, setEditingSTTProvider] = useState<STTProvider>(sttConfig.provider);
  const [testing, setTesting] = useState(false);
  const [pickingBackground, setPickingBackground] = useState(false);

  const patchTTS = (patch: Partial<TTSConfig>) => setTTSConfig(patch);
  const activeApi = apiConfigs[activeConfigIndex];

  async function pickCallBackground() {
    if (pickingBackground) return;
    setPickingBackground(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (!result.canceled) {
        setVoiceCallBackgroundImageUri(result.assets[0].uri);
        showToast('视频通话背景已保存');
      }
    } finally {
      setPickingBackground(false);
    }
  }

  async function handleTest() {
    const config = { ...ttsConfig, provider: editingTTSProvider };
    if (!isTTSConfigReady(config)) {
      Alert.alert('提示', getTTSConfigMissingMessage(config));
      return;
    }
    setTesting(true);
    try {
      await playTTS('你好，这是一段语音合成测试。', config);
      showToast('TTS 配置有效');
    } catch (error: any) {
      Alert.alert('播放失败', error?.message || 'TTS 测试失败');
    } finally {
      setTesting(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: keyboardBottomInset + 20,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <SettingsGroup
        header="使用场景"
        footer="服务商参数统一维护；聊天和实时通话可以分别选择使用的 STT/TTS 服务。"
      >
        <SelectRow
          label="聊天 TTS"
          options={TTS_PROVIDERS.filter(({ value }) => value !== 'elevenlabs')}
          value={ttsConfig.provider}
          onSelect={(value) => setTTSConfig({ provider: value as TTSProvider })}
        />
        <SelectRow
          label="聊天 STT"
          options={STT_PROVIDERS.filter(({ value }) => value !== 'elevenlabs')}
          value={sttConfig.provider}
          onSelect={(value) => setSTTConfig({ provider: value as STTProvider })}
        />
        <SelectRow
          label="通话引擎"
          options={CALL_ENGINES}
          value={voiceCallEngine}
          onSelect={(value) => setVoiceCallEngine(value as VoiceCallEngine)}
        />
        <SelectRow
          label="通话 TTS"
          options={TTS_PROVIDERS.filter(({ value }) => ['minimax', 'cartesia', 'elevenlabs'].includes(value))}
          value={voiceCallTTSProvider}
          onSelect={(value) => setVoiceCallTTSProvider(value as TTSProvider)}
        />
        <SelectRow
          label="通话 STT"
          options={STT_PROVIDERS.filter(({ value }) => ['deepgram', 'aliyun', 'elevenlabs'].includes(value))}
          value={voiceCallSTTProvider}
          onSelect={(value) => setVoiceCallSTTProvider(value as STTProvider)}
        />
      </SettingsGroup>

      <SettingsGroup
        header="视频通话背景"
        footer="用于视频通话主画面；摄像头内容默认显示在右上角小窗。"
      >
        <View style={{ padding: 16 }}>
          <Pressable
            onPress={() => void pickCallBackground()}
            style={{
              height: 150,
              overflow: 'hidden',
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.background,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {voiceCallBackgroundImageUri ? (
              <Image
                source={{ uri: voiceCallBackgroundImageUri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <Text style={{ color: colors.textSecondary }}>
                {pickingBackground ? '正在选择…' : '点击选择自定义图片'}
              </Text>
            )}
          </Pressable>
        </View>
        <ButtonRow label="选择或替换背景" onPress={() => void pickCallBackground()} loading={pickingBackground} />
        <ButtonRow
          label="恢复默认背景"
          destructive
          disabled={!voiceCallBackgroundImageUri}
          onPress={() => {
            setVoiceCallBackgroundImageUri(undefined);
            showToast('视频通话背景已恢复默认');
          }}
        />
      </SettingsGroup>

      {voiceCallEngine === 'livekit' && (
        <SettingsGroup
          header="LiveKit Agents"
          footer="模型密钥通过 HTTPS 发送给你部署的 Brain 服务，不会写入 LiveKit 客户端日志。"
        >
          <TextEditRow
            label="Brain Server URL"
            value={liveKitVoiceCallConfig.brainUrl}
            inputPlaceholder="https://brain.example.com"
            onSave={(brainUrl) => setLiveKitVoiceCallConfig({ brainUrl: brainUrl.trim().replace(/\/+$/, '') })}
          />
          <TextEditRow
            label="Brain Access Token"
            value={liveKitVoiceCallConfig.accessToken}
            placeholder="可选"
            secure
            onSave={(accessToken) => setLiveKitVoiceCallConfig({ accessToken: accessToken.trim() })}
          />
        </SettingsGroup>
      )}

      {(voiceCallEngine === 'elevenlabs'
        || voiceCallTTSProvider === 'elevenlabs'
        || voiceCallSTTProvider === 'elevenlabs') && (
        <SettingsGroup
          header="ElevenLabs Speech Engine"
          footer="Token Endpoint 必须由服务端返回 conversation token，请勿把 ElevenLabs API Key 放进 App。"
        >
          <TextEditRow
            label="Token Endpoint"
            value={ttsConfig.elevenLabsTokenEndpoint}
            inputPlaceholder="https://your-server.example.com/api/elevenlabs/token"
            onSave={(elevenLabsTokenEndpoint) => patchTTS({ elevenLabsTokenEndpoint: elevenLabsTokenEndpoint.trim() })}
          />
          <TextEditRow
            label="Voice ID"
            value={ttsConfig.elevenLabsVoiceId}
            placeholder="可选覆盖"
            onSave={(elevenLabsVoiceId) => patchTTS({ elevenLabsVoiceId: elevenLabsVoiceId.trim() })}
          />
          <TextEditRow
            label="Language"
            value={ttsConfig.elevenLabsLanguage}
            inputPlaceholder="zh"
            onSave={(elevenLabsLanguage) => patchTTS({ elevenLabsLanguage: elevenLabsLanguage.trim() || 'zh' })}
          />
        </SettingsGroup>
      )}

      <SettingsGroup
        header="TTS 语音合成"
        footer="先选择要编辑的服务商，再配置该服务商的参数。修改会立即保存。"
      >
        <SelectRow
          label="编辑服务商"
          options={TTS_PROVIDERS.filter(({ value }) => value !== 'elevenlabs')}
          value={editingTTSProvider}
          onSelect={(value) => setEditingTTSProvider(value as TTSProvider)}
        />
      </SettingsGroup>

      {editingTTSProvider === 'minimax' && (
        <SettingsGroup header="MiniMax">
          <TextEditRow label="Group ID" value={ttsConfig.groupId} onSave={(groupId) => patchTTS({ groupId: groupId.trim() })} />
          <TextEditRow label="API Key" value={ttsConfig.apiKey} secure onSave={(apiKey) => patchTTS({ apiKey: apiKey.trim() })} />
          <TextEditRow label="Voice ID" value={ttsConfig.voiceId} inputPlaceholder="male-qn-qingse" onSave={(voiceId) => patchTTS({ voiceId: voiceId.trim() })} />
          <SelectRow label="模型" options={MINIMAX_MODELS} value={ttsConfig.model} onSelect={(model) => patchTTS({ model })} />
          <TextEditRow label="语速" value={String(ttsConfig.speed)} keyboardType="decimal-pad" validate={rangedNumber(0.5, 2)} onSave={(speed) => patchTTS({ speed: Number(speed) })} />
          <TextEditRow label="音量" value={String(ttsConfig.vol)} keyboardType="decimal-pad" validate={rangedNumber(0.1, 10)} onSave={(vol) => patchTTS({ vol: Number(vol) })} />
          <TextEditRow label="音调" value={String(ttsConfig.pitch)} keyboardType="decimal-pad" validate={rangedNumber(-12, 12)} onSave={(pitch) => patchTTS({ pitch: Number(pitch) })} />
        </SettingsGroup>
      )}

      {editingTTSProvider === 'fish' && (
        <SettingsGroup header="Fish Audio">
          <TextEditRow label="Base URL" value={ttsConfig.fishBaseUrl} inputPlaceholder="https://api.fish.audio" onSave={(fishBaseUrl) => patchTTS({ fishBaseUrl: fishBaseUrl.trim() || 'https://api.fish.audio' })} />
          <TextEditRow label="API Key" value={ttsConfig.fishApiKey} secure onSave={(fishApiKey) => patchTTS({ fishApiKey: fishApiKey.trim() })} />
          <TextEditRow label="Reference ID" value={ttsConfig.fishReferenceId} onSave={(fishReferenceId) => patchTTS({ fishReferenceId: fishReferenceId.trim() })} />
          <SelectRow label="模型" options={FISH_MODELS} value={ttsConfig.fishModel} onSelect={(fishModel) => patchTTS({ fishModel })} />
          <SelectRow label="音频格式" options={FISH_FORMATS} value={ttsConfig.fishFormat} onSelect={(fishFormat) => patchTTS({ fishFormat: fishFormat as TTSConfig['fishFormat'] })} />
          <TextEditRow label="语速" value={String(ttsConfig.fishSpeed)} keyboardType="decimal-pad" validate={positiveNumber} onSave={(fishSpeed) => patchTTS({ fishSpeed: Number(fishSpeed) })} />
          <TextEditRow label="音量" value={String(ttsConfig.fishVolume)} keyboardType="decimal-pad" onSave={(fishVolume) => patchTTS({ fishVolume: Number(fishVolume) || 0 })} />
        </SettingsGroup>
      )}

      {editingTTSProvider === 'cartesia' && (
        <SettingsGroup header="Cartesia">
          <TextEditRow label="Base URL" value={ttsConfig.cartesiaBaseUrl} inputPlaceholder="https://api.cartesia.ai" onSave={(cartesiaBaseUrl) => patchTTS({ cartesiaBaseUrl: cartesiaBaseUrl.trim() || 'https://api.cartesia.ai' })} />
          <TextEditRow label="API Key" value={ttsConfig.cartesiaApiKey} secure onSave={(cartesiaApiKey) => patchTTS({ cartesiaApiKey: cartesiaApiKey.trim() })} />
          <TextEditRow label="Voice ID" value={ttsConfig.cartesiaVoiceId} onSave={(cartesiaVoiceId) => patchTTS({ cartesiaVoiceId: cartesiaVoiceId.trim() })} />
          <SelectRow label="模型" options={CARTESIA_MODELS} value={ttsConfig.cartesiaModel} onSelect={(cartesiaModel) => patchTTS({ cartesiaModel })} />
          <TextEditRow label="Language" value={ttsConfig.cartesiaLanguage} inputPlaceholder="zh" onSave={(cartesiaLanguage) => patchTTS({ cartesiaLanguage: cartesiaLanguage.trim() || 'zh' })} />
          <TextEditRow label="语速" value={String(ttsConfig.cartesiaSpeed)} keyboardType="decimal-pad" validate={rangedNumber(0.6, 1.5)} onSave={(cartesiaSpeed) => patchTTS({ cartesiaSpeed: Number(cartesiaSpeed) })} />
          <TextEditRow label="音量" value={String(ttsConfig.cartesiaVolume)} keyboardType="decimal-pad" validate={rangedNumber(0.5, 2)} onSave={(cartesiaVolume) => patchTTS({ cartesiaVolume: Number(cartesiaVolume) })} />
        </SettingsGroup>
      )}

      {editingTTSProvider === 'deepgram' && (
        <SettingsGroup header="Deepgram TTS">
          <TextEditRow label="Base URL" value={ttsConfig.deepgramBaseUrl} inputPlaceholder="https://api.deepgram.com/v1" onSave={(deepgramBaseUrl) => patchTTS({ deepgramBaseUrl: deepgramBaseUrl.trim() || 'https://api.deepgram.com/v1' })} />
          <TextEditRow label="API Key" value={ttsConfig.deepgramApiKey} secure onSave={(deepgramApiKey) => patchTTS({ deepgramApiKey: deepgramApiKey.trim() })} />
          <TextEditRow label="模型" value={ttsConfig.deepgramModel} inputPlaceholder="aura-2-thalia-en" onSave={(deepgramModel) => patchTTS({ deepgramModel: deepgramModel.trim() || 'aura-2-thalia-en' })} />
        </SettingsGroup>
      )}

      <SettingsGroup>
        <ButtonRow label="测试当前 TTS 配置" onPress={() => void handleTest()} loading={testing} />
      </SettingsGroup>

      <SettingsGroup
        header="STT 语音转文字"
        footer="长按聊天页语音按钮时使用。修改会立即保存。"
      >
        <SelectRow
          label="编辑服务商"
          options={STT_PROVIDERS.filter(({ value }) => value !== 'elevenlabs')}
          value={editingSTTProvider}
          onSelect={(value) => setEditingSTTProvider(value as STTProvider)}
        />
      </SettingsGroup>

      {editingSTTProvider === 'openai' && (
        <SettingsGroup header="OpenAI Whisper" footer="Base URL 或 API Key 留空时沿用当前聊天 API。">
          <TextEditRow label="Base URL" value={sttConfig.openAiBaseUrl} placeholder={activeApi?.baseUrl || '沿用聊天 API'} onSave={(openAiBaseUrl) => setSTTConfig({ openAiBaseUrl: openAiBaseUrl.trim() })} />
          <TextEditRow label="API Key" value={sttConfig.openAiApiKey} placeholder="沿用聊天 API" secure onSave={(openAiApiKey) => setSTTConfig({ openAiApiKey: openAiApiKey.trim() })} />
          <TextEditRow label="模型" value={sttConfig.openAiModel} inputPlaceholder="whisper-1" onSave={(openAiModel) => setSTTConfig({ openAiModel: openAiModel.trim() || 'whisper-1' })} />
        </SettingsGroup>
      )}

      {editingSTTProvider === 'fish' && (
        <SettingsGroup header="Fish Audio STT">
          <TextEditRow label="Base URL" value={sttConfig.fishBaseUrl} inputPlaceholder="https://api.fish.audio" onSave={(fishBaseUrl) => setSTTConfig({ fishBaseUrl: fishBaseUrl.trim() || 'https://api.fish.audio' })} />
          <TextEditRow label="API Key" value={sttConfig.fishApiKey} secure onSave={(fishApiKey) => setSTTConfig({ fishApiKey: fishApiKey.trim() })} />
          <TextEditRow label="语言" value={sttConfig.fishLanguage} inputPlaceholder="zh" onSave={(fishLanguage) => setSTTConfig({ fishLanguage: fishLanguage.trim() || 'zh' })} />
          <SwitchRow label="忽略时间戳" sublabel="关闭后返回分段时间信息" value={sttConfig.fishIgnoreTimestamps} onValueChange={(fishIgnoreTimestamps) => setSTTConfig({ fishIgnoreTimestamps })} />
        </SettingsGroup>
      )}

      {editingSTTProvider === 'aliyun' && (
        <SettingsGroup header="Aliyun STT">
          <TextEditRow label="Base URL" value={sttConfig.aliyunBaseUrl} inputPlaceholder="wss://dashscope.aliyuncs.com/api-ws/v1/realtime" onSave={(aliyunBaseUrl) => setSTTConfig({ aliyunBaseUrl: aliyunBaseUrl.trim() })} />
          <TextEditRow label="API Key" value={sttConfig.aliyunApiKey} secure onSave={(aliyunApiKey) => setSTTConfig({ aliyunApiKey: aliyunApiKey.trim() })} />
          <TextEditRow label="模型" value={sttConfig.aliyunModel} inputPlaceholder="qwen3-asr-flash-realtime" onSave={(aliyunModel) => setSTTConfig({ aliyunModel: aliyunModel.trim() })} />
          <TextEditRow label="语言" value={sttConfig.aliyunLanguage} inputPlaceholder="zh" onSave={(aliyunLanguage) => setSTTConfig({ aliyunLanguage: aliyunLanguage.trim() || 'zh' })} />
          <SwitchRow label="Server VAD" sublabel="关闭后使用 Manual Commit" value={sttConfig.aliyunSemanticVad} onValueChange={(aliyunSemanticVad) => setSTTConfig({ aliyunSemanticVad })} />
        </SettingsGroup>
      )}

      {editingSTTProvider === 'deepgram' && (
        <SettingsGroup header="Deepgram STT">
          <TextEditRow label="Base URL" value={sttConfig.deepgramBaseUrl} inputPlaceholder="https://api.deepgram.com/v1" onSave={(deepgramBaseUrl) => setSTTConfig({ deepgramBaseUrl: deepgramBaseUrl.trim() || 'https://api.deepgram.com/v1' })} />
          <TextEditRow label="API Key" value={sttConfig.deepgramApiKey} secure onSave={(deepgramApiKey) => setSTTConfig({ deepgramApiKey: deepgramApiKey.trim() })} />
          <TextEditRow label="模型" value={sttConfig.deepgramModel} inputPlaceholder="nova-3 / flux-general-multi" onSave={(deepgramModel) => setSTTConfig({ deepgramModel: deepgramModel.trim() || 'nova-3' })} />
          <TextEditRow label="语言" value={sttConfig.deepgramLanguage} placeholder="自动识别" inputPlaceholder="zh / en" onSave={(deepgramLanguage) => setSTTConfig({ deepgramLanguage: deepgramLanguage.trim() })} />
        </SettingsGroup>
      )}

      <SettingsGroup>
        <SettingsRow
          label="配置状态"
          value="已自动保存"
          sublabel="所有行的修改会在弹窗确认后立即持久化"
        />
      </SettingsGroup>
    </ScrollView>
  );
}
