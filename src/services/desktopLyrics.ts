import { AppState, Platform } from 'react-native';
import {
  addDesktopLyricActionListener,
  hideDesktopLyric,
  showDesktopLyric,
  type DesktopLyricAction,
} from './floatingBall';
import { useMusicStore } from '../stores/music';
import { useRadioStore } from '../stores/radio';

let storeUnsubscribe: (() => void) | null = null;
let radioUnsubscribe: (() => void) | null = null;
let actionSubscription: { remove: () => void } | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let lastSignature = '';
let pendingSignature = '';
let panelMode: 'lyrics' | 'radio' = 'lyrics';

export function startDesktopLyricSync(): () => void {
  if (storeUnsubscribe) return stopDesktopLyricSync;

  actionSubscription = addDesktopLyricActionListener(handleDesktopLyricAction);
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      refreshDesktopLyric();
    }
  });
  storeUnsubscribe = useMusicStore.subscribe(syncDesktopLyric);
  radioUnsubscribe = useRadioStore.subscribe(syncDesktopLyric);
  syncDesktopLyric();

  return stopDesktopLyricSync;
}

export function stopDesktopLyricSync(): void {
  storeUnsubscribe?.();
  radioUnsubscribe?.();
  actionSubscription?.remove();
  appStateSubscription?.remove();
  storeUnsubscribe = null;
  radioUnsubscribe = null;
  actionSubscription = null;
  appStateSubscription = null;
  lastSignature = '';
  pendingSignature = '';
  hideDesktopLyric().catch(() => undefined);
}

export function refreshDesktopLyric(): void {
  lastSignature = '';
  pendingSignature = '';
  syncDesktopLyric();
}

function syncDesktopLyric(): void {
  if (Platform.OS !== 'android') return;
  const state = useMusicStore.getState();
  const radio = useRadioStore.getState();
  if (!state.desktopLyricsEnabled || (!state.isOpen && !radio.active)) {
    if (lastSignature) {
      lastSignature = '';
      pendingSignature = '';
      hideDesktopLyric().catch(() => undefined);
    }
    return;
  }

  const nextState = getDesktopLyricState();
  const signature = [
    nextState.text,
    Math.round(nextState.lyricProgress * 1000),
    nextState.title,
    nextState.artist,
    nextState.artworkUrl,
    nextState.backgroundUri,
    Math.round(nextState.songProgress * 1000),
    nextState.isPlaying ? '1' : '0',
    nextState.panelMode,
    nextState.radioStatus,
    nextState.radioScript,
    nextState.radioTrack,
    nextState.radioActionLabel,
    nextState.radioActionEnabled ? '1' : '0',
  ].join('|');
  if (signature === lastSignature || signature === pendingSignature) return;
  pendingSignature = signature;

  showDesktopLyric(
    nextState.text,
    nextState.lyricProgress,
    nextState.title,
    nextState.artist,
    nextState.artworkUrl,
    nextState.songProgress,
    nextState.isPlaying,
    nextState.backgroundUri,
    nextState.panelMode,
    nextState.radioStatus,
    nextState.radioScript,
    nextState.radioTrack,
    nextState.radioActionLabel,
    nextState.radioActionEnabled
  ).then(() => {
    if (pendingSignature === signature) {
      lastSignature = signature;
      pendingSignature = '';
    }
  }).catch((error) => {
    if (pendingSignature === signature) {
      pendingSignature = '';
    }
    console.warn('[DesktopLyric] showDesktopLyric failed', error);
  });
}

function handleDesktopLyricAction(action: DesktopLyricAction): void {
  const music = useMusicStore.getState();
  if (action === 'previous') {
    music.previous().catch(() => undefined);
    return;
  }
  if (action === 'toggle_play') {
    music.togglePlayPause().catch(() => undefined);
    return;
  }
  if (action === 'next') {
    music.next().catch(() => undefined);
    return;
  }
  if (action === 'toggle_view') {
    panelMode = panelMode === 'lyrics' ? 'radio' : 'lyrics';
    lastSignature = '';
    syncDesktopLyric();
    return;
  }
  if (action === 'radio_action') {
    handleRadioAction();
    return;
  }
  if (action === 'close') {
    music.setDesktopLyricsEnabled(false);
    hideDesktopLyric().catch(() => undefined);
  }
}

