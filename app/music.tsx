import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Home, Library, ListMusic, Pause, Play, RefreshCw, Search, X } from 'lucide-react-native';
import { fonts } from '../src/theme/fonts';
import {
  getDailyRecommendedPlaylists,
  getDailyRecommendedSongs,
  getPublicRecommendedPlaylists,
  getRefreshedRecommendedPlaylists,
  importNeteasePlaylist,
  searchNeteaseTracks,
  type NeteaseRecommendedPlaylist,
} from '../src/services/neteaseMusic';
import { type MusicTrack, useMusicStore } from '../src/stores/music';
import { useNeteaseStore } from '../src/stores/netease';

const PAGE_BACKGROUND = '#f5f7fa';

function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mergeUniquePlaylists(
  ...groups: NeteaseRecommendedPlaylist[][]
): NeteaseRecommendedPlaylist[] {
  const playlists = new Map<number, NeteaseRecommendedPlaylist>();
  groups.flat().forEach((playlist) => playlists.set(playlist.id, playlist));
  return [...playlists.values()];
}

function pickNextPersonalPlaylists(
  candidates: NeteaseRecommendedPlaylist[],
  previous: NeteaseRecommendedPlaylist[],
  excludedIds: Set<number>,
  limit = 12
): NeteaseRecommendedPlaylist[] {
  const available = candidates.filter((item) => !excludedIds.has(item.id));
  const previousIds = new Set(previous.map((item) => item.id));
  const unseen = available.filter((item) => !previousIds.has(item.id));
  const repeated = available.filter((item) => previousIds.has(item.id));
  return [...unseen, ...repeated].slice(0, limit);
}

