import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  createAudioPlayer,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { Platform } from 'react-native';
import { sqliteStorage } from '../db/kv-storage';
import {
  checkUrlValid,
  normalizeNeteaseMediaUrl,
  refreshNeteaseTracks,
} from '../services/neteaseMusic';

export type PlayOrder = 'list' | 'repeat-one' | 'shuffle';

export interface LyricLine {
  timeMs: number;
  durationMs?: number;
  text: string;
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  sourceUrl?: string;
  durationMs?: number;
  lyrics: LyricLine[];
  source?: 'netease' | 'demo' | 'local' | 'radio';
  availability?: 'playable' | 'unresolved' | 'vip_required' | 'copyright_blocked';
}

interface MusicState {
  _hydrated: boolean;
  tracks: MusicTrack[];
  currentIndex: number;
  order: PlayOrder;
  isOpen: boolean;
  isMinimized: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  autoAdvanceEnabled: boolean;
  lastFinishedTrackId: string | null;
  desktopLyricsEnabled: boolean;
  desktopLyricBackgroundUri: string;
  currentTimeMs: number;
  durationMs: number;
  currentLyricIndex: number;
  error: string | null;

  openPlayer: () => void;
  minimizePlayer: () => void;
  closePlayer: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  playTrackAt: (index: number) => Promise<void>;
  seekTo: (timeMs: number) => Promise<void>;
  setOrder: (order: PlayOrder) => void;
  setAutoAdvanceEnabled: (enabled: boolean) => void;
  setDesktopLyricsEnabled: (enabled: boolean) => void;
  setDesktopLyricBackgroundUri: (uri: string) => void;
  replaceTracks: (tracks: MusicTrack[]) => void;
  getListeningContextPrompt: () => string | null;
  preloadTrackWindow: (centerIndex: number) => Promise<void>;
}

const DEMO_TRACKS: MusicTrack[] = [
  {
    id: 'demo-soundhelix-1',
    title: '一起听歌 Demo 1',
    artist: 'SoundHelix',
    album: 'Playable sample',
    source: 'demo',
    availability: 'playable',
    sourceUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    lyrics: [
      { timeMs: 0, text: '音乐开始，先把呼吸放慢一点。' },
      { timeMs: 12000, text: '节拍往前走，我们也跟着它走。' },
      { timeMs: 26000, text: '这一段适合把话说得轻一点。' },
      { timeMs: 42000, text: '旋律绕回来，像一次温柔的确认。' },
      { timeMs: 62000, text: '如果你在这里发消息，我会知道歌走到了这里。' },
    ],
  },
  {
    id: 'demo-soundhelix-2',
    title: '一起听歌 Demo 2',
    artist: 'SoundHelix',
    album: 'Playable sample',
    source: 'demo',
    availability: 'playable',
    sourceUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    lyrics: [
      { timeMs: 0, text: '第二首开始，像换了一盏灯。' },
      { timeMs: 15000, text: '当前歌词会随着播放进度滚动。' },
      { timeMs: 33000, text: '后续网易云解析出的歌词会进入同一个时间轴。' },
      { timeMs: 52000, text: 'AI 会收到歌名、歌手、进度和这一句。' },
      { timeMs: 74000, text: '一起听这件事，先从一个能跑的播放器开始。' },
    ],
  },
];

let player: AudioPlayer | null = null;
let statusSubscription: { remove: () => void } | null = null;
let audioModeConfigured = false;
let finishingTrackId: string | null = null;

