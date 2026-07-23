import { randomUUID } from 'expo-crypto';
import {
  getBotChannelMessages,
  getLatestBotChannelMessage,
  insertBotChannelMessage,
} from '../db/operations';
import {
  QQBotToolConfig,
  WechatClawBotToolConfig,
  useSettingsStore,
} from '../stores/settings';
import { triggerBotInboundMessage } from './botInboundTrigger';

const WECHAT_CHANNEL_VERSION = '1.0.0';
let wechatCursor = '';
let stopped = true;
let lifecycleId = 0;
let qqSocket: WebSocket | null = null;
let qqHeartbeat: ReturnType<typeof setInterval> | null = null;
let qqSequence: number | null = null;

function botHeaders(token: string): Record<string, string> {
  const random = String(Math.floor(Math.random() * 0xffffffff));
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    Authorization: `Bearer ${token}`,
    'X-WECHAT-UIN': globalThis.btoa(random),
  };
}

function wechatUrl(config: WechatClawBotToolConfig, path: string): string {
  return `${config.baseUrl.trim().replace(/\/+$/, '')}/ilink/bot/${path}`;
}

function textFromWechatMessage(message: any): string {
  return (message?.item_list || [])
    .map((item: any) => item?.text_item?.text || '')
    .filter(Boolean)
    .join('\n');
}

export async function pollWechatClawBotOnce(
  config: WechatClawBotToolConfig,
  signal?: AbortSignal
): Promise<number> {
  if (!config.enabled || !config.botToken.trim()) return 0;
  const response = await fetch(wechatUrl(config, 'getupdates'), {
    method: 'POST',
    headers: botHeaders(config.botToken.trim()),
    body: JSON.stringify({
      get_updates_buf: wechatCursor,
      base_info: { channel_version: WECHAT_CHANNEL_VERSION },
    }),
    signal,
  });
  const data = await response.json();
  if (!response.ok || (data.ret != null && data.ret !== 0)) {
    throw new Error(`微信 ClawBot 收取失败: ${data?.errmsg || data?.ret || response.status}`);
  }
  wechatCursor = data.get_updates_buf || wechatCursor;
  const messages = Array.isArray(data.msgs) ? data.msgs : [];
  for (const message of messages) {
    const content = textFromWechatMessage(message);
    if (!content) continue;
    const incoming = Number(message.message_type) !== 2;
    const inserted = await insertBotChannelMessage({
      id: `wechat:${message.message_id || message.client_id || randomUUID()}`,
      platform: 'wechat',
      direction: incoming ? 'incoming' : 'outgoing',
      content,
      senderId: message.from_user_id || undefined,
      platformMessageId: String(message.message_id || message.client_id || ''),
      route: {
        toUserId: incoming ? message.from_user_id : message.to_user_id,
        contextToken: message.context_token,
      },
      createdAt: Number(message.create_time_ms) || Date.now(),
    });
    if (inserted && incoming) triggerBotInboundMessage('wechat', content).catch(() => undefined);
  }
  return messages.length;
}

export async function sendWechatClawBotMessage(
  content: string,
  config: WechatClawBotToolConfig
): Promise<void> {
  const latest = await getLatestBotChannelMessage('wechat', 'incoming');
  const toUserId = latest?.route?.toUserId;
  const contextToken = latest?.route?.contextToken;
  if (!toUserId || !contextToken) {
    throw new Error('还没有可回复的微信消息。请先让绑定账号给 ClawBot 发一条消息。');
  }
  const clientId = randomUUID();
  const response = await fetch(wechatUrl(config, 'sendmessage'), {
    method: 'POST',
    headers: botHeaders(config.botToken.trim()),
    body: JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text: content } }],
      },
      base_info: { channel_version: WECHAT_CHANNEL_VERSION },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`微信发送失败: HTTP ${response.status} ${text.slice(0, 160)}`);
  await insertBotChannelMessage({
    id: `wechat:${clientId}`,
    platform: 'wechat',
    direction: 'outgoing',
    content,
    senderId: config.accountId || undefined,
    platformMessageId: clientId,
    route: latest.route,
    createdAt: Date.now(),
  });
}

