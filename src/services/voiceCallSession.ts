import { requestRecordingPermissionsAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { useChatStore } from '../stores/chat';
import { useSettingsStore, type TTSConfig } from '../stores/settings';
import {
  addVoiceCallAudioChunkListener,
  addVoiceCallAudioErrorListener,
  addVoiceCallBargeInListener,
  addVoiceCallSpeechEndListener,
  addVoiceCallPlaybackListener,
  clearVoiceCallSpeaker,
  enqueueVoiceCallMp3Clip,
  isAndroidVoiceCallAudioAvailable,
  setVoiceCallSpeakerphoneOn,
  startVoiceCallMic,
  startVoiceCallSpeaker,
  stopVoiceCallMic,
  stopVoiceCallAudio,
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
const MINIMAX_SAMPLE_RATE = 32000;
const PLAYBACK_RECOGNITION_SUPPRESS_MS = 900;
const BARGE_IN_RECOGNITION_OPEN_MS = 2500;
const PENDING_TRANSCRIPT_FLUSH_MS = 1500;
const LOCAL_SPEECH_END_FLUSH_MS = 900;
const DUPLICATE_USER_TEXT_WINDOW_MS = 6000;
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
  private minimaxWs: WebSocket | null = null;
  private deepgramKeepAlive: ReturnType<typeof setInterval> | null = null;
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
      this.finishMiniMax();
      if (useChatStore.getState().error) {
        throw new Error(useChatStore.getState().error || 'AI 主动语音开场失败');
      }
      if (this.snapshot.active && this.snapshot.status !== 'error') {
        this.update({ status: 'listening' });
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
    if (settings.sttConfig.provider !== 'deepgram') {
      throw new Error('语音通话需要在设置中将 STT 选择为 Deepgram');
    }
    if (settings.ttsConfig.provider !== 'minimax') {
      throw new Error('语音通话当前仅支持 MiniMax TTS');
    }
    if (!settings.sttConfig.deepgramApiKey.trim()) {
      throw new Error('请先配置 Deepgram API Key');
    }
    if (!settings.ttsConfig.apiKey.trim() || !settings.ttsConfig.voiceId.trim()) {
      throw new Error('请先配置 MiniMax API Key 和 Voice ID');
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
    await startVoiceCallSpeaker(MINIMAX_SAMPLE_RATE, 1);
    await setVoiceCallSpeakerphoneOn(false).catch(() => undefined);
    await this.connectDeepgram();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.snapshot.active || this.stopping || this.snapshot.micEnabled === enabled) return;
    if (enabled) {
      await startVoiceCallMic(DEEPGRAM_SAMPLE_RATE, 20);
      this.update({ micEnabled: true, status: this.snapshot.status === 'idle' ? 'listening' : this.snapshot.status });
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
    this.closeMiniMax();
    this.closeDeepgram();
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

  private async connectDeepgram(): Promise<void> {
    const settings = useSettingsStore.getState();
    const url = buildDeepgramLiveUrl(
      settings.sttConfig.deepgramBaseUrl,
      settings.sttConfig.deepgramModel,
      settings.sttConfig.deepgramLanguage
    );
    const apiKey = settings.sttConfig.deepgramApiKey.trim();
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
        this.update({ status: 'listening' });
        this.audioChunkSubscription = addVoiceCallAudioChunkListener((event) => {
          if (this.deepgramWs !== ws || ws.readyState !== WebSocket.OPEN) return;
          if (this.shouldSuppressRecognition()) return;
          ws.send(base64ToArrayBuffer(event.base64));
        });
        startVoiceCallMic(DEEPGRAM_SAMPLE_RATE, 20).then(
          () => settle(),
          (error) => settle(error instanceof Error ? error : new Error(String(error)))
        );
        this.deepgramKeepAlive = setInterval(() => {
          if (this.deepgramWs === ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'KeepAlive' }));
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

  private handleDeepgramMessage(raw: string): void {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    if (this.shouldSuppressRecognition()) {
      if (event.type === 'SpeechStarted' || event.type === 'UtteranceEnd' || event.type === 'Results') {
        this.clearRecognitionBuffers();
        return;
      }
    }

    if (event.type === 'SpeechStarted') {
      if (this.snapshot.status === 'speaking' || useChatStore.getState().isStreaming) {
        this.interruptAssistant();
      }
      return;
    }

    if (event.type === 'UtteranceEnd') {
      this.flushFinalTranscript();
      return;
    }

    if (event.type !== 'Results') return;
    if (this.snapshot.status !== 'listening') {
      this.clearRecognitionBuffers();
      return;
    }
    const transcript = extractDeepgramTranscript(event);
    if (!transcript) return;

    if (event.is_final) {
      this.finalTranscriptParts.push(transcript);
      this.lastInterimTranscript = '';
      this.update({ partialTranscript: uniqueJoin(this.finalTranscriptParts) });
    } else {
      this.lastInterimTranscript = transcript;
      this.update({ partialTranscript: transcript });
    }
    this.schedulePendingTranscriptFlush();

    if (event.speech_final) {
      this.flushFinalTranscript();
    }
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
    this.finishMiniMax();
    if (this.snapshot.active && this.snapshot.status !== 'error') {
      this.update({ status: 'listening' });
    }
  }

  private startAssistantTtsBridge(): void {
    this.cleanupChatBridge();
    this.closeMiniMax();
    this.activeAssistantId = null;
    this.activeAssistantTranscriptId = null;
    this.lastSpeakableAssistantText = '';
    this.pendingTtsText = '';
    this.ttsTextQueue = [];
    this.connectMiniMax(useSettingsStore.getState().ttsConfig);

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
      this.sendMiniMaxText(segment);
      boundaryIndex = findTtsBoundary(this.pendingTtsText);
    }

    if (this.pendingTtsText.length >= MAX_TTS_SEGMENT_CHARS || (force && this.pendingTtsText.trim())) {
      const segment = this.pendingTtsText.trim();
      this.pendingTtsText = '';
      this.sendMiniMaxText(segment);
    }
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
          ws.send(base64ToArrayBuffer(chunk));
        }
      });
    }
  }

  private handleLocalSpeechEnd(): void {
    if (!this.snapshot.active || this.stopping || this.snapshot.status !== 'listening') return;
    if (!this.finalTranscriptParts.length && !this.lastInterimTranscript && !this.snapshot.partialTranscript) return;
    this.schedulePendingTranscriptFlush(LOCAL_SPEECH_END_FLUSH_MS);
  }

  private isDuplicateSubmittedUserText(text: string): boolean {
    const previous = normalizeTranscriptForCompare(this.lastSubmittedUserText);
    const next = normalizeTranscriptForCompare(text);
    if (!previous || !next) return false;
    if (Date.now() - this.lastSubmittedUserTextAt > DUPLICATE_USER_TEXT_WINDOW_MS) return false;
    if (previous === next) return true;
    return previous.includes(next) || next.includes(previous);
  }

  private interruptAssistant(): void {
    clearVoiceCallSpeaker().catch(() => undefined);
    this.closeMiniMax();
    const chat = useChatStore.getState();
    if (chat.isStreaming) {
      chat.stopStreaming();
    }
    this.cleanupChatBridge();
    this.pendingTtsText = '';
    this.ttsTextQueue = [];
    this.minimaxAudioHexParts = [];
    this.update({ status: 'listening', speakingText: '' });
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
      this.update({ status: 'listening', speakingText: '', partialTranscript: '' });
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

  private fail(message: string): void {
    if (this.stopping) return;
    this.stopping = true;
    if (useChatStore.getState().isStreaming) {
      useChatStore.getState().stopStreaming();
    }
    this.cleanupChatBridge();
    this.closeMiniMax();
    this.closeDeepgram();
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
  const url = new URL(baseUrl.trim() || 'https://api.deepgram.com/v1');
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  const path = url.pathname.replace(/\/$/, '');
  url.pathname = path.endsWith('/listen') ? path : `${path || '/v1'}/listen`;
  url.searchParams.set('model', model.trim() || 'nova-3');
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', String(DEEPGRAM_SAMPLE_RATE));
  url.searchParams.set('channels', '1');
  url.searchParams.set('interim_results', 'true');
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('vad_events', 'true');
  url.searchParams.set('endpointing', '650');
  url.searchParams.set('utterance_end_ms', '1200');
  const normalizedLanguage = language.trim();
  url.searchParams.set('language', normalizedLanguage || 'multi');
  return url.toString();
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
  const token = apiKey.trim();
  return token.split('.').length === 3 ? `Bearer ${token}` : `Token ${token}`;
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

function extractDeepgramTranscript(event: any): string {
  const alternatives = event?.channel?.alternatives;
  if (!Array.isArray(alternatives)) return '';
  return alternatives
    .map((alternative) => typeof alternative?.transcript === 'string' ? alternative.transcript.trim() : '')
    .filter(Boolean)
    .join('\n')
    .trim();
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
