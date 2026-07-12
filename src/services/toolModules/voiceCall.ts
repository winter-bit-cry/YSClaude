import { ToolDefinition, ToolModule } from './types';

const START_AI_VOICE_CALL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'start_ai_voice_call',
    description: '主动给用户发起实时语音通话。调用后客户端会弹出来电界面，用户可选择接听或拒绝；若用户接听，语音通话开始后 AI 必须先说话。',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: '发起这通电话的简短原因或开场上下文，会在用户接听后作为提示提供给 AI。',
        },
      },
      required: [],
    },
  },
};

export const voiceCallTool: ToolModule = {
  id: 'voice-call',
  labels: {
    start_ai_voice_call: '主动语音通话',
  },
  getDefinitions: (config) => {
    return config.nativeTools?.aiVoiceCallEnabled ? [START_AI_VOICE_CALL_TOOL] : [];
  },
  execute: async (toolName, args) => {
    if (toolName !== 'start_ai_voice_call') return undefined;
    const { useVoiceCallStore } = await import('../../stores/voiceCall');
    const reason = typeof args.reason === 'string' ? args.reason : '';
    await useVoiceCallStore.getState().requestIncomingCall(reason);
    return [
      '已向用户发起语音通话请求。',
      '如果用户接听，客户端会进入语音通话并用专门提示词让你先开口。',
      '如果用户拒绝，客户端会插入系统消息“用户拒绝了你的语音通话”。',
    ].join('\n');
  },
};
