import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, Alert, TextInput, Modal, ActivityIndicator, Image, Dimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';

import { fonts } from '../src/theme/fonts';
import { Conversation, IncomingLetter } from '../src/types';
import {
  getAllConversations,
  deleteConversation,
  updateConversation,
  searchMessages,
  ChatSearchResult,
  getGeneratedPictureGalleryItems,
  getMessageByConversationAndId,
  updateMessageGeneratedPics,
  getAllIncomingLetters,
  type GeneratedPictureGalleryItem,
} from '../src/db/operations';
import { useChatStore } from '../src/stores/chat';
import { deleteGeneratedImageFile } from '../src/services/imageGeneration';


let colors = lightColors;
type SearchScope = 'current' | 'global';
type HistoryViewMode = 'chats' | 'gallery' | 'letters';
const GALLERY_COLUMNS = 3;
const GALLERY_GAP = 8;
const GALLERY_ITEM_SIZE = Math.floor((Dimensions.get('window').width - 32 - GALLERY_GAP * (GALLERY_COLUMNS - 1)) / GALLERY_COLUMNS);

export default function HistoryScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [editingConv, setEditingConv] = useState<Conversation | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('current');
  const [searchResults, setSearchResults] = useState<ChatSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<HistoryViewMode>('chats');
  const [galleryItems, setGalleryItems] = useState<GeneratedPictureGalleryItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [previewPicture, setPreviewPicture] = useState<GeneratedPictureGalleryItem | null>(null);
  const [deletingGalleryItemId, setDeletingGalleryItemId] = useState<string | null>(null);
  const [letters, setLetters] = useState<IncomingLetter[]>([]);
  const [lettersLoading, setLettersLoading] = useState(false);
  const [previewLetter, setPreviewLetter] = useState<IncomingLetter | null>(null);
  const {
    conversationId,
    messages,
    loadConversation,
    loadConversationAroundMessage,
    newConversation,
    deleteGeneratedPictureOnly,
  } = useChatStore();
  const isSearchActive = viewMode === 'chats' && searchText.trim().length > 0;

  useFocusEffect(
    useCallback(() => {
      loadList();
      loadGallery();
      loadLetters();
    }, [])
  );

  async function loadList() {
    const list = await getAllConversations();
    setConversations(list);
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
        setSearchError('请先打开一个对话，或切换到全局搜索');
        setSearching(false);
        return;
      }

      setSearching(true);
      setSearchError(null);
      try {
        const results = await searchMessages(keyword, {
          conversationId: searchScope === 'current' ? conversationId || undefined : undefined,
          limit: 80,
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

  function handleLongPress(conv: Conversation) {
    setEditingConv(conv);
    setEditTitle(conv.title);
  }

  async function handleSaveTitle() {
    if (!editingConv) return;
    await updateConversation(editingConv.id, { title: editTitle.trim(), updatedAt: Date.now() });
    setEditingConv(null);
    loadList();
  }

  function handleDelete(conv: Conversation) {
    Alert.alert('删除对话', `确定删除「${conv.title || '无标题'}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteConversation(conv.id);
          loadList();
          loadGallery();
        },
      },
    ]);
  }

  function handleNewChat() {
    newConversation();
    router.back();
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
    return role;
  }

  function snippet(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 90 ? `${clean.slice(0, 90)}…` : clean;
  }

  function previewPrompt(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 48 ? `${clean.slice(0, 48)}...` : clean;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.title}>对话历史</Text>
        <Pressable style={styles.newButton} onPress={handleNewChat}>
          <Text style={styles.newIcon}>✎</Text>
        </Pressable>
      </View>

      <View style={styles.modeTabs}>
        <Pressable
          style={[styles.modeTab, viewMode === 'chats' && styles.modeTabActive]}
          onPress={() => setViewMode('chats')}
        >
          <Text style={[styles.modeTabText, viewMode === 'chats' && styles.modeTabTextActive]}>对话</Text>
        </Pressable>
        <Pressable
          style={[styles.modeTab, viewMode === 'gallery' && styles.modeTabActive]}
          onPress={() => setViewMode('gallery')}
        >
          <Text style={[styles.modeTabText, viewMode === 'gallery' && styles.modeTabTextActive]}>图片画廊</Text>
        </Pressable>
        <Pressable
          style={[styles.modeTab, viewMode === 'letters' && styles.modeTabActive]}
          onPress={() => setViewMode('letters')}
        >
          <Text style={[styles.modeTabText, viewMode === 'letters' && styles.modeTabTextActive]}>来信</Text>
        </Pressable>
      </View>

      {viewMode === 'chats' && (
        <View style={styles.searchPanel}>
          <View style={styles.searchInputRow}>
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              placeholder="搜索聊天记录"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="search"
            />
            {searching && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
          <View style={styles.searchScopeRow}>
            <Pressable
              style={[styles.scopeButton, searchScope === 'current' && styles.scopeButtonActive]}
              onPress={() => setSearchScope('current')}
            >
              <Text style={[styles.scopeButtonText, searchScope === 'current' && styles.scopeButtonTextActive]}>
                当前窗口
              </Text>
            </Pressable>
            <Pressable
              style={[styles.scopeButton, searchScope === 'global' && styles.scopeButtonActive]}
              onPress={() => setSearchScope('global')}
            >
              <Text style={[styles.scopeButtonText, searchScope === 'global' && styles.scopeButtonTextActive]}>
                全局搜索
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {viewMode === 'letters' ? (
        <FlatList
          key="letters"
          data={letters}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable style={styles.letterItem} onPress={() => setPreviewLetter(item)}>
              <View style={styles.itemContent}>
                <View style={styles.searchResultHeader}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {item.title || item.occasionTitle || '来信'}
                  </Text>
                  <Text style={styles.searchResultTime}>{item.dateKey}</Text>
                </View>
                <Text style={styles.itemMeta}>
                  {item.status === 'ready' ? '已生成' : item.status === 'failed' ? '生成失败' : '生成中'}
                </Text>
                <Text style={styles.searchResultSnippet} numberOfLines={3}>
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
      ) : viewMode === 'gallery' ? (
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
                <Text style={styles.emptyText}>暂无生成图片</Text>
              )}
            </View>
          }
        />
      ) : isSearchActive ? (
        <FlatList
          key="search"
          data={searchResults}
          keyExtractor={(item) => item.messageId}
          renderItem={({ item }) => (
            <Pressable style={styles.searchResultItem} onPress={() => handleOpenSearchResult(item)}>
              <View style={styles.searchResultHeader}>
                <Text style={styles.searchResultTitle} numberOfLines={1}>
                  {item.conversationTitle || '新对话'}
                </Text>
                <Text style={styles.searchResultTime}>{formatTime(item.createdAt)}</Text>
              </View>
              <Text style={styles.searchResultMeta}>{roleLabel(item.role)}</Text>
              <Text style={styles.searchResultSnippet} numberOfLines={2}>
                {snippet(item.content) || '（空消息）'}
              </Text>
            </Pressable>
          )}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {searchError || (searching ? '正在搜索...' : '没有搜索结果')}
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          key="chats"
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isActive = item.id === conversationId;
            return (
              <Pressable
                style={[styles.item, isActive && styles.itemActive]}
                onPress={() => handleOpen(item)}
                onLongPress={() => handleLongPress(item)}
              >
                <View style={styles.itemContent}>
                  <Text
                    style={[styles.itemTitle, isActive && styles.itemTitleActive]}
                    numberOfLines={1}
                  >
                    {item.title || '新对话'}
                  </Text>
                  <Text style={[styles.itemMeta, isActive && styles.itemMetaActive]}>
                    {item.model} · {formatTime(item.createdAt)}
                  </Text>
                </View>
                <Pressable style={styles.deleteButton} onPress={() => handleDelete(item)}>
                  <Text style={[styles.deleteIcon, isActive && styles.deleteIconActive]}>×</Text>
                </Pressable>
              </Pressable>
            );
          }}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>暂无历史对话</Text>
            </View>
          }
        />
      )}

      {/* Edit title modal */}
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
                  {previewPrompt(previewPicture.prompt) || 'AI 生成图片'}
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  backIcon: { fontSize: 22, color: colors.text },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center' },
  newButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  newIcon: { fontSize: 20, color: colors.text },
  modeTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 2,
  },
  modeTab: {
    flex: 1,
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeTabActive: {
    backgroundColor: colors.primary,
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeTabTextActive: {
    color: '#FFFFFF',
  },
  searchPanel: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  searchInputRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
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
    marginTop: 10,
  },
  scopeButton: {
    minHeight: 32,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scopeButtonActive: {
    backgroundColor: colors.primary,
  },
  scopeButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  scopeButtonTextActive: {
    color: '#FFFFFF',
  },
  list: { paddingVertical: 8 },
  galleryList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  galleryRow: {
    justifyContent: 'space-between',
    marginBottom: GALLERY_GAP,
  },
  galleryItem: {
    width: GALLERY_ITEM_SIZE,
    height: GALLERY_ITEM_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  galleryImage: {
    width: GALLERY_ITEM_SIZE,
    height: GALLERY_ITEM_SIZE,
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
    fontWeight: '600',
    color: '#FFFFFF',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 12,
    paddingVertical: 14,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  itemActive: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.primary,
  },
  itemContent: { flex: 1, gap: 4 },
  itemTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  itemTitleActive: {
    color: colors.text,
    fontWeight: '700',
  },
  itemMeta: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  itemMetaActive: {
    color: colors.primary,
  },
  searchResultItem: {
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  letterItem: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  searchResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  searchResultTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  searchResultTime: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  searchResultMeta: {
    fontSize: 12,
    color: colors.primary,
    marginBottom: 5,
  },
  searchResultSnippet: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  deleteButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
  },
  deleteIcon: {
    fontSize: 20,
    color: colors.textTertiary,
  },
  deleteIconActive: {
    color: colors.primary,
  },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120 },
  emptyText: { fontSize: 15, color: colors.textTertiary },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 24,
    width: '80%',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
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
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalCancelText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  modalConfirm: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  modalConfirmText: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '500',
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
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  letterPreviewPanel: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '82%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.background,
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
    height: Math.min(520, Dimensions.get('window').height * 0.58),
    backgroundColor: '#000000',
  },
  previewTitle: {
    marginTop: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '700',
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
    fontWeight: '600',
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
    backgroundColor: colors.surface,
  },
  previewCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
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
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

let styles = createStyles(colors);