async function getQqAccessToken(config: QQBotToolConfig): Promise<string> {
  const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: config.appId.trim(), clientSecret: config.appSecret.trim() }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data?.message || 'QQ Bot access token 获取失败');
  return data.access_token;
}

function qqApiBase(config: QQBotToolConfig): string {
  return config.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com';
}

async function storeQqEvent(event: any): Promise<void> {
  const data = event?.d || {};
  const content = String(data.content || '').replace(/<@!\d+>/g, '').trim();
  if (!content) return;
  let route: Record<string, any> = {};
  const type = String(event?.t || '');
  if (type === 'C2C_MESSAGE_CREATE') route = { kind: 'c2c', targetId: data.author?.user_openid || data.author?.id };
  else if (type === 'GROUP_AT_MESSAGE_CREATE') route = { kind: 'group', targetId: data.group_openid };
  else if (type === 'DIRECT_MESSAGE_CREATE') route = { kind: 'dm', targetId: data.guild_id };
  else route = { kind: 'channel', targetId: data.channel_id };
  if (!route.targetId) return;
  const contactId = `${route.kind}:${route.targetId}`;
  const contactName = String(route.kind === 'c2c'
    ? data.author?.username || data.author?.nick || `QQ 联系人 ${route.targetId}`
    : route.kind === 'group'
      ? data.group_name || `QQ群 ${route.targetId}`
      : data.channel_name || data.guild_name || `QQ 频道 ${route.targetId}`
  ).trim();
  const inserted = await insertBotChannelMessage({
    id: `qq:${data.id || randomUUID()}`,
    platform: 'qq',
    direction: 'incoming',
    content,
    senderId: data.author?.user_openid || data.author?.id,
    platformMessageId: data.id,
    route: { ...route, contactId, contactName: contactName || undefined, replyMessageId: data.id },
    createdAt: data.timestamp ? Date.parse(data.timestamp) : Date.now(),
  });
  if (inserted) triggerBotInboundMessage('qq', content, { contactId, contactName }).catch(() => undefined);
}

export interface WechatClawLoginResult {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired';
  qrcode?: string;
  qrContent?: string;
  botToken?: string;
  accountId?: string;
  userId?: string;
  baseUrl?: string;
}

export async function beginWechatClawLogin(): Promise<WechatClawLoginResult> {
  const response = await fetch(
    'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3',
    { method: 'GET' }
  );
  const data = await response.json();
  if (!response.ok || !data.qrcode || !data.qrcode_img_content) {
    throw new Error(data?.errmsg || '无法获取微信 ClawBot 登录二维码');
  }
  return {
    status: 'wait',
    qrcode: data.qrcode,
    qrContent: data.qrcode_img_content,
  };
}

