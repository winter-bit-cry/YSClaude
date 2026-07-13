import { requestRecordingPermissionsAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { useChatStore } from '../stores/chat';
import { useSettingsStore, type STTConfig, type TTSConfig } from '../stores/settings';
import {
  addVoiceCallAudioChunkListener,
  addVoiceCallAudioErrorListener,
  addVoiceCallBargeInListener,
  addVoiceCallSpeechEndListener,
  addVoiceCallPlaybackListener,
  clearVoiceCallSpeaker,
  enqueueVoiceCallMp3Clip,
  finishVoiceCallPcmPlayback,
  isAndroidVoiceCallAudioAvailable,
  setVoiceCallSpeakerphoneOn,
  startVoiceCallMic,
  startVoiceCallSpeaker,
  stopVoiceCallMic,
  stopVoiceCallAudio,
  writeVoiceCallPcmChunk,
} from './androidVoiceCallAudio';

type VoiceCallStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'stopping' | 'error';

export interface VoiceCallSnapshot {
  active: boolean;
  status: VoiceCallStatus;
  startedAt: number | null;
  micEnabled: boolean;
  speakerphoneOn: boolean;
  partialTranscript: string;
  lastUserText: string;
  speakingText: string;
  transcriptItems: VoiceCallTranscriptItem[];
  error: string | null;
}

export interface VoiceCallTranscriptItem {
  id: string;
  speaker: 'user' | 'assistant';
  text: string;
}

type SnapshotListener = (snapshot: VoiceCallSnapshot) => void;
type Subscription = { remove: () => void };
type DeepgramWebSocketAuthAttempt = {
  label: string;
  protocols?: string | string[];
  options?: { headers?: Record<string, string> };
};

const DEEPGRAM_SAMPLE_RATE = 16000;
const ALIYUN_SAMPLE_RATE = 16000;
const MINIMAX_SAMPLE_RATE = 32000;
const CARTESIA_SAMPLE_RATE = 24000;
const CARTESIA_VERSION = '2026-03-01';
const CARTESIA_FINISH_PLAYBACK_DELAY_MS = 700;
const DEEPGRAM_FLUX_SILENCE_KEEPALIVE_MS = 200;
const DEEPGRAM_FLUX_EOT_THRESHOLD = '0.8';
const DEEPGRAM_FLUX_EOT_TIMEOUT_MS = '7000';
const ALIYUN_MANUAL_COMMIT_SILENCE_MS = 900;
const PLAYBACK_RECOGNITION_SUPPRESS_MS = 900;
const BARGE_IN_RECOGNITION_OPEN_MS = 2500;
const PENDING_TRANSCRIPT_FLUSH_MS = 2200;
const LOCAL_SPEECH_END_FLUSH_MS = 1150;
const CHINESE_PENDING_TRANSCRIPT_FLUSH_MS = 3400;
const CHINESE_LOCAL_SPEECH_END_FLUSH_MS = 2400;
const DUPLICATE_USER_TEXT_WINDOW_MS = 45000;
const TTS_SEGMENT_BOUNDARY = /[。！？!?；;，,、\n]/;
const MAX_TTS_SEGMENT_CHARS = 44;
const MINIMAX_TASK_START_FALLBACK_MS = 350;
const SPEECH_BRACKETED_CONTENT_PATTERNS = [
  /\([^()]*\)/g,
  /（[^（）]*）/g,
  /\[[^\[\]]*\]/g,
  /<[^<>]*>/g,
  /\{[^{}]*\}/g,
];
const SPEECH_TRAILING_BRACKETED_CONTENT = /[\(（\[{<][^\)）\]}>]*$/;
const NativeWebSocket = WebSocket as any;
const VOICE_CALL_START_SYSTEM_MESSAGE = '开启语音通话，以下内容为通话记录';
const VOICE_CALL_RUNTIME_INSTRUCTION =
  '当前正在与用户进行实时语音通话。请把接下来的回复当作会被 TTS 朗读出来的口语回复：优先简洁、自然、可直接念出；避免 Markdown 表格、长列表、复杂括号说明和不适合朗读的格式；如果内容较长，请先给结论，再分段说明。';
export const VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION =
  '用户已接听你主动发起的语音通话。你现在必须先开口，用自然口语直接开始这通电话；不要等待用户先说话，不要说明你调用了工具。';
const VOICE_CALL_END_SYSTEM_MESSAGE = '语音通话结束';

export function isAndroidVoiceCallAvailable(): boolean {
  return Platform.OS === 'android' && isAndroidVoiceCallAudioAvailable();
}

export class AndroidVoiceCallSession {
  private snapshot: VoiceCallSnapshot = {
    active: false,
    status: 'idle',
    startedAt: null,
    micEnabled: true,
    speakerphoneOn: false,
    partialTranscript: '',
    lastUserText: '',
    speakingText: '',
    transcriptItems: [],
    error: null,
  };

  private listeners = new Set<SnapshotListener>();
  private audioChunkSubscription: Subscription | null = null;
  private audioErrorSubscription: Subscription | null = null;
  private bargeInSubscription: Subscription | null = null;
  private speechEndSubscription: Subscription | null = null;
  private playbackSubscription: Subscription | null = null;
  private chatSubscription: (() => void) | null = null;
  private deepgramWs: WebSocket | null = null;
  private aliyunWs: WebSocket | null = null;
  private minimaxWs: WebSocket | null = null;
  private cartesiaWs: WebSocket | null = null;
  private cartesiaContextId: string | null = null;
  private cartesiaFinishTimer: ReturnType<typeof setTimeout> | null = null;
  private deepgramKeepAlive: ReturnType<typeof setInterval> | null = null;
  private deepgramFluxMode = false;
  private finalTranscriptParts: string[] = [];
  private lastInterimTranscript = '';
  private pendingTranscriptFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsStarted = false;
  private ttsStartSent = false;
  private minimaxConnected = false;
  private minimaxEndpointIndex = 0;
  private minimaxStartTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsTextQueue: string[] = [];
  private pendingTtsText = '';
  private minimaxAudioHexParts: string[] = [];
  private lastSpeakableAssistantText = '';
  private activeAssistantId: string | null = null;
  private activeAssistantTranscriptId: string | null = null;
  private stopping = false;
  private voiceCallSystemMessageOpen = false;
  private assistantPlaybackActive = false;
  private suppressRecognitionUntil = 0;
  private bargeInRecognitionOpenUntil = 0;
  private lastSubmittedUserText = '';
  private lastSubmittedUserTextAt = 0;
  private listeningStartedAt = 0;
  private sentAudioInCurrentListeningWindow = false;
  private lastMicAudioSentAt = 0;

  subscribe(listener: SnapshotListener): Subscription {
    this.listeners.add(listener);
    listener(this.snapshot);
    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }

  getSnapshot(): VoiceCallSnapshot {
    return this.snapshot;
  }

  async startAssistantInitiatedTurn(
    instruction = VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION
  ): Promise<void> {
    if (!this.snapshot.active || this.stopping) return;
    await waitForChatIdle();
    if (!this.snapshot.active || this.stopping) return;

    this.update({
      status: 'thinking',
      partialTranscript: '',
      speakingText: '',
    });
    this.startAssistantTtsBridge();
    try {
      await useChatStore.getState().triggerResponse({
        skipStickerInstruction: true,
        additionalRuntimeSections: [
          VOICE_CALL_RUNTIME_INSTRUCTION,
          instruction,
        ],
      });
      this.flushPendingTtsText(true);
      this.finishAssistantTts();
      if (useChatStore.getState().error) {
        throw new Error(useChatStore.getState().error || 'AI 主动语音开场失败');
      }
      if (this.snapshot.active && this.snapshot.status !== 'error') {
        this.enterListeningState();
      }
    } catch (error: any) {
      this.fail(error?.message || 'AI 主动语音开场失败');
    }
  }

  async start(): Promise<void> {
    if (this.snapshot.active) return;
    if (!isAndroidVoiceCallAvailable()) {
      throw new Error('实时语音通话目前只支持 Android 自定义构建');
    }

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error('请先允许麦克风权限');
    }

    const settings = useSettingsStore.getState();
    if (!settings._hydrated) {
      throw new Error('设置还没有加载完成');
    }
    if (settings.sttConfig.provider !== 'deepgram' && settings.sttConfig.provider !== 'aliyun') {
      throw new Error('语音通话需要在设置中将 STT 选择为 Deepgram 或阿里百炼');
    }
    if (settings.ttsConfig.provider !== 'minimax' && settings.ttsConfig.provider !== 'cartesia') {
      throw new Error('语音通话当前仅支持 MiniMax TTS');
    }
    if (settings.sttConfig.provider === 'deepgram' && !settings.sttConfig.deepgramApiKey.trim()) {
      throw new Error('请先配置 Deepgram API Key');
    }
    if (settings.sttConfig.provider === 'aliyun' && !settings.sttConfig.aliyunApiKey.trim()) {
      throw new Error('请先配置阿里百炼 API Key');
    }
    if (settings.ttsConfig.provider === 'minimax' && (!settings.ttsConfig.apiKey.trim() || !settings.ttsConfig.voiceId.trim())) {
      throw new Error('请先配置 MiniMax API Key 和 Voice ID');
    }
    if (settings.ttsConfig.provider === 'cartesia' && (!settings.ttsConfig.cartesiaApiKey.trim() || !settings.ttsConfig.cartesiaVoiceId.trim())) {
      throw new Error('请先配置 Cartesia API Key 和 Voice ID');
    }

    this.stopping = false;
    this.update({
      active: true,
      status: 'connecting',
      startedAt: Date.now(),
      micEnabled: true,
      speakerphoneOn: false,
      error: null,
      partialTranscript: '',
      lastUserText: '',
      speakingText: '',
      transcriptItems: [],
    });
    const startSystemMessage = await useChatStore.getState().addSystemMessage(VOICE_CALL_START_SYSTEM_MESSAGE);
    this.voiceCallSystemMessageOpen = !!startSystemMessage;
    this.audioErrorSubscription = addVoiceCallAudioErrorListener((event) => {
      this.fail(event.message || '实时音频播放失败');
    });
    this.bargeInSubscription = addVoiceCallBargeInListener((event) => {
      this.handleBargeIn(event.chunks || []);
    });
    this.speechEndSubscription = addVoiceCallSpeechEndListener(() => {
      this.handleLocalSpeechEnd();
    });
    this.playbackSubscription = addVoiceCallPlaybackListener((event) => {
      this.setAssistantPlaybackActive(!!event.active);
    });
    await startVoiceCallSpeaker(getVoiceCallTtsSampleRate(settings.ttsConfig), 1);
    await setVoiceCallSpeakerphoneOn(false).catch(() => undefined);
    await this.connectRealtimeStt();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.snapshot.active || this.stopping || this.snapshot.micEnabled === enabled) return;
    if (enabled) {
      await startVoiceCallMic(DEEPGRAM_SAMPLE_RATE, 20);
      if (this.snapshot.status === 'idle') {
        this.enterListeningState({ micEnabled: true });
      } else {
        this.update({ micEnabled: true });
      }
      return;
    }
    await stopVoiceCallMic();
    this.clearRecognitionBuffers();
    this.update({ micEnabled: false, partialTranscript: '' });
  }

  async setSpeakerphoneOn(enabled: boolean): Promise<void> {
    if (!this.snapshot.active || this.stopping || this.snapshot.speakerphoneOn === enabled) return;
    await setVoiceCallSpeakerphoneOn(enabled);
    this.update({ speakerphoneOn: enabled });
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.update({ status: 'stopping' });
    if (useChatStore.getState().isStreaming) {
      useChatStore.getState().stopStreaming();
    }
    this.cleanupChatBridge();
    this.closeAssistantTts();
    this.closeRealtimeStt();
    this.clearPendingTranscriptFlush();
    this.audioChunkSubscription?.remove();
    this.audioErrorSubscription?.remove();
    this.bargeInSubscription?.remove();
    this.speechEndSubscription?.remove();
    this.playbackSubscription?.remove();
    this.audioChunkSubscription = null;
    this.audioErrorSubscription = null;
    this.bargeInSubscription = null;
    this.speechEndSubscription = null;
    this.playbackSubscription = null;
    await stopVoiceCallAudio().catch(() => undefined);
    this.clearPendingTranscriptFlush();
    this.finalTranscriptParts = [];
    this.lastInterimTranscript = '';
    this.ttsTextQueue = [];
    this.minimaxAudioHexParts = [];
    this.pendingTtsText = '';
    this.activeAssistantId = null;
    this.activeAssistantTranscriptId = null;
    this.lastSpeakableAssistantText = '';
    this.assistantPlaybackActive = false;
    this.suppressRecognitionUntil = 0;
    this.bargeInRecognitionOpenUntil = 0;
    this.lastSubmittedUserText = '';
    this.lastSubmittedUserTextAt = 0;
    this.listeningStartedAt = 0;
    this.sentAudioInCurrentListeningWindow = false;
    this.lastMicAudioSentAt = 0;
    this.stopping = false;
    await this.closeVoiceCallSystemMessage();
    this.update({
      active: false,
      status: 'idle',
      startedAt: null,
      micEnabled: true,
      speakerphoneOn: false,
      partialTranscript: '',
      speakingText: '',
      error: null,
    });
  }

  private async connectRealtimeStt(): Promise<void> {
    const settings = useSettingsStore.getState();
    if (settings.sttConfig.provider === 'aliyun') {
      await this.connectAliyun();
      return;
    }
    await this.connectDeepgram();
  }

  private async connectDeepgram(): Promise<void> {
    const settings = useSettingsStore.getState();
    const url = buildDeepgramLiveUrl(
      settings.sttConfig.deepgramBaseUrl,
      settings.sttConfig.deepgramModel,
      settings.sttConfig.deepgramLanguage
    );
    this.deepgramFluxMode = isDeepgramFluxModel(settings.sttConfig.deepgramModel);
    const apiKey = normalizeDeepgramApiKey(settings.sttConfig.deepgramApiKey);
    const attempts: DeepgramWebSocketAuthAttempt[] = [
      {
        label: 'Authorization header',
        protocols: undefined,
        options: { headers: { Authorization: buildDeepgramAuthorizationHeader(apiKey) } },
      },
      {
        label: 'WebSocket protocol token',
        protocols: ['token', apiKey],
      },
    ];
    const errors: string[] = [];

    for (const attempt of attempts) {
      try {
        await this.openDeepgramSocket(url, attempt);
        return;
      } catch (error: any) {
        errors.push(`${attempt.label}: ${error?.message || 'connection failed'}`);
      }
    }

    throw new Error(`Deepgram 实时连接失败：${errors.join('；')}`);
  }

  private async openDeepgramSocket(url: string, auth: DeepgramWebSocketAuthAttempt): Promise<void> {
    const ws = new NativeWebSocket(url, auth.protocols, auth.options);
    this.deepgramWs = ws;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) {
          if (this.deepgramWs === ws) {
            this.deepgramWs = null;
          }
          if (ws.readyState <= WebSocket.OPEN) {
            ws.close();
          }
          reject(error);
        } else {
          resolve();
        }
      };

      ws.onopen = () => {
        this.enterListeningState();
        this.audioChunkSubscription = addVoiceCallAudioChunkListener((event) => {
          if (this.deepgramWs !== ws || ws.readyState !== WebSocket.OPEN) return;
          if (this.shouldSuppressRecognition()) return;
          this.markMicAudioSent();
          ws.send(base64ToArrayBuffer(event.base64));
        });
        startVoiceCallMic(DEEPGRAM_SAMPLE_RATE, 20).then(
          () => settle(),
          (error) => settle(error instanceof Error ? error : new Error(String(error)))
        );
        this.deepgramKeepAlive = setInterval(() => {
          if (this.deepgramWs === ws && ws.readyState === WebSocket.OPEN) {
            ws.send(this.deepgramFluxMode
              ? createPcmSilence(DEEPGRAM_SAMPLE_RATE, DEEPGRAM_FLUX_SILENCE_KEEPALIVE_MS)
              : JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 8000);
      };

      ws.onerror = () => settle(new Error('WebSocket 握手未通过'));
      ws.onclose = (event: any) => {
        const closeDetail = formatWebSocketClose(event);
        if (!settled) {
          settle(new Error(closeDetail ? `WebSocket 握手未通过（${closeDetail}）` : 'WebSocket 握手未通过'));
          return;
        }
        if (!this.stopping && this.deepgramWs === ws) {
          this.fail(closeDetail ? `Deepgram 实时连接已断开：${closeDetail}` : 'Deepgram 实时连接已断开');
        }
      };
      ws.onmessage = (message: any) => {
        this.handleDeepgramMessage(String(message.data));
      };
    });
  }

  private async connectAliyun(): Promise<void> {
    const settings = useSettingsStore.getState();
    const url = buildAliyunRealtimeUrl(settings.sttConfig.aliyunBaseUrl, settings.sttConfig.aliyunModel);
    const ws = new NativeWebSocket(url, undefined, {
      headers: {
        Authorization: `Bearer ${settings.sttConfig.aliyunApiKey.trim()}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    } as any);
    this.aliyunWs = ws;
    this.deepgramFluxMode = false;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) {
          if (this.aliyunWs === ws) {
            this.aliyunWs = null;
          }
          if (ws.readyState <= WebSocket.OPEN) {
            ws.close();
          }
          reject(error);
        } else {
          resolve();
        }
      };

      ws.onopen = () => {
        this.enterListeningState();
        ws.send(JSON.stringify(buildAliyunSessionUpdateRequest(settings.sttConfig)));
        this.audioChunkSubscription = addVoiceCallAudioChunkListener((event) => {
          if (this.aliyunWs !== ws || ws.readyState !== WebSocket.OPEN) return;
          if (this.shouldSuppressRecognition()) return;
          this.markMicAudioSent();
          ws.send(JSON.stringify(buildAliyunAudioAppendRequest(event.base64)));
        });
        startVoiceCallMic(ALIYUN_SAMPLE_RATE, 20).then(
          () => settle(),
          (error) => settle(error instanceof Error ? error : new Error(String(error)))
        );
      };

      ws.onerror = () => settle(new Error('WebSocket 握手未通过'));
      ws.onclose = (event: any) => {
        const closeDetail = formatWebSocketClose(event);
        if (!settled) {
          settle(new Error(closeDetail ? `WebSocket 握手未通过：${closeDetail}` : 'WebSocket 握手未通过'));
          return;
        }
        if (!this.stopping && this.aliyunWs === ws) {
          this.fail(closeDetail ? `阿里实时连接已断开：${closeDetail}` : '阿里实时连接已断开');
        }
      };
      ws.onmessage = (message: any) => {
        this.handleAliyunMessage(String(message.data));
      };
    });
  }

  private handleDeepgramMessage(raw: string): void {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    if (event.type === 'TurnInfo') {
      this.handleDeepgramFluxTurnInfo(event);
      return;
    }

    if (this.shouldSuppressRecognition()) {
      if (event.type === 'SpeechStarted' || event.type === 'UtteranceEnd' || event.type === 'Results') {
        this.clearRecognitionBuffers();
        return;
      }
    }

    if (event.type === 'SpeechStarted') {
      if (this.snapshot.status === 'listening' && !this.sentAudioInCurrentListeningWindow) {
        this.clearRecognitionBuffers();
        return;
      }
      if (this.snapshot.status === 'speaking' || useChatStore.getState().isStreaming) {
        this.interruptAssistant();
      }
      return;
    }

    if (event.type === 'UtteranceEnd') {
      if (this.isDeepgramChineseMode()) {
        this.schedulePendingTranscriptFlush(CHINESE_PENDING_TRANSCRIPT_FLUSH_MS);
        return;
      }
      this.flushFinalTranscript();
      return;
    }

    if (event.type !== 'Results') return;
    if (this.snapshot.status !== 'listening') {
      this.clearRecognitionBuffers();
      return;
    }
    if (!this.sentAudioInCurrentListeningWindow) {
      this.clearRecognitionBuffers();
      return;
    }
    const transcript = extractDeepgramTranscript(event);
    if (!transcript) return;
    if (this.isDuplicateSubmittedUserText(transcript)) {
      this.clearRecognitionBuffers();
      return;
    }

    if (event.is_final) {
      this.finalTranscriptParts.push(transcript);
      this.lastInterimTranscript = '';
      this.update({ partialTranscript: uniqueJoin(this.finalTranscriptParts) });
    } else {
      this.lastInterimTranscript = transcript;
      this.update({ partialTranscript: transcript });
    }
    this.schedulePendingTranscriptFlush(this.getPendingTranscriptFlushMs());

    if (event.speech_final) {
      if (this.isDeepgramChineseMode()) {
        this.schedulePendingTranscriptFlush(CHINESE_PENDING_TRANSCRIPT_FLUSH_MS);
        return;
      }
      this.flushFinalTranscript();
    }
  }

  private handleAliyunMessage(raw: string): void {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    const type = String(event.type || '');
    if (type === 'error') {
      this.fail(extractAliyunErrorMessage(event));
      return;
    }

    if (this.shouldSuppressRecognition()) {
      if (isAliyunSpeechEvent(type) || isAliyunTranscriptEvent(type)) {
        this.clearRecognitionBuffers();
        return;
      }
    }

    if (type.includes('speech_started')) {
      if (this.snapshot.status === 'listening' && !this.sentAudioInCurrentListeningWindow) {
        this.clearRecognitionBuffers();
        return;
      }
      if (this.snapshot.status === 'speaking' || useChatStore.getState().isStreaming) {
        this.interruptAssistant();
      }
      return;
    }

    if (type.includes('speech_stopped')) {
      if (!useSettingsStore.getState().sttConfig.aliyunSemanticVad) {
        this.commitAliyunAudio();
      }
      return;
    }

    if (!isAliyunTranscriptEvent(type)) return;
    if (this.snapshot.status !== 'listening') {
      this.clearRecognitionBuffers();
      return;
    }
    if (!this.sentAudioInCurrentListeningWindow) {
      this.clearRecognitionBuffers();
      return;
    }

    const transcript = extractAliyunTranscript(event);
    if (!transcript) return;
    if (this.isDuplicateSubmittedUserText(transcript)) {
      this.clearRecognitionBuffers();
      return;
    }

    if (isAliyunFinalTranscriptEvent(type)) {
      this.clearPendingTranscriptFlush();
      this.finalTranscriptParts = [];
      this.lastInterimTranscript = '';
      this.update({ partialTranscript: '' });
      this.lastSubmittedUserText = transcript;
      this.lastSubmittedUserTextAt = Date.now();
      this.handleUserTurn(transcript).catch((error) => {
        this.fail(error?.message || 'Voice turn failed');
      });
      return;
    }

    this.lastInterimTranscript = transcript;
    this.update({ partialTranscript: transcript });
    if (!useSettingsStore.getState().sttConfig.aliyunSemanticVad) {
      this.schedulePendingTranscriptFlush(ALIYUN_MANUAL_COMMIT_SILENCE_MS);
    }
  }

  private handleDeepgramFluxTurnInfo(event: any): void {
    const turnEvent = String(event.event || '');
    const transcript = extractDeepgramFluxTranscript(event);

    if (turnEvent === 'StartOfTurn') {
      if (this.snapshot.status === 'speaking' || useChatStore.getState().isStreaming) {
        this.interruptAssistant();
      }
      if (transcript && !this.isDuplicateSubmittedUserText(transcript)) {
        this.update({ partialTranscript: transcript });
      }
      return;
    }

    if (turnEvent === 'Update' || turnEvent === 'EagerEndOfTurn' || turnEvent === 'TurnResumed') {
      if (this.snapshot.status !== 'listening') return;
      if (transcript && !this.isDuplicateSubmittedUserText(transcript)) {
        this.update({ partialTranscript: transcript });
      }
      return;
    }

    if (turnEvent !== 'EndOfTurn') return;
    const text = (transcript || this.snapshot.partialTranscript).trim();
    this.clearPendingTranscriptFlush();
    this.finalTranscriptParts = [];
    this.lastInterimTranscript = '';
    this.update({ partialTranscript: '' });
    if (!text || this.isDuplicateSubmittedUserText(text)) return;
    this.lastSubmittedUserText = text;
    this.lastSubmittedUserTextAt = Date.now();
    this.handleUserTurn(text).catch((error) => {
      this.fail(error?.message || 'Voice turn failed');
    });
  }

  private flushFinalTranscript(): void {
    this.clearPendingTranscriptFlush();
    if (this.snapshot.status !== 'listening') {
      this.finalTranscriptParts = [];
      this.lastInterimTranscript = '';
      if (this.snapshot.partialTranscript) {
        this.update({ partialTranscript: '' });
      }
      return;
    }
    const text = (uniqueJoin(this.finalTranscriptParts) || this.lastInterimTranscript || this.snapshot.partialTranscript).trim();
    this.finalTranscriptParts = [];
    this.lastInterimTranscript = '';
    this.update({ partialTranscript: '' });
    if (!text) return;
    if (this.isDuplicateSubmittedUserText(text)) return;
    this.lastSubmittedUserText = text;
    this.lastSubmittedUserTextAt = Date.now();
    this.handleUserTurn(text).catch((error) => {
      this.fail(error?.message || 'Voice turn failed');
    });
  }

  private schedulePendingTranscriptFlush(delayMs = PENDING_TRANSCRIPT_FLUSH_MS): void {
    if (this.snapshot.status !== 'listening') return;
    this.clearPendingTranscriptFlush();
    this.pendingTranscriptFlushTimer = setTimeout(() => {
      this.pendingTranscriptFlushTimer = null;
      if (this.snapshot.status !== 'listening') return;
      this.flushFinalTranscript();
    }, delayMs);
  }

  private clearPendingTranscriptFlush(): void {
    if (this.pendingTranscriptFlushTimer !== null) {
      clearTimeout(this.pendingTranscriptFlushTimer);
      this.pendingTranscriptFlushTimer = null;
    }
  }

  private async handleUserTurn(text: string): Promise<void> {
    if (!this.snapshot.active || this.stopping) return;
    const chat = useChatStore.getState();
    if (chat.isStreaming) {
      this.interruptAssistant();
    }
    this.update({
      status: 'thinking',
      lastUserText: text,
      partialTranscript: '',
      speakingText: '',
    });
    this.appendTranscriptItem('user', text);
    await chat.addUserMessage(text);
    if (useChatStore.getState().error) {
      throw new Error(useChatStore.getState().error || '发送语音文字失败');
    }
    this.startAssistantTtsBridge();
    await useChatStore.getState().triggerResponse({
      skipStickerInstruction: true,
      additionalRuntimeSections: [VOICE_CALL_RUNTIME_INSTRUCTION],
    });
    this.flushPendingTtsText(true);
    this.finishAssistantTts();
    if (this.snapshot.active && this.snapshot.status !== 'error') {
      this.enterListeningState();
    }
  }

  private startAssistantTtsBridge(): void {
    this.cleanupChatBridge();
    this.closeAssistantTts();
    this.activeAssistantId = null;
    this.activeAssistantTranscriptId = null;
    this.lastSpeakableAssistantText = '';
    this.pendingTtsText = '';
    this.ttsTextQueue = [];
    this.connectAssistantTts(useSettingsStore.getState().ttsConfig);

    this.chatSubscription = useChatStore.subscribe((state) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant') return;
      if (this.activeAssistantId !== last.id) {
        this.activeAssistantId = last.id;
        this.activeAssistantTranscriptId = null;
        this.lastSpeakableAssistantText = '';
        this.pendingTtsText = '';
      }
      const speakable = extractSpeakableAssistantText(last.content);
      if (speakable.length <= this.lastSpeakableAssistantText.length) return;
      const delta = speakable.slice(this.lastSpeakableAssistantText.length);
      this.lastSpeakableAssistantText = speakable;
      this.appendTtsText(delta);
    });
  }

  private appendTtsText(delta: string): void {
    const clean = delta.replace(/\s+/g, ' ');
    if (!clean.trim()) return;
    this.appendAssistantTranscriptDelta(clean);
    this.pendingTtsText += clean;
    this.flushPendingTtsText(false);
  }

  private flushPendingTtsText(force: boolean): void {
    let boundaryIndex = findTtsBoundary(this.pendingTtsText);
    while (boundaryIndex >= 0) {
      const segment = this.pendingTtsText.slice(0, boundaryIndex + 1).trim();
      this.pendingTtsText = this.pendingTtsText.slice(boundaryIndex + 1);
      this.sendAssistantTtsText(segment);
      boundaryIndex = findTtsBoundary(this.pendingTtsText);
    }

    if (this.pendingTtsText.length >= MAX_TTS_SEGMENT_CHARS || (force && this.pendingTtsText.trim())) {
      const segment = this.pendingTtsText.trim();
      this.pendingTtsText = '';
      this.sendAssistantTtsText(segment);
    }
  }

  private connectAssistantTts(config: TTSConfig): void {
    if (config.provider === 'cartesia') {
      this.connectCartesia(config);
      return;
    }
    this.connectMiniMax(config);
  }

  private sendAssistantTtsText(text: string): void {
    const config = useSettingsStore.getState().ttsConfig;
    if (config.provider === 'cartesia') {
      this.sendCartesiaText(text, config);
      return;
    }
    this.sendMiniMaxText(text);
  }

  private finishAssistantTts(): void {
    const config = useSettingsStore.getState().ttsConfig;
    if (config.provider === 'cartesia') {
      this.finishCartesia(config);
      return;
    }
    this.finishMiniMax();
  }

  private connectCartesia(config: TTSConfig): void {
    this.closeCartesia();
    const ws = new NativeWebSocket(
      buildCartesiaWebSocketUrl(config.cartesiaBaseUrl),
      undefined,
      {
        headers: {
          'X-API-Key': config.cartesiaApiKey.trim(),
        },
      } as any
    );
    this.cartesiaWs = ws;
    this.cartesiaContextId = `voice-call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.ttsStarted = false;

    ws.onopen = () => {
      this.ttsStarted = true;
      this.drainCartesiaTextQueue();
    };
    ws.onerror = () => {
      this.fail('Cartesia TTS realtime connection failed');
    };
    ws.onclose = (event: any) => {
      if (this.cartesiaWs !== ws || this.stopping) return;
      const closeDetail = formatWebSocketClose(event);
      this.fail(closeDetail ? `Cartesia TTS connection closed: ${closeDetail}` : 'Cartesia TTS connection closed');
    };
    ws.onmessage = (message: any) => {
      this.handleCartesiaMessage(String(message.data), ws);
    };
  }

  private sendCartesiaText(text: string, config: TTSConfig): void {
    const normalized = text.trim();
    if (!normalized) return;
    this.update({ speakingText: normalized });
    if (!this.cartesiaWs || this.cartesiaWs.readyState > WebSocket.OPEN) {
      this.connectCartesia(config);
    }
    if (!this.ttsStarted || this.cartesiaWs?.readyState !== WebSocket.OPEN) {
      this.ttsTextQueue.push(normalized);
      return;
    }
    this.cartesiaWs.send(JSON.stringify(buildCartesiaGenerationRequest(config, this.requireCartesiaContextId(), normalized, true)));
  }

  private finishCartesia(config: TTSConfig): void {
    if (this.cartesiaWs?.readyState === WebSocket.OPEN && this.ttsStarted) {
      this.cartesiaWs.send(JSON.stringify(buildCartesiaGenerationRequest(config, this.requireCartesiaContextId(), '', false)));
    }
  }

  private drainCartesiaTextQueue(): void {
    const queued = [...this.ttsTextQueue];
    this.ttsTextQueue = [];
    queued.forEach((text) => this.sendCartesiaText(text, useSettingsStore.getState().ttsConfig));
  }

  private handleCartesiaMessage(raw: string, ws: WebSocket): void {
    if (this.cartesiaWs !== ws) return;
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    if (event.type === 'error') {
      this.fail(event.message || event.title || 'Cartesia TTS returned an error');
      return;
    }

    const audioBase64 = typeof event.data === 'string'
      ? event.data
      : typeof event.audio === 'string'
        ? event.audio
        : '';
    if (event.type === 'chunk' && audioBase64) {
      this.update({ status: 'speaking' });
      writeVoiceCallPcmChunk(audioBase64).catch((error) => {
        this.fail(error?.message || 'Failed to play Cartesia audio');
      });
    }

    if (event.done || event.type === 'done') {
      this.scheduleCartesiaPlaybackFinish();
    }
  }

  private scheduleCartesiaPlaybackFinish(): void {
    if (this.cartesiaFinishTimer !== null) {
      clearTimeout(this.cartesiaFinishTimer);
    }
    this.cartesiaFinishTimer = setTimeout(() => {
      this.cartesiaFinishTimer = null;
      finishVoiceCallPcmPlayback().catch(() => undefined);
    }, CARTESIA_FINISH_PLAYBACK_DELAY_MS);
  }

  private requireCartesiaContextId(): string {
    if (!this.cartesiaContextId) {
      this.cartesiaContextId = `voice-call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return this.cartesiaContextId;
  }

  private connectMiniMax(config: TTSConfig, endpointIndex = 0): void {
    const endpoints = buildMiniMaxWebSocketUrls(config.groupId);
    const endpoint = endpoints[Math.min(endpointIndex, endpoints.length - 1)];
    const ws = new NativeWebSocket(
      endpoint,
      undefined,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
      } as any
    );
    this.minimaxWs = ws;
    this.ttsStarted = false;
    this.ttsStartSent = false;
    this.minimaxConnected = false;
    this.minimaxEndpointIndex = endpointIndex;
    if (this.minimaxStartTimer !== null) {
      clearTimeout(this.minimaxStartTimer);
      this.minimaxStartTimer = null;
    }

    ws.onopen = () => {
      this.minimaxStartTimer = setTimeout(() => {
        if (this.minimaxWs === ws && ws.readyState === WebSocket.OPEN && !this.ttsStartSent) {
          this.sendMiniMaxTaskStart(ws, config);
        }
      }, MINIMAX_TASK_START_FALLBACK_MS);
    };
    ws.onerror = () => {
      this.tryNextMiniMaxEndpoint(ws, config, 'WebSocket connection failed');
    };
    ws.onclose = (event: any) => {
      if (this.minimaxWs !== ws || this.stopping || this.ttsStarted) return;
      this.tryNextMiniMaxEndpoint(ws, config, formatWebSocketClose(event) || 'connection closed');
    };
    ws.onmessage = (message: any) => {
      this.handleMiniMaxMessage(String(message.data), ws, config);
    };
  }

  private sendMiniMaxTaskStart(ws: WebSocket, config: TTSConfig): void {
    if (this.minimaxWs !== ws || ws.readyState !== WebSocket.OPEN || this.ttsStartSent) return;
    this.ttsStartSent = true;
    ws.send(JSON.stringify({
      event: 'task_start',
      model: config.model || 'speech-02-hd',
      voice_setting: {
        voice_id: config.voiceId,
        speed: config.speed,
        vol: config.vol,
        pitch: config.pitch,
      },
      audio_setting: {
        sample_rate: MINIMAX_SAMPLE_RATE,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }));
  }

  private handleMiniMaxMessage(raw: string, ws: WebSocket, config: TTSConfig): void {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    const eventName = String(event.event || event.type || '');
    if (eventName === 'connected_success') {
      this.minimaxConnected = true;
      if (this.minimaxStartTimer !== null) {
        clearTimeout(this.minimaxStartTimer);
        this.minimaxStartTimer = null;
      }
      this.sendMiniMaxTaskStart(ws, config);
      return;
    }
    if (eventName === 'task_started') {
      this.ttsStarted = true;
      this.drainMiniMaxTextQueue();
      return;
    }
    const audioHex = typeof event?.data?.audio === 'string'
      ? event.data.audio
      : typeof event?.audio === 'string'
        ? event.audio
        : '';
    if (audioHex) {
      this.update({ status: 'speaking' });
      this.minimaxAudioHexParts.push(audioHex);
    }
    if (event.is_final && this.minimaxAudioHexParts.length > 0) {
      const audio = this.minimaxAudioHexParts.join('');
      this.minimaxAudioHexParts = [];
      enqueueVoiceCallMp3Clip(hexToBase64(audio)).catch((error) => {
        this.fail(error?.message || 'Failed to play TTS audio');
      });
    }
    const statusCode = event?.base_resp?.status_code ?? event?.status_code;
    if (typeof statusCode === 'number' && statusCode !== 0) {
      const message = event?.base_resp?.status_msg || event?.message || 'MiniMax TTS returned an error';
      if (!this.ttsStarted) {
        this.tryNextMiniMaxEndpoint(ws, config, message);
      } else {
        this.fail(message);
      }
    }
  }

  private tryNextMiniMaxEndpoint(ws: WebSocket, config: TTSConfig, reason: string): void {
    if (this.minimaxWs !== ws || this.stopping) return;
    const endpoints = buildMiniMaxWebSocketUrls(config.groupId);
    const nextIndex = this.minimaxEndpointIndex + 1;
    if (this.minimaxStartTimer !== null) {
      clearTimeout(this.minimaxStartTimer);
      this.minimaxStartTimer = null;
    }
    try {
      ws.close();
    } catch {
    }
    this.minimaxWs = null;
    this.ttsStarted = false;
    this.ttsStartSent = false;
    this.minimaxConnected = false;

    if (nextIndex < endpoints.length) {
      this.connectMiniMax(config, nextIndex);
      return;
    }

    this.fail(`MiniMax TTS realtime connection failed: ${reason}. Tried ${endpoints.map((item) => new URL(item).host).join(', ')}`);
  }

  private sendMiniMaxText(text: string): void {
    const normalized = text.trim();
    if (!normalized) return;
    this.update({ speakingText: normalized });
    if (!this.minimaxWs || this.minimaxWs.readyState > WebSocket.OPEN) {
      this.connectMiniMax(useSettingsStore.getState().ttsConfig);
    }
    if (!this.ttsStarted || this.minimaxWs?.readyState !== WebSocket.OPEN) {
      this.ttsTextQueue.push(normalized);
      return;
    }
    this.minimaxWs.send(JSON.stringify({ event: 'task_continue', text: normalized }));
  }

  private drainMiniMaxTextQueue(): void {
    const queued = [...this.ttsTextQueue];
    this.ttsTextQueue = [];
    queued.forEach((text) => this.sendMiniMaxText(text));
  }

  private finishMiniMax(): void {
    if (this.minimaxWs?.readyState === WebSocket.OPEN && this.ttsStarted) {
      this.minimaxWs.send(JSON.stringify({ event: 'task_finish' }));
    }
  }

  private handleBargeIn(chunks: string[]): void {
    if (!this.snapshot.active || this.stopping) return;
    this.bargeInRecognitionOpenUntil = Date.now() + BARGE_IN_RECOGNITION_OPEN_MS;
    this.assistantPlaybackActive = false;
    this.suppressRecognitionUntil = 0;
    this.clearRecognitionBuffers();
    this.interruptAssistant();

    const ws = this.deepgramWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      chunks.forEach((chunk) => {
        if (chunk) {
          this.markMicAudioSent();
          ws.send(base64ToArrayBuffer(chunk));
        }
      });
    }

    const aliyunWs = this.aliyunWs;
    if (aliyunWs && aliyunWs.readyState === WebSocket.OPEN) {
      chunks.forEach((chunk) => {
        if (chunk) {
          this.markMicAudioSent();
          aliyunWs.send(JSON.stringify(buildAliyunAudioAppendRequest(chunk)));
        }
      });
    }
  }

  private handleLocalSpeechEnd(): void {
    if (this.deepgramFluxMode) return;
    if (!this.snapshot.active || this.stopping || this.snapshot.status !== 'listening') return;
    if (this.aliyunWs?.readyState === WebSocket.OPEN) {
      if (!useSettingsStore.getState().sttConfig.aliyunSemanticVad) {
        this.commitAliyunAudio();
        this.schedulePendingTranscriptFlush(ALIYUN_MANUAL_COMMIT_SILENCE_MS);
      }
      return;
    }
    if (!this.finalTranscriptParts.length && !this.lastInterimTranscript && !this.snapshot.partialTranscript) return;
    this.schedulePendingTranscriptFlush(this.isDeepgramChineseMode()
      ? CHINESE_LOCAL_SPEECH_END_FLUSH_MS
      : LOCAL_SPEECH_END_FLUSH_MS);
  }

  private getPendingTranscriptFlushMs(): number {
    return this.isDeepgramChineseMode()
      ? CHINESE_PENDING_TRANSCRIPT_FLUSH_MS
      : PENDING_TRANSCRIPT_FLUSH_MS;
  }

  private isDeepgramChineseMode(): boolean {
    const settings = useSettingsStore.getState();
    if (settings.sttConfig.provider !== 'deepgram') return false;
    if (isDeepgramFluxModel(settings.sttConfig.deepgramModel)) return false;
    return isChineseDeepgramLanguage(settings.sttConfig.deepgramLanguage);
  }

  private commitAliyunAudio(): void {
    const ws = this.aliyunWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(buildAliyunCommitRequest()));
  }

  private isDuplicateSubmittedUserText(text: string): boolean {
    const previous = normalizeTranscriptForCompare(this.lastSubmittedUserText);
    const next = normalizeTranscriptForCompare(text);
    if (!previous || !next) return false;
    if (Date.now() - this.lastSubmittedUserTextAt > DUPLICATE_USER_TEXT_WINDOW_MS) return false;
    return previous === next;
  }

  private interruptAssistant(): void {
    clearVoiceCallSpeaker().catch(() => undefined);
    this.closeAssistantTts();
    const chat = useChatStore.getState();
    if (chat.isStreaming) {
      chat.stopStreaming();
    }
    this.cleanupChatBridge();
    this.pendingTtsText = '';
    this.ttsTextQueue = [];
    this.minimaxAudioHexParts = [];
    this.enterListeningState({ speakingText: '' });
  }

  private cleanupChatBridge(): void {
    this.chatSubscription?.();
    this.chatSubscription = null;
  }

  private closeDeepgram(): void {
    if (this.deepgramKeepAlive !== null) {
      clearInterval(this.deepgramKeepAlive);
      this.deepgramKeepAlive = null;
    }
    const ws = this.deepgramWs;
    this.deepgramWs = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
    }
  }

  private closeRealtimeStt(): void {
    this.closeDeepgram();
    this.closeAliyun();
  }

  private closeAliyun(): void {
    const ws = this.aliyunWs;
    this.aliyunWs = null;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
    }
  }

  private closeAssistantTts(): void {
    this.closeMiniMax();
    this.closeCartesia();
  }

  private closeCartesia(): void {
    if (this.cartesiaFinishTimer !== null) {
      clearTimeout(this.cartesiaFinishTimer);
      this.cartesiaFinishTimer = null;
    }
    const ws = this.cartesiaWs;
    this.cartesiaWs = null;
    this.cartesiaContextId = null;
    this.ttsStarted = false;
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
    }
  }

  private closeMiniMax(): void {
    if (this.minimaxStartTimer !== null) {
      clearTimeout(this.minimaxStartTimer);
      this.minimaxStartTimer = null;
    }
    const ws = this.minimaxWs;
    this.minimaxWs = null;
    this.ttsStarted = false;
    this.ttsStartSent = false;
    this.minimaxConnected = false;
    this.minimaxAudioHexParts = [];
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close();
    }
  }

  private setAssistantPlaybackActive(active: boolean): void {
    const now = Date.now();
    this.assistantPlaybackActive = active;
    if (active) {
      this.bargeInRecognitionOpenUntil = 0;
      this.suppressRecognitionUntil = now + PLAYBACK_RECOGNITION_SUPPRESS_MS;
    } else {
      this.suppressRecognitionUntil = now < this.bargeInRecognitionOpenUntil ? 0 : now + PLAYBACK_RECOGNITION_SUPPRESS_MS;
    }
    this.clearRecognitionBuffers();
    if (!this.snapshot.active || this.stopping || this.snapshot.status === 'error') return;
    if (active) {
      this.update({ status: 'speaking', partialTranscript: '' });
    } else if (!useChatStore.getState().isStreaming && this.snapshot.status === 'speaking') {
      this.enterListeningState({ speakingText: '', partialTranscript: '' });
    }
  }

  private shouldSuppressRecognition(): boolean {
    const now = Date.now();
    if (now < this.bargeInRecognitionOpenUntil) return false;
    return this.assistantPlaybackActive || now < this.suppressRecognitionUntil;
  }

  private clearRecognitionBuffers(): void {
    this.clearPendingTranscriptFlush();
    this.finalTranscriptParts = [];
    this.lastInterimTranscript = '';
    if (this.snapshot.partialTranscript) {
      this.update({ partialTranscript: '' });
    }
  }

  private enterListeningState(patch: Partial<VoiceCallSnapshot> = {}): void {
    this.clearRecognitionBuffers();
    this.listeningStartedAt = Date.now();
    this.sentAudioInCurrentListeningWindow = false;
    this.lastMicAudioSentAt = 0;
    this.update({
      ...patch,
      status: 'listening',
      partialTranscript: '',
    });
  }

  private markMicAudioSent(): void {
    this.sentAudioInCurrentListeningWindow = true;
    this.lastMicAudioSentAt = Date.now();
  }

  private fail(message: string): void {
    if (this.stopping) return;
    this.stopping = true;
    if (useChatStore.getState().isStreaming) {
      useChatStore.getState().stopStreaming();
    }
    this.cleanupChatBridge();
    this.closeAssistantTts();
    this.closeRealtimeStt();
    this.audioChunkSubscription?.remove();
    this.audioErrorSubscription?.remove();
    this.bargeInSubscription?.remove();
    this.speechEndSubscription?.remove();
    this.playbackSubscription?.remove();
    this.audioChunkSubscription = null;
    this.audioErrorSubscription = null;
    this.bargeInSubscription = null;
    this.speechEndSubscription = null;
    this.playbackSubscription = null;
    this.assistantPlaybackActive = false;
    this.suppressRecognitionUntil = 0;
    this.bargeInRecognitionOpenUntil = 0;
    this.lastSubmittedUserText = '';
    this.lastSubmittedUserTextAt = 0;
    this.listeningStartedAt = 0;
    this.sentAudioInCurrentListeningWindow = false;
    this.lastMicAudioSentAt = 0;
    stopVoiceCallAudio().catch(() => undefined);
    this.closeVoiceCallSystemMessage().catch(() => undefined);
    this.stopping = false;
    this.update({
      active: false,
      status: 'error',
      startedAt: null,
      micEnabled: true,
      speakerphoneOn: false,
      partialTranscript: '',
      speakingText: '',
      error: message,
    });
  }

  private update(patch: Partial<VoiceCallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private appendTranscriptItem(speaker: VoiceCallTranscriptItem['speaker'], text: string): void {
    const normalized = text.trim();
    if (!normalized) return;
    this.update({
      transcriptItems: [
        ...this.snapshot.transcriptItems,
        {
          id: `${speaker}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          speaker,
          text: normalized,
        },
      ].slice(-80),
    });
  }

  private appendAssistantTranscriptDelta(delta: string): void {
    const normalized = delta.replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    const items = [...this.snapshot.transcriptItems];
    const activeId = this.activeAssistantTranscriptId;
    const activeIndex = activeId ? items.findIndex((item) => item.id === activeId) : -1;
    if (activeIndex >= 0) {
      const current = items[activeIndex];
      items[activeIndex] = {
        ...current,
        text: `${current.text}${current.text.endsWith(' ') ? '' : ' '}${normalized}`.trim(),
      };
      this.update({ transcriptItems: items.slice(-80) });
      return;
    }
    const item = {
      id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      speaker: 'assistant' as const,
      text: normalized,
    };
    this.activeAssistantTranscriptId = item.id;
    this.update({ transcriptItems: [...items, item].slice(-80) });
  }

  private async closeVoiceCallSystemMessage(): Promise<void> {
    if (!this.voiceCallSystemMessageOpen) return;
    this.voiceCallSystemMessageOpen = false;
    await useChatStore.getState().addSystemMessage(VOICE_CALL_END_SYSTEM_MESSAGE).catch(() => null);
  }
}

