import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
  useWindowDimensions,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Download,
  Edit3,
  FileText,
  FolderPlus,
  Mail,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react-native';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';

import { Conversation, IncomingLetter } from '../src/types';
import {
  addConversationToChatGroup,
  createChatGroup,
  deleteChatGroup,
  deleteConversation,
  getAllConversationArtifacts,
  getAllConversations,
  getAllIncomingLetters,
  getChatGroupsWithConversations,
  getGeneratedPictureGalleryItems,
  getMessageByConversationAndId,
  removeConversationFromChatGroup,
  searchMessages,
  updateChatGroup,
  updateConversation,
  updateMessageGeneratedPics,
  type ChatGroupWithConversations,
  type ChatSearchResult,
  type ConversationArtifactListItem,
  type GeneratedPictureGalleryItem,
} from '../src/db/operations';
import { useChatStore } from '../src/stores/chat';
import { deleteGeneratedImageFile } from '../src/services/imageGeneration';
import { deleteConversationVoiceFiles } from '../src/services/voiceFiles';
import {
  downloadConversationArtifactFile,
  readConversationArtifact,
  replaceConversationArtifactContent,
} from '../src/services/conversationArtifacts';
import { pickAndImportSillyTavernChats } from '../src/services/sillyTavernImport';

let colors = lightColors;

type HistorySection = 'menu' | 'chats' | 'groups' | 'artifacts' | 'pictures' | 'letters';
type GroupEditorMode = 'create' | 'edit';
type SearchScope = 'global' | 'current';

const GALLERY_COLUMNS = 3;
const GALLERY_GAP = 8;

const MENU_ITEMS: Array<{
  key: Exclude<HistorySection, 'menu'> | 'new';
  label: string;
  icon: ImageSourcePropType;
  accent?: boolean;
}> = [
  { key: 'new', label: 'New chat', icon: require('../assets/newchats.png'), accent: true },
  { key: 'chats', label: 'Chats', icon: require('../assets/chats.png') },
  { key: 'groups', label: 'Groups', icon: require('../assets/groups.png') },
  { key: 'artifacts', label: 'Artifacts', icon: require('../assets/artifacts.png') },
  { key: 'pictures', label: 'Pictures', icon: require('../assets/pictures.png') },
  { key: 'letters', label: 'Letters', icon: require('../assets/letters.png') },
];

