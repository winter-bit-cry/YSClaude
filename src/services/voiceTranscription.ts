import { fetch as expoFetch } from 'expo/fetch';
import { File, UploadType } from 'expo-file-system';

const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';

export interface TranscribeVoiceRequest {
  provider?: 'openai' | 'fish' | 'deepgram';
  baseUrl: string;
  apiKey: string;
  uri: string;
  mimeType?: string;
  fileName?: string;
  model?: string;
  language?: string;
  ignoreTimestamps?: boolean;
}

export async function transcribeVoice({
  provider = 'openai',
  baseUrl,
  apiKey,
  uri,
  mimeType,
  fileName,
  model = DEFAULT_TRANSCRIPTION_MODEL,
  language,
  ignoreTimestamps,
}: TranscribeVoiceRequest): Promise<string> {
  if (provider === 'fish') {
    return transcribeFishAudio({
      baseUrl,
      apiKey,
      uri,
      mimeType,
      fileName,
      language,
      ignoreTimestamps,
    });
  }

  if (provider === 'deepgram') {
    return transcribeDeepgram({
      baseUrl,
      apiKey,
      uri,
      mimeType,
      model,
      language,
    });
  }

  return transcribeOpenAI({
    baseUrl,
    apiKey,
    uri,
    mimeType,
    fileName,
    model,
  });
}

async function transcribeOpenAI({
  baseUrl,
  apiKey,
  uri,
  mimeType,
  fileName,
  model = DEFAULT_TRANSCRIPTION_MODEL,
}: TranscribeVoiceRequest): Promise<string> {
  const endpoint = `${baseUrl.trim().replace(/\/$/, '')}/audio/transcriptions`;
  const formData = new FormData();
  formData.append('model', model);
  await appendAudioFile(formData, 'file', uri, mimeType, fileName);

  const response = await expoFetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: formData as any,
  }) as Response;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`STT Error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const json = await response.json();
  const text = typeof json.text === 'string' ? json.text.trim() : '';
  if (!text) {
    throw new Error('STT 未返回文字');
  }
  return text;
}

async function transcribeFishAudio({
  baseUrl,
  apiKey,
  uri,
  mimeType,
  fileName,
  language = 'zh',
  ignoreTimestamps = true,
}: TranscribeVoiceRequest): Promise<string> {
  const endpoint = `${baseUrl.trim().replace(/\/$/, '')}/v1/asr`;
  const formData = new FormData();
  await appendAudioFile(formData, 'audio', uri, mimeType, fileName);

  const normalizedLanguage = language.trim();
  if (normalizedLanguage) {
    formData.append('language', normalizedLanguage);
  }
  formData.append('ignore_timestamps', ignoreTimestamps ? 'true' : 'false');

  const response = await expoFetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: formData as any,
  }) as Response;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fish Audio STT Error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const json = await response.json();
  const text = typeof json.text === 'string' ? json.text.trim() : '';
  if (!text) {
    throw new Error('Fish Audio STT 未返回文字');
  }
  return text;
}

async function transcribeDeepgram({
  baseUrl,
  apiKey,
  uri,
  mimeType,
  model = 'nova-3',
  language,
}: TranscribeVoiceRequest): Promise<string> {
  const endpoint = buildDeepgramEndpoint(baseUrl, model, language);
  const file = new File(uri);
  let response;
  try {
    response = await file.upload(endpoint, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      mimeType: mimeType || mimeTypeFromUri(uri),
      headers: {
        Authorization: `Token ${apiKey.trim()}`,
        'Content-Type': mimeType || mimeTypeFromUri(uri),
      },
    });
  } catch (error: any) {
    const message = String(error?.message || error || '');
    if (message.includes('SETTINGS preface')) {
      throw new Error('Deepgram STT 请求失败：请确认 Base URL 使用 REST 地址 https://api.deepgram.com/v1');
    }
    throw error;
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Deepgram STT Error ${response.status}: ${response.body.slice(0, 300)}`);
  }

  const json = JSON.parse(response.body);
  const text = extractDeepgramTranscript(json);
  if (!text) {
    throw new Error('Deepgram STT 未返回文字');
  }
  return text;
}

function buildDeepgramEndpoint(baseUrl: string, model?: string, language?: string): string {
  const url = new URL(baseUrl.trim() || 'https://api.deepgram.com/v1');
  const normalizedPath = url.pathname.replace(/\/$/, '');
  if (!normalizedPath || normalizedPath === '') {
    url.pathname = '/v1/listen';
  } else if (normalizedPath.endsWith('/listen')) {
    url.pathname = normalizedPath;
  } else {
    url.pathname = `${normalizedPath}/listen`;
  }
  const normalizedModel = model?.trim() || 'nova-3';
  if (normalizedModel) {
    url.searchParams.set('model', normalizedModel);
  }
  const normalizedLanguage = language?.trim();
  if (normalizedLanguage) {
    url.searchParams.set('language', normalizedLanguage);
  }
  url.searchParams.set('smart_format', 'true');
  return url.toString();
}

function extractDeepgramTranscript(json: any): string {
  const channels = json?.results?.channels;
  if (!Array.isArray(channels)) return '';
  const transcripts = channels
    .flatMap((channel) => Array.isArray(channel?.alternatives) ? channel.alternatives : [])
    .map((alternative) => typeof alternative?.transcript === 'string' ? alternative.transcript.trim() : '')
    .filter(Boolean);
  return transcripts.join('\n').trim();
}

async function appendAudioFile(
  formData: FormData,
  fieldName: string,
  uri: string,
  mimeType?: string,
  fileName?: string
): Promise<void> {
  const file = new File(uri);
  const name = fileName || file.name || `voice${extensionFromUri(uri)}`;
  const type = mimeType || mimeTypeFromUri(uri);
  formData.append(fieldName, {
    name,
    type,
    bytes: () => file.bytes(),
  } as any);
}

export function mimeTypeFromUri(uri: string): string {
  const lower = uri.toLowerCase().split('?')[0];
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.3gp')) return 'audio/3gpp';
  if (lower.endsWith('.mp4')) return 'audio/mp4';
  return 'audio/mp4';
}

export function extensionFromUri(uri: string): string {
  const lower = uri.toLowerCase().split('?')[0];
  const match = lower.match(/\.[a-z0-9]+$/);
  return match?.[0] || '.m4a';
}