function buildDeepgramLiveUrl(baseUrl: string, model: string, language: string): string {
  const normalizedModel = model.trim() || 'nova-3';
  const fluxMode = isDeepgramFluxModel(normalizedModel);
  const url = new URL(baseUrl.trim() || (fluxMode ? 'https://api.deepgram.com/v2' : 'https://api.deepgram.com/v1'));
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  const path = url.pathname.replace(/\/$/, '');
  if (fluxMode) {
    url.pathname = buildDeepgramFluxListenPath(path);
  } else {
    url.pathname = path.endsWith('/listen') ? path : `${path || '/v1'}/listen`;
  }
  url.searchParams.set('model', normalizedModel);
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', String(DEEPGRAM_SAMPLE_RATE));
  if (fluxMode) {
    url.searchParams.set('eot_threshold', DEEPGRAM_FLUX_EOT_THRESHOLD);
    url.searchParams.set('eot_timeout_ms', DEEPGRAM_FLUX_EOT_TIMEOUT_MS);
    const normalizedLanguage = language.trim();
    if (normalizedLanguage) {
      normalizedLanguage.split(/[,\s]+/).filter(Boolean).forEach((item) => {
        url.searchParams.append('language_hint', item);
      });
    }
    return url.toString();
  }
  url.searchParams.set('channels', '1');
  url.searchParams.set('interim_results', 'true');
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('vad_events', 'true');
  url.searchParams.set('endpointing', '1000');
  url.searchParams.set('utterance_end_ms', '1800');
  const normalizedLanguage = language.trim();
  url.searchParams.set('language', normalizedLanguage || 'multi');
  return url.toString();
}

