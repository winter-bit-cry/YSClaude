import { createAudioPlayer, type AudioStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { TTSConfig } from '../stores/settings';

let currentPlayer: ReturnType<typeof createAudioPlayer> | null = null;
let currentSubscription: { remove: () => void } | null = null;
let currentWaitResolve: (() => void) | null = null;

export function isTTSConfigReady(config: TTSConfig): boolean {
  if (config.provider === 'fish') {
    return !!config.fishApiKey.trim() && !!config.fishReferenceId.trim();
  }
  if (config.provider === 'deepgram') {
    return !!config.deepgramApiKey.trim() && !!config.deepgramModel.trim();
  }
  if (config.provider === 'mossland') {
    return !!config.mosslandBaseUrl.trim() && !!config.mosslandApiKey.trim()
      && !!config.mosslandModel.trim() && !!config.mosslandVoice.trim();
  }
  if (config.provider === 'cartesia') {
    return !!config.cartesiaApiKey.trim() && !!config.cartesiaVoiceId.trim();
  }
  return !!config.apiKey.trim() && !!config.groupId.trim() && !!config.voiceId.trim();
}

export function getTTSConfigMissingMessage(config: TTSConfig): string {
  if (config.provider === 'mossland') {
    return '请先配置 Mossland Base URL、API Key、模型和 Voice';
  }
  if (config.provider === 'cartesia') {
    return '请先配置 Cartesia API Key 和 Voice ID';
  }
  if (config.provider === 'fish') {
    return '请先配置 Fish Audio API Key 和 Reference ID';
  }
  if (config.provider === 'deepgram') {
    return '请先配置 Deepgram API Key 和模型';
  }
  return '请先配置 MiniMax Group ID、API Key 和 Voice ID';
}

async function createTTSPlayer(text: string, config: TTSConfig): Promise<ReturnType<typeof createAudioPlayer>> {
  const speakableText = sanitizeTTSInput(text);
  if (!speakableText) {
    throw new Error('没有可朗读的内容');
  }
  if (config.provider === 'fish') {
    return createFishTTSPlayer(speakableText, config);
  }
  if (config.provider === 'deepgram') {
    return createDeepgramTTSPlayer(speakableText, config);
  }
  if (config.provider === 'mossland') {
    return createMosslandTTSPlayer(speakableText, config);
  }
  if (config.provider === 'cartesia') {
    return createCartesiaTTSPlayer(speakableText, config);
  }
  return createMiniMaxTTSPlayer(speakableText, config);
}

async function createMiniMaxTTSPlayer(speakableText: string, config: TTSConfig): Promise<ReturnType<typeof createAudioPlayer>> {
  if (!config.apiKey || !config.groupId) {
    throw new Error('请先配置 MiniMax Group ID 和 API Key');
  }
  if (!config.voiceId) {
    throw new Error('请先配置 Voice ID');
  }

  const url = `https://api.minimax.chat/v1/t2a_v2?GroupId=${encodeURIComponent(config.groupId)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      text: speakableText,
      stream: false,
      voice_setting: {
        voice_id: config.voiceId,
        speed: config.speed,
        vol: config.vol,
        pitch: config.pitch,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`MiniMax TTS Error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();

  if (data.base_resp?.status_code !== 0) {
    throw new Error(data.base_resp?.status_msg || 'TTS 请求失败');
  }

  const audioHex = data.data?.audio;
  if (!audioHex) {
    throw new Error('未返回音频数据');
  }

  const audioBytes = hexToBytes(audioHex);
  const file = new File(Paths.cache, 'tts_audio.mp3');
  const writable = file.writableStream();
  const writer = writable.getWriter();
  await writer.write(audioBytes);
  await writer.close();

  return createAudioPlayer(file.uri);
}

async function createFishTTSPlayer(speakableText: string, config: TTSConfig): Promise<ReturnType<typeof createAudioPlayer>> {
  const apiKey = config.fishApiKey.trim();
  const referenceId = config.fishReferenceId.trim();
  if (!apiKey) {
    throw new Error('请先配置 Fish Audio API Key');
  }
  if (!referenceId) {
    throw new Error('请先配置 Fish Audio Reference ID');
  }

  const format = config.fishFormat || 'mp3';
  const endpoint = `${(config.fishBaseUrl || 'https://api.fish.audio').trim().replace(/\/$/, '')}/v1/tts`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      model: config.fishModel.trim() || 's2-pro',
    },
    body: JSON.stringify({
      text: speakableText,
      reference_id: referenceId,
      format,
      normalize: true,
      latency: 'normal',
      prosody: {
        speed: config.fishSpeed || 1,
        volume: config.fishVolume || 0,
        normalize_loudness: true,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Fish Audio TTS Error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const audioBytes = new Uint8Array(await response.arrayBuffer());
  if (audioBytes.length === 0) {
    throw new Error('Fish Audio 未返回音频数据');
  }

  const file = new File(Paths.cache, `tts_audio.${format}`);
  const writable = file.writableStream();
  const writer = writable.getWriter();
  await writer.write(audioBytes);
  await writer.close();

  return createAudioPlayer(file.uri);
}

async function createDeepgramTTSPlayer(speakableText: string, config: TTSConfig): Promise<ReturnType<typeof createAudioPlayer>> {
  const apiKey = config.deepgramApiKey.trim();
  if (!apiKey) {
    throw new Error('请先配置 Deepgram API Key');
  }

  const endpoint = buildDeepgramSpeakEndpoint(
    config.deepgramBaseUrl || 'https://api.deepgram.com/v1',
    config.deepgramModel || 'aura-2-thalia-en'
  );
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text: speakableText }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Deepgram TTS Error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const audioBytes = new Uint8Array(await response.arrayBuffer());
  if (audioBytes.length === 0) {
    throw new Error('Deepgram 未返回音频数据');
  }

  const file = new File(Paths.cache, 'tts_audio_deepgram.mp3');
  const writable = file.writableStream();
  const writer = writable.getWriter();
  await writer.write(audioBytes);
  await writer.close();

  return createAudioPlayer(file.uri);
}

async function createMosslandTTSPlayer(speakableText: string, config: TTSConfig): Promise<ReturnType<typeof createAudioPlayer>> {
  const baseUrl = config.mosslandBaseUrl.trim();
  const apiKey = config.mosslandApiKey.trim();
  const model = config.mosslandModel.trim();
  const voice = config.mosslandVoice.trim();
  if (!baseUrl || !apiKey || !model || !voice) {
    throw new Error('请先配置 Mossland Base URL、API Key、模型和 Voice');
  }

  const response = await fetch(buildOpenAISpeechEndpoint(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ model, input: speakableText, voice, response_format: 'mp3' }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mossland TTS Error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const audioBytes = new Uint8Array(await response.arrayBuffer());
  if (audioBytes.length === 0) throw new Error('Mossland 未返回音频数据');
  const file = new File(Paths.cache, 'tts_audio_mossland.mp3');
  const writer = file.writableStream().getWriter();
  await writer.write(audioBytes);
  await writer.close();
  return createAudioPlayer(file.uri);
}

async function createCartesiaTTSPlayer(speakableText: string, config: TTSConfig): Promise<ReturnType<typeof createAudioPlayer>> {
  const apiKey = config.cartesiaApiKey.trim();
  const voiceId = config.cartesiaVoiceId.trim();
  if (!apiKey) {
    throw new Error('请先配置 Cartesia API Key');
  }
  if (!voiceId) {
    throw new Error('请先配置 Cartesia Voice ID');
  }

  const response = await fetch(buildCartesiaTtsBytesEndpoint(config.cartesiaBaseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Cartesia-Version': '2026-03-01',
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      model_id: config.cartesiaModel.trim() || 'sonic-3.5',
      transcript: speakableText,
      voice: {
        mode: 'id',
        id: voiceId,
      },
      language: normalizeCartesiaLanguage(config.cartesiaLanguage),
      output_format: {
        container: 'mp3',
        sample_rate: 44100,
        bit_rate: 128000,
      },
      generation_config: {
        speed: clampNumber(config.cartesiaSpeed, 0.6, 1.5, 1),
        volume: clampNumber(config.cartesiaVolume, 0.5, 2, 1),
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Cartesia TTS Error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const audioBytes = new Uint8Array(await response.arrayBuffer());
  if (audioBytes.length === 0) {
    throw new Error('Cartesia 未返回音频数据');
  }

  const file = new File(Paths.cache, 'tts_audio_cartesia.mp3');
  const writable = file.writableStream();
  const writer = writable.getWriter();
  await writer.write(audioBytes);
  await writer.close();

  return createAudioPlayer(file.uri);
}

function buildDeepgramSpeakEndpoint(baseUrl: string, model: string): string {
  const url = new URL(baseUrl.trim() || 'https://api.deepgram.com/v1');
  const path = url.pathname.replace(/\/$/, '');
  if (!path || path === '/') {
    url.pathname = '/v1/speak';
  } else if (path.endsWith('/speak')) {
    url.pathname = path;
  } else {
    url.pathname = `${path}/speak`;
  }
  url.searchParams.set('model', model.trim() || 'aura-2-thalia-en');
  return url.toString();
}

function buildOpenAISpeechEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/$/, '');
  url.pathname = path.endsWith('/audio/speech') ? path : `${path || ''}/audio/speech`;
  return url.toString();
}

function buildCartesiaTtsBytesEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim() || 'https://api.cartesia.ai');
  const path = url.pathname.replace(/\/$/, '');
  url.pathname = path.endsWith('/tts/bytes') ? path : `${path || ''}/tts/bytes`;
  return url.toString();
}

function normalizeCartesiaLanguage(language: string): string {
  return (language || 'zh').trim() || 'zh';
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export async function playTTS(text: string, config: TTSConfig): Promise<void> {
  await stopTTS();
  currentPlayer = await createTTSPlayer(text, config);
  currentPlayer.play();
}

export async function playTTSAndWait(text: string, config: TTSConfig): Promise<void> {
  await stopTTS();
  currentPlayer = await createTTSPlayer(text, config);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      currentSubscription?.remove();
      currentSubscription = null;
      currentWaitResolve = null;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    currentWaitResolve = () => finish();
    currentSubscription = currentPlayer?.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.error) {
        finish(new Error(status.error));
        return;
      }
      if (status.didJustFinish) {
        finish();
      }
    }) ?? null;
    currentPlayer?.play();
  });

  await stopTTS();
}

export async function stopTTS(): Promise<void> {
  currentSubscription?.remove();
  currentSubscription = null;
  currentWaitResolve?.();
  currentWaitResolve = null;
  if (currentPlayer) {
    currentPlayer.pause();
    currentPlayer.release();
    currentPlayer = null;
  }
}

function sanitizeTTSInput(text: string): string {
  let next = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ')
    .replace(/<[^<>]*>/g, ' ');
  const bracketedContentPattern =
    /\[[^\[\]]*\]|\([^()]*\)|\{[^{}]*\}|\u3010[^\u3010\u3011]*\u3011|\uFF08[^\uFF08\uFF09]*\uFF09|\uFF5B[^\uFF5B\uFF5D]*\uFF5D|<[^<>]*>|\uFF1C[^\uFF1C\uFF1E]*\uFF1E/g;

  while (bracketedContentPattern.test(next)) {
    next = next.replace(bracketedContentPattern, ' ');
    bracketedContentPattern.lastIndex = 0;
  }

  return next.replace(/[\u300A\u300B]/g, '').replace(/\s+/g, ' ').trim();
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
