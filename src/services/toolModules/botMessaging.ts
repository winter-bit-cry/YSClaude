import { getBotChannelMessages, getQqBotMessageList } from '../../db/operations';
import {
  pollWechatClawBotOnce,
  sendQqBotMessage,
  sendWechatClawBotMessage,
} from '../localBotChannels';
import { ToolDefinition, ToolModule } from './types';

function readTool(name: string, platform: string): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: `读取 YSClaude 本地保存的最近 ${platform} Bot 消息。消息数可自定义；只能读取 YSClaude 运行期间收发的记录。`,
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'integer', description: '要读取的最近消息数。' },
        },
        required: [],
      },
    },
  };
}

function sendTool(name: string, platform: string): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description: platform === 'QQ'
        ? '通过本机运行的 QQ Bot 向指定联系人或群聊发送一条文本消息。contact_id 必须来自消息列表或消息提醒。仅在用户明确要求发送时调用。'
        : `通过本机运行的 ${platform} Bot 向绑定账号发送一条文本消息。仅在用户明确要求发送时调用。`,
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '要发送的完整文本。' },
          ...(platform === 'QQ' ? {
            contact_id: { type: 'string', description: '接收方联系人（群聊）标识，例如 group:xxx。' },
          } : {}),
        },
        required: platform === 'QQ' ? ['contact_id', 'message'] : ['message'],
      },
    },
  };
}

const QQ_READ = readTool('qq_bot_read_messages', 'QQ');
QQ_READ.function.description = '读取指定 QQ 联系人（群聊）的最近消息。contact_id 可从消息列表或消息提醒获得。';
QQ_READ.function.parameters.properties.contact_id = {
  type: 'string',
  description: '联系人（群聊）标识，例如 group:xxx。省略时读取全部联系人的最近消息。',
};
const QQ_LIST: ToolDefinition = {
  type: 'function',
  function: {
    name: 'qq_bot_list_messages',
    description: '查看 QQ Bot 消息列表（会话列表），返回最近联系过的联系人或群聊、contact_id、最后消息和时间。发送消息前应先用它确定接收方。',
    parameters: {
      type: 'object',
      properties: { count: { type: 'integer', description: '要查看的会话数量。' } },
      required: [],
    },
  },
};
const QQ_SEND = sendTool('qq_bot_send_message', 'QQ');
const WECHAT_READ = readTool('wechat_clawbot_read_messages', '微信 ClawBot');
const WECHAT_SEND = sendTool('wechat_clawbot_send_message', '微信 ClawBot');

function formatMessages(messages: Awaited<ReturnType<typeof getBotChannelMessages>>): string {
  if (messages.length === 0) return '本地暂无消息记录。请先让绑定账号向 Bot 发送消息，并保持 YSClaude 运行。';
  return messages.map((message) => {
    const time = new Date(message.createdAt).toLocaleString();
    const direction = message.direction === 'incoming' ? '联系人 → Bot' : 'Bot → 联系人';
    const contact = message.route?.contactId
      ? ` [${message.route.contactName || '名称未知'} | contact_id=${message.route.contactId}]`
      : '';
    return `[${time}] ${direction}${contact}\n${message.content}`;
  }).join('\n\n');
}

function formatQqMessageList(messages: Awaited<ReturnType<typeof getQqBotMessageList>>): string {
  if (messages.length === 0) return 'QQ Bot 暂无消息会话。';
  return messages.map((message) => {
    const time = new Date(message.createdAt).toLocaleString();
    const route = message.route || {};
    const type = route.kind === 'group' ? '群聊' : route.kind === 'c2c' ? '联系人' : '频道';
    return `${type}：${route.contactName || '名称未知'}\ncontact_id：${route.contactId}\n最后消息：[${time}] ${message.content}`;
  }).join('\n\n');
}

export const botMessagingTool: ToolModule = {
  id: 'bot-messaging',
  labels: {
    qq_bot_read_messages: '读取 QQ Bot 消息',
    qq_bot_list_messages: '查看 QQ Bot 消息列表',
    qq_bot_send_message: '发送 QQ Bot 消息',
    wechat_clawbot_read_messages: '读取微信 ClawBot 消息',
    wechat_clawbot_send_message: '发送微信 ClawBot 消息',
  },
  getDefinitions: (config) => [
    ...(config.qqBotTools ? [QQ_LIST, QQ_READ, QQ_SEND] : []),
    ...(config.wechatClawBotTools ? [WECHAT_READ, WECHAT_SEND] : []),
  ],
  execute: async (toolName, args, context) => {
    if (toolName === 'qq_bot_list_messages') {
      const config = context.qqBotToolConfig;
      if (!config?.enabled) throw new Error('QQ Bot 工具未启用');
      const count = Math.min(config.maxReadLimit, Math.max(1, Number(args.count) || config.defaultReadLimit));
      return formatQqMessageList(await getQqBotMessageList(count));
    }
    if (toolName === 'qq_bot_read_messages') {
      const config = context.qqBotToolConfig;
      if (!config?.enabled) throw new Error('QQ Bot 工具未启用');
      const count = Math.min(config.maxReadLimit, Math.max(1, Number(args.count) || config.defaultReadLimit));
      const contactId = String(args.contact_id || '').trim() || undefined;
      return formatMessages(await getBotChannelMessages('qq', count, contactId));
    }
    if (toolName === 'qq_bot_send_message') {
      if (!context.qqBotToolConfig?.enabled) throw new Error('QQ Bot 工具未启用');
      const message = String(args.message || '').trim();
      const contactId = String(args.contact_id || '').trim();
      if (!message) throw new Error('发送内容不能为空');
      if (!contactId) throw new Error('必须指定 QQ 联系人（群聊）的 contact_id');
      await sendQqBotMessage(message, contactId, context.qqBotToolConfig);
      return `QQ Bot 消息已发送至 ${contactId}。`;
    }
    if (toolName === 'wechat_clawbot_read_messages') {
      const config = context.wechatClawBotToolConfig;
      if (!config?.enabled) throw new Error('微信 ClawBot 工具未启用');
      await pollWechatClawBotOnce(config).catch(() => 0);
      const count = Math.min(config.maxReadLimit, Math.max(1, Number(args.count) || config.defaultReadLimit));
      return formatMessages(await getBotChannelMessages('wechat', count));
    }
    if (toolName === 'wechat_clawbot_send_message') {
      if (!context.wechatClawBotToolConfig?.enabled) throw new Error('微信 ClawBot 工具未启用');
      const message = String(args.message || '').trim();
      if (!message) throw new Error('发送内容不能为空');
      await sendWechatClawBotMessage(message, context.wechatClawBotToolConfig);
      return '微信 ClawBot 消息已发送。';
    }
    return undefined;
  },
};