export default function MusicHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { _hydrated, baseUrl, cookie, profile, homeCache, loadLoginStatus, setHomeCache } = useNeteaseStore();
  const music = useMusicStore();
  const [publicPlaylists, setPublicPlaylists] = useState<NeteaseRecommendedPlaylist[]>([]);
  const [personalPlaylists, setPersonalPlaylists] = useState<NeteaseRecommendedPlaylist[]>([]);
  const [recommendedSongs, setRecommendedSongs] = useState<MusicTrack[]>([]);
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [openingPlaylistId, setOpeningPlaylistId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentTrack = music.tracks[music.currentIndex];

  const loadHome = useCallback(async (forceRefresh = false) => {
    const normalizedBaseUrl = baseUrl.trim();
    if (!normalizedBaseUrl) return;
    const date = getLocalDateKey();
    const sourceKey = `${normalizedBaseUrl}\n${cookie}`;
    if (!forceRefresh && homeCache?.date === date && homeCache.sourceKey === sourceKey) {
      setPublicPlaylists(homeCache.publicPlaylists);
      setPersonalPlaylists(homeCache.personalPlaylists);
      setRecommendedSongs(homeCache.recommendedSongs);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [publicItems, personalSources, songs] = await Promise.all([
        getPublicRecommendedPlaylists(baseUrl, 12),
        cookie
          ? Promise.all([
            getDailyRecommendedPlaylists(baseUrl, cookie).catch(() => []),
            getRefreshedRecommendedPlaylists(baseUrl, cookie, 60).catch(() => []),
          ])
          : Promise.resolve([[], []] as NeteaseRecommendedPlaylist[][]),
        cookie ? getDailyRecommendedSongs(baseUrl, cookie) : Promise.resolve([]),
      ]);
      const publicIds = new Set(publicItems.map((item) => item.id));
      const previousPersonalItems = homeCache?.sourceKey === sourceKey
        ? homeCache.personalPlaylists
        : [];
      const personalCandidates = mergeUniquePlaylists(...personalSources);
      const personalItems = pickNextPersonalPlaylists(
        personalCandidates,
        previousPersonalItems,
        publicIds
      );
      setPublicPlaylists(publicItems);
      setPersonalPlaylists(personalItems);
      setRecommendedSongs(songs);
      setHomeCache({
        date,
        sourceKey,
        publicPlaylists: publicItems,
        personalPlaylists: personalItems,
        recommendedSongs: songs,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '音乐首页加载失败');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, cookie, homeCache, setHomeCache]);

  useEffect(() => {
    if (cookie && !profile) loadLoginStatus().catch(() => undefined);
  }, [cookie, loadLoginStatus, profile]);

  useFocusEffect(useCallback(() => {
    if (_hydrated) loadHome().catch(() => undefined);
  }, [_hydrated, loadHome]));

  const openTracks = useCallback(async (tracks: MusicTrack[], index: number) => {
    if (!tracks[index]) return;
    music.replaceTracks(tracks);
    await useMusicStore.getState().playTrackAt(index);
    router.push({ pathname: '/music-player', params: { from: 'home' } });
  }, [music, router]);

  const openPlaylist = useCallback(async (playlistId: number) => {
    setOpeningPlaylistId(playlistId);
    setError(null);
    try {
      const result = await importNeteasePlaylist(baseUrl, cookie, playlistId);
      if (!result.tracks.length) throw new Error('这个歌单暂时没有可播放歌曲');
      await openTracks(result.tracks, 0);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : '歌单加载失败');
    } finally {
      setOpeningPlaylistId(null);
    }
  }, [baseUrl, cookie, openTracks]);

  const submitSearch = useCallback(async () => {
    const text = query.trim();
    if (!text || !baseUrl.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setSearchResults(await searchNeteaseTracks(baseUrl, cookie, text, 12));
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : '搜索失败');
    } finally {
      setSearching(false);
    }
  }, [baseUrl, cookie, query]);

  const closeMusic = useCallback(() => {
    music.closePlayer().catch(() => undefined);
    router.replace('/');
  }, [music, router]);

  const showSearch = searching || searchResults.length > 0 || !!query.trim();

  return (
    <View style={[styles.page, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.replace('/')}>
          <ChevronLeft size={27} color="#121622" strokeWidth={2.2} />
        </Pressable>
        <View style={styles.searchBox}>
          <Search size={18} color="#8c929e" />
          <TextInput
            value={query}
            onChangeText={(value) => { setQuery(value); if (!value.trim()) setSearchResults([]); }}
            onSubmitEditing={() => submitSearch().catch(() => undefined)}
            placeholder="搜索歌曲"
            placeholderTextColor="#969ca7"
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searching && <ActivityIndicator size="small" color="#e34a58" />}
        </View>
        <Pressable
          accessibilityLabel="刷新首页内容"
          disabled={loading || !baseUrl.trim()}
          style={[styles.headerButton, (loading || !baseUrl.trim()) && styles.headerButtonDisabled]}
          onPress={() => loadHome(true).catch(() => undefined)}
        >
          {loading
            ? <ActivityIndicator size="small" color="#121622" />
            : <RefreshCw size={22} color="#121622" strokeWidth={2.1} />}
        </Pressable>
        <Pressable style={styles.headerButton} onPress={closeMusic}>
          <X size={25} color="#121622" strokeWidth={2.1} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 12) + 142 }]}
      >
        {!baseUrl.trim() ? (
          <Pressable style={styles.setupCard} onPress={() => router.push('/music-playlists')}>
            <Text style={styles.setupTitle}>先连接网易云音乐</Text>
            <Text style={styles.setupText}>前往“我的”填写 API 地址，首页即可加载推荐内容。</Text>
          </Pressable>
        ) : showSearch ? (
          <Section title={`搜索结果${searchResults.length ? ` · ${searchResults.length}` : ''}`}>
            {!searching && searchResults.length === 0 && <EmptyText text="输入歌名或歌手后搜索" />}
            {searchResults.map((track, index) => (
              <SongRow key={track.id} track={track} onPress={() => openTracks(searchResults, index).catch(() => undefined)} />
            ))}
          </Section>
        ) : (
          <>
            <Section title="公共推荐" subtitle="发现大家都在听的好歌单">
              <PlaylistRail items={publicPlaylists} busyId={openingPlaylistId} onPress={openPlaylist} />
            </Section>

            <Section title="个人推荐" subtitle={cookie ? '根据你的网易云音乐偏好更新' : '登录后解锁每日个性推荐'}>
              {cookie ? (
                <PlaylistRail items={personalPlaylists} busyId={openingPlaylistId} onPress={openPlaylist} />
              ) : (
                <Pressable style={styles.loginCard} onPress={() => router.push('/music-playlists')}>
                  <View>
                    <Text style={styles.loginTitle}>登录网易云音乐</Text>
                    <Text style={styles.loginText}>同步歌单和专属每日推荐</Text>
                  </View>
                  <Text style={styles.loginArrow}>›</Text>
                </Pressable>
              )}
            </Section>

            <Section title="单曲推荐" subtitle="为你精选的今日歌曲">
              {cookie ? recommendedSongs.slice(0, 12).map((track, index) => (
                <SongRow key={track.id} track={track} onPress={() => openTracks(recommendedSongs, index).catch(() => undefined)} />
              )) : <EmptyText text="登录后显示每日推荐歌曲" />}
            </Section>
          </>
        )}
        {loading && <ActivityIndicator style={styles.pageLoader} color="#e34a58" />}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={[styles.fixedBottom, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {!!currentTrack && (
          <Pressable style={styles.miniPlayer} onPress={() => router.push({ pathname: '/music-player', params: { from: 'home' } })}>
            {currentTrack.artworkUrl
              ? <Image source={{ uri: currentTrack.artworkUrl }} style={styles.miniCover} />
              : <Image source={require('../assets/music.png')} style={styles.miniCover} />}
            <View style={styles.miniText}>
              <Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text>
              <Text style={styles.miniArtist} numberOfLines={1}>{currentTrack.artist}</Text>
            </View>
            <Pressable style={styles.miniAction} onPress={(event) => { event.stopPropagation(); music.togglePlayPause().catch(() => undefined); }}>
              {music.isBuffering ? <ActivityIndicator size="small" color="#171b25" /> : music.isPlaying
                ? <Pause size={20} color="#171b25" fill="#171b25" />
                : <Play size={20} color="#171b25" fill="#171b25" />}
            </Pressable>
            <ListMusic size={23} color="#171b25" />
          </Pressable>
        )}
        <View style={styles.navBar}>
          <Pressable style={styles.navItem}>
            <Home size={22} color="#121622" fill="#121622" />
            <Text style={[styles.navText, styles.navTextActive]}>首页</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => router.push('/music-playlists')}>
            <Library size={22} color="#8b919c" />
            <Text style={styles.navText}>我的</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {!!subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    {children}
  </View>;
}

function PlaylistRail({
  items,
  busyId,
  onPress,
}: {
  items: NeteaseRecommendedPlaylist[];
  busyId: number | null;
  onPress: (id: number) => Promise<void>;
}) {
  if (!items.length) return <EmptyText text="暂无推荐内容" />;
  return <FlatList
    horizontal
    data={items}
    keyExtractor={(item) => String(item.id)}
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.rail}
    renderItem={({ item }) => (
      <Pressable style={styles.playlistCard} onPress={() => onPress(item.id).catch(() => undefined)}>
        <View style={styles.coverWrap}>
          {item.coverImgUrl
            ? <Image source={{ uri: item.coverImgUrl }} style={styles.playlistCover} />
            : <Image source={require('../assets/music.png')} style={styles.playlistCover} />}
          <View style={styles.coverShade} />
          {busyId === item.id
            ? <ActivityIndicator style={styles.coverPlay} color="#fff" />
            : <Play style={styles.coverPlay} size={25} color="#fff" fill="#fff" />}
        </View>
        <Text style={styles.playlistName} numberOfLines={2}>{item.name}</Text>
      </Pressable>
    )}
  />;
}

