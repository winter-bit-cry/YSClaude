import { MusicTrack, LyricLine } from '../stores/music';

export interface NeteaseProfile {
  userId: number;
  nickname: string;
  avatarUrl?: string;
  backgroundUrl?: string;
  signature?: string;
  follows?: number;
  followeds?: number;
  eventCount?: number;
  playlistCount?: number;
  listenSongs?: number;
  level?: number;
  listenTimeSeconds?: number;
  createDays?: number;
}

export interface NeteasePlaylistSummary {
  id: number;
  name: string;
  trackCount: number;
  coverImgUrl?: string;
}

export interface NeteaseRecommendedPlaylist extends NeteasePlaylistSummary {
  picUrl?: string;
  description?: string;
  copywriter?: string;
  playCount?: number;
}

export interface NeteaseQrLogin {
  key: string;
  qrimg: string;
}

export interface NeteaseQrCheckResult {
  code: number;
  message?: string;
  cookie?: string;
}

export interface NeteaseImportResult {
  tracks: MusicTrack[];
  playableCount: number;
  skippedCount: number;
}

let publicPlaylistPageCursor = Math.floor(Math.random() * 20);

interface NeteaseSong {
  id: number;
  name: string;
  dt?: number;
  ar?: Array<{ name: string }>;
  al?: { name?: string; picUrl?: string };
}

interface NeteaseSearchSong {
  id: number;
  name: string;
  duration?: number;
  artists?: Array<{ name: string }>;
  album?: { name?: string; picUrl?: string };
  ar?: Array<{ name: string }>;
  al?: { name?: string; picUrl?: string };
}

