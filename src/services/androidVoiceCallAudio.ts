import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

export interface VoiceCallAudioChunkEvent {
  base64: string;
  sampleRate: number;
}

export interface VoiceCallAudioErrorEvent {
  message?: string;
}

export interface VoiceCallPlaybackEvent {
  active: boolean;
}

export interface VoiceCallBargeInEvent {
  chunks?: string[];
  sampleRate?: number;
}

export interface VoiceCallSpeechEndEvent {
  sampleRate?: number;
}

interface VoiceCallAudioModule {
  startMic(sampleRate: number, chunkMs: number): Promise<boolean>;
  stopMic(): Promise<boolean>;
  startMp3Speaker(sampleRate: number, channels: number): Promise<boolean>;
  setSpeakerphoneOn(enabled: boolean): Promise<boolean>;
  setSpeakerVolume(volume: number): Promise<boolean>;
  setTuningConfig(config: VoiceCallAudioTuningConfig): Promise<boolean>;
  writeMp3Chunk(base64: string): Promise<boolean>;
  writePcmChunk(base64: string): Promise<boolean>;
  finishPcmPlayback(): Promise<boolean>;
  enqueueMp3Clip(base64: string): Promise<boolean>;
  clearSpeaker(): Promise<boolean>;
  stopSpeaker(): Promise<boolean>;
  stopAll(): Promise<boolean>;
  startIncomingRingtone(): Promise<boolean>;
  stopIncomingRingtone(): Promise<boolean>;
}

export interface VoiceCallAudioTuningConfig {
  bargeInMinSpeechMs?: number;
  bargeInRmsFloor?: number;
  bargeInEchoMultiplier?: number;
  bargeInPeakThreshold?: number;
  bargeInClearPeakThreshold?: number;
  bargeInClearRmsThreshold?: number;
  playbackMicSuppressMs?: number;
  afterPlaybackSuppressMs?: number;
  micStartMinSpeechMs?: number;
  micEndSilenceMs?: number;
  micTrailingAudioMs?: number;
  micMinStartRms?: number;
  micMinActiveRms?: number;
}

const nativeModule = NativeModules.VoiceCallAudio as VoiceCallAudioModule | undefined;

export function isAndroidVoiceCallAudioAvailable(): boolean {
  return Platform.OS === 'android' && !!nativeModule;
}

function requireVoiceCallAudio(): VoiceCallAudioModule {
  if (!isAndroidVoiceCallAudioAvailable() || !nativeModule) {
    throw new Error('实时语音通话目前只支持 Android 自定义构建');
  }
  return nativeModule;
}

export async function startVoiceCallMic(sampleRate = 16000, chunkMs = 20): Promise<void> {
  await requireVoiceCallAudio().startMic(sampleRate, chunkMs);
}

export async function stopVoiceCallMic(): Promise<void> {
  await requireVoiceCallAudio().stopMic();
}

export async function startVoiceCallSpeaker(sampleRate = 32000, channels = 1): Promise<void> {
  await requireVoiceCallAudio().startMp3Speaker(sampleRate, channels);
}

export async function setVoiceCallSpeakerphoneOn(enabled: boolean): Promise<void> {
  await requireVoiceCallAudio().setSpeakerphoneOn(enabled);
}

export async function setVoiceCallSpeakerVolume(volume: number): Promise<void> {
  await requireVoiceCallAudio().setSpeakerVolume(volume);
}

export async function setVoiceCallAudioTuningConfig(config: VoiceCallAudioTuningConfig): Promise<void> {
  await requireVoiceCallAudio().setTuningConfig(config);
}

export async function writeVoiceCallMp3Chunk(base64: string): Promise<void> {
  await requireVoiceCallAudio().writeMp3Chunk(base64);
}

export async function writeVoiceCallPcmChunk(base64: string): Promise<void> {
  await requireVoiceCallAudio().writePcmChunk(base64);
}

export async function finishVoiceCallPcmPlayback(): Promise<void> {
  await requireVoiceCallAudio().finishPcmPlayback();
}

export async function enqueueVoiceCallMp3Clip(base64: string): Promise<void> {
  await requireVoiceCallAudio().enqueueMp3Clip(base64);
}

export async function clearVoiceCallSpeaker(): Promise<void> {
  await requireVoiceCallAudio().clearSpeaker();
}

export async function stopVoiceCallSpeaker(): Promise<void> {
  await requireVoiceCallAudio().stopSpeaker();
}

export async function stopVoiceCallAudio(): Promise<void> {
  await requireVoiceCallAudio().stopAll();
}

export async function startIncomingCallRingtone(): Promise<void> {
  await requireVoiceCallAudio().startIncomingRingtone();
}

export async function stopIncomingCallRingtone(): Promise<void> {
  await requireVoiceCallAudio().stopIncomingRingtone();
}

export function addVoiceCallAudioChunkListener(
  listener: (event: VoiceCallAudioChunkEvent) => void
) {
  return DeviceEventEmitter.addListener('VoiceCallAudioChunk', listener);
}

export function addVoiceCallAudioErrorListener(
  listener: (event: VoiceCallAudioErrorEvent) => void
) {
  return DeviceEventEmitter.addListener('VoiceCallAudioError', listener);
}

export function addVoiceCallPlaybackListener(
  listener: (event: VoiceCallPlaybackEvent) => void
) {
  return DeviceEventEmitter.addListener('VoiceCallPlayback', listener);
}

export function addVoiceCallBargeInListener(
  listener: (event: VoiceCallBargeInEvent) => void
) {
  return DeviceEventEmitter.addListener('VoiceCallBargeIn', listener);
}

export function addVoiceCallSpeechEndListener(
  listener: (event: VoiceCallSpeechEndEvent) => void
) {
  return DeviceEventEmitter.addListener('VoiceCallSpeechEnd', listener);
}