export async function pollWechatClawLogin(qrcode: string): Promise<WechatClawLoginResult> {
  const response = await fetch(
    `https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    { method: 'GET', headers: { 'iLink-App-ClientVersion': '1' } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data?.errmsg || '微信扫码状态查询失败');
  const status = data.status as WechatClawLoginResult['status'];
  return {
    status,
    botToken: data.bot_token,
    accountId: data.ilink_bot_id,
    userId: data.ilink_user_id,
    baseUrl: data.baseurl,
  };
}

export function logoutWechatClawBot(): void {
  wechatCursor = '';
  useSettingsStore.getState().setWechatClawBotToolConfig({
    enabled: false,
    botToken: '',
    accountId: '',
  });
}

export async function sendQqBotMessage(
  content: string,
  contactId: string,
  config: QQBotToolConfig
): Promise<void> {
  const latest = (await getBotChannelMessages('qq', 1, contactId))[0];
  const route = latest?.route;
  if (!route?.targetId) throw new Error(`找不到 QQ 联系人（群聊）${contactId}，请先查看消息列表。`);
  const token = await getQqAccessToken(config);
  const path = route.kind === 'c2c'
    ? `/v2/users/${encodeURIComponent(route.targetId)}/messages`
    : route.kind === 'group'
      ? `/v2/groups/${encodeURIComponent(route.targetId)}/messages`
      : route.kind === 'dm'
        ? `/dms/${encodeURIComponent(route.targetId)}/messages`
        : `/channels/${encodeURIComponent(route.targetId)}/messages`;
  const body = route.kind === 'c2c' || route.kind === 'group'
    ? { content, msg_type: 0, msg_id: route.replyMessageId }
    : { content, msg_id: route.replyMessageId };
  const response = await fetch(`${qqApiBase(config)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `QQBot ${token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`QQ 发送失败: HTTP ${response.status} ${text.slice(0, 160)}`);
  const result = text ? JSON.parse(text) : {};
  await insertBotChannelMessage({
    id: `qq:${result.id || randomUUID()}`,
    platform: 'qq',
    direction: 'outgoing',
    content,
    platformMessageId: result.id,
    route,
    createdAt: Date.now(),
  });
}

async function startQqSocket(config: QQBotToolConfig): Promise<void> {
  if (!config.enabled || !config.appId.trim() || !config.appSecret.trim() || qqSocket) return;
  const token = await getQqAccessToken(config);
  const gatewayResponse = await fetch(`${qqApiBase(config)}/gateway/bot`, {
    headers: { Authorization: `QQBot ${token}` },
  });
  const gateway = await gatewayResponse.json();
  if (!gatewayResponse.ok || !gateway.url) throw new Error('QQ Bot gateway 获取失败');
  const socket = new WebSocket(gateway.url);
  qqSocket = socket;
  socket.onmessage = (message) => {
    try {
      const packet = JSON.parse(String(message.data));
      if (typeof packet.s === 'number') qqSequence = packet.s;
      if (packet.op === 10) {
        const interval = Number(packet.d?.heartbeat_interval) || 30000;
        socket.send(JSON.stringify({
          op: 2,
          d: {
            token: `QQBot ${token}`,
            intents: (1 << 0) | (1 << 1) | (1 << 12) | (1 << 25),
            shard: [0, 1],
            properties: { $os: 'android', $browser: 'ysclaude', $device: 'ysclaude' },
          },
        }));
        qqHeartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 1, d: qqSequence }));
        }, interval);
      } else if (packet.op === 0) {
        storeQqEvent(packet).catch(() => undefined);
      }
    } catch {
      // Ignore malformed gateway events and keep the connection alive.
    }
  };
  socket.onclose = () => {
    qqSocket = null;
    if (qqHeartbeat) clearInterval(qqHeartbeat);
    qqHeartbeat = null;
    if (!stopped) setTimeout(() => startQqSocket(useSettingsStore.getState().qqBotToolConfig).catch(() => undefined), 3000);
  };
}

async function runWechatLoop(runId: number): Promise<void> {
  while (!stopped && runId === lifecycleId) {
    const config = useSettingsStore.getState().wechatClawBotToolConfig;
    if (!config?.enabled || !config.botToken?.trim()) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    try {
      await pollWechatClawBotOnce(config);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export function startLocalBotChannels(): () => void {
  const runId = ++lifecycleId;
  stopped = false;
  const settings = useSettingsStore.getState();
  if (settings.qqBotToolConfig) startQqSocket(settings.qqBotToolConfig).catch(() => undefined);
  runWechatLoop(runId).catch(() => undefined);
  return () => {
    if (runId !== lifecycleId) return;
    stopped = true;
    lifecycleId += 1;
    qqSocket?.close();
    qqSocket = null;
    if (qqHeartbeat) clearInterval(qqHeartbeat);
    qqHeartbeat = null;
  };
}