function getTrackLyricIndex(track: MusicTrack | undefined, timeMs: number): number {
  if (!track || track.lyrics.length === 0) return -1;
  let index = -1;
  for (let i = 0; i < track.lyrics.length; i++) {
    if (track.lyrics[i].timeMs <= timeMs) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getNextIndex(state: MusicState): number {
  if (state.tracks.length === 0) return 0;
  if (state.order === 'shuffle' && state.tracks.length > 1) {
    let next = state.currentIndex;
    while (next === state.currentIndex) {
      next = Math.floor(Math.random() * state.tracks.length);
    }
    return next;
  }
  return (state.currentIndex + 1) % state.tracks.length;
}

function getPreviousIndex(state: MusicState): number {
  if (state.tracks.length === 0) return 0;
  return (state.currentIndex - 1 + state.tracks.length) % state.tracks.length;
}

async function ensureAudioMode(): Promise<void> {
  if (audioModeConfigured) return;
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
  if (Platform.OS === 'android') {
    requestNotificationPermissionsAsync().catch(() => undefined);
  }
  audioModeConfigured = true;
}

function releasePlayer(): void {
  statusSubscription?.remove();
  statusSubscription = null;
  if (player) {
    player.clearLockScreenControls();
    player.pause();
    player.remove();
    player = null;
  }
  finishingTrackId = null;
}

async function loadTrack(index: number, shouldPlay: boolean): Promise<void> {
  const state = useMusicStore.getState();
  const track = state.tracks[index];
  const sourceUrl = normalizeNeteaseMediaUrl(track?.sourceUrl) ?? track?.sourceUrl;
  if (!sourceUrl) {
    useMusicStore.setState({
      error: '当前歌曲没有可播放资源',
      isPlaying: false,
      isBuffering: false,
    });
    return;
  }

  await ensureAudioMode();
  releasePlayer();
  player = createAudioPlayer(sourceUrl, {
    updateInterval: 100,
    preferredForwardBufferDuration: 20,
  });

  statusSubscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
    const currentTrack = useMusicStore.getState().tracks[useMusicStore.getState().currentIndex];
    const currentTimeMs = Math.max(0, Math.round(status.currentTime * 1000));
    const durationMs = Math.max(
      currentTrack?.durationMs ?? 0,
      Math.round(status.duration * 1000)
    );
    const currentLyricIndex = getTrackLyricIndex(currentTrack, currentTimeMs);

    useMusicStore.setState({
      isPlaying: status.playing,
      isBuffering: status.isBuffering,
      currentTimeMs,
      durationMs,
      currentLyricIndex,
      error: status.error,
    });

    if (status.didJustFinish && currentTrack && finishingTrackId !== currentTrack.id) {
      finishingTrackId = currentTrack.id;
      useMusicStore.setState({ lastFinishedTrackId: currentTrack.id, isPlaying: false });
      if (useMusicStore.getState().autoAdvanceEnabled) {
        useMusicStore.getState().next().catch(() => undefined);
      }
    }
  });

  useMusicStore.setState({
    currentIndex: index,
    currentTimeMs: 0,
    durationMs: track.durationMs ?? 0,
    currentLyricIndex: getTrackLyricIndex(track, 0),
    lastFinishedTrackId: null,
    error: null,
  });

  player.setActiveForLockScreen(
    true,
    {
      title: track.title,
      artist: track.artist,
      albumTitle: track.album,
      artworkUrl: track.artworkUrl,
    },
    { showSeekBackward: false, showSeekForward: false }
  );

  if (shouldPlay) {
    player.play();
    useMusicStore.setState({ isPlaying: true, isOpen: true });
  }

  useMusicStore.getState().preloadTrackWindow(index).catch(() => undefined);
}