interface NeteaseSongUrl {
  id: number;
  url?: string | null;
  time?: number;
  freeTrialInfo?: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function withQuery(baseUrl: string, path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('timestamp', String(Date.now()));
  return url.toString();
}

export function normalizeNeteaseMediaUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'http:' && url.hostname.endsWith('.music.126.net')) {
      url.protocol = 'https:';
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

async function fetchJson<T>(baseUrl: string, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  if (!normalizeBaseUrl(baseUrl)) {
    throw new Error('请先填写网易云 API 地址');
  }
  const response = await fetch(withQuery(baseUrl, path, params));
  if (!response.ok) {
    throw new Error(`网易云 API 请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function createNeteaseQrLogin(baseUrl: string): Promise<NeteaseQrLogin> {
  const keyResult = await fetchJson<{ data?: { unikey?: string } }>(baseUrl, '/login/qr/key');
  const key = keyResult.data?.unikey;
  if (!key) {
    throw new Error('未获取到扫码登录 key');
  }
  const qrResult = await fetchJson<{ data?: { qrimg?: string } }>(baseUrl, '/login/qr/create', {
    key,
    qrimg: 'true',
  });
  const qrimg = qrResult.data?.qrimg;
  if (!qrimg) {
    throw new Error('未获取到登录二维码');
  }
  return { key, qrimg };
}

export async function checkNeteaseQrLogin(baseUrl: string, key: string): Promise<NeteaseQrCheckResult> {
  return fetchJson<NeteaseQrCheckResult>(baseUrl, '/login/qr/check', { key });
}

export async function getNeteaseLoginProfile(baseUrl: string, cookie: string): Promise<NeteaseProfile> {
  const result = await fetchJson<{ data?: { profile?: NeteaseProfile }; profile?: NeteaseProfile }>(
    baseUrl,
    '/login/status',
    { cookie }
  );
  const profile = result.data?.profile ?? result.profile;
  if (!profile?.userId) {
    throw new Error('未读取到网易云登录账号');
  }
  return profile;
}

export async function getNeteaseUserOverview(
  baseUrl: string,
  cookie: string,
  userId: number
): Promise<Partial<NeteaseProfile>> {
  const [detailResult, levelResult, listenResult] = await Promise.allSettled([
    fetchJson<{
      profile?: Partial<NeteaseProfile>;
      level?: number;
      listenSongs?: number;
      createDays?: number;
    }>(baseUrl, '/user/detail', { uid: userId, cookie }),
    fetchJson<{ data?: { level?: number; listenSongs?: number } }>(baseUrl, '/user/level', { cookie }),
    fetchJson<unknown>(baseUrl, '/listen/data/total', { cookie }),
  ]);

  const detail = detailResult.status === 'fulfilled' ? detailResult.value : {};
  const level = levelResult.status === 'fulfilled' ? levelResult.value.data : undefined;
  const listenTimeSeconds = listenResult.status === 'fulfilled'
    ? extractListenTimeSeconds(listenResult.value)
    : undefined;
  return {
    ...detail.profile,
    level: level?.level ?? detail.level,
    listenSongs: detail.listenSongs ?? level?.listenSongs,
    createDays: detail.createDays,
    listenTimeSeconds,
  };
}

function extractListenTimeSeconds(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['totalDuration', 'totalTime', 'listenTime', 'duration']) {
    const candidate = record[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return candidate > 100_000_000 ? Math.round(candidate / 1000) : Math.round(candidate);
    }
  }
  for (const child of Object.values(record)) {
    const result = extractListenTimeSeconds(child);
    if (result !== undefined) return result;
  }
  return undefined;
}

export async function getNeteasePlaylists(
  baseUrl: string,
  cookie: string,
  userId: number
): Promise<NeteasePlaylistSummary[]> {
  const result = await fetchJson<{ playlist?: NeteasePlaylistSummary[] }>(baseUrl, '/user/playlist', {
    uid: userId,
    limit: 100,
    cookie,
  });
  return result.playlist ?? [];
}

export async function getPublicRecommendedPlaylists(
  baseUrl: string,
  limit = 12,
  offset?: number
): Promise<NeteaseRecommendedPlaylist[]> {
  const resolvedOffset = offset ?? (publicPlaylistPageCursor++ % 20) * limit;
  const result = await fetchJson<{ playlists?: NeteaseRecommendedPlaylist[] }>(baseUrl, '/top/playlist', {
    order: 'hot',
    limit,
    offset: resolvedOffset,
  });
  return (result.playlists ?? []).map((item) => ({
    ...item,
    coverImgUrl: item.coverImgUrl ?? item.picUrl,
  }));
}

export async function getDailyRecommendedPlaylists(
  baseUrl: string,
  cookie: string
): Promise<NeteaseRecommendedPlaylist[]> {
  if (!cookie) return [];
  const result = await fetchJson<{ recommend?: NeteaseRecommendedPlaylist[] }>(
    baseUrl,
    '/recommend/resource',
    { cookie }
  );
  return (result.recommend ?? []).map((item) => ({
    ...item,
    coverImgUrl: item.coverImgUrl ?? item.picUrl,
  }));
}

export async function getRefreshedRecommendedPlaylists(
  baseUrl: string,
  cookie: string,
  limit = 12
): Promise<NeteaseRecommendedPlaylist[]> {
  if (!cookie) return [];
  const result = await fetchJson<unknown>(baseUrl, '/homepage/block/page', {
    refresh: 'true',
    cookie,
  });
  const playlists = extractHomepagePlaylists(result);
  return playlists.slice(0, limit);
}

function extractHomepagePlaylists(value: unknown): NeteaseRecommendedPlaylist[] {
  const found = new Map<number, NeteaseRecommendedPlaylist>();
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const item = candidate as Record<string, unknown>;
    const resourceType = String(item.resourceType ?? item.resourceTypeCode ?? '').toLowerCase();
    const playlistData = item.playlistData && typeof item.playlistData === 'object'
      ? item.playlistData as Record<string, unknown>
      : undefined;
    const uiElement = item.uiElement && typeof item.uiElement === 'object'
      ? item.uiElement as Record<string, unknown>
      : undefined;
    const mainTitle = uiElement?.mainTitle && typeof uiElement.mainTitle === 'object'
      ? uiElement.mainTitle as Record<string, unknown>
      : undefined;
    const image = uiElement?.image && typeof uiElement.image === 'object'
      ? uiElement.image as Record<string, unknown>
      : undefined;
    const rawId = playlistData?.id ?? item.resourceId;
    const id = typeof rawId === 'number' ? rawId : Number(rawId);
    const name = playlistData?.name ?? mainTitle?.title;
    const looksLikePlaylist = resourceType.includes('playlist') || !!playlistData;
    if (looksLikePlaylist && Number.isFinite(id) && typeof name === 'string' && name.trim()) {
      found.set(id, {
        id,
        name,
        trackCount: typeof playlistData?.trackCount === 'number' ? playlistData.trackCount : 0,
        coverImgUrl: normalizeNeteaseMediaUrl(
          typeof playlistData?.coverImgUrl === 'string'
            ? playlistData.coverImgUrl
            : typeof image?.imageUrl === 'string' ? image.imageUrl : undefined
        ),
        playCount: typeof playlistData?.playCount === 'number' ? playlistData.playCount : undefined,
      });
    }
    Object.values(item).forEach(visit);
  };
  visit(value);
  return [...found.values()];
}

async function getPlaylistSongs(baseUrl: string, cookie: string, playlistId: number): Promise<NeteaseSong[]> {
  const result = await fetchJson<{ songs?: NeteaseSong[] }>(baseUrl, '/playlist/track/all', {
    id: playlistId,
    limit: 1000,
    cookie,
  });
  return result.songs ?? [];
}

async function getSongUrls(baseUrl: string, cookie: string, songIds: number[]): Promise<Map<number, NeteaseSongUrl>> {
  if (songIds.length === 0) return new Map();
  const result = await fetchJson<{ data?: NeteaseSongUrl[] }>(baseUrl, '/song/url/v1', {
    id: songIds.join(','),
    level: 'exhigh',
    cookie,
  });
  return new Map((result.data ?? []).map((item) => [item.id, item]));
}

async function getLyrics(baseUrl: string, cookie: string, songId: number): Promise<LyricLine[]> {
  try {
    const result = await fetchJson<{ yrc?: { lyric?: string }; lrc?: { lyric?: string } }>(baseUrl, '/lyric/new', {
      id: songId,
      cookie,
    });
    const yrcLyrics = parseYrc(result.yrc?.lyric ?? '');
    if (yrcLyrics.length > 0) return yrcLyrics;
    return parseLrc(result.lrc?.lyric ?? '');
  } catch {
    return [];
  }
}

async function resolveSongs(
  baseUrl: string,
  cookie: string,
  songs: NeteaseSong[]
): Promise<MusicTrack[]> {
  const urls = await getSongUrls(baseUrl, cookie, songs.map((song) => song.id));
  const playableSongs = songs.filter((song) => {
    const url = urls.get(song.id);
    return !!url?.url && !url.freeTrialInfo;
  });
  const lyricPairs = await Promise.all(
    playableSongs.map(async (song) => [song.id, await getLyrics(baseUrl, cookie, song.id)] as const)
  );
  const lyricsBySongId = new Map(lyricPairs);
  return playableSongs.map((song) => {
    const source = urls.get(song.id);
    return {
      id: `netease-${song.id}`,
      title: song.name,
      artist: song.ar?.map((artist) => artist.name).filter(Boolean).join(' / ') || '未知歌手',
      album: song.al?.name,
      artworkUrl: song.al?.picUrl,
      sourceUrl: normalizeNeteaseMediaUrl(source?.url),
      durationMs: source?.time ?? song.dt,
      lyrics: lyricsBySongId.get(song.id) ?? [],
      source: 'netease',
      availability: 'playable',
    } satisfies MusicTrack;
  });
}

export async function getDailyRecommendedSongs(
  baseUrl: string,
  cookie: string
): Promise<MusicTrack[]> {
  if (!cookie) return [];
  const result = await fetchJson<{ data?: { dailySongs?: NeteaseSong[] } }>(
    baseUrl,
    '/recommend/songs',
    { cookie }
  );
  return resolveSongs(baseUrl, cookie, result.data?.dailySongs ?? []);
}

export async function importNeteasePlaylist(
  baseUrl: string,
  cookie: string,
  playlistId: number
): Promise<NeteaseImportResult> {
  const songs = await getPlaylistSongs(baseUrl, cookie, playlistId);
  const urls = await getSongUrls(baseUrl, cookie, songs.map((song) => song.id));
  const playableSongs = songs.filter((song) => {
    const url = urls.get(song.id);
    return !!url?.url && !url.freeTrialInfo;
  });

  const lyricPairs = await Promise.all(
    playableSongs.map(async (song) => [song.id, await getLyrics(baseUrl, cookie, song.id)] as const)
  );
  const lyricsBySongId = new Map(lyricPairs);

  const tracks: MusicTrack[] = playableSongs.map((song) => {
    const source = urls.get(song.id);
    return {
      id: `netease-${song.id}`,
      title: song.name,
      artist: song.ar?.map((artist) => artist.name).filter(Boolean).join(' / ') || '未知歌手',
      album: song.al?.name,
      artworkUrl: song.al?.picUrl,
      sourceUrl: normalizeNeteaseMediaUrl(source?.url),
      durationMs: source?.time ?? song.dt,
      lyrics: lyricsBySongId.get(song.id) ?? [],
      source: 'netease',
      availability: 'playable',
    };
  });

  return {
    tracks,
    playableCount: tracks.length,
    skippedCount: Math.max(0, songs.length - tracks.length),
  };
}

export async function searchNeteaseTracks(
  baseUrl: string,
  cookie: string,
  query: string,
  limit = 10
): Promise<MusicTrack[]> {
  const text = query.trim();
  if (!text) return [];
  const result = await fetchJson<{ result?: { songs?: NeteaseSearchSong[] } }>(baseUrl, '/search', {
    keywords: text,
    type: 1,
    limit,
    cookie,
  });
  const rawSongs = result.result?.songs ?? [];
  const songs: NeteaseSong[] = rawSongs.map((song) => ({
    id: song.id,
    name: song.name,
    dt: song.duration,
    ar: song.ar ?? song.artists,
    al: song.al ?? song.album,
  }));
  return resolveSongs(baseUrl, cookie, songs);
}

function getSearchSongArtists(song: NeteaseSearchSong): string {
  const artists = song.ar ?? song.artists ?? [];
  return artists.map((artist) => artist.name).filter(Boolean).join(' / ') || '未知歌手';
}

function getSearchSongAlbum(song: NeteaseSearchSong): { name?: string; picUrl?: string } | undefined {
  return song.al ?? song.album;
}

export async function searchNeteaseTrack(
  baseUrl: string,
  cookie: string,
  query: string
): Promise<MusicTrack | null> {
  const text = query.trim();
  if (!text) return null;

  const result = await fetchJson<{ result?: { songs?: NeteaseSearchSong[] } }>(baseUrl, '/search', {
    keywords: text,
    type: 1,
    limit: 5,
    cookie,
  });
  const songs = result.result?.songs ?? [];
  if (songs.length === 0) return null;

  const urls = await getSongUrls(baseUrl, cookie, songs.map((song) => song.id));
  const song = songs.find((item) => {
    const url = urls.get(item.id);
    return !!url?.url && !url.freeTrialInfo;
  });
  if (!song) return null;

  const urlData = urls.get(song.id);
  const album = getSearchSongAlbum(song);
  return {
    id: `radio-netease-${song.id}`,
    title: song.name,
    artist: getSearchSongArtists(song),
    album: album?.name,
    artworkUrl: album?.picUrl,
    sourceUrl: normalizeNeteaseMediaUrl(urlData?.url),
    durationMs: urlData?.time ?? song.duration,
    lyrics: await getLyrics(baseUrl, cookie, song.id),
    source: 'radio',
    availability: 'playable',
  };
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const pattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  for (const rawLine of lrc.split(/\r?\n/)) {
    const text = rawLine.replace(pattern, '').trim();
    if (!text) continue;

    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(rawLine))) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fraction = match[3] ?? '0';
      const millis = parseInt(fraction.padEnd(3, '0').slice(0, 3), 10);
      lines.push({
        timeMs: minutes * 60_000 + seconds * 1000 + millis,
        text,
      });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function parseYrc(yrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const linePattern = /\[(\d+),(\d+)\](.*)/;
  const wordPattern = /\((\d+),(\d+),\d+\)([^()]*)/g;

  for (const rawLine of yrc.split(/\r?\n/)) {
    const lineMatch = rawLine.match(linePattern);
    if (!lineMatch) continue;

    const timeMs = parseInt(lineMatch[1], 10);
    const durationMs = parseInt(lineMatch[2], 10);
    const content = lineMatch[3] ?? '';
    const textParts: string[] = [];
    let match: RegExpExecArray | null;

    wordPattern.lastIndex = 0;
    while ((match = wordPattern.exec(content))) {
      textParts.push(match[3]);
    }

    const text = (textParts.length > 0 ? textParts.join('') : content.replace(wordPattern, '')).trim();
    if (!text || Number.isNaN(timeMs) || Number.isNaN(durationMs)) continue;

    lines.push({
      timeMs,
      durationMs: Math.max(1, durationMs),
      text,
    });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

export async function checkUrlValid(url: string): Promise<boolean> {
  try {
    const preferredUrl = normalizeNeteaseMediaUrl(url) ?? url;
    let response = await fetch(preferredUrl, { method: 'HEAD' });
    if (!response.ok && preferredUrl !== url) {
      response = await fetch(url, { method: 'HEAD' });
    }
    return response.ok;
  } catch {
    return false;
  }
}

export async function refreshNeteaseTracks(
  baseUrl: string,
  cookie: string,
  tracks: MusicTrack[],
  indices: number[]
): Promise<MusicTrack[]> {
  const neteaseIds = indices
    .map((index) => tracks[index])
    .filter((track) => track?.source === 'netease' && track.id.startsWith('netease-'))
    .map((track) => parseInt(track.id.replace('netease-', ''), 10))
    .filter((id) => !isNaN(id));

  if (neteaseIds.length === 0) return tracks;

  const urls = await getSongUrls(baseUrl, cookie, neteaseIds);
  const updatedTracks = [...tracks];

  for (const index of indices) {
    const track = tracks[index];
    if (!track || track.source !== 'netease' || !track.id.startsWith('netease-')) continue;

    const neteaseId = parseInt(track.id.replace('netease-', ''), 10);
    if (isNaN(neteaseId)) continue;

    const urlData = urls.get(neteaseId);
    if (urlData?.url && !urlData.freeTrialInfo) {
      updatedTracks[index] = {
        ...track,
        sourceUrl: normalizeNeteaseMediaUrl(urlData.url),
        durationMs: urlData.time ?? track.durationMs,
        availability: 'playable',
      };
    } else {
      updatedTracks[index] = {
        ...track,
        sourceUrl: undefined,
        availability: urlData?.freeTrialInfo ? 'vip_required' : 'unresolved',
      };
    }
  }

  return updatedTracks;
}
