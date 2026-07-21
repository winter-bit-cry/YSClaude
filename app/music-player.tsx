import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  ImageBackground,
  LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Captions,
  ChevronDown,
  ListMusic,
  MessageCircle,
  Pause,
  Play,
  Radio as RadioIcon,
  Repeat1,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { fonts } from '../src/theme/fonts';
import {
  getTogetherListeningElapsedMs,
  LyricLine,
  MusicTrack,
  PlayOrder,
  useMusicStore,
} from '../src/stores/music';
import { useRadioStore } from '../src/stores/radio';
import { useChatStore } from '../src/stores/chat';
import { useSettingsStore } from '../src/stores/settings';
import { getAllConversations } from '../src/db/operations';
import { canDrawFloatingBall, openFloatingBallPermissionSettings } from '../src/services/floatingBall';
import { refreshDesktopLyric } from '../src/services/desktopLyrics';
import { copyFileFromUri } from '../src/utils/fileSystem';
import { useKeyboardHeight } from '../src/hooks/useKeyboardHeight';
import { buildStickerDefinitions, splitStickerContent, type StickerDefinition } from '../src/utils/stickers';

const ORDER_SEQUENCE: PlayOrder[] = ['list', 'repeat-one', 'shuffle'];
type AiBubble =
  | { type: 'text'; text: string }
  | { type: 'sticker'; sticker: StickerDefinition };

function buildAiBubbles(content: string, stickers: StickerDefinition[]): AiBubble[] {
  return splitStickerContent(content, stickers).flatMap((chunk): AiBubble[] => {
    if (chunk.type === 'sticker') return [{ type: 'sticker', sticker: chunk.sticker }];
    return chunk.text
      .split(/\n+/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ type: 'text', text }));
  });
}
function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatListenDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${String(totalMinutes).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
}

function imageExtension(asset: ImagePicker.ImagePickerAsset) {
  const mime = asset.mimeType?.toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}

async function pickImage(prefix: string, aspect?: [number, number], preserveOriginal = false) {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: !preserveOriginal,
    ...(!preserveOriginal && aspect ? { aspect } : {}),
    quality: 0.9,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset?.uri) return '';
  const dir = new Directory(Paths.document, 'listen-together-assets');
  dir.create({ intermediates: true, idempotent: true });
  const destination = new File(dir, `${prefix}-${randomUUID()}${imageExtension(asset)}`);
  await copyFileFromUri(asset.uri, destination);
  return destination.uri;
}

