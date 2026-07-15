import { create } from 'zustand';
import type { LocalVideoTrack } from 'livekit-client';
import {
  VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION,
  isAndroidVoiceCallAvailable,
  type VoiceCallSnapshot,
  type VoiceCallMediaMode,
} from '../services/voiceCallSession';
import { ElevenLabsVoiceCallSession } from '../services/elevenLabsVoiceCallSession';
import { LiveKitVoiceCallSession } from '../services/liveKitVoiceCallSession';
import {
  hideVoiceCallFloatingBall,
  showScreenCallFloatingBall,
  showVideoCallFloatingWindow,
  showVoiceCallFloatingBall,
} from '../services/floatingBall';
import { useChatStore } from './chat';
import { useSettingsStore } from './settings';
import {
  startVoiceCallForegroundService,
  stopVoiceCallForegroundService,
} from '../services/voiceCallForegroundService';

export const INITIAL_VOICE_CALL_SNAPSHOT: VoiceCallSnapshot = {
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

type Subscription = { remove: () => void };

export interface IncomingVoiceCall {
  id: string;
  reason: string;
  mode: VoiceCallMode;
  createdAt: number;
}

interface VoiceCallStartOptions {
  assistantInitialPrompt?: string;
  mode?: VoiceCallMode;
}

export type VoiceCallMode = VoiceCallMediaMode;

interface VoiceCallStore {
  snapshot: VoiceCallSnapshot;
  starting: boolean;
  minimized: boolean;
  mode: VoiceCallMode;
  cameraFacing: 'front' | 'back';
  localVideoTrack: LocalVideoTrack | null;
  incomingCall: IncomingVoiceCall | null;
  startCall: (options?: VoiceCallStartOptions) => Promise<void>;
  stopCall: () => Promise<void>;
  requestIncomingCall: (reason?: string, mode?: VoiceCallMode) => Promise<IncomingVoiceCall>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  setSpeakerphoneOn: (enabled: boolean) => Promise<void>;
  setCameraFacing: (facing: 'front' | 'back') => Promise<void>;
  minimizeToFloatingBall: (durationText: string, previewUri?: string) => Promise<void>;
  restoreFromFloatingBall: () => Promise<void>;
}

type VoiceCallSession = ElevenLabsVoiceCallSession | LiveKitVoiceCallSession;

let session: VoiceCallSession | null = null;
let sessionSubscription: Subscription | null = null;

export const useVoiceCallStore = create<VoiceCallStore>((set, get) => ({
  snapshot: INITIAL_VOICE_CALL_SNAPSHOT,
  starting: false,
  minimized: false,
  mode: 'voice',
  cameraFacing: 'front',
  localVideoTrack: null,
  incomingCall: null,

  startCall: async (options = {}) => {
    const current = get();
    if (current.snapshot.active || current.starting) return;
    if (!isAndroidVoiceCallAvailable()) {
      throw new Error('实时语音通话目前只支持 Android 自定义构建。');
    }

    const mode = options.mode || 'voice';
    const settings = useSettingsStore.getState();
    set({ starting: true, minimized: false, mode });
    if (settings.voiceCallEngine === 'livekit') {
      if (settings.voiceCallSTTProvider !== 'aliyun' || settings.voiceCallTTSProvider !== 'cartesia') {
        set({ starting: false });
        throw new Error('LiveKit Agents 需要选择阿里 STT + Cartesia TTS');
      }
    }
    const elevenLabsSelected = settings.voiceCallSTTProvider === 'elevenlabs'
      && settings.voiceCallTTSProvider === 'elevenlabs';
    const elevenLabsPartiallySelected = settings.voiceCallSTTProvider === 'elevenlabs'
      || settings.voiceCallTTSProvider === 'elevenlabs';
    if (elevenLabsPartiallySelected && !elevenLabsSelected) {
      set({ starting: false });
      throw new Error('使用 ElevenLabs 通话时，STT 和 TTS 必须同时选择 ElevenLabs');
    }
    if (settings.voiceCallEngine === 'elevenlabs' && mode !== 'voice') {
      set({ starting: false });
      throw new Error('ElevenLabs 当前仅支持语音通话；视频和共享屏幕请使用 LiveKit Agents');
    }
    const nextSession: VoiceCallSession = settings.voiceCallEngine === 'livekit'
      ? new LiveKitVoiceCallSession(mode, get().cameraFacing)
      : new ElevenLabsVoiceCallSession();
    if (nextSession instanceof LiveKitVoiceCallSession) {
      nextSession.setLocalVideoTrackListener((localVideoTrack) => set({ localVideoTrack }));
    } else {
      set({ localVideoTrack: null });
    }
    session = nextSession;
    sessionSubscription?.remove();
    sessionSubscription = nextSession.subscribe((snapshot) => {
      set({ snapshot });
      if (snapshot.status === 'error') {
        stopVoiceCallForegroundService().catch(() => undefined);
      }
    });

    try {
      await nextSession.start();
      await startVoiceCallForegroundService(mode);
    } catch (error) {
      await stopVoiceCallForegroundService().catch(() => undefined);
      await nextSession.stop().catch(() => undefined);
      sessionSubscription?.remove();
      sessionSubscription = null;
      session = null;
      const message = error instanceof Error ? error.message : '语音通话启动失败';
      set({
        starting: false,
        minimized: false,
        snapshot: { ...INITIAL_VOICE_CALL_SNAPSHOT, status: 'error', error: message },
      });
      throw error;
    }

    set({ starting: false });
    if (options.assistantInitialPrompt) {
      nextSession.startAssistantInitiatedTurn(options.assistantInitialPrompt).catch(() => undefined);
    }
  },

  stopCall: async () => {
    const activeSession = session;
    session = null;
    sessionSubscription?.remove();
    sessionSubscription = null;
    set({ starting: false, minimized: false, localVideoTrack: null });
    await hideVoiceCallFloatingBall().catch(() => undefined);
    await stopVoiceCallForegroundService().catch(() => undefined);
    try {
      if (activeSession) {
        await activeSession.stop();
      }
    } finally {
      set({ snapshot: INITIAL_VOICE_CALL_SNAPSHOT });
    }
  },

  requestIncomingCall: async (reason = '', mode = 'voice') => {
    const current = get();
    if (current.snapshot.active || current.starting) {
      throw new Error('当前已经在语音通话中');
    }
    if (current.incomingCall) return current.incomingCall;
    if (!isAndroidVoiceCallAvailable()) {
      throw new Error('实时语音通话目前只支持 Android 自定义构建。');
    }

    const incomingCall: IncomingVoiceCall = {
      id: `incoming-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reason: reason.trim(),
      mode,
      createdAt: Date.now(),
    };
    set({ incomingCall, minimized: false });
    return incomingCall;
  },

  acceptIncomingCall: async () => {
    const incomingCall = get().incomingCall;
    if (!incomingCall) return;
    set({ incomingCall: null });
    await get().startCall({
      mode: incomingCall.mode,
      assistantInitialPrompt: incomingCall.reason
        ? `${VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION}\n\n这通电话的发起原因：${incomingCall.reason}`
        : VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION,
    });
  },

  rejectIncomingCall: async () => {
    const incomingCall = get().incomingCall;
    if (!incomingCall) return;
    set({ incomingCall: null });
    const callType = incomingCall.mode === 'video' ? '视频通话' : incomingCall.mode === 'screen' ? '共享屏幕通话' : '语音通话';
    await addSystemMessageWhenChatIdle(`用户拒绝了你的${callType}`);
  },

  setMicrophoneEnabled: async (enabled: boolean) => {
    await session?.setMicrophoneEnabled(enabled);
  },

  setSpeakerphoneOn: async (enabled: boolean) => {
    await session?.setSpeakerphoneOn(enabled);
  },

  setCameraFacing: async (facing) => {
    if (session instanceof LiveKitVoiceCallSession) {
      await session.setCameraFacing(facing);
    }
    set({ cameraFacing: facing });
  },

  minimizeToFloatingBall: async (durationText: string, previewUri) => {
    if (!get().snapshot.active) return;
    if (get().mode === 'screen') {
      await showScreenCallFloatingBall(durationText);
    } else if (get().mode === 'video' && previewUri) {
      await showVideoCallFloatingWindow(durationText, previewUri);
    } else {
      await showVoiceCallFloatingBall(durationText);
    }
    set({ minimized: true });
  },

  restoreFromFloatingBall: async () => {
    await hideVoiceCallFloatingBall().catch(() => undefined);
    set({ minimized: false });
  },

}));

async function addSystemMessageWhenChatIdle(content: string): Promise<void> {
  if (!useChatStore.getState().isStreaming) {
    await useChatStore.getState().addSystemMessage(content);
    return;
  }

  const unsubscribe = useChatStore.subscribe((state) => {
    if (!state.isStreaming) {
      unsubscribe();
      useChatStore.getState().addSystemMessage(content).catch(() => undefined);
    }
  });
  if (!useChatStore.getState().isStreaming) {
    unsubscribe();
    await useChatStore.getState().addSystemMessage(content);
  }
}
