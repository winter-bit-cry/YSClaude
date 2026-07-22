import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Clock3,
  Home,
  ImagePlus,
  Library,
  ListMusic,
  MoreVertical,
  Pause,
  Play,
  Plus,
  X,
} from 'lucide-react-native';
import { fonts } from '../src/theme/fonts';
import { type NeteasePlaylistSummary } from '../src/services/neteaseMusic';
import { useMusicStore } from '../src/stores/music';
import { MusicModuleGesture } from '../src/components/MusicModuleGesture';
import { useNeteaseStore } from '../src/stores/netease';
import { copyFileFromUri } from '../src/utils/fileSystem';

const AVATAR_FRAME_MAX_BYTES = 4 * 1024 * 1024;
const BACKGROUND_MAX_BYTES = 8 * 1024 * 1024;

function imageExtension(asset: ImagePicker.ImagePickerAsset): string {
  const mime = asset.mimeType?.toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  return '.png';
}

async function savePickedImage(asset: ImagePicker.ImagePickerAsset, prefix: string): Promise<string> {
  const dir = new Directory(Paths.document, 'music-profile-assets');
  dir.create({ intermediates: true, idempotent: true });
  const destination = new File(dir, `${prefix}-${randomUUID()}${imageExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

function formatListeningTime(seconds?: number): string {
  if (seconds === undefined) return '--';
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours} 小时`;
  return `${Math.max(1, Math.floor(seconds / 60))} 分钟`;
}

export default function MusicPlaylistsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const music = useMusicStore();
  const currentTrack = music.tracks[music.currentIndex];
  const exitMusic = useCallback(() => {
    music.closePlayer().catch(() => undefined);
    router.replace('/');
  }, [music, router]);
  const store = useNeteaseStore();
  const {
    _hydrated,
    baseUrl,
    cookie,
    profile,
    qrLogin,
    playlists,
    loading,
    importingPlaylistId,
    error,
    profileBackgroundUri,
    avatarFrameUri,
    setBaseUrl,
    checkQrLogin,
    loadLoginStatus,
    loadPlaylists,
    importPlaylist,
    logout,
    setProfileBackgroundUri,
    setAvatarFrameUri,
  } = store;
  const [loginVisible, setLoginVisible] = useState(false);
  const [draftBaseUrl, setDraftBaseUrl] = useState(baseUrl);

  useEffect(() => setDraftBaseUrl(baseUrl), [baseUrl]);
  useEffect(() => {
    if (!_hydrated || !cookie) return;
    if (profile) loadPlaylists().catch(() => undefined);
    else loadLoginStatus().catch(() => undefined);
  }, [_hydrated]);

  const pickBackground = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > BACKGROUND_MAX_BYTES) {
      Alert.alert('图片过大', '背景图不能超过 8 MB');
      return;
    }
    setProfileBackgroundUri(await savePickedImage(asset, 'background'));
  }, [setProfileBackgroundUri]);

  const pickAvatarFrame = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > AVATAR_FRAME_MAX_BYTES) {
      Alert.alert('图片过大', '头像框不能超过 4 MB');
      return;
    }
    if (asset.width < 128 || asset.height < 128 || asset.width > 2048 || asset.height > 2048) {
      Alert.alert('尺寸不符合要求', '头像框需为 128–2048 px 的正方形图片');
      return;
    }
    setAvatarFrameUri(await savePickedImage(asset, 'avatar-frame'));
  }, [setAvatarFrameUri]);

  const openLogin = useCallback(() => {
    setDraftBaseUrl(baseUrl);
    setLoginVisible(true);
  }, [baseUrl]);

  const saveApiAndStartLogin = useCallback(async () => {
    const nextUrl = draftBaseUrl.trim();
    if (!nextUrl) return;
    setBaseUrl(nextUrl);
    await useNeteaseStore.getState().startQrLogin();
  }, [draftBaseUrl, setBaseUrl]);

  const renderPlaylist: ListRenderItem<NeteasePlaylistSummary> = useCallback(({ item }) => {
    const importing = importingPlaylistId === item.id;
    return (
      <Pressable
        style={styles.playlistRow}
        disabled={!!importingPlaylistId}
        onPress={() => importPlaylist(item.id).catch(() => undefined)}
      >
        {item.coverImgUrl
          ? <Image source={{ uri: item.coverImgUrl }} style={styles.playlistCover} />
          : <Image source={require('../assets/music.png')} style={styles.playlistCover} resizeMode="contain" />}
        <View style={styles.playlistText}>
          <Text style={styles.playlistTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.playlistMeta}>歌单 · {item.trackCount} 首{profile?.nickname ? ` · ${profile.nickname}` : ''}</Text>
        </View>
        {importing ? <ActivityIndicator color="#717887" /> : <MoreVertical size={21} color="#a2a8b3" />}
      </Pressable>
    );
  }, [importPlaylist, importingPlaylistId, profile?.nickname]);

  const profileHeader = (
    <>
      <ImageBackground
        source={profileBackgroundUri
          ? { uri: profileBackgroundUri }
          : profile?.backgroundUrl ? { uri: profile.backgroundUrl } : undefined}
        style={[styles.hero, { paddingTop: insets.top + 8 }]}
        imageStyle={styles.heroImage}
      >
        <View style={styles.heroShade} />
        <View style={styles.topBar}>
          <Pressable style={styles.topButton} onPress={() => router.replace('/')}>
            <ChevronLeft size={27} color="#fff" />
          </Pressable>
          <View style={styles.topActions}>
            <Pressable accessibilityLabel="更换背景图" style={styles.topButton} onPress={() => pickBackground().catch(() => undefined)}>
              <ImagePlus size={23} color="#fff" />
            </Pressable>
            <Pressable accessibilityLabel="网易云账号设置" style={styles.topButton} onPress={openLogin}>
              <Plus size={29} color="#fff" />
            </Pressable>
          </View>
        </View>

        <View style={styles.profileArea}>
          <Pressable style={styles.avatarWrap} onPress={() => pickAvatarFrame().catch(() => undefined)}>
            {profile?.avatarUrl
              ? <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
              : <Image source={require('../assets/music.png')} style={styles.avatar} resizeMode="contain" />}
            {!!avatarFrameUri && <View pointerEvents="none" style={styles.avatarFrame}><Image source={{ uri: avatarFrameUri }} style={styles.avatarFrameImage} resizeMode="contain" /></View>}
          </Pressable>
          <Text style={styles.nickname}>{profile?.nickname || '未登录网易云音乐'}</Text>
          <Text style={styles.signature} numberOfLines={2}>
            {profile?.signature || (profile ? '这个人很懒，还没有留下签名' : '点击右上角 ＋ 填写 API 并登录账号')}
          </Text>
          <View style={styles.stats}>
            <Stat value={profile?.follows ?? '--'} label="关注" />
            <Stat value={profile?.followeds ?? '--'} label="粉丝" />
            <Stat value={profile?.level !== undefined ? `Lv.${profile.level}` : '--'} label="等级" />
            <Stat value={formatListeningTime(profile?.listenTimeSeconds)} label="听歌时长" />
          </View>
          <View style={styles.quickActions}>
            <View style={styles.quickItem}><Clock3 size={18} color="#eef2f6" /><Text style={styles.quickText}>{profile?.listenSongs ?? '--'} 首听歌</Text></View>
            <View style={styles.quickItem}><Library size={18} color="#eef2f6" /><Text style={styles.quickText}>{playlists.length} 个歌单</Text></View>
            <View style={styles.quickItem}><Text style={styles.quickText}>入驻 {profile?.createDays ?? '--'} 天</Text></View>
          </View>
        </View>
      </ImageBackground>

      <View style={styles.sheetHeader}>
        <View style={styles.tabs}>
          <Text style={[styles.tab, styles.tabActive]}>音乐</Text>
          <Text style={styles.tab}>播客</Text>
          <Text style={styles.tab}>笔记</Text>
          <Text style={styles.tab}>评论</Text>
        </View>
        <View style={styles.subHeader}>
          <Text style={styles.subTitle}>歌单 <Text style={styles.subCount}>{playlists.length}</Text></Text>
          {!!profile && <Pressable onPress={() => loadPlaylists().catch(() => undefined)}><Text style={styles.refreshText}>刷新</Text></Pressable>}
        </View>
      </View>
    </>
  );

  return (
    <MusicModuleGesture onExit={exitMusic}>
    <View style={styles.page}>
      <FlatList
        data={playlists}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderPlaylist}
        ListHeaderComponent={profileHeader}
        ListEmptyComponent={<Text style={styles.emptyText}>{profile ? '暂无歌单' : '登录后显示账号下的歌单'}</Text>}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 10) + (currentTrack ? 142 : 76) }}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.fixedBottom, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {!!currentTrack && (
          <Pressable style={styles.miniPlayer} onPress={() => router.push({ pathname: '/music-player', params: { from: 'mine' } })}>
            {currentTrack.artworkUrl
              ? <Image source={{ uri: currentTrack.artworkUrl }} style={styles.miniCover} />
              : <Image source={require('../assets/music.png')} style={styles.miniCover} />}
            <View style={styles.miniText}><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniArtist} numberOfLines={1}>{currentTrack.artist}</Text></View>
            <Pressable style={styles.miniAction} onPress={(event) => { event.stopPropagation(); music.togglePlayPause().catch(() => undefined); }}>
              {music.isPlaying ? <Pause size={19} color="#171b25" fill="#171b25" /> : <Play size={19} color="#171b25" fill="#171b25" />}
            </Pressable>
            <ListMusic size={22} color="#171b25" />
          </Pressable>
        )}
        <View style={styles.navBar}>
          <Pressable style={styles.navItem} onPress={() => router.replace('/music')}><Home size={22} color="#9299a5" /><Text style={styles.navText}>首页</Text></Pressable>
          <View style={styles.navItem}><Library size={22} color="#121622" fill="#121622" /><Text style={[styles.navText, styles.navActive]}>我的</Text></View>
        </View>
      </View>

      <Modal visible={loginVisible} transparent animationType="fade" onRequestClose={() => setLoginVisible(false)}>
        <Pressable style={styles.modalShade} onPress={() => setLoginVisible(false)}>
          <Pressable style={[styles.loginSheet, { paddingBottom: Math.max(insets.bottom, 18) }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.loginHeader}><Text style={styles.loginTitle}>网易云账号</Text><Pressable onPress={() => setLoginVisible(false)}><X size={24} color="#252a35" /></Pressable></View>
            <Text style={styles.inputLabel}>网易云 API 地址</Text>
            <TextInput value={draftBaseUrl} onChangeText={setDraftBaseUrl} style={styles.apiInput} placeholder="例如 http://192.168.1.10:3000" autoCapitalize="none" autoCorrect={false} />
            {profile ? (
              <View style={styles.loggedRow}>
                {profile.avatarUrl && <Image source={{ uri: profile.avatarUrl }} style={styles.loggedAvatar} />}
                <View style={styles.loggedText}><Text style={styles.loggedName}>{profile.nickname}</Text><Text style={styles.loggedHint}>账号已登录</Text></View>
                <Pressable style={styles.secondaryButton} onPress={logout}><Text style={styles.secondaryText}>退出登录</Text></Pressable>
              </View>
            ) : (
              <>
                <Pressable disabled={loading || !draftBaseUrl.trim()} style={[styles.primaryButton, (loading || !draftBaseUrl.trim()) && styles.disabled]} onPress={() => saveApiAndStartLogin().catch(() => undefined)}>
                  <Text style={styles.primaryText}>获取登录二维码</Text>
                </Pressable>
                {!!qrLogin && <View style={styles.qrArea}><Image source={{ uri: qrLogin.qrimg }} style={styles.qrImage} /><Text style={styles.qrHint}>使用网易云音乐扫码并确认</Text><Pressable disabled={loading} style={styles.secondaryButton} onPress={() => checkQrLogin().catch(() => undefined)}><Text style={styles.secondaryText}>我已确认登录</Text></Pressable></View>}
              </>
            )}
            {loading && <ActivityIndicator style={styles.loginLoading} color="#e34a58" />}
            {!!error && <Text style={styles.errorText}>{error}</Text>}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
    </MusicModuleGesture>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f7fa' },
  hero: { minHeight: 455, backgroundColor: '#7893ad' },
  heroImage: { opacity: .95 },
  heroShade: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(30,48,68,.32)' },
  topBar: { height: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topActions: { flexDirection: 'row', gap: 4 },
  topButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  profileArea: { alignItems: 'center', paddingTop: 8, paddingHorizontal: 20 },
  avatarWrap: { width: 126, height: 126, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 102, height: 102, borderRadius: 51, backgroundColor: '#e7ebef' },
  avatarFrame: { position: 'absolute', width: 126, height: 126 },
  avatarFrameImage: { width: '100%', height: '100%' },
  nickname: { marginTop: 10, color: '#fff', fontFamily: fonts.bold, fontSize: 25 },
  signature: { minHeight: 39, marginTop: 9, color: 'rgba(255,255,255,.82)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  stats: { marginTop: 13, flexDirection: 'row', alignItems: 'flex-start' },
  stat: { minWidth: 76, alignItems: 'center' },
  statValue: { color: '#fff', fontFamily: fonts.bold, fontSize: 17 },
  statLabel: { marginTop: 3, color: 'rgba(255,255,255,.72)', fontSize: 11 },
  quickActions: { width: '100%', marginTop: 18, flexDirection: 'row', gap: 9 },
  quickItem: { flex: 1, height: 48, borderRadius: 10, backgroundColor: 'rgba(255,255,255,.13)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  quickText: { color: '#eef2f6', fontSize: 12 },
  sheetHeader: { marginTop: -12, paddingTop: 5, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#f5f7fa' },
  tabs: { height: 65, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e8ec' },
  tab: { height: 65, paddingTop: 21, color: '#8a909b', fontFamily: fonts.bold, fontSize: 18 },
  tabActive: { color: '#131824', borderBottomWidth: 3, borderBottomColor: '#131824' },
  subHeader: { height: 58, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subTitle: { color: '#202532', fontFamily: fonts.bold, fontSize: 18 },
  subCount: { color: '#9ba1ac', fontFamily: fonts.regular, fontSize: 12 },
  refreshText: { color: '#858c98', fontSize: 13 },
  playlistRow: { minHeight: 78, marginHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 13 },
  playlistCover: { width: 58, height: 58, borderRadius: 8, backgroundColor: '#e1e5ea' },
  playlistText: { flex: 1 },
  playlistTitle: { color: '#171c28', fontFamily: fonts.bold, fontSize: 16 },
  playlistMeta: { marginTop: 6, color: '#9298a3', fontSize: 12 },
  emptyText: { paddingVertical: 60, textAlign: 'center', color: '#9aa0aa', fontSize: 14 },
  fixedBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(245,247,250,.97)' },
  miniPlayer: { height: 62, marginHorizontal: 16, marginBottom: 3, paddingHorizontal: 10, borderRadius: 31, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 8 },
  miniCover: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e4e7eb' },
  miniText: { flex: 1 }, miniTitle: { color: '#171b25', fontFamily: fonts.bold, fontSize: 14 }, miniArtist: { marginTop: 2, color: '#969ba5', fontSize: 12 },
  miniAction: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: '#d8dce2', alignItems: 'center', justifyContent: 'center' },
  navBar: { height: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  navItem: { width: 110, alignItems: 'center', gap: 4 }, navText: { color: '#9399a4', fontSize: 13 }, navActive: { color: '#121622', fontFamily: fonts.bold },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.46)' },
  loginSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, backgroundColor: '#fff' },
  loginHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  loginTitle: { color: '#202530', fontFamily: fonts.bold, fontSize: 20 },
  inputLabel: { marginTop: 20, marginBottom: 8, color: '#646b77', fontSize: 13 },
  apiInput: { height: 46, borderRadius: 12, paddingHorizontal: 13, backgroundColor: '#f0f2f5', color: '#1d222d', fontSize: 14 },
  primaryButton: { height: 46, marginTop: 14, borderRadius: 23, backgroundColor: '#e34a58', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 }, disabled: { opacity: .45 },
  qrArea: { alignItems: 'center', marginTop: 16 }, qrImage: { width: 180, height: 180 }, qrHint: { marginVertical: 8, color: '#818894', fontSize: 12 },
  secondaryButton: { minHeight: 38, borderRadius: 19, paddingHorizontal: 16, borderWidth: 1, borderColor: '#d9dde3', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#555c68', fontSize: 13 },
  loggedRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }, loggedAvatar: { width: 44, height: 44, borderRadius: 22 }, loggedText: { flex: 1 }, loggedName: { color: '#202530', fontFamily: fonts.bold, fontSize: 15 }, loggedHint: { marginTop: 3, color: '#8d939e', fontSize: 12 },
  loginLoading: { marginTop: 12 }, errorText: { marginTop: 12, color: '#c43e4c', fontSize: 12, textAlign: 'center' },
});