function buildAliyunRealtimeUrl(baseUrl: string, model: string): string {
  const url = new URL(baseUrl.trim() || 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
  url.protocol = url.protocol === 'http:' ? 'ws:' : url.protocol === 'https:' ? 'wss:' : url.protocol;
  url.searchParams.set('model', model.trim() || 'qwen3-asr-flash-realtime');
  return url.toString();
}

function buildAliyunSessionUpdateRequest(config: STTConfig): Record<string, any> {
  const language = config.aliyunLanguage.trim() || 'zh';
  return {
    event_id: createRealtimeEventId('session'),
    type: 'session.update',
    session: {
      modalities: ['text'],
      input_audio_format: 'pcm',
      sample_rate: ALIYUN_SAMPLE_RATE,
      input_audio_transcription: {
        model: config.aliyunModel.trim() || 'qwen3-asr-flash-realtime',
        language,
      },
      turn_detection: config.aliyunSemanticVad
        ? {
            type: 'server_vad',
            threshold: 0.2,
            prefix_padding_ms: 300,
            silence_duration_ms: 750,
          }
        : null,
    },
  };
}

function buildAliyunAudioAppendRequest(base64: string): Record<string, any> {
  return {
    event_id: createRealtimeEventId('audio'),
    type: 'input_audio_buffer.append',
    audio: base64,
  };
}

function buildAliyunCommitRequest(): Record<string, any> {
  return {
    event_id: createRealtimeEventId('commit'),
    type: 'input_audio_buffer.commit',
  };
}

function createRealtimeEventId(prefix: string): string {
  return `event_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildDeepgramFluxListenPath(path: string): string {
  if (!path || path === '/') return '/v2/listen';
  if (path.endsWith('/v2/listen')) return path;
  if (path.endsWith('/v1/listen')) return `${path.slice(0, -'/v1/listen'.length)}/v2/listen`;
  if (path.endsWith('/v1')) return `${path.slice(0, -'/v1'.length)}/v2/listen`;
  if (path.endsWith('/v2')) return `${path}/listen`;
  if (path.endsWith('/listen')) return path;
  return `${path}/listen`;
}

function waitForChatIdle(): Promise<void> {
  if (!useChatStore.getState().isStreaming) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useChatStore.subscribe((state) => {
      if (!state.isStreaming) {
        unsubscribe();
        resolve();
      }
    });
    if (!useChatStore.getState().isStreaming) {
      unsubscribe();
      resolve();
    }
  });
}

function buildDeepgramAuthorizationHeader(apiKey: string): string {
  const token = normalizeDeepgramApiKey(apiKey);
  return token.split('.').length === 3 ? `Bearer ${token}` : `Token ${token}`;
}

function normalizeDeepgramApiKey(apiKey: string): string {
  return apiKey.trim().replace(/^(token|bearer)\s+/i, '').trim();
}

function buildMiniMaxWebSocketUrls(groupId: string): string[] {
  const normalizedGroupId = groupId.trim();
  const withGroupId = (rawUrl: string) => {
    const url = new URL(rawUrl);
    if (normalizedGroupId) {
      url.searchParams.set('GroupId', normalizedGroupId);
    }
    return url.toString();
  };

  return [
    withGroupId('wss://api.minimax.chat/ws/v1/t2a_v2'),
    withGroupId('wss://api.minimaxi.com/ws/v1/t2a_v2'),
    withGroupId('wss://api.minimaxi.chat/ws/v1/t2a_v2'),
    'wss://api.minimax.io/ws/v1/t2a_v2',
    'wss://api-uw.minimax.io/ws/v1/t2a_v2',
  ];
}

function buildCartesiaWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim() || 'https://api.cartesia.ai');
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  const path = url.pathname.replace(/\/$/, '');
  url.pathname = path.endsWith('/tts/websocket') ? path : `${path || ''}/tts/websocket`;
  url.searchParams.set('cartesia_version', CARTESIA_VERSION);
  return url.toString();
}

function buildCartesiaGenerationRequest(config: TTSConfig, contextId: string, transcript: string, mayContinue: boolean): Record<string, any> {
  return {
    model_id: config.cartesiaModel.trim() || 'sonic-3.5',
    transcript,
    voice: {
      mode: 'id',
      id: config.cartesiaVoiceId.trim(),
    },
    output_format: {
      container: 'raw',
      encoding: 'pcm_s16le',
      sample_rate: CARTESIA_SAMPLE_RATE,
    },
    language: normalizeCartesiaLanguage(config.cartesiaLanguage),
    context_id: contextId,
    continue: mayContinue,
    max_buffer_delay_ms: 120,
    generation_config: {
      speed: clampNumber(config.cartesiaSpeed, 0.6, 1.5, 1),
      volume: clampNumber(config.cartesiaVolume, 0.5, 2, 1),
    },
  };
}

function getVoiceCallTtsSampleRate(config: TTSConfig): number {
  return config.provider === 'cartesia' ? CARTESIA_SAMPLE_RATE : MINIMAX_SAMPLE_RATE;
}

function extractDeepgramTranscript(event: any): string {
  const alternatives = event?.channel?.alternatives;
  if (!Array.isArray(alternatives)) return '';
  return alternatives
    .map((alternative) => typeof alternative?.transcript === 'string' ? alternative.transcript.trim() : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractDeepgramFluxTranscript(event: any): string {
  if (typeof event?.transcript === 'string') return event.transcript.trim();
  if (typeof event?.channel?.alternatives?.[0]?.transcript === 'string') {
    return event.channel.alternatives[0].transcript.trim();
  }
  if (Array.isArray(event?.words)) {
    return event.words
      .map((word: any) => typeof word?.word === 'string' ? word.word.trim() : '')
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return '';
}

function isAliyunSpeechEvent(type: string): boolean {
  return type.includes('input_audio_buffer.speech_started')
    || type.includes('input_audio_buffer.speech_stopped')
    || type.includes('speech_started')
    || type.includes('speech_stopped');
}

function isAliyunTranscriptEvent(type: string): boolean {
  return type.includes('input_audio_transcription')
    || type.includes('transcription')
    || type.includes('transcript');
}

function isAliyunFinalTranscriptEvent(type: string): boolean {
  return type.includes('completed')
    || type.includes('committed')
    || type.endsWith('.done');
}

function extractAliyunTranscript(event: any): string {
  const direct = pickString(
    event.transcript,
    event.text,
    event.delta,
    event.output?.text,
    event.output?.transcript,
    event.result?.text,
    event.result?.transcript,
    event.item?.content?.[0]?.transcript,
    event.item?.content?.[0]?.text
  );
  const stash = pickString(event.stash, event.output?.stash, event.result?.stash);
  return `${direct}${stash}`.trim();
}

function extractAliyunErrorMessage(event: any): string {
  const message = pickString(
    event.error?.message,
    event.error?.code,
    event.message,
    event.code
  );
  return message ? `阿里实时 STT 错误：${message}` : '阿里实时 STT 返回错误';
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function uniqueJoin(parts: string[]): string {
  const result: string[] = [];
  parts.forEach((part) => {
    const normalized = part.trim();
    if (!normalized) return;
    if (result[result.length - 1] === normalized) return;
    result.push(normalized);
  });
  return result.join(' ');
}

function normalizeTranscriptForCompare(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:]+/g, '');
}

function isDeepgramFluxModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('flux-');
}

function isChineseDeepgramLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return normalized === 'zh'
    || normalized === 'zh-cn'
    || normalized === 'zh-hans'
    || normalized === 'zh-tw'
    || normalized === 'zh-hant'
    || normalized === 'zh-hk'
    || normalized === 'cmn'
    || normalized === 'yue';
}

function createPcmSilence(sampleRate: number, durationMs: number): ArrayBuffer {
  return new ArrayBuffer(Math.max(1, Math.floor(sampleRate * durationMs / 1000)) * 2);
}

function normalizeCartesiaLanguage(language: string): string {
  return (language || 'zh').trim() || 'zh';
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function extractSpeakableAssistantText(content: string): string {
  return stripSpeechBracketedContent(content
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ')
    .replace(/<thinking>[\s\S]*$/gi, ' '))
    .replace(/\s+/g, ' ')
    .trimStart();
}

function stripSpeechBracketedContent(text: string): string {
  let previous = text;
  let next = previous;
  for (let pass = 0; pass < 8; pass += 1) {
    next = previous;
    SPEECH_BRACKETED_CONTENT_PATTERNS.forEach((pattern) => {
      pattern.lastIndex = 0;
      next = next.replace(pattern, ' ');
    });
    if (next === previous) break;
    previous = next;
  }
  return next.replace(SPEECH_TRAILING_BRACKETED_CONTENT, ' ');
}

function findTtsBoundary(text: string): number {
  for (let index = 0; index < text.length; index += 1) {
    if (TTS_SEGMENT_BOUNDARY.test(text[index])) {
      TTS_SEGMENT_BOUNDARY.lastIndex = 0;
      return index;
    }
  }
  TTS_SEGMENT_BOUNDARY.lastIndex = 0;
  return -1;
}

function formatWebSocketClose(event: any): string {
  const code = typeof event?.code === 'number' ? event.code : undefined;
  const reason = typeof event?.reason === 'string' ? event.reason.trim() : '';
  if (code && reason) return `${code} ${reason}`;
  if (code) return `code ${code}`;
  return reason;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function hexToBase64(hex: string): string {
  let binary = '';
  for (let index = 0; index < hex.length; index += 2) {
    binary += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16));
  }
  return globalThis.btoa(binary);
}