export default function MusicScreen() {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const spin = useRef(new Animated.Value(0)).current;
  const spinAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const lyricListRef = useRef<FlatList<LyricLine>>(null);
  const userBubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiBubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingMusicReply = useRef(false);
  const lastMusicAssistantId = useRef<string | null>(
    [...useChatStore.getState().messages].reverse().find(message => message.role === 'assistant')?.id ?? null
  );
  const [progressWidth, setProgressWidth] = useState(1);
  const [queueVisible, setQueueVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatText, setChatText] = useState('');
  const [userBubble, setUserBubble] = useState('');
  const [aiBubbles, setAiBubbles] = useState<AiBubble[]>([]);
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [listenClockNow, setListenClockNow] = useState(Date.now());

  const radio = useRadioStore();
  const music = useMusicStore();
  const assistantStickerConfig = useSettingsStore(state => state.stickerConfig?.assistantStickers);
  const assistantStickers = useMemo(
    () => buildStickerDefinitions(assistantStickerConfig),
    [assistantStickerConfig]
  );
  const chatMessages = useChatStore(state => state.messages);
  const chatConversationId = useChatStore(state => state.conversationId);
  const chatIsStreaming = useChatStore(state => state.isStreaming);
  const chatError = useChatStore(state => state.error);
  const loadConversation = useChatStore(state => state.loadConversation);
  const addChatUserMessage = useChatStore(state => state.addUserMessage);
  const triggerChatResponse = useChatStore(state => state.triggerResponse);
  const {
    _hydrated, tracks, currentIndex, order, isPlaying, isBuffering, desktopLyricsEnabled,
    desktopLyricBackgroundUri, togetherBackgroundUri, togetherUserAvatarUri,
    togetherAiAvatarUri, togetherRingUri, togetherRingEnabled, togetherRecordBorderEnabled,
    togetherBackgroundOverlayEnabled, togetherBackgroundOverlayOpacity, togetherElapsedMs, togetherStartedAt,
    currentTimeMs, durationMs, currentLyricIndex, error,
    openPlayer, minimizePlayer, closePlayer, togglePlayPause, previous, next,
    playTrackAt, removeTrackAt, seekTo, setOrder, setDesktopLyricsEnabled, setDesktopLyricBackgroundUri,
    setTogetherBackgroundUri, setTogetherUserAvatarUri, setTogetherAiAvatarUri, setTogetherRingUri,
    setTogetherRingEnabled, setTogetherRecordBorderEnabled, setTogetherBackgroundOverlayEnabled,
    setTogetherBackgroundOverlayOpacity,
  } = music;
  const track = tracks[currentIndex];
  const progress = durationMs > 0 ? Math.min(1, currentTimeMs / durationMs) : 0;
  const listenElapsedMs = getTogetherListeningElapsedMs(
    { togetherElapsedMs, togetherStartedAt },
    listenClockNow
  );

  useEffect(() => {
    if (_hydrated) openPlayer();
  }, [_hydrated, openPlayer]);
  useEffect(() => {
    setListenClockNow(Date.now());
    const timer = setInterval(() => setListenClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    spinAnimation.current?.stop();
    if (!isPlaying) return;
    spin.setValue(0);
    spinAnimation.current = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      { resetBeforeIteration: true }
    );
    spinAnimation.current.start();
    return () => spinAnimation.current?.stop();
  }, [isPlaying, spin, track?.id]);
  useEffect(() => {
    if (!lyricsVisible || currentLyricIndex < 0) return;
    lyricListRef.current?.scrollToIndex({ index: currentLyricIndex, animated: true, viewPosition: 0.45 });
  }, [currentLyricIndex, lyricsVisible]);
  useEffect(() => {
    const latestAssistant = [...chatMessages].reverse().find(message => message.role === 'assistant');
    if (!awaitingMusicReply.current || !latestAssistant?.content) return;
    lastMusicAssistantId.current = latestAssistant.id;
    setAiBubbles(buildAiBubbles(latestAssistant.content, assistantStickers));
    if (aiBubbleTimer.current) clearTimeout(aiBubbleTimer.current);
    if (!chatIsStreaming) {
      awaitingMusicReply.current = false;
      aiBubbleTimer.current = setTimeout(() => setAiBubbles([]), 5000);
    }
  }, [assistantStickers, chatIsStreaming, chatMessages]);
  useEffect(() => () => {
    if (userBubbleTimer.current) clearTimeout(userBubbleTimer.current);
    if (aiBubbleTimer.current) clearTimeout(aiBubbleTimer.current);
  }, []);

  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const handleMinimize = useCallback(() => {
    minimizePlayer();
    router.replace(from === 'mine' ? '/music-playlists' : '/music');
  }, [from, minimizePlayer, router]);
  const handleClose = useCallback(() => {
    router.replace('/');
    closePlayer().catch((closeError) => {
      console.warn('关闭音乐播放器失败:', closeError);
    });
  }, [closePlayer, router]);
  const handleProgressPress = useCallback((event: any) => {
    seekTo(Math.max(0, Math.min(1, event.nativeEvent.locationX / progressWidth)) * durationMs).catch(() => undefined);
  }, [durationMs, progressWidth, seekTo]);
  const cycleOrder = useCallback(() => {
    setOrder(ORDER_SEQUENCE[(ORDER_SEQUENCE.indexOf(order) + 1) % ORDER_SEQUENCE.length]);
  }, [order, setOrder]);
  const toggleDesktopLyrics = useCallback(async () => {
    const enabled = !desktopLyricsEnabled;
    setDesktopLyricsEnabled(enabled);
    if (!enabled) return;
    try {
      if (!await canDrawFloatingBall()) {
        Alert.alert('需要悬浮窗权限', '请允许 YSClaude 显示在其他应用上层。');
        await openFloatingBallPermissionSettings();
        return;
      }
      refreshDesktopLyric();
    } catch {
      refreshDesktopLyric();
    }
  }, [desktopLyricsEnabled, setDesktopLyricsEnabled]);
  const sendMessage = useCallback(async () => {
    const text = chatText.trim();
    if (!text || chatIsStreaming) return;
    setUserBubble(text);
    setAiBubbles([]);
    if (userBubbleTimer.current) clearTimeout(userBubbleTimer.current);
    userBubbleTimer.current = setTimeout(() => setUserBubble(''), 5000);
    setChatText('');
    const conversations = await getAllConversations();
    const latest = conversations[0];
    if (latest && latest.id !== chatConversationId) {
      await loadConversation(latest.id);
    }
    const userMessage = await addChatUserMessage(text);
    if (!userMessage || useChatStore.getState().error) return;
    awaitingMusicReply.current = true;
    await triggerChatResponse();
  }, [addChatUserMessage, chatConversationId, chatIsStreaming, chatText, loadConversation, triggerChatResponse]);
  const handleRadio = useCallback(() => {
    const action = radio.phase === 'call_in_waiting'
      ? radio.continueProgram
      : radio.active ? radio.end : radio.start;
    action();
    setAiBubbles([{ type: 'text', text: radio.active ? '今天的 AI 电台先陪你到这里。' : '我选了一首相似氛围的歌，下一首一起听吧。' }]);
    if (aiBubbleTimer.current) clearTimeout(aiBubbleTimer.current);
    aiBubbleTimer.current = setTimeout(() => setAiBubbles([]), 5000);
  }, [radio]);

  if (!track) {
    return <View style={styles.empty}><Text style={styles.primaryText}>还没有可播放歌曲</Text></View>;
  }

  const source = togetherBackgroundUri ? { uri: togetherBackgroundUri } : undefined;
  const player = (
    <View
      style={[
      styles.page,
      source && styles.pageWithBackground,
      source && togetherBackgroundOverlayEnabled && {
        backgroundColor: `rgba(6,7,9,${togetherBackgroundOverlayOpacity})`,
      },
      { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 14) },
      ]}
    >
      <View style={styles.header}>
        <Pressable style={styles.roundButton} onPress={handleMinimize}><ChevronDown size={27} color="#d8d8dc" strokeWidth={1.8} /></Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.songTitle} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
        </View>
        <Pressable style={styles.roundButton} onPress={handleClose}><X size={25} color="#d8d8dc" strokeWidth={1.8} /></Pressable>
      </View>

      {lyricsVisible ? (
        <Pressable style={styles.lyricsCenter} onPress={() => setLyricsVisible(false)}>
          <Text style={styles.lyricsHint}>点击返回唱片</Text>
          <FlatList
            ref={lyricListRef}
            data={track.lyrics}
            keyExtractor={(item, index) => `${item.timeMs}-${index}`}
            contentContainerStyle={styles.lyricsContent}
            showsVerticalScrollIndicator={false}
            onScrollToIndexFailed={({ index }) => setTimeout(() => lyricListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 }), 120)}
            ListEmptyComponent={<Text style={styles.emptyLyrics}>暂无时间轴歌词</Text>}
            renderItem={({ item, index }) => (
              <Pressable style={styles.lyricRow} onPress={() => seekTo(item.timeMs).catch(() => undefined)}>
                <Text style={[styles.lyricText, index === currentLyricIndex && styles.lyricActive]}>{item.text}</Text>
              </Pressable>
            )}
          />
        </Pressable>
      ) : (
        <>
          <View style={styles.listeners}>
            <View style={styles.avatarZone}>
              <View style={styles.avatarRow}>
                <View style={[styles.avatar, styles.userAvatar]}>
                  {togetherUserAvatarUri ? <Image source={{ uri: togetherUserAvatarUri }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>你</Text>}
                </View>
                <View style={[styles.avatar, styles.aiAvatar]}>
                  {togetherAiAvatarUri ? <Image source={{ uri: togetherAiAvatarUri }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>AI</Text>}
                </View>
              </View>
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Image source={require('../assets/headphone-left.png')} style={styles.headphoneLeft} resizeMode="contain" />
                <Image source={require('../assets/headphone-right.png')} style={styles.headphoneRight} resizeMode="contain" />
              </View>
              {!!userBubble && <View style={[styles.bubble, styles.userBubble]}><Text style={styles.bubbleText}>{userBubble}</Text></View>}
              {!!aiBubbles.length && (
                <View style={styles.aiBubbleStack}>
                  {aiBubbles.map((bubble, index) => bubble.type === 'sticker' ? (
                    <View key={`sticker-${index}-${bubble.sticker.id}`} style={[styles.bubble, styles.aiBubble, styles.stickerBubble]}>
                      <Image source={bubble.sticker.image} style={styles.aiSticker} resizeMode="contain" />
                    </View>
                  ) : (
                    <View key={`text-${index}-${bubble.text}`} style={[styles.bubble, styles.aiBubble]}>
                      <Text style={styles.bubbleText}>{bubble.text}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <Text style={styles.listenTime}>一起听了 {formatListenDuration(listenElapsedMs)}</Text>
          </View>
          <Pressable style={styles.recordStage} onPress={() => setLyricsVisible(true)}>
            <View style={styles.recordHalo} />
            {togetherRingEnabled && <View style={styles.ring}>
              {togetherRingUri ? <Image source={{ uri: togetherRingUri }} style={styles.ringImage} resizeMode="contain" /> : null}
              {[
                { size: 298, fill: 'rgba(150,151,157,.012)' },
                { size: 290, fill: 'rgba(150,151,157,.015)' },
                { size: 282, fill: 'rgba(150,151,157,.018)' },
                { size: 274, fill: 'rgba(150,151,157,.022)' },
                { size: 266, fill: 'rgba(150,151,157,.027)' },
                { size: 258, fill: 'rgba(150,151,157,.033)' },
                { size: 250, fill: 'rgba(150,151,157,.04)' },
                { size: 242, fill: 'rgba(150,151,157,.048)' },
                { size: 234, fill: 'rgba(150,151,157,.058)' },
              ].map(({ size, fill }) => (
                <View
                  key={size}
                  pointerEvents="none"
                  style={[
                    styles.ringLine,
                    { width: size, height: size, borderRadius: size / 2, backgroundColor: fill },
                  ]}
                />
              ))}
            </View>}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.vinyl,
                !togetherRecordBorderEnabled && styles.vinylWithoutBorder,
                { transform: [{ rotate: rotation }] },
              ]}
            >
              {track.artworkUrl
                ? <Image source={{ uri: track.artworkUrl }} style={styles.cover} />
                : <View style={[styles.cover, styles.coverFallback]}><Text style={styles.coverNote}>♪</Text></View>}
            </Animated.View>
          </Pressable>
        </>
      )}

      <View style={styles.bottom}>
        <View style={styles.featureArea}>
          {chatVisible && (
            <View style={[styles.chatOverlay, { bottom: 54 + keyboardHeight }]}>
              <View style={styles.chatRow}>
                <TextInput
                  value={chatText}
                  onChangeText={setChatText}
                  onSubmitEditing={() => sendMessage().catch(() => undefined)}
                  placeholder="和 AI 聊聊这首歌…"
                  placeholderTextColor="#85858d"
                  style={styles.chatInput}
                  returnKeyType="send"
                />
                <Pressable style={[styles.sendButton, chatIsStreaming && styles.sendButtonDisabled]} disabled={chatIsStreaming} onPress={() => sendMessage().catch(() => undefined)}>
                  {chatIsStreaming ? <ActivityIndicator size="small" color="#17171a" /> : <Text style={styles.sendText}>发送</Text>}
                </Pressable>
              </View>
              {!!chatError && <Text style={styles.chatError}>{chatError}</Text>}
            </View>
          )}
          <View style={styles.featureRow}>
            <Feature Icon={Captions} label="桌面歌词" active={desktopLyricsEnabled} onPress={() => toggleDesktopLyrics().catch(() => undefined)} />
            <Feature Icon={MessageCircle} label="聊天" active={chatVisible} onPress={() => setChatVisible(value => !value)} />
            <Feature Icon={RadioIcon} label="AI 电台" active={radio.active} loading={radio.loading || radio.ending} onPress={handleRadio} />
            <Feature Icon={Settings} label="设置" onPress={() => setSettingsVisible(true)} />
          </View>
        </View>
        <View style={styles.progressSection}>
          <Pressable
            style={styles.progressHit}
            onLayout={(event: LayoutChangeEvent) => setProgressWidth(Math.max(1, event.nativeEvent.layout.width))}
            onPress={handleProgressPress}
          >
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>
          </Pressable>
          <View style={styles.timeRow}><Text style={styles.time}>{formatTime(currentTimeMs)}</Text><Text style={styles.time}>{formatTime(durationMs)}</Text></View>
        </View>
        <View style={styles.controls}>
          <Control Icon={order === 'shuffle' ? Shuffle : order === 'repeat-one' ? Repeat1 : ListMusic} onPress={cycleOrder} />
          <Control Icon={SkipBack} onPress={() => previous().catch(() => undefined)} />
          <Pressable style={styles.playButton} onPress={() => togglePlayPause().catch(() => undefined)}>
            {isBuffering ? <ActivityIndicator color="#fff" /> : isPlaying
              ? <Pause size={28} color="#fff" fill="#fff" strokeWidth={1.8} />
              : <Play size={28} color="#fff" fill="#fff" strokeWidth={1.8} />}
          </Pressable>
          <Control Icon={SkipForward} onPress={() => next().catch(() => undefined)} />
          <Control Icon={ListMusic} onPress={() => setQueueVisible(true)} />
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>

      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <Pressable style={styles.modalShade} onPress={() => setSettingsVisible(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>一起听设置</Text><Pressable onPress={() => setSettingsVisible(false)}><Text style={styles.closeText}>×</Text></Pressable></View>
            <Text style={styles.sectionLabel}>自定义图片</Text>
            <View style={styles.uploadGrid}>
              <Upload label="背景图" hasImage={!!togetherBackgroundUri} onClear={() => setTogetherBackgroundUri('')} onPress={() => pickImage('background', undefined, true).then(uri => uri && setTogetherBackgroundUri(uri))} />
              <Upload label="我的头像" hasImage={!!togetherUserAvatarUri} onClear={() => setTogetherUserAvatarUri('')} onPress={() => pickImage('user-avatar', [1, 1]).then(uri => uri && setTogetherUserAvatarUri(uri))} />
              <Upload label="AI 头像" hasImage={!!togetherAiAvatarUri} onClear={() => setTogetherAiAvatarUri('')} onPress={() => pickImage('ai-avatar', [1, 1]).then(uri => uri && setTogetherAiAvatarUri(uri))} />
              <Upload label="唱片外圈装饰" hasImage={!!togetherRingUri} onClear={() => setTogetherRingUri('')} onPress={() => pickImage('record-ring', [1, 1]).then(uri => uri && setTogetherRingUri(uri))} />
              <Upload label="桌面歌词背景" hasImage={!!desktopLyricBackgroundUri} onClear={() => setDesktopLyricBackgroundUri('')} onPress={() => pickImage('desktop-lyrics', [16, 9]).then(uri => uri && setDesktopLyricBackgroundUri(uri))} />
            </View>
            <View style={styles.toggleGroup}>
              <SettingToggle
                label="灰白年轮外圈"
                value={togetherRingEnabled}
                onValueChange={setTogetherRingEnabled}
              />
              <SettingToggle
                label="唱片灰白描边"
                value={togetherRecordBorderEnabled}
                onValueChange={setTogetherRecordBorderEnabled}
              />
              <SettingToggle
                label="背景图半透明深色遮罩"
                value={togetherBackgroundOverlayEnabled}
                onValueChange={setTogetherBackgroundOverlayEnabled}
              />
              {togetherBackgroundOverlayEnabled && (
                <OpacitySlider
                  value={togetherBackgroundOverlayOpacity}
                  onValueChange={setTogetherBackgroundOverlayOpacity}
                />
              )}
            </View>
            <Pressable style={styles.manageButton} onPress={() => { setSettingsVisible(false); router.push('/music-playlists'); }}>
              <Text style={styles.manageText}>歌单管理</Text><Text style={styles.manageArrow}>›</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={queueVisible} transparent animationType="slide" onRequestClose={() => setQueueVisible(false)}>
        <Pressable style={styles.modalShade} onPress={() => setQueueVisible(false)}>
          <View style={styles.queueSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>当前歌曲列表</Text>
            <FlatList
              data={tracks}
              keyExtractor={item => item.id}
              renderItem={({ item, index }: { item: MusicTrack; index: number }) => (
                <Pressable style={[styles.queueRow, index === currentIndex && styles.queueRowActive]} onPress={() => { setQueueVisible(false); playTrackAt(index).catch(() => undefined); }}>
                  <Text style={styles.queueIndex}>{index === currentIndex && isPlaying ? 'Ⅱ' : index + 1}</Text>
                  <View style={styles.queueText}><Text style={styles.queueTitle} numberOfLines={1}>{item.title}</Text><Text style={styles.queueArtist} numberOfLines={1}>{item.artist}</Text></View>
                  <Pressable
                    accessibilityLabel={`删除 ${item.title}`}
                    hitSlop={8}
                    style={styles.queueDelete}
                    onPress={(event) => {
                      event.stopPropagation();
                      removeTrackAt(index).catch(() => undefined);
                    }}
                  >
                    <X size={19} color="#999aa2" strokeWidth={1.8} />
                  </Pressable>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );

  return source ? <ImageBackground source={source} style={styles.background} resizeMode="cover">{player}</ImageBackground> : player;
}

function Feature({ Icon, label, active, loading, onPress }: { Icon: LucideIcon; label: string; active?: boolean; loading?: boolean; onPress: () => void }) {
  return <Pressable style={styles.feature} onPress={onPress}><View style={[styles.featureIcon, active && styles.featureActive]}>{loading ? <ActivityIndicator size="small" color="#fff" /> : <Icon size={21} color={active ? '#f1f1f3' : '#c9c9cf'} strokeWidth={1.8} />}</View><Text style={styles.featureLabel}>{label}</Text></Pressable>;
}
function Control({ Icon, onPress }: { Icon: LucideIcon; onPress: () => void }) {
  return <Pressable style={styles.control} onPress={onPress}><Icon size={24} color="#d2d2d7" strokeWidth={1.8} /></Pressable>;
}
function Upload({ label, hasImage, onPress, onClear }: { label: string; hasImage: boolean; onPress: () => void; onClear: () => void }) {
  return (
    <View style={styles.upload}>
      <Pressable style={styles.uploadPicker} onPress={onPress}>
        <Text style={styles.uploadIcon}>{hasImage ? '↻' : '＋'}</Text>
        <Text style={styles.uploadLabel}>{label}</Text>
      </Pressable>
      {hasImage && <Pressable hitSlop={8} onPress={onClear}><Text style={styles.uploadClear}>清除</Text></Pressable>}
    </View>
  );
}
function SettingToggle({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#3d3e44', true: '#777983' }}
        thumbColor={value ? '#f1f1f3' : '#b4b4ba'}
      />
    </View>
  );
}

function OpacitySlider({ value, onValueChange }: { value: number; onValueChange: (value: number) => void }) {
  const [trackWidth, setTrackWidth] = useState(1);
  const updateValue = (locationX: number) => {
    onValueChange(Math.max(0, Math.min(1, locationX / trackWidth)));
  };
  return (
    <View style={styles.opacityRow}>
      <Text style={styles.opacityLabel}>遮罩透明度</Text>
      <View
        style={styles.opacitySlider}
        onLayout={(event) => setTrackWidth(Math.max(1, event.nativeEvent.layout.width))}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(event) => updateValue(event.nativeEvent.locationX)}
        onResponderMove={(event) => updateValue(event.nativeEvent.locationX)}
      >
        <View style={[styles.opacityFill, { width: `${value * 100}%` }]} />
        <View style={[styles.opacityThumb, { left: `${value * 100}%` }]} />
      </View>
      <Text style={styles.opacityValue}>{Math.round(value * 100)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#090a0c' },
  page: { flex: 1, paddingHorizontal: 20, backgroundColor: '#090a0c' },
  pageWithBackground: { backgroundColor: 'transparent' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#090a0c' },
  primaryText: { color: '#fff', fontSize: 17 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', zIndex: 20, elevation: 20 },
  roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', zIndex: 21 },
  titleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  songTitle: { color: '#f0f0f2', fontFamily: fonts.bold, fontSize: 17 },
  artist: { marginTop: 4, color: '#999aa2', fontSize: 12 },
  listeners: { alignItems: 'center', paddingTop: 12, zIndex: 3 },
  avatarZone: { position: 'relative', width: 190, height: 88, alignItems: 'center' },
  avatarRow: { flexDirection: 'row', justifyContent: 'center', zIndex: 2 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  userAvatar: { backgroundColor: '#887ba8' },
  aiAvatar: { marginLeft: -10, backgroundColor: '#5c91a9' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: '#fff', fontFamily: fonts.bold, fontSize: 20 },
  headphoneLeft: { position: 'absolute', zIndex: 3, left: -153, top: -122, width: 488, height: 488 },
  headphoneRight: { position: 'absolute', zIndex: 3, left: -167, top: -122, width: 488, height: 488 },
  bubble: { zIndex: 5, maxWidth: 155, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: 'rgba(20,20,24,.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)' },
  userBubble: { position: 'absolute', top: 76, right: 98, borderTopRightRadius: 4 },
  aiBubbleStack: { position: 'absolute', top: 76, left: 98, zIndex: 5, gap: 5, alignItems: 'flex-start' },
  aiBubble: { borderTopLeftRadius: 4 },
  stickerBubble: { paddingHorizontal: 6, paddingVertical: 6 },
  aiSticker: { width: 68, height: 68 },
  bubbleText: { color: '#ededf0', fontSize: 12, lineHeight: 17 },
  listenTime: { marginTop: 5, color: '#dedee2', fontSize: 13, fontVariant: ['tabular-nums'] },
  lyricsCenter: { flex: 1, minHeight: 330, marginTop: 10, overflow: 'hidden' },
  lyricsHint: { paddingVertical: 6, textAlign: 'center', color: '#777780', fontSize: 11 },
  lyricsContent: { paddingTop: 120, paddingBottom: 150 },
  lyricRow: { minHeight: 48, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  lyricText: { textAlign: 'center', color: '#777780', fontSize: 15, lineHeight: 22 },
  lyricActive: { color: '#f2f2f4', fontFamily: fonts.bold, fontSize: 20, lineHeight: 28 },
  emptyLyrics: { marginTop: 120, textAlign: 'center', color: '#888891', fontSize: 14 },
  recordStage: {
    flex: 1,
    minHeight: 245,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [
      { translateX: 0 }, // 正数向右，负数向左
      { translateY: -20 }, // 正数向下，负数向上
    ],
  },
  recordHalo: { position: 'absolute', width: 330, height: 330, borderRadius: 165, backgroundColor: 'rgba(255,255,255,.035)' },
  ring: { position: 'absolute', width: 306, height: 306, borderRadius: 153, borderWidth: 1, borderColor: 'rgba(255,255,255,.18)', backgroundColor: 'rgba(170,170,175,.015)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ringImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  ringLine: { position: 'absolute', borderWidth: 0, borderColor: 'transparent' },
  vinyl: { width: 232, height: 232, borderRadius: 116, alignItems: 'center', justifyContent: 'center', borderWidth: 6, borderColor: 'rgba(235,235,238,.72)', overflow: 'hidden' },
  vinylWithoutBorder: { borderWidth: 0 },
  cover: { width: '100%', height: '100%', borderRadius: 110 },
  coverFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#496174' },
  coverNote: { color: '#fff', fontSize: 34 },
  bottom: { paddingTop: 2 },
  featureArea: { position: 'relative', zIndex: 30 },
  featureRow: { flexDirection: 'row', justifyContent: 'space-around' },
  feature: { width: 72, alignItems: 'center' },
  featureIcon: { width: 44, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  featureActive: { backgroundColor: 'rgba(255,255,255,.12)' },
  featureLabel: { marginTop: 1, color: '#96969e', fontSize: 10 },
  chatOverlay: { position: 'absolute', left: 0, right: 0, bottom: 54, zIndex: 31 },
  chatRow: { height: 44, flexDirection: 'row', gap: 8 },
  chatInput: { flex: 1, borderRadius: 22, paddingHorizontal: 16, color: '#fff', backgroundColor: 'rgba(255,255,255,.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,.1)' },
  sendButton: { width: 58, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ececef' },
  sendButtonDisabled: { opacity: .62 },
  sendText: { color: '#17171a', fontSize: 12, fontFamily: fonts.bold },
  chatError: { marginTop: 5, textAlign: 'center', color: '#ffaaaa', fontSize: 11 },
  progressSection: { marginTop: 10 },
  progressHit: { height: 20, justifyContent: 'center' },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: '#55565d', overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: '#f1f1f3' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { color: '#85858d', fontSize: 11, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 4 },
  control: { width: 48, height: 52, alignItems: 'center', justifyContent: 'center' },
  playButton: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.13)' },
  error: { color: '#ff9e9e', textAlign: 'center', fontSize: 11 },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.48)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, backgroundColor: '#17181c' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: '#f0f0f2', fontSize: 17, fontFamily: fonts.bold },
  closeText: { color: '#d9d9dd', fontSize: 28 },
  sectionLabel: { marginTop: 18, marginBottom: 10, color: '#a0a0a7', fontSize: 12 },
  uploadGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  upload: { width: '48%', minHeight: 58, flexDirection: 'row', alignItems: 'center', borderRadius: 13, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,.06)' },
  uploadPicker: { flex: 1, minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9 },
  uploadIcon: { color: '#e7e7ea', fontSize: 20 },
  uploadLabel: { flexShrink: 1, color: '#d5d5da', fontSize: 12 },
  uploadClear: { color: '#e79b9b', fontSize: 11 },
  toggleGroup: { marginTop: 14, borderRadius: 13, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,.06)' },
  toggleRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel: { color: '#d5d5da', fontSize: 13 },
  opacityRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,.08)' },
  opacityLabel: { width: 88, color: '#b8b8bf', fontSize: 12 },
  opacitySlider: { flex: 1, height: 28, justifyContent: 'center' },
  opacityFill: { height: 4, borderRadius: 2, backgroundColor: '#bfc0c8' },
  opacityThumb: { position: 'absolute', width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: '#f1f1f3', borderWidth: 2, borderColor: '#777983' },
  opacityValue: { width: 42, color: '#d5d5da', fontSize: 12, textAlign: 'right', fontVariant: ['tabular-nums'] },
  manageButton: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, borderRadius: 13, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,.06)' },
  manageText: { color: '#e1e1e5', fontSize: 13 },
  manageArrow: { color: '#98989f', fontSize: 24 },
  queueSheet: { maxHeight: '70%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, backgroundColor: '#17181c' },
  queueRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.07)' },
  queueRowActive: { backgroundColor: 'rgba(255,255,255,.06)' },
  queueIndex: { width: 34, color: '#999aa2', textAlign: 'center' },
  queueText: { flex: 1, paddingLeft: 8 },
  queueDelete: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  queueTitle: { color: '#ededf0', fontSize: 14 },
  queueArtist: { color: '#8f8f97', fontSize: 12, marginTop: 4 },
});