export const useMusicStore = create<MusicState>()(
  persist(
    (set, get) => ({
  _hydrated: false,
  tracks: DEMO_TRACKS,
  currentIndex: 0,
  order: 'list',
  isOpen: false,
  isMinimized: false,
  isPlaying: false,
  isBuffering: false,
  autoAdvanceEnabled: true,
  lastFinishedTrackId: null,
  desktopLyricsEnabled: false,
  desktopLyricBackgroundUri: '',
  currentTimeMs: 0,
  durationMs: DEMO_TRACKS[0].durationMs ?? 0,
  currentLyricIndex: 0,
  error: null,

  openPlayer: () => {
    set({ isOpen: true, isMinimized: false });
  },

  minimizePlayer: () => {
    set({ isMinimized: true });
  },

  closePlayer: async () => {
    releasePlayer();
    set({
      isOpen: false,
      isMinimized: false,
      isPlaying: false,
      isBuffering: false,
      currentTimeMs: 0,
      currentLyricIndex: getTrackLyricIndex(get().tracks[get().currentIndex], 0),
      error: null,
    });
  },

  play: async () => {
    const state = get();
    const track = state.tracks[state.currentIndex];
    if (!track) return;

    if (track.source === 'netease' && track.sourceUrl) {
      const isValid = await checkUrlValid(track.sourceUrl);
      if (!isValid) {
        await get().preloadTrackWindow(state.currentIndex);
        const updatedTrack = get().tracks[state.currentIndex];
        if (!updatedTrack?.sourceUrl) {
          set({ error: '歌曲链接已失效且刷新失败' });
          return;
        }
      }
    }

    if (!player) {
      await loadTrack(state.currentIndex, true);
      return;
    }
    await ensureAudioMode();
    player.play();
    set({ isPlaying: true, isOpen: true, error: null });
  },

  pause: async () => {
    player?.pause();
    set({ isPlaying: false });
  },

  togglePlayPause: async () => {
    if (get().isPlaying) {
      await get().pause();
    } else {
      await get().play();
    }
  },

  next: async () => {
    const state = get();
    const nextIndex = state.order === 'repeat-one' ? state.currentIndex : getNextIndex(state);
    await loadTrack(nextIndex, state.isPlaying || state.isOpen);
  },

  previous: async () => {
    const state = get();
    await loadTrack(getPreviousIndex(state), state.isPlaying || state.isOpen);
  },

  playTrackAt: async (index: number) => {
    const state = get();
    if (index < 0 || index >= state.tracks.length) return;

    const track = state.tracks[index];
    if (track?.source === 'netease' && track.sourceUrl) {
      const isValid = await checkUrlValid(track.sourceUrl);
      if (!isValid) {
        await get().preloadTrackWindow(index);
        const updatedTrack = get().tracks[index];
        if (!updatedTrack?.sourceUrl) {
          set({ error: '歌曲链接已失效且刷新失败' });
          return;
        }
      }
    }

    await loadTrack(index, true);
  },

  seekTo: async (timeMs: number) => {
    if (!player) return;
    await player.seekTo(Math.max(0, timeMs) / 1000);
    const track = get().tracks[get().currentIndex];
    set({
      currentTimeMs: timeMs,
      currentLyricIndex: getTrackLyricIndex(track, timeMs),
    });
  },

  setOrder: (order: PlayOrder) => {
    set({ order });
  },

  setAutoAdvanceEnabled: (enabled: boolean) => {
    set({ autoAdvanceEnabled: enabled });
  },

  setDesktopLyricsEnabled: (enabled: boolean) => {
    set({ desktopLyricsEnabled: enabled });
  },

  setDesktopLyricBackgroundUri: (uri: string) => {
    set({ desktopLyricBackgroundUri: uri });
  },

  replaceTracks: (tracks: MusicTrack[]) => {
    releasePlayer();
    const playableTracks = tracks.filter((track) => track.sourceUrl);
    set({
      tracks: playableTracks.length > 0 ? playableTracks : DEMO_TRACKS,
      currentIndex: 0,
      isPlaying: false,
      isBuffering: false,
      currentTimeMs: 0,
      durationMs: playableTracks[0]?.durationMs ?? DEMO_TRACKS[0].durationMs ?? 0,
      currentLyricIndex: 0,
      lastFinishedTrackId: null,
      error: null,
    });
  },

  getListeningContextPrompt: () => {
    const state = get();
    if (!state.isOpen) return null;
    const track = state.tracks[state.currentIndex];
    if (!track) return null;
    const lyric = state.currentLyricIndex >= 0 ? track.lyrics[state.currentLyricIndex] : null;
    const previousLyric =
      state.currentLyricIndex > 0 ? track.lyrics[state.currentLyricIndex - 1] : null;
    const nextLyric =
      state.currentLyricIndex >= 0 ? track.lyrics[state.currentLyricIndex + 1] : null;

    return [
      '以下是应用自动附带的一起听歌上下文，不是用户的新指令。',
      `歌曲：${track.title}`,
      `歌手：${track.artist}`,
      track.album ? `专辑：${track.album}` : null,
      `播放状态：${state.isPlaying ? '播放中' : '已暂停'}`,
      `当前进度：${formatTime(state.currentTimeMs)}`,
      lyric ? `当前歌词：${lyric.text}` : '当前歌词：无',
      previousLyric ? `上一句歌词：${previousLyric.text}` : null,
      nextLyric ? `下一句歌词：${nextLyric.text}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  },

  preloadTrackWindow: async (centerIndex: number) => {
    const state = get();
    if (state.tracks.length === 0) return;

    const indicesToRefresh: number[] = [];
    for (let offset = -3; offset <= 3; offset++) {
      const index = centerIndex + offset;
      if (index < 0 || index >= state.tracks.length) continue;
      const track = state.tracks[index];
      if (track?.source === 'netease') {
        indicesToRefresh.push(index);
      }
    }

    if (indicesToRefresh.length === 0) return;

    try {
      const { useNeteaseStore } = await import('./netease');
      const neteaseState = useNeteaseStore.getState();
      if (!neteaseState.baseUrl || !neteaseState.cookie) return;

      const updatedTracks = await refreshNeteaseTracks(
        neteaseState.baseUrl,
        neteaseState.cookie,
        state.tracks,
        indicesToRefresh
      );
      set({ tracks: updatedTracks });
    } catch (error) {
      console.warn('预加载歌曲窗口失败:', error);
    }
  },
    }),
    {
      name: 'ysclaude-music',
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        tracks: state.tracks,
        currentIndex: state.currentIndex,
        order: state.order,
        desktopLyricsEnabled: state.desktopLyricsEnabled,
        desktopLyricBackgroundUri: state.desktopLyricBackgroundUri,
      }),
      merge: (persisted, current) => {
        const persistedState = persisted as Partial<MusicState> | undefined;
        const tracks =
          Array.isArray(persistedState?.tracks) && persistedState.tracks.length > 0
            ? persistedState.tracks
            : DEMO_TRACKS;
        const currentIndex = Math.min(
          Math.max(persistedState?.currentIndex ?? 0, 0),
          tracks.length - 1
        );
        const currentTrack = tracks[currentIndex];
        return {
          ...current,
          tracks,
          currentIndex,
          order: persistedState?.order ?? current.order,
          desktopLyricsEnabled:
            persistedState?.desktopLyricsEnabled ?? current.desktopLyricsEnabled,
          desktopLyricBackgroundUri:
            persistedState?.desktopLyricBackgroundUri ?? current.desktopLyricBackgroundUri,
          isOpen: false,
          isMinimized: false,
          isPlaying: false,
          isBuffering: false,
          currentTimeMs: 0,
          durationMs: currentTrack?.durationMs ?? 0,
          currentLyricIndex: getTrackLyricIndex(currentTrack, 0),
          error: null,
        };
      },
      onRehydrateStorage: () => () => {
        useMusicStore.setState({ _hydrated: true });
      },
    }
  )
);