export default function HistoryScreen() {
  colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const router = useRouter();
  const drawerWidth = useMemo(() => Math.min(window.width * 0.86, 460), [window.width]);
  const galleryItemSize = useMemo(
    () => Math.floor((drawerWidth - 32 - GALLERY_GAP * (GALLERY_COLUMNS - 1)) / GALLERY_COLUMNS),
    [drawerWidth]
  );
  styles = useMemo(
    () => createStyles(colors, galleryItemSize, window.height, drawerWidth),
    [colors, galleryItemSize, window.height, drawerWidth]
  );

  const [section, setSection] = useState<HistorySection>('menu');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [recentMenuConv, setRecentMenuConv] = useState<Conversation | null>(null);
  const [editingConv, setEditingConv] = useState<Conversation | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('global');
  const [searchResults, setSearchResults] = useState<ChatSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [groups, setGroups] = useState<ChatGroupWithConversations[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupEditorMode, setGroupEditorMode] = useState<GroupEditorMode>('create');
  const [groupEditorVisible, setGroupEditorVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [addChatGroupId, setAddChatGroupId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ConversationArtifactListItem[]>([]);
  const [previewArtifact, setPreviewArtifact] = useState<ConversationArtifactListItem | null>(null);
  const [artifactContent, setArtifactContent] = useState('');
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactSaving, setArtifactSaving] = useState(false);
  const [artifactDownloading, setArtifactDownloading] = useState(false);
  const [galleryItems, setGalleryItems] = useState<GeneratedPictureGalleryItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [previewPicture, setPreviewPicture] = useState<GeneratedPictureGalleryItem | null>(null);
  const [deletingGalleryItemId, setDeletingGalleryItemId] = useState<string | null>(null);
  const [letters, setLetters] = useState<IncomingLetter[]>([]);
  const [lettersLoading, setLettersLoading] = useState(false);
  const [importingSillyTavern, setImportingSillyTavern] = useState(false);
  const [previewLetter, setPreviewLetter] = useState<IncomingLetter | null>(null);

  const {
    conversationId,
    messages,
    loadConversation,
    loadConversationAroundMessage,
    newConversation,
    deleteGeneratedPictureOnly,
  } = useChatStore();

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || groups[0] || null;
  const addChatGroup = groups.find((group) => group.id === addChatGroupId) || null;
  const addChatCandidates = useMemo(() => {
    if (!addChatGroup) return [];
    const existing = new Set(addChatGroup.conversations.map((conversation) => conversation.id));
    return conversations.filter((conversation) => !existing.has(conversation.id));
  }, [addChatGroup, conversations]);
  const isSearchActive = searchText.trim().length > 0;

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [])
  );

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  useEffect(() => {
    const keyword = searchText.trim();
    if (!keyword) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      if (searchScope === 'current' && !conversationId) {
        setSearchResults([]);
        setSearchError('请先打开一个对话，或切换到全部对话搜索');
        setSearching(false);
        return;
      }

      setSearching(true);
      setSearchError(null);
      try {
        const results = await searchMessages(keyword, {
          conversationId: searchScope === 'current' ? conversationId || undefined : undefined,
          limit: 100,
        });
        setSearchResults(results);
      } catch (error: any) {
        setSearchResults([]);
        setSearchError(error?.message || '搜索失败');
      } finally {
        setSearching(false);
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [conversationId, searchScope, searchText]);

  async function loadAll() {
    await Promise.all([
      loadList(),
      loadGroups(),
      loadArtifacts(),
      loadGallery(),
      loadLetters(),
    ]);
  }

  async function loadList() {
    const list = await getAllConversations();
    setConversations(list);
  }

  async function loadGroups() {
    const list = await getChatGroupsWithConversations();
    setGroups(list);
  }

  async function loadArtifacts() {
    const list = await getAllConversationArtifacts();
    setArtifacts(list);
  }

  async function loadGallery() {
    setGalleryLoading(true);
    try {
      const list = await getGeneratedPictureGalleryItems();
      setGalleryItems(list);
    } finally {
      setGalleryLoading(false);
    }
  }

  async function loadLetters() {
    setLettersLoading(true);
    try {
      const list = await getAllIncomingLetters();
      setLetters(list);
    } finally {
      setLettersLoading(false);
    }
  }

  async function handleOpen(conv: Conversation) {
    await loadConversation(conv.id);
    router.back();
  }

  async function handleOpenSearchResult(result: ChatSearchResult) {
    await loadConversationAroundMessage(result.conversationId, result.messageId);
    router.back();
  }

  async function handleOpenGalleryItem(item: GeneratedPictureGalleryItem) {
    setPreviewPicture(null);
    await loadConversationAroundMessage(item.conversationId, item.messageId);
    router.back();
  }

  async function handleOpenArtifactConversation(item: ConversationArtifactListItem) {
    setPreviewArtifact(null);
    await loadConversation(item.conversationId);
    router.back();
  }

  async function handlePreviewArtifact(item: ConversationArtifactListItem) {
    setPreviewArtifact(item);
    setArtifactContent('');
    setArtifactLoading(true);
    try {
      const result = await readConversationArtifact(item.conversationId, item.id);
      setArtifactContent(result.version.content);
    } catch (error: any) {
      Alert.alert('打开失败', error?.message || '无法读取这个 Artifact');
      setPreviewArtifact(null);
    } finally {
      setArtifactLoading(false);
    }
  }

  async function handleSaveArtifact() {
    if (!previewArtifact) return;
    setArtifactSaving(true);
    try {
      await replaceConversationArtifactContent({
        conversationId: previewArtifact.conversationId,
        artifactId: previewArtifact.id,
        content: artifactContent,
        createdBy: 'user',
      });
      await loadArtifacts();
      Alert.alert('已保存', 'Artifact 已保存为新版本。');
    } catch (error: any) {
      Alert.alert('保存失败', error?.message || '无法保存这个 Artifact');
    } finally {
      setArtifactSaving(false);
    }
  }

  async function handleDownloadArtifact() {
    if (!previewArtifact) return;
    setArtifactDownloading(true);
    try {
      const result = await downloadConversationArtifactFile({
        artifact: previewArtifact,
        content: artifactContent,
      });
      if (!result.shared) {
        Alert.alert('已保存', `Artifact 已保存到应用文件：${result.fileName}`);
      }
    } catch (error: any) {
      Alert.alert('下载失败', error?.message || '无法下载这个 Artifact');
    } finally {
      setArtifactDownloading(false);
    }
  }

  function handleNewChat() {
    newConversation();
    router.back();
  }

  async function handleImportSillyTavern() {
    if (importingSillyTavern) return;
    setImportingSillyTavern(true);
    try {
      const imported = await pickAndImportSillyTavernChats();
      if (imported.length === 0) return;
      await loadList();
      const totalMessages = imported.reduce((sum, item) => sum + item.messageCount, 0);
      Alert.alert(
        '导入完成',
        `已导入 ${imported.length} 个聊天窗口，共 ${totalMessages} 条消息。`
      );
    } catch (error: any) {
      Alert.alert('导入失败', error?.message || '无法导入 SillyTavern 聊天记录');
    } finally {
      setImportingSillyTavern(false);
    }
  }

  function handleLongPress(conv: Conversation) {
    setEditingConv(conv);
    setEditTitle(conv.title);
  }

  function handleRecentLongPress(conv: Conversation) {
    setRecentMenuConv(conv);
  }

  async function handleArchiveFromRecents(conv: Conversation) {
    setRecentMenuConv(null);
    await updateConversation(conv.id, { archivedFromRecents: true });
    await loadList();
  }

  async function handleSaveTitle() {
    if (!editingConv) return;
    await updateConversation(editingConv.id, { title: editTitle.trim(), updatedAt: Date.now() });
    setEditingConv(null);
    await Promise.all([loadList(), loadGroups(), loadArtifacts()]);
  }

  function handleDelete(conv: Conversation) {
    Alert.alert('删除对话', `确定删除「${conv.title || '新对话'}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteConversationVoiceFiles(conv.id);
          await deleteConversation(conv.id);
          if (conv.id === conversationId) {
            newConversation();
          }
          await loadAll();
        },
      },
    ]);
  }

  function openCreateGroup() {
    setGroupEditorMode('create');
    setGroupName('');
    setGroupEditorVisible(true);
  }

  function openEditGroup(group: ChatGroupWithConversations) {
    setGroupEditorMode('edit');
    setGroupName(group.name);
    setSelectedGroupId(group.id);
    setGroupEditorVisible(true);
  }

  async function saveGroup() {
    const name = groupName.trim();
    if (!name) return;
    const now = Date.now();
    if (groupEditorMode === 'create') {
      const id = randomUUID();
      await createChatGroup({ id, name, createdAt: now, updatedAt: now });
      setSelectedGroupId(id);
    } else if (selectedGroup) {
      await updateChatGroup(selectedGroup.id, { name, updatedAt: now });
    }
    setGroupEditorVisible(false);
    setGroupName('');
    await loadGroups();
  }

  function handleDeleteGroup(group: ChatGroupWithConversations) {
    Alert.alert('删除分组', `确定删除「${group.name}」？对话不会被删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteChatGroup(group.id);
          if (selectedGroupId === group.id) setSelectedGroupId(null);
          await loadGroups();
        },
      },
    ]);
  }

  async function handleAddConversationToGroup(groupId: string, conv: Conversation) {
    await addConversationToChatGroup(groupId, conv.id);
    await loadGroups();
  }

  async function handleRemoveConversationFromGroup(groupId: string, conv: Conversation) {
    await removeConversationFromChatGroup(groupId, conv.id);
    await loadGroups();
  }

  async function deleteGalleryItem(item: GeneratedPictureGalleryItem) {
    setDeletingGalleryItemId(item.id);
    try {
      const loadedMessage =
        item.conversationId === conversationId
          ? messages.find((message) => message.id === item.messageId)
          : undefined;
      const loadedPicture = loadedMessage?.generatedPics?.find(
        (picture) => picture.tokenIndex === item.tokenIndex
      );

      if (loadedMessage && loadedPicture) {
        await deleteGeneratedPictureOnly(item.messageId, item.tokenIndex);
      } else {
        const message = await getMessageByConversationAndId(item.conversationId, item.messageId);
        const existing = message?.generatedPics?.find(
          (picture) => picture.tokenIndex === item.tokenIndex
        );
        if (!message?.generatedPics || !existing) {
          setGalleryItems((current) => current.filter((picture) => picture.id !== item.id));
          setPreviewPicture((current) => (current?.id === item.id ? null : current));
          return;
        }

        await deleteGeneratedImageFile(existing.imageUri);
        const nextPics = message.generatedPics.map((picture) =>
          picture.tokenIndex === item.tokenIndex
            ? {
                ...picture,
                status: 'deleted' as const,
                imageUri: undefined,
                errorMessage: undefined,
                updatedAt: Date.now(),
              }
            : picture
        );
        await updateMessageGeneratedPics(item.messageId, nextPics);
      }

      setGalleryItems((current) => current.filter((picture) => picture.id !== item.id));
      setPreviewPicture((current) => (current?.id === item.id ? null : current));
    } catch (error: any) {
      Alert.alert('删除失败', error?.message || '无法删除这张图片');
    } finally {
      setDeletingGalleryItemId(null);
    }
  }

  function handleDeleteGalleryItem(item: GeneratedPictureGalleryItem) {
    Alert.alert('删除图片', '确定删除这张生成图吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void deleteGalleryItem(item);
        },
      },
    ]);
  }

  function formatTime(ts: number) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function roleLabel(role: ChatSearchResult['role']) {
    if (role === 'user') return '你';
    if (role === 'assistant') return 'AI';
    if (role === 'system') return '系统';
    return '工具';
  }

  function snippet(text: string, max = 90) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max)}...` : clean;
  }

  function formatBytes(size: number) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function renderMenu() {
    const recent = conversations.filter((conversation) => !conversation.archivedFromRecents).slice(0, 5);
    return (
      <View style={[styles.menuPane, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.menuTop}>
          <Text style={styles.brandText}>Claude</Text>
          <View style={styles.menuList}>
            {MENU_ITEMS.map((item) => {
              const active = item.key !== 'new' && section === item.key;
              return (
                <Pressable
                  key={item.key}
                  style={styles.menuItem}
                  onPress={() => {
                    if (item.key === 'new') handleNewChat();
                    else setSection(item.key);
                  }}
                >
                  <Image
                    source={item.icon}
                    style={[
                      styles.menuIcon,
                      { tintColor: item.accent ? colors.primary : colors.textSecondary },
                      active && styles.menuIconActive,
                    ]}
                    resizeMode="contain"
                  />
                  <Text
                    style={[
                      styles.menuItemText,
                      item.accent && styles.menuItemAccent,
                      active && styles.menuItemActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.recentsSection}>
          <View style={styles.recentsDivider} />
          <Text style={styles.recentsTitle}>Recents</Text>
          <View style={styles.recentsList}>
            {recent.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => handleOpen(item)}
                onLongPress={() => handleRecentLongPress(item)}
                style={styles.recentItem}
              >
                <Text style={styles.recentText} numberOfLines={1}>
                  {item.title || 'Untitled'}
                </Text>
              </Pressable>
            ))}
            {recent.length === 0 && <Text style={styles.emptyMenuText}>No recent chats</Text>}
          </View>
        </View>
      </View>
    );
  }

  function renderSectionHeader(title: string, action?: React.ReactNode) {
    return (
      <View style={[styles.sectionHeader, { paddingTop: insets.top + 10 }]}>
        <Pressable style={styles.headerIconButton} onPress={() => setSection('menu')}>
          <ChevronLeft size={28} color={colors.text} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.headerActionSlot}>{action}</View>
      </View>
    );
  }

  function renderConversationRow(item: Conversation, options?: { showDelete?: boolean }) {
    const isActive = item.id === conversationId;
    return (
      <Pressable
        style={[styles.listItem, isActive && styles.listItemActive]}
        onPress={() => handleOpen(item)}
        onLongPress={() => handleLongPress(item)}
      >
        <View style={styles.itemContent}>
          <Text style={[styles.itemTitle, isActive && styles.itemTitleActive]} numberOfLines={1}>
            {item.title || '新对话'}
          </Text>
          <Text style={[styles.itemMeta, isActive && styles.itemMetaActive]} numberOfLines={1}>
            {item.model || 'model'} · {formatTime(item.createdAt)}
          </Text>
        </View>
        {options?.showDelete !== false && (
          <Pressable style={styles.iconActionButton} onPress={() => handleDelete(item)}>
            <Trash2 size={18} color={isActive ? colors.primary : colors.textTertiary} strokeWidth={2} />
          </Pressable>
        )}
      </Pressable>
    );
  }

  function renderChats() {
    return (
      <View style={styles.screen}>
        {renderSectionHeader(
          'Chats',
          <Pressable
            style={styles.headerIconButton}
            onPress={handleImportSillyTavern}
            disabled={importingSillyTavern}
            accessibilityLabel="导入 SillyTavern 聊天"
          >
            {importingSillyTavern ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Upload size={22} color={colors.text} strokeWidth={2.1} />
            )}
          </Pressable>
        )}
        <View style={styles.searchPanel}>
          <Search size={19} color={colors.textTertiary} strokeWidth={2} />
          <TextInput
            style={styles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="搜索所有对话"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
          />
          {searching ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : searchText ? (
            <Pressable onPress={() => setSearchText('')}>
              <X size={18} color={colors.textTertiary} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.searchScopeRow}>
          <Pressable
            style={[styles.scopeButton, searchScope === 'global' && styles.scopeButtonActive]}
            onPress={() => setSearchScope('global')}
          >
            <Text style={[styles.scopeButtonText, searchScope === 'global' && styles.scopeButtonTextActive]}>
              全部对话
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.scopeButton,
              searchScope === 'current' && styles.scopeButtonActive,
              !conversationId && styles.scopeButtonDisabled,
            ]}
            onPress={() => setSearchScope('current')}
          >
            <Text
              style={[
                styles.scopeButtonText,
                searchScope === 'current' && styles.scopeButtonTextActive,
                !conversationId && styles.scopeButtonTextDisabled,
              ]}
            >
              当前对话
            </Text>
          </Pressable>
        </View>
        {isSearchActive ? (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.messageId}
            renderItem={({ item }) => (
              <Pressable style={styles.listItem} onPress={() => handleOpenSearchResult(item)}>
                <View style={styles.itemContent}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {item.conversationTitle || '新对话'}
                    </Text>
                    <Text style={styles.itemMeta}>{formatTime(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.itemMeta}>{roleLabel(item.role)}</Text>
                  <Text style={styles.itemSnippet} numberOfLines={2}>
                    {snippet(item.content) || '（空消息）'}
                  </Text>
                </View>
              </Pressable>
            )}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <EmptyState text={searchError || (searching ? '正在搜索...' : '没有搜索结果')} />
            }
          />
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => renderConversationRow(item)}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<EmptyState text="暂无历史对话" />}
          />
        )}
      </View>
    );
  }

  function renderGroups() {
    return (
      <View style={styles.screen}>
        {renderSectionHeader(
          'Groups',
          <Pressable style={styles.headerIconButton} onPress={openCreateGroup}>
            <FolderPlus size={22} color={colors.text} strokeWidth={2.1} />
          </Pressable>
        )}
        <ScrollView contentContainerStyle={styles.groupsBody}>
          <View style={styles.groupSelector}>
            {groups.map((group) => {
              const active = selectedGroup?.id === group.id;
              return (
                <Pressable
                  key={group.id}
                  style={[styles.groupChip, active && styles.groupChipActive]}
                  onPress={() => setSelectedGroupId(group.id)}
                >
                  <Text style={[styles.groupChipText, active && styles.groupChipTextActive]} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <Text style={[styles.groupChipCount, active && styles.groupChipTextActive]}>
                    {group.conversations.length}
                  </Text>
                </Pressable>
              );
            })}
            {groups.length === 0 && <EmptyState text="还没有分组" compact />}
          </View>

          {selectedGroup && (
            <View style={styles.groupDetail}>
              <View style={styles.groupDetailHeader}>
                <View style={styles.itemContent}>
                  <Text style={styles.groupTitle}>{selectedGroup.name}</Text>
                  <Text style={styles.itemMeta}>{selectedGroup.conversations.length} chats</Text>
                </View>
                <Pressable style={styles.iconActionButton} onPress={() => openEditGroup(selectedGroup)}>
                  <Edit3 size={18} color={colors.textSecondary} strokeWidth={2} />
                </Pressable>
                <Pressable style={styles.iconActionButton} onPress={() => handleDeleteGroup(selectedGroup)}>
                  <Trash2 size={18} color={colors.danger} strokeWidth={2} />
                </Pressable>
              </View>

              <Pressable style={styles.addChatButton} onPress={() => setAddChatGroupId(selectedGroup.id)}>
                <Plus size={18} color="#FFFFFF" strokeWidth={2.2} />
                <Text style={styles.addChatButtonText}>添加 chats</Text>
              </Pressable>

              {selectedGroup.conversations.map((conv) => (
                <View key={conv.id} style={styles.groupMemberRow}>
                  <Pressable style={styles.groupMemberMain} onPress={() => handleOpen(conv)}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{conv.title || '新对话'}</Text>
                    <Text style={styles.itemMeta}>{formatTime(conv.createdAt)}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.iconActionButton}
                    onPress={() => handleRemoveConversationFromGroup(selectedGroup.id, conv)}
                  >
                    <X size={18} color={colors.textTertiary} strokeWidth={2.2} />
                  </Pressable>
                </View>
              ))}
              {selectedGroup.conversations.length === 0 && <EmptyState text="这个分组还没有 chats" compact />}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  function renderArtifacts() {
    return (
      <View style={styles.screen}>
        {renderSectionHeader('Artifacts')}
        <FlatList
          data={artifacts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable style={styles.listItem} onPress={() => handlePreviewArtifact(item)}>
              <FileText size={22} color={colors.textSecondary} strokeWidth={2} />
              <View style={styles.itemContent}>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.name || 'Untitled'}</Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {item.kind} · {formatBytes(item.size)} · {formatTime(item.updatedAt)}
                </Text>
                <Text style={styles.itemSnippet} numberOfLines={1}>
                  {item.conversationTitle || '新对话'}
                </Text>
              </View>
            </Pressable>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState text="暂无 Artifacts" />}
        />
      </View>
    );
  }

  function renderPictures() {
    return (
      <View style={styles.screen}>
        {renderSectionHeader('Pictures')}
        <FlatList
          key="gallery"
          data={galleryItems}
          numColumns={GALLERY_COLUMNS}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.galleryItem}
              onPress={() => setPreviewPicture(item)}
              onLongPress={() => handleOpenGalleryItem(item)}
            >
              <Image source={{ uri: item.imageUri }} style={styles.galleryImage} resizeMode="cover" />
              <View style={styles.galleryCaption}>
                <Text style={styles.galleryTitle} numberOfLines={1}>
                  {item.conversationTitle || '新对话'}
                </Text>
              </View>
            </Pressable>
          )}
          contentContainerStyle={styles.galleryList}
          columnWrapperStyle={styles.galleryRow}
          ListEmptyComponent={
            <View style={styles.empty}>
              {galleryLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.emptyText}>暂无生成图</Text>
              )}
            </View>
          }
        />
      </View>
    );
  }

  function renderLetters() {
    return (
      <View style={styles.screen}>
        {renderSectionHeader('Letters')}
        <FlatList
          data={letters}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable style={styles.listItem} onPress={() => setPreviewLetter(item)}>
              <Mail size={22} color={colors.textSecondary} strokeWidth={2} />
              <View style={styles.itemContent}>
                <View style={styles.rowBetween}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {item.title || item.occasionTitle || '来信'}
                  </Text>
                  <Text style={styles.itemMeta}>{item.dateKey}</Text>
                </View>
                <Text style={styles.itemMeta}>
                  {item.status === 'ready' ? '已生成' : item.status === 'failed' ? '生成失败' : '生成中'}
                </Text>
                <Text style={styles.itemSnippet} numberOfLines={3}>
                  {item.content || item.errorMessage || '还没有正文'}
                </Text>
              </View>
            </Pressable>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              {lettersLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.emptyText}>暂无来信</Text>
              )}
            </View>
          }
        />
      </View>
    );
  }

  function renderActiveSection() {
    if (section === 'menu') return renderMenu();
    if (section === 'chats') return renderChats();
    if (section === 'groups') return renderGroups();
    if (section === 'artifacts') return renderArtifacts();
    if (section === 'pictures') return renderPictures();
    return renderLetters();
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.dimLayer} onPress={() => router.back()} />
      <View style={styles.drawer}>{renderActiveSection()}</View>

      <Modal
        visible={!!recentMenuConv}
        transparent
        animationType="fade"
        onRequestClose={() => setRecentMenuConv(null)}
      >
        <Pressable style={styles.recentMenuOverlay} onPress={() => setRecentMenuConv(null)}>
          <View style={styles.recentMenu} onStartShouldSetResponder={() => true}>
            <Pressable
              style={({ pressed }) => [styles.recentMenuAction, pressed && styles.recentMenuActionPressed]}
              onPress={() => {
                const conv = recentMenuConv;
                setRecentMenuConv(null);
                if (conv) handleLongPress(conv);
              }}
            >
              <Text style={styles.recentMenuActionText}>重命名</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.recentMenuAction, pressed && styles.recentMenuActionPressed]}
              onPress={() => recentMenuConv && handleArchiveFromRecents(recentMenuConv)}
            >
              <Text style={styles.recentMenuActionText}>归档</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.recentMenuAction, pressed && styles.recentMenuActionPressed]}
              onPress={() => {
                const conv = recentMenuConv;
                setRecentMenuConv(null);
                if (conv) handleDelete(conv);
              }}
            >
              <Text style={[styles.recentMenuActionText, styles.recentMenuDeleteText]}>删除</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.recentMenuAction, pressed && styles.recentMenuActionPressed]}
              onPress={() => setRecentMenuConv(null)}
            >
              <Text style={styles.recentMenuCancelText}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!editingConv} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setEditingConv(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>编辑标题</Text>
            <TextInput
              style={styles.modalInput}
              value={editTitle}
              onChangeText={setEditTitle}
              autoFocus
              selectTextOnFocus
              placeholder="输入对话标题"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setEditingConv(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveTitle}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={groupEditorVisible} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setGroupEditorVisible(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{groupEditorMode === 'create' ? '新建分组' : '编辑分组'}</Text>
            <TextInput
              style={styles.modalInput}
              value={groupName}
              onChangeText={setGroupName}
              autoFocus
              selectTextOnFocus
              placeholder="分组名称"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setGroupEditorVisible(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, !groupName.trim() && styles.modalConfirmDisabled]}
                onPress={saveGroup}
                disabled={!groupName.trim()}
              >
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!addChatGroupId} transparent animationType="slide" onRequestClose={() => setAddChatGroupId(null)}>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setAddChatGroupId(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>添加 chats</Text>
              <Pressable style={styles.iconActionButton} onPress={() => setAddChatGroupId(null)}>
                <X size={20} color={colors.textSecondary} strokeWidth={2.2} />
              </Pressable>
            </View>
            <FlatList
              data={addChatCandidates}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.addCandidateRow}
                  onPress={() => {
                    if (addChatGroupId) {
                      handleAddConversationToGroup(addChatGroupId, item).catch(() => undefined);
                    }
                  }}
                >
                  <Text style={styles.itemTitle} numberOfLines={1}>{item.title || '新对话'}</Text>
                  <Plus size={18} color={colors.primary} strokeWidth={2.2} />
                </Pressable>
              )}
              ListEmptyComponent={<EmptyState text="没有可添加的 chats" compact />}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={!!previewArtifact} transparent animationType="fade" onRequestClose={() => setPreviewArtifact(null)}>
        <View style={styles.previewOverlay}>
          <Pressable style={styles.previewBackdrop} onPress={() => setPreviewArtifact(null)} />
          <View style={styles.artifactPreviewPanel}>
            {previewArtifact && (
              <>
                <View style={styles.artifactPreviewHeader}>
                  <View style={styles.itemContent}>
                    <Text style={styles.previewTitle} numberOfLines={1}>
                      {previewArtifact.name || 'Untitled'}
                    </Text>
                    <Text style={styles.previewPrompt} numberOfLines={1}>
                      {previewArtifact.kind} · {formatBytes(previewArtifact.size)} · {previewArtifact.conversationTitle || '新对话'}
                    </Text>
                  </View>
                  <Pressable style={styles.iconActionButton} onPress={() => setPreviewArtifact(null)}>
                    <X size={20} color={colors.textSecondary} strokeWidth={2.2} />
                  </Pressable>
                </View>

                {artifactLoading ? (
                  <View style={styles.artifactLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.emptyText}>正在读取...</Text>
                  </View>
                ) : (
                  <TextInput
                    style={styles.artifactEditor}
                    value={artifactContent}
                    onChangeText={setArtifactContent}
                    multiline
                    textAlignVertical="top"
                    autoCorrect={false}
                    autoCapitalize="none"
                    placeholder="Artifact 内容"
                    placeholderTextColor={colors.textTertiary}
                  />
                )}

                <View style={styles.previewActions}>
                  <Pressable style={styles.previewCancel} onPress={() => setPreviewArtifact(null)}>
                    <Text style={styles.previewCancelText}>关闭</Text>
                  </Pressable>
                  <Pressable
                    style={styles.previewCancel}
                    onPress={() => handleOpenArtifactConversation(previewArtifact)}
                  >
                    <Text style={styles.previewCancelText}>打开对话</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.previewCancel,
                      (artifactLoading || artifactDownloading) && styles.previewButtonDisabled,
                    ]}
                    onPress={handleDownloadArtifact}
                    disabled={artifactLoading || artifactDownloading}
                  >
                    {artifactDownloading ? (
                      <ActivityIndicator size="small" color={colors.textSecondary} />
                    ) : (
                      <View style={styles.previewButtonContent}>
                        <Download size={16} color={colors.textSecondary} strokeWidth={2.2} />
                        <Text style={styles.previewCancelText}>下载</Text>
                      </View>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.previewOpen, (artifactLoading || artifactSaving || artifactDownloading) && styles.previewButtonDisabled]}
                    onPress={handleSaveArtifact}
                    disabled={artifactLoading || artifactSaving || artifactDownloading}
                  >
                    {artifactSaving ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.previewOpenText}>保存</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!previewPicture} transparent animationType="fade" onRequestClose={() => setPreviewPicture(null)}>
        <View style={styles.previewOverlay}>
          <Pressable style={styles.previewBackdrop} onPress={() => setPreviewPicture(null)} />
          <View style={styles.previewPanel}>
            {previewPicture && (
              <>
                <Image source={{ uri: previewPicture.imageUri }} style={styles.previewImage} resizeMode="contain" />
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {previewPicture.conversationTitle || '新对话'}
                </Text>
                <Text style={styles.previewPrompt} numberOfLines={2}>
                  {snippet(previewPicture.prompt, 72) || 'AI 生成图片'}
                </Text>
                <View style={styles.previewActions}>
                  <Pressable
                    style={[
                      styles.previewDelete,
                      deletingGalleryItemId === previewPicture.id && styles.previewButtonDisabled,
                    ]}
                    onPress={() => handleDeleteGalleryItem(previewPicture)}
                    disabled={deletingGalleryItemId === previewPicture.id}
                  >
                    {deletingGalleryItemId === previewPicture.id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Text style={styles.previewDeleteText}>删除图片</Text>
                    )}
                  </Pressable>
                  <Pressable style={styles.previewCancel} onPress={() => setPreviewPicture(null)}>
                    <Text style={styles.previewCancelText}>关闭</Text>
                  </Pressable>
                  <Pressable style={styles.previewOpen} onPress={() => handleOpenGalleryItem(previewPicture)}>
                    <Text style={styles.previewOpenText}>打开对话</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!previewLetter} transparent animationType="fade" onRequestClose={() => setPreviewLetter(null)}>
        <View style={styles.previewOverlay}>
          <Pressable style={styles.previewBackdrop} onPress={() => setPreviewLetter(null)} />
          <View style={styles.letterPreviewPanel}>
            {previewLetter && (
              <>
                <Text style={styles.previewTitle}>
                  {previewLetter.title || previewLetter.occasionTitle || '来信'}
                </Text>
                <Text style={styles.previewPrompt}>
                  {previewLetter.dateKey} · {previewLetter.occasionTitle || '收信日'}
                </Text>
                <FlatList
                  data={[previewLetter.content || previewLetter.errorMessage || '还没有正文']}
                  keyExtractor={(_, index) => String(index)}
                  renderItem={({ item }) => (
                    <Text selectable style={styles.letterPreviewContent}>
                      {item}
                    </Text>
                  )}
                  contentContainerStyle={styles.letterPreviewBody}
                />
                <View style={styles.previewActions}>
                  <Pressable style={styles.previewCancel} onPress={() => setPreviewLetter(null)}>
                    <Text style={styles.previewCancelText}>关闭</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function EmptyState({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const createStyles = (
  colors: ThemeColors,
  galleryItemSize: number,
  windowHeight: number,
  drawerWidth: number
) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  dimLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  drawer: {
    flex: 1,
    width: drawerWidth,
    backgroundColor: colors.background,
    borderTopRightRadius: 26,
    borderBottomRightRadius: 26,
    overflow: 'hidden',
  },
  menuPane: {
    flex: 1,
    paddingHorizontal: 24,
  },
  menuTop: {
    justifyContent: 'flex-start',
  },
  brandText: {
    fontSize: 34,
    lineHeight: 52,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 14,
  },
  menuList: {
    gap: 10,
  },
  menuItem: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  menuIcon: {
    width: 23,
    height: 23,
  },
  menuIconActive: {
    tintColor: colors.text,
  },
  menuItemText: {
    flex: 1,
    fontSize: 20,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  menuItemAccent: {
    color: colors.primary,
  },
  menuItemActive: {
    color: colors.text,
    fontWeight: '400',
  },
  recentsSection: {
    flex: 1,
    marginTop: 28,
  },
  recentsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  recentsTitle: {
    fontSize: 20,
    fontWeight: '400',
    color: colors.textTertiary,
    marginBottom: 10,
  },
  recentsList: {
    gap: 14,
  },
  recentItem: {
    minHeight: 24,
    justifyContent: 'center',
  },
  recentText: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.text,
  },
  emptyMenuText: {
    fontSize: 16,
    color: colors.textTertiary,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sectionHeader: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  headerActionSlot: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchPanel: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    paddingHorizontal: 13,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 9,
  },
  searchScopeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scopeButton: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scopeButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  scopeButtonDisabled: {
    opacity: 0.52,
  },
  scopeButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  scopeButtonTextActive: {
    color: colors.primary,
  },
  scopeButtonTextDisabled: {
    color: colors.textTertiary,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  listItem: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listItemActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  itemContent: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemTitle: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  itemTitleActive: {
    color: colors.text,
    fontWeight: '800',
  },
  itemMeta: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  itemMetaActive: {
    color: colors.primary,
  },
  itemSnippet: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  iconActionButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupsBody: {
    padding: 16,
    paddingBottom: 28,
  },
  groupSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  groupChip: {
    maxWidth: '100%',
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  groupChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  groupChipText: {
    maxWidth: 210,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  groupChipTextActive: {
    color: colors.primary,
  },
  groupChipCount: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textTertiary,
  },
  groupDetail: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  groupDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  groupTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.text,
  },
  addChatButton: {
    minHeight: 42,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginBottom: 12,
  },
  addChatButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  groupMemberRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  groupMemberMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  galleryList: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },
  galleryRow: {
    justifyContent: 'space-between',
    marginBottom: GALLERY_GAP,
  },
  galleryItem: {
    width: galleryItemSize,
    height: galleryItemSize,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  galleryImage: {
    width: galleryItemSize,
    height: galleryItemSize,
  },
  galleryCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 7,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  galleryTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 120,
  },
  emptyCompact: {
    width: '100%',
    paddingTop: 28,
    paddingBottom: 18,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(20,20,19,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  recentMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,20,19,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  recentMenu: {
    width: '100%',
    maxWidth: 360,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 28,
    backgroundColor: colors.background,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  recentMenuAction: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  recentMenuActionPressed: {
    backgroundColor: colors.inputBackground,
  },
  recentMenuActionText: {
    fontSize: 22,
    lineHeight: 30,
    color: colors.text,
  },
  recentMenuDeleteText: {
    color: colors.danger,
  },
  recentMenuCancelText: {
    fontSize: 22,
    lineHeight: 30,
    color: colors.textSecondary,
  },
  modal: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: colors.text,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancel: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  modalConfirm: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
  modalConfirmDisabled: {
    opacity: 0.45,
  },
  modalConfirmText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(20,20,19,0.32)',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    maxHeight: '70%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  sheetHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  addCandidateRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  previewOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    padding: 18,
  },
  previewBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  previewPanel: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  artifactPreviewPanel: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '86%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  artifactPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingRight: 10,
  },
  artifactLoading: {
    minHeight: 260,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  artifactEditor: {
    minHeight: Math.min(460, windowHeight * 0.52),
    maxHeight: Math.min(560, windowHeight * 0.62),
    marginHorizontal: 16,
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
  letterPreviewPanel: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '82%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  letterPreviewBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  letterPreviewContent: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.text,
  },
  previewImage: {
    width: '100%',
    height: Math.min(520, windowHeight * 0.58),
    backgroundColor: '#000000',
  },
  previewTitle: {
    marginTop: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  previewPrompt: {
    paddingHorizontal: 16,
    paddingTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
    padding: 16,
  },
  previewDelete: {
    minHeight: 36,
    paddingHorizontal: 15,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
  },
  previewDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.danger,
  },
  previewButtonDisabled: {
    opacity: 0.6,
  },
  previewCancel: {
    minHeight: 36,
    paddingHorizontal: 15,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.inputBackground,
  },
  previewCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  previewButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewOpen: {
    minHeight: 36,
    paddingHorizontal: 15,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  previewOpenText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

let styles = createStyles(colors, 100, 720, 360);
