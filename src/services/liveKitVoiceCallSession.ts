import { AudioSession, registerGlobals } from '@livekit/react-native';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  Room,
  RoomEvent,
  Track,
  LocalVideoTrack,
  type RpcInvocationData,
  type Participant,
  type TranscriptionSegment,
} from 'livekit-client';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { getHiddenMessageIds, getHiddenRanges, getMessagesByConversation } from '../db/operations';
import { executeTool, getToolDefinitions, type ToolExecutionResult } from './tools';
import {
  getVoiceCallEndSystemMessage,
  getVoiceCallRuntimeInstruction,
  getVoiceCallStartSystemMessage,
  type VoiceCallSnapshot,
  type VoiceCallTranscriptItem,
} from './voiceCallSession';
import type { VoiceCallMode } from '../stores/voiceCall';

registerGlobals();

type SnapshotListener = (snapshot: VoiceCallSnapshot) => void;
type Subscription = { remove: () => void };

interface ConnectionDetails {
  server_url: string;
  room_name: string;
  participant_token: string;
}

const TOOL_RPC_METHOD = 'ysclaude.execute_tool';
const MAX_CONTEXT_CHARS = 32_000;

export class LiveKitVoiceCallSession {
  private room: Room | null = null;
  private listeners = new Set<SnapshotListener>();
  private stopping = false;
  private voiceCallSystemMessageOpen = false;
  private transcriptWrittenToChat = false;
  private transcriptBaseTime = 0;
  private localVideoTrackListener: ((track: LocalVideoTrack | null) => void) | null = null;
  constructor(
    private readonly mode: VoiceCallMode = 'voice',
    private cameraFacing: 'front' | 'back' = 'front'
  ) {}
  private snapshot: VoiceCallSnapshot = {
    active: false,
    status: 'idle',
    startedAt: null,
    micEnabled: true,
    speakerphoneOn: true,
    partialTranscript: '',
    lastUserText: '',
    speakingText: '',
    transcriptItems: [],
    error: null,
  };

  subscribe(listener: SnapshotListener): Subscription {
    this.listeners.add(listener);
    listener(this.snapshot);
    return { remove: () => this.listeners.delete(listener) };
  }

  setLocalVideoTrackListener(listener: ((track: LocalVideoTrack | null) => void) | null): void {
    this.localVideoTrackListener = listener;
    const track = this.room?.localParticipant
      .getTrackPublication(Track.Source.Camera)?.videoTrack;
    listener?.(track instanceof LocalVideoTrack ? track : null);
  }

