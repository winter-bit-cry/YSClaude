import { ToolDefinition, ToolModule } from './types';

const API_BASE = 'https://discord.com/api/v10';

const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'discord_bot_list_servers',
      description: '列出 Discord Bot 已加入的服务器，返回服务器名称和 guild_id。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'discord_bot_list_channels',
      description: '列出指定 Discord 服务器中 Bot 可见的频道，返回频道名称、类型和 channel_id。',
      parameters: {
        type: 'object',
        properties: { guild_id: { type: 'string', description: 'Discord 服务器 ID。' } },
        required: ['guild_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'discord_bot_read_messages',
      description: '读取指定 Discord 频道的最近消息。仅在用户要求查看 Discord 消息时调用。',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Discord 频道 ID。' },
          count: { type: 'integer', description: '读取数量，1–100。' },
        },
        required: ['channel_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'discord_bot_send_message',
      description: '向指定 Discord 频道发送文本消息。仅在用户明确要求发送时调用。',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'Discord 频道 ID。' },
          message: { type: 'string', description: '要发送的完整文本。' },
        },
        required: ['channel_id', 'message'],
      },
    },
  },
];

async function discordRequest(token: string, path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Discord API ${response.status}: ${detail.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function requireId(value: unknown, label: string): string {
  const id = String(value || '').trim();
  if (!/^\d{16,22}$/.test(id)) throw new Error(`${label} 无效`);
  return id;
}

export const discordBotTool: ToolModule = {
  id: 'discord-bot',
  labels: {
    discord_bot_list_servers: '列出 Discord 服务器',
    discord_bot_list_channels: '列出 Discord 频道',
    discord_bot_read_messages: '读取 Discord 消息',
    discord_bot_send_message: '发送 Discord 消息',
  },
  getDefinitions: (config) => config.discordBotTools ? definitions : [],
  execute: async (toolName, args, context) => {
    if (!toolName.startsWith('discord_bot_')) return undefined;
    const config = context.discordBotToolConfig;
    if (!config?.enabled) throw new Error('Discord Bot 工具未启用');
    const token = config.botToken.trim();
    if (!token) throw new Error('未配置 Discord Bot Token');

    if (toolName === 'discord_bot_list_servers') {
      const guilds = await discordRequest(token, '/users/@me/guilds');
      return guilds.length ? guilds.map((g: any) => `${g.name}\nguild_id: ${g.id}`).join('\n\n') : 'Bot 尚未加入任何 Discord 服务器。';
    }
    if (toolName === 'discord_bot_list_channels') {
      const guildId = requireId(args.guild_id, 'guild_id');
      const channels = await discordRequest(token, `/guilds/${guildId}/channels`);
      return channels.length ? channels.map((c: any) => `${c.name || '未命名'} (type=${c.type})\nchannel_id: ${c.id}`).join('\n\n') : '该服务器没有 Bot 可见的频道。';
    }
    if (toolName === 'discord_bot_read_messages') {
      const channelId = requireId(args.channel_id, 'channel_id');
      const count = Math.min(config.maxReadLimit, Math.max(1, Number(args.count) || config.defaultReadLimit));
      const messages = await discordRequest(token, `/channels/${channelId}/messages?limit=${count}`);
      return messages.length ? messages.map((m: any) => `[${new Date(m.timestamp).toLocaleString()}] ${m.author?.global_name || m.author?.username || '未知用户'}: ${m.content || '[非文本消息]'}`).join('\n') : '该频道暂无消息。';
    }
    if (toolName === 'discord_bot_send_message') {
      const channelId = requireId(args.channel_id, 'channel_id');
      const message = String(args.message || '').trim();
      if (!message) throw new Error('发送内容不能为空');
      await discordRequest(token, `/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
      });
      return `Discord 消息已发送至频道 ${channelId}。`;
    }
    return undefined;
  },
};
