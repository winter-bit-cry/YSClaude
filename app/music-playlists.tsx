import { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import { NeteasePlaylistSummary } from '../src/services/neteaseMusic';
import { useNeteaseStore } from '../src/stores/netease';

let colors = lightColors;

export default function MusicPlaylistsScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const {
    _hydrated,
    baseUrl,
    cookie,
    profile,
    qrLogin,
    playlists,
    loading,
    importingPlaylistId,
    lastImportSummary,
    error,
    setBaseUrl,
    startQrLogin,
    checkQrLogin,
    loadLoginStatus,
    loadPlaylists,
    importPlaylist,
    logout,
  } = useNeteaseStore();

  useEffect(() => {
    if (_hydrated && cookie && profile) {
      loadPlaylists().catch(() => undefined);
    } else if (_hydrated && cookie) {
      loadLoginStatus().catch(() => undefined);
    }
  }, [_hydrated]);

  const renderPlaylist: ListRenderItem<NeteasePlaylistSummary> = useCallback(({ item }) => {
    const importing = importingPlaylistId === item.id;
    return (
      <View style={styles.playlistRow}>
        <View style={styles.playlistCover}>
          {item.coverImgUrl ? (
            <Image source={{ uri: item.coverImgUrl }} style={styles.playlistCoverImage} resizeMode="cover" />
          ) : (
            <Image source={require('../assets/music.png')} style={styles.playlistCoverIcon} resizeMode="contain" />
          )}
        </View>
        <View style={styles.playlistBody}>
          <Text style={styles.playlistTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.playlistMeta}>{item.trackCount} 首</Text>
        </View>
        <Pressable
          style={[styles.importButton, importing && styles.importButtonDisabled]}
          onPress={() => importPlaylist(item.id).catch(() => undefined)}
          disabled={!!importingPlaylistId}
        >
          {importing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.importButtonText}>导入</Text>
          )}
        </Pressable>
      </View>
    );
  }, [importPlaylist, importingPlaylistId]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>‹</Text>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>歌单管理</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            网易云登录与可播放歌曲导入
          </Text>
        </View>
        <Pressable style={styles.iconButton} onPress={() => router.replace('/music')}>
          <Image source={require('../assets/music.png')} style={styles.headerMusicIcon} resizeMode="contain" />
        </Pressable>
      </View>

      <View style={styles.connectionPanel}>
        <Text style={styles.sectionTitle}>网易云 API</Text>
        <TextInput
          style={styles.apiInput}
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="例如 http://192.168.1.10:3000"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {profile ? (
          <View style={styles.profileRow}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} resizeMode="cover" />
            ) : (
              <View style={styles.avatarFallback} />
            )}
            <View style={styles.profileBody}>
              <Text style={styles.profileName} numberOfLines={1}>{profile.nickname}</Text>
              <Text style={styles.profileMeta}>已登录</Text>
            </View>
            <Pressable style={styles.ghostButton} onPress={logout}>
              <Text style={styles.ghostButtonText}>退出</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.loginActions}>
            <Pressable
              style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
              onPress={() => startQrLogin().catch(() => undefined)}
              disabled={loading || !baseUrl.trim()}
            >
              <Text style={styles.primaryButtonText}>获取二维码</Text>
            </Pressable>
            <Pressable
              style={[styles.ghostButton, (!qrLogin || loading) && styles.ghostButtonDisabled]}
              onPress={() => checkQrLogin().catch(() => undefined)}
              disabled={!qrLogin || loading}
            >
              <Text style={styles.ghostButtonText}>确认登录</Text>
            </Pressable>
          </View>
        )}

        {qrLogin && !profile && (
          <View style={styles.qrWrap}>
            <Image source={{ uri: qrLogin.qrimg }} style={styles.qrImage} resizeMode="contain" />
            <Text style={styles.qrText}>用网易云音乐扫码后点确认登录</Text>
          </View>
        )}

        {loading && (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.statusText}>正在连接网易云...</Text>
          </View>
        )}
        {lastImportSummary && <Text style={styles.successText}>{lastImportSummary}</Text>}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>我的歌单</Text>
        <Pressable
          style={[styles.refreshButton, (!profile || loading) && styles.refreshButtonDisabled]}
          onPress={() => loadPlaylists().catch(() => undefined)}
          disabled={!profile || loading}
        >
          <Text style={styles.refreshButtonText}>刷新</Text>
        </Pressable>
      </View>

      <FlatList
        data={playlists}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderPlaylist}
        contentContainerStyle={styles.playlistContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Image source={require('../assets/music.png')} style={styles.emptyIcon} resizeMode="contain" />
            <Text style={styles.emptyText}>
              {profile ? '暂无歌单，或还没有刷新成功' : '登录后会显示网易云歌单'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 18,
  },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  headerIcon: {
    fontSize: 28,
    lineHeight: 30,
    color: colors.text,
  },
  headerMusicIcon: {
    width: 22,
    height: 22,
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textTertiary,
  },
  connectionPanel: {
    marginTop: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  apiInput: {
    marginTop: 10,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 14,
  },
  loginActions: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryButton: {
    minHeight: 40,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: '#FFFFFF',
  },
  ghostButton: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  ghostButtonDisabled: {
    opacity: 0.5,
  },
  ghostButtonText: {
    fontSize: 13,
    color: colors.text,
  },
  qrWrap: {
    alignItems: 'center',
    marginTop: 14,
  },
  qrImage: {
    width: 190,
    height: 190,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  qrText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textTertiary,
  },
  profileRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 8,
  },
  avatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  profileBody: {
    flex: 1,
  },
  profileName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  profileMeta: {
    marginTop: 3,
    fontSize: 12,
    color: colors.textTertiary,
  },
  statusRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  successText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: colors.success,
  },
  errorText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: colors.danger,
  },
  listHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshButton: {
    minHeight: 34,
    borderRadius: 8,
    paddingHorizontal: 13,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  refreshButtonDisabled: {
    opacity: 0.5,
  },
  refreshButtonText: {
    fontSize: 13,
    color: colors.text,
  },
  playlistContent: {
    paddingBottom: 34,
  },
  playlistRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  playlistCover: {
    width: 50,
    height: 50,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playlistCoverImage: {
    width: '100%',
    height: '100%',
  },
  playlistCoverIcon: {
    width: 24,
    height: 24,
    opacity: 0.76,
  },
  playlistBody: {
    flex: 1,
  },
  playlistTitle: {
    fontSize: 15,
    color: colors.text,
  },
  playlistMeta: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textTertiary,
  },
  importButton: {
    width: 58,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  importButtonDisabled: {
    opacity: 0.72,
  },
  importButtonText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: '#FFFFFF',
  },
  emptyState: {
    minHeight: 240,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIcon: {
    width: 44,
    height: 44,
    opacity: 0.54,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.textTertiary,
  },
});

let styles = createStyles(colors);