  async start(): Promise<void> {
    if (this.snapshot.active) return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error('请先允许麦克风权限');
    if (this.mode === 'video') {
      const cameraPermission = Platform.OS !== 'android'
        || await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
          === PermissionsAndroid.RESULTS.GRANTED;
      if (!cameraPermission) throw new Error('请先允许摄像头权限');
    }

    const settings = useSettingsStore.getState();
    const brainUrl = settings.liveKitVoiceCallConfig.brainUrl.trim().replace(/\/+$/, '');
    const apiConfig = settings.apiConfigs[settings.activeConfigIndex];
    const stt = settings.sttConfig;
    const tts = settings.ttsConfig;
    if (!brainUrl) throw new Error('请先配置 LiveKit Brain Server URL');
    if (!apiConfig?.baseUrl || !apiConfig.apiKey || !apiConfig.model) {
      throw new Error('当前聊天 LLM API 配置不完整');
    }
    if (!stt.aliyunApiKey.trim()) throw new Error('请先配置阿里 STT API Key');
    if (!tts.cartesiaApiKey.trim() || !tts.cartesiaVoiceId.trim()) {
      throw new Error('请先配置 Cartesia API Key 和 Voice ID');
    }

    this.update({
      active: true,
      status: 'connecting',
      startedAt: Date.now(),
      micEnabled: true,
      speakerphoneOn: true,
      partialTranscript: '',
      lastUserText: '',
      speakingText: '',
      transcriptItems: [],
      error: null,
    });
    this.transcriptWrittenToChat = false;

    const startMessage = await useChatStore.getState().addSystemMessage([
      getVoiceCallStartSystemMessage(this.mode),
      getVoiceCallRuntimeInstruction(this.mode),
    ].join('\n\n'));
    this.voiceCallSystemMessageOpen = !!startMessage;
    this.transcriptBaseTime = startMessage?.createdAt || Date.now();
    const callChat = useChatStore.getState();

    try {
      const historyMessages = await loadVoiceHistory(callChat.conversationId, callChat.messages);
      const details = await fetchConnectionDetails(brainUrl, settings.liveKitVoiceCallConfig.accessToken, {
        identity: `ysclaude-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        display_name: 'YSClaude 用户',
        system_prompt: settings.systemPrompt,
        conversation_id: callChat.conversationId,
        visual_mode: this.mode,
        history_messages: historyMessages,
        tools: buildVoiceToolDefinitions(settings),
        llm: {
          base_url: apiConfig.baseUrl,
          api_key: apiConfig.apiKey,
          model: apiConfig.model,
          max_completion_tokens: settings.maxOutputTokens,
        },
        stt: {
          base_url: stt.aliyunBaseUrl,
          api_key: stt.aliyunApiKey,
          model: stt.aliyunModel,
          language: stt.aliyunLanguage,
        },
        tts: {
          base_url: tts.cartesiaBaseUrl,
          api_key: tts.cartesiaApiKey,
          model: tts.cartesiaModel,
          voice_id: tts.cartesiaVoiceId,
          language: tts.cartesiaLanguage,
          speed: tts.cartesiaSpeed,
          volume: tts.cartesiaVolume,
        },
      });
      await AudioSession.startAudioSession();
      await selectSpeakerOutput(true);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      this.room = room;
      room.registerRpcMethod(TOOL_RPC_METHOD, (data) => this.executeToolRpc(data));
      this.bindRoom(room);
      await room.connect(details.server_url, details.participant_token);
      await room.localParticipant.setMicrophoneEnabled(true);
      if (this.mode === 'video') {
        const publication = await room.localParticipant.setCameraEnabled(true, {
          facingMode: this.cameraFacing === 'front' ? 'user' : 'environment',
        });
        const track = publication?.videoTrack;
        this.localVideoTrackListener?.(track instanceof LocalVideoTrack ? track : null);
      } else if (this.mode === 'screen') {
        await room.localParticipant.setScreenShareEnabled(true, { audio: false });
      }
      this.update({ status: 'listening' });
    } catch (error: any) {
      await this.cleanupRoom();
      await this.closeVoiceCallSystemMessage();
      this.fail(error?.message || 'LiveKit 语音通话连接失败');
      throw error;
    }
  }

  async startAssistantInitiatedTurn(instruction: string): Promise<void> {
    const room = this.room;
    if (!room || !instruction.trim()) return;
    const payload = new TextEncoder().encode(JSON.stringify({
      type: 'generate_reply',
      instructions: instruction.trim(),
    }));
    await room.localParticipant.publishData(payload, { reliable: true, topic: 'ysclaude.command' });
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await this.room?.localParticipant.setMicrophoneEnabled(enabled);
    this.update({ micEnabled: enabled });
  }

  async setSpeakerphoneOn(enabled: boolean): Promise<void> {
    await selectSpeakerOutput(enabled);
    this.update({ speakerphoneOn: enabled });
  }

  async setCameraFacing(facing: 'front' | 'back'): Promise<void> {
    this.cameraFacing = facing;
    if (this.mode !== 'video') return;
    const publication = this.room?.localParticipant.getTrackPublication(Track.Source.Camera);
    if (publication?.videoTrack) {
      await publication.videoTrack.restartTrack({
        facingMode: facing === 'front' ? 'user' : 'environment',
      });
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.update({ status: 'stopping' });
    try {
      await this.cleanupRoom();
      await this.closeVoiceCallSystemMessage();
    } finally {
      this.stopping = false;
      this.update({
        active: false,
        status: 'idle',
        startedAt: null,
        partialTranscript: '',
        speakingText: '',
        error: null,
      });
    }
  }

  private bindRoom(room: Room): void {
    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      this.handleTranscription(segments, participant);
    });
    room.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
      if (!participant.isAgent) return;
      const state = changed['lk.agent.state'] || participant.attributes['lk.agent.state'];
      if (state) this.updateAgentState(state);
    });
    room.on(RoomEvent.Reconnecting, () => this.update({ status: 'connecting' }));
    room.on(RoomEvent.Reconnected, () => this.update({ status: 'listening' }));
    room.on(RoomEvent.Disconnected, () => {
      if (!this.stopping && this.snapshot.active) this.fail('LiveKit 通话已断开');
    });
  }

  private async executeToolRpc(data: RpcInvocationData): Promise<string> {
    const payload = JSON.parse(data.payload || '{}') as { name?: string; arguments?: Record<string, any> };
    if (!payload.name) throw new Error('工具名称为空');
    const settings = useSettingsStore.getState();
    const result = await executeTool(payload.name, payload.arguments || {}, {
      conversationId: useChatStore.getState().conversationId || undefined,
      memoryVaultConfig: settings.memoryVaultConfig,
      webSearchConfig: settings.webSearchConfig,
      webInteractionConfig: settings.webInteractionConfig,
      conversationArtifactToolConfig: settings.conversationArtifactToolConfig,
      conversationWindowToolConfig: settings.conversationWindowToolConfig,
      htmlArtifactToolConfig: settings.htmlArtifactToolConfig,
      hotboardConfig: settings.hotboardConfig,
      runCommandConfig: settings.runCommandConfig,
      nativeToolConfig: settings.nativeToolConfig,
      mcpToolConfig: settings.mcpToolConfig,
    });
    return JSON.stringify(normalizeToolResult(result));
  }

  private handleTranscription(segments: TranscriptionSegment[], participant?: Participant): void {
    const speaker: VoiceCallTranscriptItem['speaker'] = participant?.isAgent ? 'assistant' : 'user';
    for (const segment of segments) {
      const text = segment.text.trim();
      if (!text) continue;
      if (!segment.final) {
        this.update(speaker === 'user' ? { partialTranscript: text } : { speakingText: text });
        continue;
      }
      const existing = this.snapshot.transcriptItems.findIndex((item) => item.id === segment.id);
      const item: VoiceCallTranscriptItem = { id: segment.id, speaker, text };
      const transcriptItems = existing >= 0
        ? this.snapshot.transcriptItems.map((old, index) => index === existing ? item : old)
        : [...this.snapshot.transcriptItems, item];
      this.update({
        transcriptItems,
        ...(speaker === 'user'
          ? { lastUserText: text, partialTranscript: '', status: 'thinking' as const }
          : { speakingText: text, status: 'speaking' as const }),
      });
    }
  }

  private updateAgentState(state: string): void {
    if (state === 'speaking') this.update({ status: 'speaking' });
    else if (state === 'thinking') this.update({ status: 'thinking', speakingText: '' });
    else if (state === 'listening') this.update({ status: 'listening', speakingText: '' });
    else if (state === 'initializing') this.update({ status: 'connecting' });
  }

  private async cleanupRoom(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.localVideoTrackListener?.(null);
    if (room) {
      room.unregisterRpcMethod(TOOL_RPC_METHOD);
      await room.disconnect().catch(() => undefined);
    }
    await AudioSession.stopAudioSession().catch(() => undefined);
  }

  private fail(message: string): void {
    this.update({ active: false, status: 'error', error: message });
    this.closeVoiceCallSystemMessage().catch(() => undefined);
  }

  private async closeVoiceCallSystemMessage(): Promise<void> {
    if (!this.voiceCallSystemMessageOpen) return;
    this.voiceCallSystemMessageOpen = false;
    await this.writeTranscriptToChat();
    await useChatStore.getState().addSystemMessage(
      getVoiceCallEndSystemMessage(this.mode)
    ).catch(() => null);
  }

  private async writeTranscriptToChat(): Promise<void> {
    if (this.transcriptWrittenToChat) return;
    this.transcriptWrittenToChat = true;
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const item of this.snapshot.transcriptItems) {
      const previous = turns[turns.length - 1];
      if (previous?.role === item.speaker) {
        previous.content = `${previous.content} ${item.text}`.trim();
      } else {
        turns.push({ role: item.speaker, content: item.text });
      }
    }
    await useChatStore.getState().addCallTranscriptMessages(
      turns.map((item, index) => ({
        ...item,
        createdAt: this.transcriptBaseTime + index + 1,
      }))
    ).catch(() => []);
  }

  private update(patch: Partial<VoiceCallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}

async function loadVoiceHistory(
  conversationId: string | null,
  fallbackMessages: ReturnType<typeof useChatStore.getState>['messages']
) {
  if (!conversationId) return buildHistoryMessages(fallbackMessages);
  const [messages, hiddenRanges, hiddenIds] = await Promise.all([
    getMessagesByConversation(conversationId),
    getHiddenRanges(conversationId),
    getHiddenMessageIds(conversationId),
  ]);
  const hiddenIdSet = new Set(hiddenIds);
  let floor = 0;
  const visible = messages.filter((message) => {
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') return false;
    if (message.role === 'user' || message.role === 'assistant') floor += 1;
    return !hiddenIdSet.has(message.id)
      && !hiddenRanges.some((range) => floor >= range.from && floor <= range.to);
  });
  return buildHistoryMessages(visible);
}

function buildHistoryMessages(messages: ReturnType<typeof useChatStore.getState>['messages']) {
  const result: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') continue;
    const content = message.content.trim();
    if (!content) continue;
    if (chars + content.length > MAX_CONTEXT_CHARS && result.length > 0) break;
    const remaining = Math.max(0, MAX_CONTEXT_CHARS - chars);
    result.unshift({ role: message.role, content: content.slice(-remaining) });
    chars += Math.min(content.length, remaining);
    if (chars >= MAX_CONTEXT_CHARS) break;
  }
  return result;
}

function buildVoiceToolDefinitions(settings: ReturnType<typeof useSettingsStore.getState>) {
  const memoryVault = settings.memoryVaultConfig.enabled && !!settings.memoryVaultConfig.baseUrl;
  const webSearch = settings.webSearchConfig.enabled && !!settings.webSearchConfig.tavilyApiKey;
  const runCommand = settings.runCommandConfig.enabled
    && !!settings.runCommandConfig.sshHost.trim()
    && !!settings.runCommandConfig.sshUsername.trim()
    && !!(settings.runCommandConfig.sshPassword || settings.runCommandConfig.sshPrivateKey);
  return getToolDefinitions({
    memoryVault,
    memoryVaultConfig: settings.memoryVaultConfig,
    webSearch,
    webInteraction: !!settings.webInteractionConfig.enabled,
    conversationArtifacts: !!settings.conversationArtifactToolConfig.enabled,
    conversationWindows: !!settings.conversationWindowToolConfig?.enabled,
    htmlArtifacts: !!settings.htmlArtifactToolConfig.enabled,
    runCommand: runCommand ? settings.runCommandConfig : undefined,
    nativeTools: settings.nativeToolConfig,
    mcpTools: settings.mcpToolConfig,
    voiceCallActive: true,
  });
}

function normalizeToolResult(result: ToolExecutionResult): { text: string; imageDataUrl?: string } {
  if (typeof result === 'string') return { text: result };
  return { text: result.text, imageDataUrl: result.dataUrl };
}

async function fetchConnectionDetails(brainUrl: string, accessToken: string, body: unknown): Promise<ConnectionDetails> {
  const response = await fetch(`${brainUrl}/api/livekit/session`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(accessToken.trim() ? { Authorization: `Bearer ${accessToken.trim()}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Brain Server 请求失败 (${response.status}): ${text.slice(0, 240)}`);
  const details = JSON.parse(text) as ConnectionDetails;
  if (!details.server_url || !details.participant_token) throw new Error('Brain Server 返回的连接信息不完整');
  return details;
}

async function selectSpeakerOutput(enabled: boolean): Promise<void> {
  const outputs = await AudioSession.getAudioOutputs();
  const preferred = enabled ? ['speaker', 'force_speaker'] : ['earpiece', 'default'];
  const output = preferred.find((candidate) => outputs.includes(candidate));
  if (output) await AudioSession.selectAudioOutput(output);
}