function SongRow({ track, onPress }: { track: MusicTrack; onPress: () => void }) {
  return <Pressable style={styles.songRow} onPress={onPress}>
    {track.artworkUrl
      ? <Image source={{ uri: track.artworkUrl }} style={styles.songCover} />
      : <Image source={require('../assets/music.png')} style={styles.songCover} />}
    <View style={styles.songText}>
      <Text style={styles.songTitle} numberOfLines={1}>{track.title}</Text>
      <Text style={styles.songMeta} numberOfLines={1}>{track.artist}{track.album ? ` · ${track.album}` : ''}</Text>
    </View>
    <Play size={21} color="#676e7b" fill="#676e7b" />
  </Pressable>;
}

function EmptyText({ text }: { text: string }) {
  return <Text style={styles.emptyText}>{text}</Text>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAGE_BACKGROUND },
  header: { height: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerButtonDisabled: { opacity: .45 },
  searchBox: { flex: 1, height: 42, borderRadius: 22, paddingHorizontal: 14, backgroundColor: '#e9edf2', flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 0, color: '#141822', fontFamily: fonts.regular, fontSize: 15 },
  content: { paddingTop: 8 },
  section: { marginBottom: 30 },
  sectionTitle: { marginHorizontal: 20, color: '#111522', fontFamily: fonts.bold, fontSize: 23 },
  sectionSubtitle: { marginHorizontal: 20, marginTop: 4, marginBottom: 14, color: '#8a909c', fontFamily: fonts.regular, fontSize: 13 },
  rail: { paddingHorizontal: 20, gap: 14 },
  playlistCard: { width: 148 },
  coverWrap: { width: 148, height: 148, borderRadius: 13, overflow: 'hidden', backgroundColor: '#dfe3e8' },
  playlistCover: { width: '100%', height: '100%' },
  coverShade: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(9,13,21,.08)' },
  coverPlay: { position: 'absolute', right: 12, bottom: 11 },
  playlistName: { marginTop: 9, color: '#242936', fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  songRow: { minHeight: 66, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  songCover: { width: 50, height: 50, borderRadius: 8, backgroundColor: '#e0e4e9' },
  songText: { flex: 1 },
  songTitle: { color: '#171b26', fontFamily: fonts.bold, fontSize: 16 },
  songMeta: { marginTop: 5, color: '#9196a0', fontFamily: fonts.regular, fontSize: 13 },
  emptyText: { marginHorizontal: 20, paddingVertical: 22, color: '#999faa', fontFamily: fonts.regular, fontSize: 14 },
  loginCard: { marginHorizontal: 20, padding: 18, borderRadius: 16, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  loginTitle: { color: '#171b26', fontFamily: fonts.bold, fontSize: 17 },
  loginText: { marginTop: 5, color: '#9196a0', fontFamily: fonts.regular, fontSize: 13 },
  loginArrow: { color: '#666d79', fontSize: 30 },
  setupCard: { margin: 20, padding: 22, borderRadius: 18, backgroundColor: '#171c29' },
  setupTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 19 },
  setupText: { marginTop: 8, color: '#bfc5cf', fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  pageLoader: { marginVertical: 18 },
  error: { marginHorizontal: 20, marginBottom: 22, padding: 12, borderRadius: 10, color: '#bd3444', backgroundColor: '#ffe9ec', fontFamily: fonts.regular, fontSize: 13 },
  fixedBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(245,247,250,.97)' },
  miniPlayer: { height: 62, marginHorizontal: 16, marginBottom: 3, paddingHorizontal: 10, borderRadius: 31, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#151922', shadowOffset: { width: 0, height: 3 }, shadowOpacity: .1, shadowRadius: 14, elevation: 8 },
  miniCover: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e4e7eb' },
  miniText: { flex: 1 },
  miniTitle: { color: '#171b25', fontFamily: fonts.bold, fontSize: 14 },
  miniArtist: { marginTop: 2, color: '#969ba5', fontFamily: fonts.regular, fontSize: 12 },
  miniAction: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: '#d8dce2', alignItems: 'center', justifyContent: 'center' },
  navBar: { height: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  navItem: { width: 110, alignItems: 'center', gap: 4 },
  navText: { color: '#9399a4', fontFamily: fonts.regular, fontSize: 13 },
  navTextActive: { color: '#121622', fontFamily: fonts.bold },
});