function getDesktopLyricState(): {
  text: string;
  lyricProgress: number;
  title: string;
  artist: string;
  artworkUrl: string;
  backgroundUri: string;
  songProgress: number;
  isPlaying: boolean;
  panelMode: 'lyrics' | 'radio';
  radioStatus: string;
  radioScript: string;
  radioTrack: string;
  radioActionLabel: string;
  radioActionEnabled: boolean;
} {
  const state = useMusicStore.getState();
  const radio = useRadioStore.getState();
  const track = state.tracks[state.currentIndex];
  const radioState = getRadioPanelState();
  const radioAction = getRadioActionState();
  if (!track) {
    return {
      text: panelMode === 'radio' ? radioState.text : '暂无播放歌曲',
      lyricProgress: 0,
      title: panelMode === 'radio' ? radio.title : '暂无播放歌曲',
      artist: panelMode === 'radio' ? radio.status : '',
      artworkUrl: '',
      backgroundUri: state.desktopLyricBackgroundUri,
      songProgress: 0,
      isPlaying: false,
      panelMode,
      radioStatus: radio.status,
      radioScript: radioState.script,
      radioTrack: radio.currentTrackLabel,
      radioActionLabel: radioAction.label,
      radioActionEnabled: radioAction.enabled,
    };
  }

  const lyric =
    state.currentLyricIndex >= 0
      ? track.lyrics[state.currentLyricIndex]?.text
      : '';
  const lyricProgress = lyric
    ? getCurrentLyricProgress(state, track.lyrics[state.currentLyricIndex], track.lyrics[state.currentLyricIndex + 1])
    : getBoundedProgress(state.currentTimeMs, 0, state.durationMs);

  return {
    text: panelMode === 'radio' ? radioState.text : lyric || `${track.title} - ${track.artist}`,
    lyricProgress,
    title: panelMode === 'radio' ? radio.title : track.title,
    artist: panelMode === 'radio' ? radio.status : track.artist,
    artworkUrl: track.artworkUrl ?? '',
    backgroundUri: state.desktopLyricBackgroundUri,
    songProgress: getBoundedProgress(state.currentTimeMs, 0, state.durationMs),
    isPlaying: state.isPlaying,
    panelMode,
    radioStatus: radio.status,
    radioScript: radioState.script,
    radioTrack: radio.currentTrackLabel || `${track.title} - ${track.artist}`,
    radioActionLabel: radioAction.label,
    radioActionEnabled: radioAction.enabled,
  };
}

function handleRadioAction(): void {
  const radio = useRadioStore.getState();
  if (radio.loading || radio.ending) return;

  if (radio.phase === 'call_in_waiting') {
    radio.continueProgram().catch(() => undefined);
    return;
  }

  if (radio.active) {
    radio.end().catch(() => undefined);
    return;
  }

  radio.start().catch(() => undefined);
}

function getRadioActionState(): { label: string; enabled: boolean } {
  const radio = useRadioStore.getState();
  if (radio.loading || radio.ending) {
    return { label: '处理中', enabled: false };
  }
  if (radio.phase === 'call_in_waiting') {
    return { label: '继续', enabled: true };
  }
  if (radio.active) {
    return { label: '总结', enabled: true };
  }
  return { label: '开台', enabled: true };
}

function getRadioPanelState(): { text: string; script: string } {
  const radio = useRadioStore.getState();
  if (!radio.active) {
    return {
      text: 'AI 电台未开台',
      script: '开启电台后，这里会显示当前节目脚本、来电环节和节目状态。',
    };
  }

  const script = radio.currentScript.trim();
  if (script) {
    return {
      text: script,
      script,
    };
  }

  const latestProgram = radio.programs[radio.programs.length - 1];
  const fallbackScript = latestProgram?.summary || radio.status;
  return {
    text: fallbackScript,
    script: fallbackScript,
  };
}

function getCurrentLyricProgress(
  state: ReturnType<typeof useMusicStore.getState>,
  currentLine: { timeMs: number; durationMs?: number },
  nextLine?: { timeMs: number }
): number {
  const endTimeMs = currentLine.durationMs
    ? currentLine.timeMs + currentLine.durationMs
    : nextLine?.timeMs ?? state.durationMs;
  return getBoundedProgress(state.currentTimeMs, currentLine.timeMs, endTimeMs);
}

function getBoundedProgress(currentTimeMs: number, startTimeMs: number, endTimeMs: number): number {
  const durationMs = Math.max(1, endTimeMs - startTimeMs);
  return Math.min(1, Math.max(0, (currentTimeMs - startTimeMs) / durationMs));
}
