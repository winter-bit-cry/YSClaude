import { ToolDefinition, ToolModule } from './types';

let hangupPending = false;
const HANGUP_FALLBACK_DELAY_MS = 10_000;

const START_AI_VOICE_CALL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'start_ai_voice_call',
    description: '主动给用户发起实时通话，可选择语音、视频或共享屏幕。调用后客户端会弹出来电界面，用户可选择接听或拒绝；若用户接听，通话开始后 AI 必须先说话。',
    parameters: {
      type: 'object',
      properties: {
        call_type: {
          type: 'string',
          enum: ['voice', 'video', 'screen'],
          description: '通话类型：voice 为语音通话，video 为视频通话，screen 为共享用户屏幕的通话。',
        },
        reason: {
          type: 'string',
          description: '发起这通电话的简短原因或开场上下文，会在用户接听后作为提示提供给 AI。',
        },
      },
      required: ['call_type'],
    },
  },
};

const HANGUP_AI_VOICE_CALL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'hangup_ai_voice_call',
    description: '结束当前正在进行的实时通话，适用于语音、视频和共享屏幕通话。仅在通话过程中使用；调用后客户端会挂断并清理通话资源。',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: '可选，简短说明为什么要结束这通通话。',
        },
      },
      required: [],
    },
  },
};

export const voiceCallTool: ToolModule = {
  id: 'voice-call',
  labels: {
    hangup_ai_voice_call: '挂断通话',
    start_ai_voice_call: '主动通话',
  },
  getDefinitions: (config) => {
    const tools: ToolDefinition[] = [];
    if (config.nativeTools?.aiVoiceCallEnabled) {
      tools.push(START_AI_VOICE_CALL_TOOL);
    }
    if (config.nativeTools?.aiVoiceCallHangupEnabled && config.voiceCallActive) {
      tools.push(HANGUP_AI_VOICE_CALL_TOOL);
    }
    return tools;
  },
  execute: async (toolName, args) => {
    if (toolName !== 'start_ai_voice_call' && toolName !== 'hangup_ai_voice_call') return undefined;
    const { useVoiceCallStore } = await import('../../stores/voiceCall');
    if (toolName === 'hangup_ai_voice_call') {
      const { snapshot } = useVoiceCallStore.getState();
      if (!snapshot.active || snapshot.status === 'error') {
        return '当前没有正在进行的通话，无法挂断。';
      }
      if (hangupPending) return '挂断指令已经收到，通话即将结束。';

      // Return the tool result before disconnecting the LiveKit room. The agent
      // still needs the room while it feeds this result back to the model and
      // plays its closing response, so wait for speaking -> listening instead
      // of using a short fixed delay that can interrupt the tool-call turn.
      hangupPending = true;
      let heardClosingResponse = false;
      let finished = false;
      const finishHangup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(fallbackTimer);
        unsubscribe();
        const call = useVoiceCallStore.getState();
        const stop = call.snapshot.active && call.snapshot.status !== 'error'
          ? call.stopCall()
          : Promise.resolve();
        stop.catch(() => undefined).finally(() => {
          hangupPending = false;
        });
      };
      const unsubscribe = useVoiceCallStore.subscribe((state) => {
        if (state.snapshot.status === 'speaking') {
          heardClosingResponse = true;
        } else if (heardClosingResponse && state.snapshot.status === 'listening') {
          finishHangup();
        } else if (!state.snapshot.active || state.snapshot.status === 'error') {
          finishHangup();
        }
      });
      const fallbackTimer = setTimeout(finishHangup, HANGUP_FALLBACK_DELAY_MS);
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      return reason ? `已收到挂断指令，通话即将结束。原因：${reason}` : '已收到挂断指令，通话即将结束。';
    }
    const reason = typeof args.reason === 'string' ? args.reason : '';
    const mode = args.call_type === 'video' || args.call_type === 'screen' ? args.call_type : 'voice';
    const callType = mode === 'video' ? '视频通话' : mode === 'screen' ? '共享屏幕通话' : '语音通话';
    await useVoiceCallStore.getState().requestIncomingCall(reason, mode);
    return [
      `已向用户发起${callType}请求。`,
      `如果用户接听，客户端会进入${callType}并用专门提示词让你先开口。`,
      `如果用户拒绝，客户端会插入相应的拒绝通话系统消息。`,
    ].join('\n');
  },
};
