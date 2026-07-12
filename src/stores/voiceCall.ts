import { create } from 'zustand';
import {
  AndroidVoiceCallSession,
  VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION,
  isAndroidVoiceCallAvailable,
  type VoiceCallSnapshot,
} from '../services/voiceCallSession';
import {
  hideVoiceCallFloatingBall,
  showVoiceCallFloatingBall,
} from '../services/floatingBall';
import { useChatStore } from './chat';

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
  createdAt: number;
}

interface VoiceCallStartOptions {
  assistantInitialPrompt?: string;
}

interface VoiceCallStore {
  snapshot: VoiceCallSnapshot;
  starting: boolean;
  minimized: boolean;
  incomingCall: IncomingVoiceCall | null;
  startCall: (options?: VoiceCallStartOptions) => Promise<void>;
  stopCall: () => Promise<void>;
  requestIncomingCall: (reason?: string) => Promise<IncomingVoiceCall>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
  setSpeakerphoneOn: (enabled: boolean) => Promise<void>;
  minimizeToFloatingBall: (durationText: string) => Promise<void>;
  restoreFromFloatingBall: () => Promise<void>;
}

let session: AndroidVoiceCallSession | null = null;
let sessionSubscription: Subscription | null = null;

export const useVoiceCallStore = create<VoiceCallStore>((set, get) => ({
  snapshot: INITIAL_VOICE_CALL_SNAPSHOT,
  starting: false,
  minimized: false,
  incomingCall: null,

  startCall: async (options = {}) => {
    const current = get();
    if (current.snapshot.active || current.starting) return;
    if (!isAndroidVoiceCallAvailable()) {
      throw new Error('实时语音通话目前只支持 Android 自定义构建。');
    }

    set({ starting: true, minimized: false });
    const nextSession = new AndroidVoiceCallSession();
    session = nextSession;
    sessionSubscription?.remove();
    sessionSubscription = nextSession.subscribe((snapshot) => {
      set({ snapshot });
    });

    try {
      await nextSession.start();
    } catch (error) {
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
    set({ starting: false, minimized: false });
    await hideVoiceCallFloatingBall().catch(() => undefined);
    if (activeSession) {
      await activeSession.stop();
    }
    set({ snapshot: INITIAL_VOICE_CALL_SNAPSHOT });
  },

  requestIncomingCall: async (reason = '') => {
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
      assistantInitialPrompt: incomingCall.reason
        ? `${VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION}\n\n这通电话的发起原因：${incomingCall.reason}`
        : VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION,
    });
  },

  rejectIncomingCall: async () => {
    if (!get().incomingCall) return;
    set({ incomingCall: null });
    await addSystemMessageWhenChatIdle('用户拒绝了你的语音通话');
  },

  setMicrophoneEnabled: async (enabled: boolean) => {
    await session?.setMicrophoneEnabled(enabled);
  },

  setSpeakerphoneOn: async (enabled: boolean) => {
    await session?.setSpeakerphoneOn(enabled);
  },

  minimizeToFloatingBall: async (durationText: string) => {
    if (!get().snapshot.active) return;
    await showVoiceCallFloatingBall(durationText);
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
