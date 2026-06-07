import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import { LyricLine, MusicTrack, PlayOrder, useMusicStore } from '../src/stores/music';
import { useRadioStore } from '../src/stores/radio';
import {
  canDrawFloatingBall,
  openFloatingBallPermissionSettings,
} from '../src/services/floatingBall';
import { refreshDesktopLyric } from '../src/services/desktopLyrics';

let colors = lightColors;

const ORDER_LABELS: Record<PlayOrder, string> = {
  list: '列表循环',
  'repeat-one': '单曲循环',
  shuffle: '随机播放',
};

const ORDER_SEQUENCE: PlayOrder[] = ['list', 'repeat-one', 'shuffle'];

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function trackSourceLabel(track: MusicTrack): string {
  if (track.source === 'radio') return 'AI 电台';
  if (track.source === 'netease') return '网易云歌单';
  if (track.source === 'local') return '本地音乐';
  return '示例歌单';
}

export default function MusicScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const lyricListRef = useRef<FlatList<LyricLine>>(null);
  const [progressWidth, setProgressWidth] = useState(1);
  const [queueVisible, setQueueVisible] = useState(false);
  const {
    phase: radioPhase,
    loading: radioLoading,
    active: radioActive,
    ending: radioEnding,
    title: radioTitle,
    status: radioStatus,
    start: startRadio,
    continueProgram: continueRadio,
    end: endRadio,
  } = useRadioStore();

  const {
    tracks,
    currentIndex,
    order,
    isPlaying,
    isBuffering,
    desktopLyricsEnabled,
    desktopLyricBackgroundUri,
    currentTimeMs,
    durationMs,
    currentLyricIndex,
    error,
    openPlayer,
    minimizePlayer,
    closePlayer,
    togglePlayPause,
    previous,
    playTrackAt,
    next,
    seekTo,
    setOrder,
    setDesktopLyricsEnabled,
    setDesktopLyricBackgroundUri,
  } = useMusicStore();

  const track = tracks[currentIndex];
  const progress = durationMs > 0 ? Math.min(1, currentTimeMs / durationMs) : 0;
  const lyricBlurTint = colors === lightColors ? 'systemThickMaterialLight' : 'systemThickMaterialDark';
  const radioButtonLabel = radioPhase === 'call_in_waiting' ? '继续' : radioActive ? '结束' : '开台';
  const handleRadioButtonPress =
    radioPhase === 'call_in_waiting' ? continueRadio : radioActive ? endRadio : startRadio;

  useEffect(() => {
    openPlayer();
  }, [openPlayer]);

  useEffect(() => {
    if (currentLyricIndex < 0) return;
    lyricListRef.current?.scrollToIndex({
      index: currentLyricIndex,
      animated: true,
      viewPosition: 0.45,
    });
  }, [currentLyricIndex]);

  const handleProgressLayout = useCallback((event: LayoutChangeEvent) => {
    setProgressWidth(Math.max(1, event.nativeEvent.layout.width));
  }, []);

  const handleProgressPress = useCallback((event: any) => {
    const x = event.nativeEvent.locationX;
    const ratio = Math.max(0, Math.min(1, x / progressWidth));
    seekTo(ratio * durationMs).catch(() => undefined);
  }, [durationMs, progressWidth, seekTo]);

  const cycleOrder = useCallback(() => {
    const current = ORDER_SEQUENCE.indexOf(order);
    setOrder(ORDER_SEQUENCE[(current + 1) % ORDER_SEQUENCE.length]);
  }, [order, setOrder]);

  const handleMinimize = useCallback(() => {
    minimizePlayer();
    router.replace('/');
  }, [minimizePlayer, router]);

  const handleClose = useCallback(() => {
    closePlayer().finally(() => router.replace('/'));
  }, [closePlayer, router]);

  const pickDesktopLyricBackground = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    setDesktopLyricBackgroundUri(result.assets[0].uri);
  }, [setDesktopLyricBackgroundUri]);

  const clearDesktopLyricBackground = useCallback(() => {
    setDesktopLyricBackgroundUri('');
  }, [setDesktopLyricBackgroundUri]);

  const handleDesktopLyricToggle = useCallback(async () => {
    const nextEnabled = !desktopLyricsEnabled;
    setDesktopLyricsEnabled(nextEnabled);
    if (!nextEnabled) return;

    try {
      const canDraw = await canDrawFloatingBall();
      if (!canDraw) {
        Alert.alert(
          '需要悬浮窗权限',
          '请允许 YSClaude 显示在其他应用上层，返回后会自动重试显示桌面歌词。'
        );
        await openFloatingBallPermissionSettings();
        return;
      }
      refreshDesktopLyric();
    } catch (error) {
      console.warn('[Music] desktop lyric permission check failed', error);
      refreshDesktopLyric();
    }
  }, [desktopLyricsEnabled, setDesktopLyricsEnabled]);

  const renderLyric: ListRenderItem<LyricLine> = useCallback(({ item, index }) => {
    const active = index === currentLyricIndex;
    return (
      <Pressable
        style={styles.lyricRow}
        onPress={() => seekTo(item.timeMs).catch(() => undefined)}
      >
        <Text style={[styles.lyricText, active && styles.lyricTextActive]}>
          {item.text}
        </Text>
      </Pressable>
    );
  }, [currentLyricIndex, seekTo]);

  if (!track) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.emptyTitle}>还没有可播放歌曲</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={handleMinimize}>
          <Text style={styles.headerIcon}>⌄</Text>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>一起听</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {tracks.length} 首可播放歌曲
          </Text>
        </View>
        <Pressable style={styles.iconButton} onPress={handleClose}>
          <Text style={styles.headerIcon}>×</Text>
        </Pressable>
      </View>

      <Pressable style={styles.manageButton} onPress={() => router.push('/music-playlists')}>
        <Image source={require('../assets/music.png')} style={styles.manageIcon} resizeMode="contain" />
        <Text style={styles.manageText}>歌单管理</Text>
      </Pressable>

      <View style={styles.radioPanel}>
        <View style={styles.radioTextBlock}>
          <Text style={styles.radioTitle} numberOfLines={1}>{radioTitle}</Text>
          <Text style={styles.radioStatus} numberOfLines={2}>{radioStatus}</Text>
        </View>
        <Pressable
          style={[styles.radioButton, (radioLoading || radioEnding) && styles.radioButtonDisabled]}
          onPress={handleRadioButtonPress}
          disabled={radioLoading || radioEnding}
        >
          {radioLoading || radioEnding ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.radioButtonText}>{radioButtonLabel}</Text>
          )}
        </Pressable>
      </View>

      <Pressable
        style={[styles.desktopLyricToggle, desktopLyricsEnabled && styles.desktopLyricToggleActive]}
        onPress={() => handleDesktopLyricToggle().catch(() => undefined)}
      >
        <Text style={[styles.desktopLyricToggleText, desktopLyricsEnabled && styles.desktopLyricToggleTextActive]}>
          桌面歌词
        </Text>
        <View style={[styles.desktopLyricSwitch, desktopLyricsEnabled && styles.desktopLyricSwitchActive]}>
          <View style={[styles.desktopLyricKnob, desktopLyricsEnabled && styles.desktopLyricKnobActive]} />
        </View>
      </Pressable>

      <View style={styles.desktopLyricBackgroundPanel}>
        {desktopLyricBackgroundUri ? (
          <Image source={{ uri: desktopLyricBackgroundUri }} style={styles.desktopLyricBackgroundPreview} resizeMode="cover" />
        ) : (
          <View style={styles.desktopLyricBackgroundPlaceholder} />
        )}
        <Pressable style={styles.desktopLyricBackgroundButton} onPress={pickDesktopLyricBackground}>
          <Text style={styles.desktopLyricBackgroundButtonText}>
            {desktopLyricBackgroundUri ? 'Change Background' : 'Upload Background'}
          </Text>
        </Pressable>
        {desktopLyricBackgroundUri ? (
          <Pressable style={styles.desktopLyricBackgroundClear} onPress={clearDesktopLyricBackground}>
            <Text style={styles.desktopLyricBackgroundClearText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.nowPlaying}>
        <View style={styles.coverShell}>
          {track.artworkUrl ? (
            <Image source={{ uri: track.artworkUrl }} style={styles.coverImage} resizeMode="cover" />
          ) : (
            <Image source={require('../assets/music.png')} style={styles.coverIcon} resizeMode="contain" />
          )}
        </View>

        <View style={styles.trackTextBlock}>
          <Text style={styles.trackTitle} numberOfLines={2}>{track.title}</Text>
          <Text style={styles.trackArtist} numberOfLines={1}>{track.artist}</Text>
          <Text style={styles.trackMeta} numberOfLines={1}>
            {trackSourceLabel(track)}
          </Text>
        </View>
      </View>

      <View style={styles.progressSection}>
        <Pressable
          style={styles.progressTrack}
          onLayout={handleProgressLayout}
          onPress={handleProgressPress}
        >
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </Pressable>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(currentTimeMs)}</Text>
          <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.secondaryControl} onPress={cycleOrder}>
          <Text style={styles.secondaryControlIcon}>
            {order === 'shuffle' ? '⇄' : order === 'repeat-one' ? '①' : '∞'}
          </Text>
        </Pressable>
        <Pressable style={styles.skipControl} onPress={() => previous().catch(() => undefined)}>
          <Text style={styles.skipIcon}>‹‹</Text>
        </Pressable>
        <Pressable style={styles.playControl} onPress={() => togglePlayPause().catch(() => undefined)}>
          {isBuffering ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.playIcon}>{isPlaying ? 'Ⅱ' : '▶'}</Text>
          )}
        </Pressable>
        <Pressable style={styles.skipControl} onPress={() => next().catch(() => undefined)}>
          <Text style={styles.skipIcon}>››</Text>
        </Pressable>
        <Pressable style={styles.secondaryControl} onPress={() => setQueueVisible(true)}>
          <Image source={require('../assets/music.png')} style={styles.tinyMusicIcon} resizeMode="contain" />
        </Pressable>
      </View>

      <Text style={styles.orderText}>{ORDER_LABELS[order]}</Text>

      {error && (
        <View style={styles.errorPill}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.lyricGlassShell}>
        <BlurView
          intensity={80}
          tint={lyricBlurTint}
          style={styles.lyricBlurPanel}
          pointerEvents="none"
        />
        <FlatList
          ref={lyricListRef}
          data={track.lyrics}
          keyExtractor={(item, index) => `${item.timeMs}-${index}`}
          renderItem={renderLyric}
          style={styles.lyricList}
          contentContainerStyle={styles.lyricContent}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={({ index }) => {
            setTimeout(() => {
              lyricListRef.current?.scrollToIndex({
                index,
                animated: true,
                viewPosition: 0.45,
              });
            }, 120);
          }}
          ListEmptyComponent={
            <View style={styles.emptyLyrics}>
              <Text style={styles.emptyLyricsText}>暂无时间轴歌词</Text>
            </View>
          }
        />
      </View>

      <Modal
        visible={queueVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setQueueVisible(false)}
      >
        <Pressable style={styles.queueOverlay} onPress={() => setQueueVisible(false)}>
          <View style={styles.queuePanel} onStartShouldSetResponder={() => true}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle}>当前歌曲列表</Text>
              <Pressable style={styles.queueCloseButton} onPress={() => setQueueVisible(false)}>
                <Text style={styles.queueCloseText}>×</Text>
              </Pressable>
            </View>
            <FlatList
              data={tracks}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }: { item: MusicTrack; index: number }) => {
                const active = index === currentIndex;
                return (
                  <Pressable
                    style={[styles.queueRow, active && styles.queueRowActive]}
                    onPress={() => {
                      setQueueVisible(false);
                      playTrackAt(index).catch(() => undefined);
                    }}
                  >
                    <View style={styles.queueIndexWrap}>
                      <Text style={[styles.queueIndex, active && styles.queueIndexActive]}>
                        {active && isPlaying ? 'Ⅱ' : String(index + 1)}
                      </Text>
                    </View>
                    <View style={styles.queueSongBody}>
                      <Text style={[styles.queueSongTitle, active && styles.queueSongTitleActive]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.queueSongArtist} numberOfLines={1}>
                        {item.artist}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
              style={styles.queueList}
              contentContainerStyle={styles.queueContent}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
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
    fontSize: 24,
    lineHeight: 26,
    color: colors.text,
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
  nowPlaying: {
    alignItems: 'center',
    paddingTop: 14,
  },
  manageButton: {
    alignSelf: 'center',
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 13,
    backgroundColor: colors.surface,
  },
  manageIcon: {
    width: 18,
    height: 18,
    opacity: 0.82,
  },
  manageText: {
    fontSize: 13,
    color: colors.text,
  },
  radioPanel: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  radioTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  radioTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  radioStatus: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  radioButton: {
    width: 58,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  radioButtonDisabled: {
    opacity: 0.72,
  },
  radioButtonText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: '#FFFFFF',
  },
  desktopLyricToggle: {
    alignSelf: 'center',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    borderRadius: 8,
    paddingLeft: 13,
    paddingRight: 8,
    backgroundColor: colors.surface,
  },
  desktopLyricToggleActive: {
    backgroundColor: colors.primaryLight,
  },
  desktopLyricToggleText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  desktopLyricToggleTextActive: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  desktopLyricSwitch: {
    width: 34,
    height: 20,
    borderRadius: 10,
    padding: 2,
    backgroundColor: colors.border,
  },
  desktopLyricSwitchActive: {
    backgroundColor: colors.primary,
  },
  desktopLyricKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  desktopLyricKnobActive: {
    transform: [{ translateX: 14 }],
  },
  desktopLyricBackgroundPanel: {
    alignSelf: 'center',
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: colors.surface,
  },
  desktopLyricBackgroundPreview: {
    width: 42,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.inputBackground,
  },
  desktopLyricBackgroundPlaceholder: {
    width: 42,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
  },
  desktopLyricBackgroundButton: {
    minHeight: 28,
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.primaryLight,
  },
  desktopLyricBackgroundButtonText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  desktopLyricBackgroundClear: {
    minHeight: 28,
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 9,
    backgroundColor: colors.dangerSurface,
  },
  desktopLyricBackgroundClearText: {
    fontSize: 12,
    color: colors.danger,
  },
  coverShell: {
    width: 210,
    height: 210,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverIcon: {
    width: 86,
    height: 86,
    opacity: 0.84,
  },
  trackTextBlock: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 18,
  },
  trackTitle: {
    maxWidth: '92%',
    textAlign: 'center',
    fontSize: 24,
    lineHeight: 30,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  trackArtist: {
    maxWidth: '90%',
    marginTop: 7,
    textAlign: 'center',
    fontSize: 15,
    color: colors.textSecondary,
  },
  trackMeta: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textTertiary,
  },
  progressSection: {
    paddingTop: 20,
  },
  progressTrack: {
    height: 18,
    borderRadius: 8,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  timeRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 12,
    fontFamily: fonts.mono,
    color: colors.textTertiary,
  },
  controls: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  secondaryControl: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryControlIcon: {
    fontSize: 20,
    color: colors.text,
  },
  skipControl: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipIcon: {
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
  },
  playControl: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    marginLeft: 2,
    fontSize: 26,
    lineHeight: 30,
    color: '#FFFFFF',
  },
  tinyMusicIcon: {
    width: 22,
    height: 22,
    opacity: 0.82,
  },
  queueOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,20,19,0.34)',
    justifyContent: 'flex-end',
  },
  queuePanel: {
    maxHeight: '72%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
  },
  queueHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  queueTitle: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  queueCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  queueCloseText: {
    fontSize: 22,
    lineHeight: 24,
    color: colors.text,
  },
  queueList: {
    marginTop: 4,
  },
  queueContent: {
    paddingBottom: 8,
  },
  queueRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  queueRowActive: {
    backgroundColor: colors.primaryLight,
  },
  queueIndexWrap: {
    width: 34,
    alignItems: 'center',
  },
  queueIndex: {
    fontSize: 13,
    fontFamily: fonts.mono,
    color: colors.textTertiary,
  },
  queueIndexActive: {
    color: colors.primary,
  },
  queueSongBody: {
    flex: 1,
    paddingRight: 8,
  },
  queueSongTitle: {
    fontSize: 15,
    color: colors.text,
  },
  queueSongTitleActive: {
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  queueSongArtist: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textTertiary,
  },
  orderText: {
    marginTop: 9,
    textAlign: 'center',
    fontSize: 12,
    color: colors.textTertiary,
  },
  errorPill: {
    marginTop: 10,
    alignSelf: 'center',
    maxWidth: '96%',
    minHeight: 30,
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: colors.dangerSurface,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
  },
  lyricGlassShell: {
    flex: 1,
    minHeight: 180,
    maxHeight: 260,
    marginTop: 10,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors === lightColors ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
    backgroundColor: 'transparent',
  },
  lyricBlurPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  lyricList: {
    flex: 1,
  },
  lyricContent: {
    paddingTop: 24,
    paddingBottom: 42,
  },
  lyricRow: {
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  lyricText: {
    textAlign: 'center',
    fontSize: 15,
    lineHeight: 22,
    color: colors.textTertiary,
  },
  lyricTextActive: {
    fontSize: 19,
    lineHeight: 26,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  emptyLyrics: {
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyLyricsText: {
    fontSize: 14,
    color: colors.textTertiary,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
  },
});

let styles = createStyles(colors);
