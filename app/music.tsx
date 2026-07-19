import { useCallback, useEffect, useRef, useState } from 'react';
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
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../src/theme/fonts';
import { LyricLine, MusicTrack, PlayOrder, useMusicStore } from '../src/stores/music';
import { useRadioStore } from '../src/stores/radio';
import { useChatStore } from '../src/stores/chat';
import { getAllConversations } from '../src/db/operations';
import { canDrawFloatingBall, openFloatingBallPermissionSettings } from '../src/services/floatingBall';
import { refreshDesktopLyric } from '../src/services/desktopLyrics';

const ORDER_SEQUENCE: PlayOrder[] = ['list', 'repeat-one', 'shuffle'];
function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function pickImage(aspect?: [number, number]) {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect,
    quality: 0.9,
  });
  return result.canceled ? '' : result.assets[0]?.uri || '';
}

export default function MusicScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const spin = useRef(new Animated.Value(0)).current;
  const spinAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const lyricListRef = useRef<FlatList<LyricLine>>(null);
  const [progressWidth, setProgressWidth] = useState(1);
  const [queueVisible, setQueueVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatText, setChatText] = useState('');
  const [userBubble, setUserBubble] = useState('');
  const [aiBubbles, setAiBubbles] = useState<string[]>([]);
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [backgroundUri, setBackgroundUri] = useState('');
  const [userAvatarUri, setUserAvatarUri] = useState('');
  const [aiAvatarUri, setAiAvatarUri] = useState('');
  const [ringUri, setRingUri] = useState('');
  const [listenSeconds, setListenSeconds] = useState(0);

  const radio = useRadioStore();
  const music = useMusicStore();
  const chatMessages = useChatStore(state => state.messages);
  const chatConversationId = useChatStore(state => state.conversationId);
  const chatIsStreaming = useChatStore(state => state.isStreaming);
  const chatError = useChatStore(state => state.error);
  const loadConversation = useChatStore(state => state.loadConversation);
  const sendChatMessage = useChatStore(state => state.sendMessage);
  const {
    tracks, currentIndex, order, isPlaying, isBuffering, desktopLyricsEnabled,
    desktopLyricBackgroundUri, currentTimeMs, durationMs, currentLyricIndex, error,
    openPlayer, minimizePlayer, closePlayer, togglePlayPause, previous, next,
    playTrackAt, seekTo, setOrder, setDesktopLyricsEnabled, setDesktopLyricBackgroundUri,
  } = music;
  const track = tracks[currentIndex];
  const progress = durationMs > 0 ? Math.min(1, currentTimeMs / durationMs) : 0;

  useEffect(() => { openPlayer(); }, [openPlayer]);
  useEffect(() => {
    const timer = setInterval(() => setListenSeconds(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    spinAnimation.current?.stop();
    if (!isPlaying) return;
    spinAnimation.current = Animated.loop(Animated.timing(spin, {
      toValue: 1,
      duration: 12000,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    spinAnimation.current.start();
    return () => spinAnimation.current?.stop();
  }, [isPlaying, spin]);
  useEffect(() => {
    if (!lyricsVisible || currentLyricIndex < 0) return;
    lyricListRef.current?.scrollToIndex({ index: currentLyricIndex, animated: true, viewPosition: 0.45 });
  }, [currentLyricIndex, lyricsVisible]);
  useEffect(() => {
    const latestAssistant = [...chatMessages].reverse().find(message => message.role === 'assistant');
    if (!latestAssistant?.content) return;
    const parts = latestAssistant.content.split(/\n+/).map(line => line.trim()).filter(Boolean);
    setAiBubbles(parts);
  }, [chatMessages]);

  const rotation = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const handleMinimize = useCallback(() => {
    minimizePlayer();
    router.replace('/');
  }, [minimizePlayer, router]);
  const handleClose = useCallback(() => {
    closePlayer().finally(() => router.replace('/'));
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
    setChatText('');
    const conversations = await getAllConversations();
    const latest = conversations[0];
    if (latest && latest.id !== chatConversationId) {
      await loadConversation(latest.id);
    }
    await sendChatMessage(text);
  }, [chatConversationId, chatIsStreaming, chatText, loadConversation, sendChatMessage]);
  const handleRadio = useCallback(() => {
    const action = radio.phase === 'call_in_waiting'
      ? radio.continueProgram
      : radio.active ? radio.end : radio.start;
    action();
    setAiBubbles([radio.active ? '今天的 AI 电台先陪你到这里。' : '我选了一首相似氛围的歌，下一首一起听吧。']);
  }, [radio]);

  if (!track) {
    return <View style={styles.empty}><Text style={styles.primaryText}>还没有可播放歌曲</Text></View>;
  }

  const source = backgroundUri ? { uri: backgroundUri } : undefined;
  const player = (
    <View style={[styles.page, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 14) }]}>
      <View style={styles.header}>
        <Pressable style={styles.roundButton} onPress={handleMinimize}><Text style={styles.headerIcon}>⌄</Text></Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.songTitle} numberOfLines={1}>{track.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{track.artist}</Text>
        </View>
        <Pressable style={styles.roundButton} onPress={handleClose}><Text style={styles.headerIcon}>×</Text></Pressable>
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
                  {userAvatarUri ? <Image source={{ uri: userAvatarUri }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>你</Text>}
                </View>
                <View style={[styles.avatar, styles.aiAvatar]}>
                  {aiAvatarUri ? <Image source={{ uri: aiAvatarUri }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>AI</Text>}
                </View>
              </View>
              <Image source={require('../assets/headphones.png')} style={styles.headphones} resizeMode="contain" />
              {!!userBubble && <View style={[styles.bubble, styles.userBubble]}><Text style={styles.bubbleText}>{userBubble}</Text></View>}
              {!!aiBubbles.length && (
                <View style={styles.aiBubbleStack}>
                  {aiBubbles.map((line, index) => <View key={`${index}-${line}`} style={[styles.bubble, styles.aiBubble]}><Text style={styles.bubbleText}>{line}</Text></View>)}
                </View>
              )}
            </View>
            <Text style={styles.listenTime}>一起听了 {formatTime(listenSeconds * 1000)}</Text>
          </View>
          <Pressable style={styles.recordStage} onPress={() => setLyricsVisible(true)}>
            <View style={styles.recordHalo} />
            <View style={styles.ring}>
              {ringUri ? <Image source={{ uri: ringUri }} style={styles.ringImage} resizeMode="contain" /> : null}
            </View>
            <Animated.View pointerEvents="none" style={[styles.vinyl, { transform: [{ rotate: rotation }] }]}>
              <View style={styles.grooveOne} /><View style={styles.grooveTwo} />
              {track.artworkUrl
                ? <Image source={{ uri: track.artworkUrl }} style={styles.cover} />
                : <View style={[styles.cover, styles.coverFallback]}><Text style={styles.coverNote}>♪</Text></View>}
            </Animated.View>
          </Pressable>
        </>
      )}

      <View style={styles.bottom}>
        <View style={styles.featureRow}>
          <Feature icon="词" label="桌面歌词" active={desktopLyricsEnabled} onPress={() => toggleDesktopLyrics().catch(() => undefined)} />
          <Feature icon="◌" label="聊天" active={chatVisible} onPress={() => setChatVisible(value => !value)} />
          <Feature icon="◉" label="AI 电台" active={radio.active} loading={radio.loading || radio.ending} onPress={handleRadio} />
          <Feature icon="⚙" label="设置" onPress={() => setSettingsVisible(true)} />
        </View>
        {chatVisible && (
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
        )}
        {!!chatError && <Text style={styles.chatError}>{chatError}</Text>}
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
          <Control text={order === 'shuffle' ? '⇄' : order === 'repeat-one' ? '①' : '↻'} onPress={cycleOrder} />
          <Control text="◀|" onPress={() => previous().catch(() => undefined)} />
          <Pressable style={styles.playButton} onPress={() => togglePlayPause().catch(() => undefined)}>
            {isBuffering ? <ActivityIndicator color="#fff" /> : <Text style={styles.playText}>{isPlaying ? 'Ⅱ' : '▶'}</Text>}
          </Pressable>
          <Control text="|▶" onPress={() => next().catch(() => undefined)} />
          <Control text="☷" onPress={() => setQueueVisible(true)} />
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>

      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <Pressable style={styles.modalShade} onPress={() => setSettingsVisible(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>一起听设置</Text><Pressable onPress={() => setSettingsVisible(false)}><Text style={styles.closeText}>×</Text></Pressable></View>
            <Text style={styles.sectionLabel}>自定义图片</Text>
            <View style={styles.uploadGrid}>
              <Upload label="背景图" onPress={() => pickImage([9, 16]).then(setBackgroundUri)} />
              <Upload label="我的头像" onPress={() => pickImage([1, 1]).then(setUserAvatarUri)} />
              <Upload label="AI 头像" onPress={() => pickImage([1, 1]).then(setAiAvatarUri)} />
              <Upload label="唱片外圈装饰" onPress={() => pickImage([1, 1]).then(setRingUri)} />
              <Upload label="桌面歌词背景" onPress={() => pickImage([16, 9]).then(uri => uri && setDesktopLyricBackgroundUri(uri))} />
            </View>
            <Pressable style={styles.manageButton} onPress={() => { setSettingsVisible(false); router.push('/music-playlists'); }}>
              <Text style={styles.manageText}>歌单管理</Text><Text style={styles.manageArrow}>›</Text>
            </Pressable>
            {!!desktopLyricBackgroundUri && <Pressable onPress={() => setDesktopLyricBackgroundUri('')}><Text style={styles.clearText}>移除桌面歌词背景</Text></Pressable>}
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
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );

  return source ? <ImageBackground source={source} style={styles.background} blurRadius={8}>{player}</ImageBackground> : player;
}

function Feature({ icon, label, active, loading, onPress }: { icon: string; label: string; active?: boolean; loading?: boolean; onPress: () => void }) {
  return <Pressable style={styles.feature} onPress={onPress}><View style={[styles.featureIcon, active && styles.featureActive]}>{loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.featureIconText}>{icon}</Text>}</View><Text style={styles.featureLabel}>{label}</Text></Pressable>;
}
function Control({ text, onPress }: { text: string; onPress: () => void }) {
  return <Pressable style={styles.control} onPress={onPress}><Text style={styles.controlText}>{text}</Text></Pressable>;
}
function Upload({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable style={styles.upload} onPress={onPress}><Text style={styles.uploadIcon}>＋</Text><Text style={styles.uploadLabel}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: '#090a0c' },
  page: { flex: 1, paddingHorizontal: 20, backgroundColor: 'rgba(6,7,9,.65)' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#090a0c' },
  primaryText: { color: '#fff', fontSize: 17 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center' },
  roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { color: '#d8d8dc', fontSize: 27, lineHeight: 29 },
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
  headphones: { position: 'absolute', zIndex: 3, left: '45%', top: -15, marginLeft: -98, width: 220, height: 128 },
  bubble: { zIndex: 5, maxWidth: 155, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: 'rgba(20,20,24,.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,.08)' },
  userBubble: { position: 'absolute', top: 76, right: 98, borderTopRightRadius: 4 },
  aiBubbleStack: { position: 'absolute', top: 76, left: 98, zIndex: 5, gap: 5, alignItems: 'flex-start' },
  aiBubble: { borderTopLeftRadius: 4 },
  bubbleText: { color: '#ededf0', fontSize: 12, lineHeight: 17 },
  listenTime: { marginTop: 5, color: '#dedee2', fontSize: 13, fontVariant: ['tabular-nums'] },
  lyricsCenter: { flex: 1, minHeight: 330, marginTop: 10, overflow: 'hidden' },
  lyricsHint: { paddingVertical: 6, textAlign: 'center', color: '#777780', fontSize: 11 },
  lyricsContent: { paddingTop: 120, paddingBottom: 150 },
  lyricRow: { minHeight: 48, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  lyricText: { textAlign: 'center', color: '#777780', fontSize: 15, lineHeight: 22 },
  lyricActive: { color: '#f2f2f4', fontFamily: fonts.bold, fontSize: 20, lineHeight: 28 },
  emptyLyrics: { marginTop: 120, textAlign: 'center', color: '#888891', fontSize: 14 },
  recordStage: { flex: 1, minHeight: 245, alignItems: 'center', justifyContent: 'center' },
  recordHalo: { position: 'absolute', width: 330, height: 330, borderRadius: 165, backgroundColor: 'rgba(255,255,255,.035)' },
  ring: { position: 'absolute', width: 306, height: 306, borderRadius: 153, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', backgroundColor: 'rgba(120,120,125,.12)', overflow: 'hidden' },
  ringImage: { width: '100%', height: '100%' },
  vinyl: { width: 232, height: 232, borderRadius: 116, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101114', borderWidth: 12, borderColor: '#1b1c20', shadowColor: '#000', shadowOpacity: .65, shadowRadius: 22, elevation: 12 },
  grooveOne: { position: 'absolute', width: 202, height: 202, borderRadius: 101, borderWidth: 1, borderColor: '#33343a' },
  grooveTwo: { position: 'absolute', width: 184, height: 184, borderRadius: 92, borderWidth: 1, borderColor: '#2b2c31' },
  cover: { width: 154, height: 154, borderRadius: 77 },
  coverFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#496174' },
  coverNote: { color: '#fff', fontSize: 34 },
  bottom: { paddingTop: 2 },
  featureRow: { flexDirection: 'row', justifyContent: 'space-around' },
  feature: { width: 72, alignItems: 'center' },
  featureIcon: { width: 44, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  featureActive: { backgroundColor: 'rgba(255,255,255,.12)' },
  featureIconText: { color: '#c9c9cf', fontSize: 21 },
  featureLabel: { marginTop: 1, color: '#96969e', fontSize: 10 },
  chatRow: { height: 44, flexDirection: 'row', gap: 8, marginTop: 8 },
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
  controlText: { color: '#d2d2d7', fontSize: 24 },
  playButton: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.13)' },
  playText: { color: '#fff', fontSize: 27 },
  error: { color: '#ff9e9e', textAlign: 'center', fontSize: 11 },
  modalShade: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.48)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, backgroundColor: '#17181c' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: '#f0f0f2', fontSize: 17, fontFamily: fonts.bold },
  closeText: { color: '#d9d9dd', fontSize: 28 },
  sectionLabel: { marginTop: 18, marginBottom: 10, color: '#a0a0a7', fontSize: 12 },
  uploadGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  upload: { width: '48%', minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13, padding: 10, backgroundColor: 'rgba(255,255,255,.06)' },
  uploadIcon: { color: '#e7e7ea', fontSize: 20 },
  uploadLabel: { color: '#d5d5da', fontSize: 12 },
  manageButton: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, borderRadius: 13, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,.06)' },
  manageText: { color: '#e1e1e5', fontSize: 13 },
  manageArrow: { color: '#98989f', fontSize: 24 },
  clearText: { color: '#e79b9b', textAlign: 'center', marginTop: 16, fontSize: 12 },
  queueSheet: { maxHeight: '70%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, backgroundColor: '#17181c' },
  queueRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.07)' },
  queueRowActive: { backgroundColor: 'rgba(255,255,255,.06)' },
  queueIndex: { width: 34, color: '#999aa2', textAlign: 'center' },
  queueText: { flex: 1, paddingLeft: 8 },
  queueTitle: { color: '#ededf0', fontSize: 14 },
  queueArtist: { color: '#8f8f97', fontSize: 12, marginTop: 4 },
});
