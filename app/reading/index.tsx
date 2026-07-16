import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  FlatList,
  Image,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { IOSToast } from '../../src/components/IOSToast';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { lightColors, useThemeColors, type ThemeColors } from '../../src/theme/colors';

import { fonts } from '../../src/theme/fonts';
import { ReadingBook, ReadingHighlight, ReadingNote } from '../../src/types';
import {
  createReadingBook,
  deleteReadingBook,
  deleteReadingHighlight,
  deleteReadingNote,
  getAllReadingBookSnapshots,
  getAllReadingHighlights,
  getAllReadingNotes,
  getAllReadingBooks,
  insertReadingNote,
  updateReadingNoteContent,
  updateReadingBook,
} from '../../src/db/operations';
import { parseReadingBookAsset, pickReadingBookDocument } from '../../src/services/readingImport';
import { useSettingsStore } from '../../src/stores/settings';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';


let colors = lightColors;
const TABS = ['书架', '总结', '设置'] as const;
type ToastFn = (message: string) => void;
const DEFAULT_SUMMARY_SYSTEM_PROMPT =
  '你是一个细致的 AI 共读记录整理者。只根据用户提供的聊天记录做总结，不补充书籍原文、阅读位置或外部信息。';
const HIGHLIGHT_COLOR = '#FFF36D';
type SummaryBook = Pick<ReadingBook, 'id' | 'title' | 'author'> & { deleted?: boolean };

export default function ReadingScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1800);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <Text style={styles.title}>AI 共读</Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab, index) => (
          <Pressable
            key={tab}
            style={[styles.tab, index === activeTab && styles.tabActive]}
            onPress={() => setActiveTab(index)}
          >
            <Text style={[styles.tabText, index === activeTab && styles.tabTextActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === 0 && <BookshelfTab showToast={showToast} />}
      {activeTab === 1 && <ReadingSummaryTab showToast={showToast} />}
      {activeTab === 2 && <ReadingSettingsTab showToast={showToast} />}

      <IOSToast message={toastMessage} />
    </View>
  );
}

function BookshelfTab({ showToast }: { showToast: ToastFn }) {
  const router = useRouter();
  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [importing, setImporting] = useState(false);
  const [editingBook, setEditingBook] = useState<ReadingBook | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editCoverUri, setEditCoverUri] = useState<string | undefined>();

  useFocusEffect(
    useCallback(() => {
      loadBooks();
    }, [])
  );

  async function loadBooks() {
    const list = await getAllReadingBooks();
    setBooks(list);
  }

  async function handleImport() {
    if (importing) return;
    setImporting(true);
    try {
      const asset = await pickReadingBookDocument();
      if (!asset) return;

      const id = randomUUID();
      const parsed = await parseReadingBookAsset(asset, id);
      if (!parsed.text.trim()) {
        Alert.alert('导入失败', '没有解析到可阅读的正文内容');
        return;
      }

      const now = Date.now();
      await createReadingBook({
        id,
        title: parsed.title,
        author: parsed.author,
        coverUri: parsed.coverUri,
        fileUri: parsed.fileUri,
        format: parsed.format,
        text: parsed.text,
        chapters: parsed.chapters,
        readingOffset: 0,
        createdAt: now,
        updatedAt: now,
      });
      await loadBooks();
      showToast('导入成功');
    } catch (error: any) {
      Alert.alert('导入失败', error?.message || '无法解析该文件');
    } finally {
      setImporting(false);
    }
  }

  function openEdit(book: ReadingBook) {
    setEditingBook(book);
    setEditTitle(book.title);
    setEditAuthor(book.author);
    setEditCoverUri(book.coverUri);
  }

  async function handlePickCover() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled) {
      setEditCoverUri(result.assets[0]?.uri);
    }
  }

  async function handleSaveEdit() {
    if (!editingBook) return;
    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      Alert.alert('提示', '书名不能为空');
      return;
    }
    await updateReadingBook(editingBook.id, {
      title: nextTitle,
      author: editAuthor.trim(),
      coverUri: editCoverUri,
      updatedAt: Date.now(),
    });
    setEditingBook(null);
    await loadBooks();
    showToast('已保存');
  }

  function handleDelete(book: ReadingBook) {
    Alert.alert('删除书籍', `确定删除《${book.title || '未命名书籍'}》及其共读对话？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteReadingBook(book.id);
          await loadBooks();
        },
      },
    ]);
  }

  return (
    <View style={styles.content}>
      <View style={styles.bookshelfActions}>
        <Pressable style={styles.primaryButton} onPress={handleImport} disabled={importing}>
          {importing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>导入电子书</Text>
          )}
        </Pressable>
      </View>

      <FlatList
        data={books}
        keyExtractor={(item) => item.id}
        contentContainerStyle={books.length === 0 ? styles.emptyList : styles.bookList}
        renderItem={({ item }) => (
          <Pressable
            style={styles.bookItem}
            onPress={() => router.push(`/reading/${item.id}`)}
            onLongPress={() => openEdit(item)}
          >
            {item.coverUri ? (
              <Image source={{ uri: item.coverUri }} style={styles.cover} resizeMode="cover" />
            ) : (
              <View style={styles.coverPlaceholder}>
                <Text style={styles.coverPlaceholderText}>{item.title.slice(0, 1) || '书'}</Text>
              </View>
            )}
            <View style={styles.bookInfo}>
              <Text style={styles.bookTitle} numberOfLines={1}>{item.title || '未命名书籍'}</Text>
              <Text style={styles.bookAuthor} numberOfLines={1}>{item.author || '未知作者'}</Text>
              <Text style={styles.bookMeta}>
                {item.format.toUpperCase()} · {item.text.length} 字
              </Text>
            </View>
            <Pressable style={styles.deleteButton} onPress={() => handleDelete(item)}>
              <Text style={styles.deleteIcon}>×</Text>
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>书架还是空的</Text>
            <Text style={styles.emptyText}>导入 txt 或 epub 后，就可以边读边和 AI 讨论。</Text>
          </View>
        }
      />

      <Modal visible={!!editingBook} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setEditingBook(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>编辑书籍</Text>
            <Pressable style={styles.coverEdit} onPress={handlePickCover}>
              {editCoverUri ? (
                <Image source={{ uri: editCoverUri }} style={styles.coverLarge} resizeMode="cover" />
              ) : (
                <View style={styles.coverLargePlaceholder}>
                  <Text style={styles.coverPlaceholderText}>封面</Text>
                </View>
              )}
            </Pressable>
            <TextInput
              style={styles.input}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="书名"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={styles.input}
              value={editAuthor}
              onChangeText={setEditAuthor}
              placeholder="作者"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setEditingBook(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveEdit}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function ReadingSummaryTab({ showToast }: { showToast: ToastFn }) {
  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [notesByBook, setNotesByBook] = useState<Record<string, ReadingNote[]>>({});
  const [highlightsByBook, setHighlightsByBook] = useState<Record<string, ReadingHighlight[]>>({});
  const [bookSnapshots, setBookSnapshots] = useState<Record<string, { title: string; author: string }>>({});
  const [editingNote, setEditingNote] = useState<ReadingNote | null>(null);
  const [editText, setEditText] = useState('');
  const [reflectionBook, setReflectionBook] = useState<ReadingBook | null>(null);
  const [reflectionText, setReflectionText] = useState('');
  const [expandedBookIds, setExpandedBookIds] = useState<Set<string>>(new Set());

  const summaryBooks = useMemo<SummaryBook[]>(() => {
    const existingIds = new Set(books.map((book) => book.id));
    const recordIds = new Set([
      ...Object.keys(notesByBook),
      ...Object.keys(highlightsByBook),
    ]);
    const deletedBooks = [...recordIds]
      .filter((bookId) => !existingIds.has(bookId))
      .map((bookId) => {
        const snapshot = bookSnapshots[bookId];
        return {
          id: bookId,
          title: snapshot?.title || '未命名书籍',
          author: snapshot?.author || '未知作者',
          deleted: true,
        };
      });
    return [...books, ...deletedBooks];
  }, [bookSnapshots, books, highlightsByBook, notesByBook]);

  useFocusEffect(
    useCallback(() => {
      loadSummaryData();
    }, [])
  );

  async function loadSummaryData() {
    const [nextBooks, notes, highlights, snapshots] = await Promise.all([
      getAllReadingBooks(),
      getAllReadingNotes(),
      getAllReadingHighlights(),
      getAllReadingBookSnapshots(),
    ]);
    const grouped: Record<string, ReadingNote[]> = {};
    notes.forEach((note) => {
      grouped[note.bookId] = [...(grouped[note.bookId] || []), note];
    });
    const groupedHighlights: Record<string, ReadingHighlight[]> = {};
    highlights.forEach((highlight) => {
      groupedHighlights[highlight.bookId] = [
        ...(groupedHighlights[highlight.bookId] || []),
        highlight,
      ];
    });
    setBooks(nextBooks);
    setNotesByBook(grouped);
    setHighlightsByBook(groupedHighlights);
    setBookSnapshots(
      Object.fromEntries(
        snapshots.map((snapshot) => [
          snapshot.bookId,
          { title: snapshot.title, author: snapshot.author },
        ])
      )
    );
  }

  function handleOpenReflection(book: ReadingBook) {
    setReflectionBook(book);
    setReflectionText('');
  }

  function toggleBookExpanded(bookId: string) {
    setExpandedBookIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  async function handleSaveReflection() {
    if (!reflectionBook) return;
    const content = reflectionText.trim();
    if (!content) {
      Alert.alert('提示', '请输入读书心得');
      return;
    }
    const now = Date.now();
    await insertReadingNote({
      id: randomUUID(),
      bookId: reflectionBook.id,
      kind: 'reflection',
      content,
      createdAt: now,
      updatedAt: now,
    });
    await updateReadingBook(reflectionBook.id, { updatedAt: now });
    setReflectionBook(null);
    setReflectionText('');
    await loadSummaryData();
    showToast('读书心得已保存');
  }

  function handleOpenNote(note: ReadingNote) {
    setEditingNote(note);
    setEditText(note.content);
  }

  async function handleSaveNoteEdit() {
    if (!editingNote) return;
    const content = editText.trim();
    if (!content) {
      Alert.alert('提示', '内容不能为空');
      return;
    }
    await updateReadingNoteContent(editingNote.id, content);
    setEditingNote(null);
    setEditText('');
    await loadSummaryData();
    showToast('已保存');
  }

  function handleDeleteNote() {
    if (!editingNote) return;
    const label = editingNote.kind === 'summary' ? '总结' : '读书心得';
    Alert.alert(`删除${label}`, `确定删除这条${label}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteReadingNote(editingNote.id);
          setEditingNote(null);
          setEditText('');
          await loadSummaryData();
        },
      },
    ]);
  }

  function handleDeleteHighlight(highlight: ReadingHighlight) {
    Alert.alert('删除划线', '确定删除这句划线？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteReadingHighlight(highlight.id);
          await loadSummaryData();
          showToast('划线已删除');
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.summaryContent} contentContainerStyle={styles.summaryContentInner}>
      {summaryBooks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>还没有记录</Text>
          <Text style={styles.emptyText}>导入书籍后，这里会按书显示划线、AI 总结和你的读书心得。</Text>
        </View>
      ) : (
        summaryBooks.map((book) => {
          const notes = notesByBook[book.id] || [];
          const highlights = highlightsByBook[book.id] || [];
          const entries = [
            ...highlights.map((highlight) => ({
              type: 'highlight' as const,
              id: highlight.id,
              createdAt: highlight.createdAt,
              highlight,
            })),
            ...notes.map((note) => ({
              type: 'note' as const,
              id: note.id,
              createdAt: note.createdAt,
              note,
            })),
          ].sort((a, b) => a.createdAt - b.createdAt);
          const expanded = expandedBookIds.has(book.id);

          return (
            <View key={book.id} style={styles.summaryBookSection}>
              <Pressable style={styles.summaryBookHeader} onPress={() => toggleBookExpanded(book.id)}>
                <View style={styles.summaryBookTitleWrap}>
                  <Text style={styles.summaryBookTitle} numberOfLines={1}>
                    {book.title || '未命名书籍'}
                  </Text>
                  <Text style={styles.summaryBookAuthor} numberOfLines={1}>
                    {book.author || '未知作者'} · {entries.length} 条记录
                  </Text>
                </View>
                <Text style={styles.summaryChevron}>{expanded ? '⌃' : '⌄'}</Text>
              </Pressable>

              {expanded && !book.deleted && (
                <View style={styles.summaryBookActions}>
                  <Pressable style={styles.addReflectionButton} onPress={() => handleOpenReflection(book as ReadingBook)}>
                    <Text style={styles.addReflectionText}>添加心得</Text>
                  </Pressable>
                </View>
              )}

              {expanded && entries.length === 0 ? (
                <Text style={styles.summaryEmptyText}>暂无划线、总结或读书心得。</Text>
              ) : expanded ? (
                entries.map((entry) => {
                  if (entry.type === 'highlight') {
                    return (
                      <Pressable
                        key={entry.id}
                        style={[styles.noteItem, styles.highlightNote]}
                        onLongPress={() => handleDeleteHighlight(entry.highlight)}
                      >
                        <Text style={[styles.noteBadge, styles.highlightNoteBadge]}>划线句子</Text>
                        <Text style={styles.noteText}>{entry.highlight.content}</Text>
                      </Pressable>
                    );
                  }

                  const note = entry.note;
                  return (
                    <Pressable
                      key={entry.id}
                      style={[
                        styles.noteItem,
                        note.kind === 'summary' ? styles.summaryNote : styles.reflectionNote,
                      ]}
                      onLongPress={() => handleOpenNote(note)}
                    >
                      <Text
                        style={[
                          styles.noteBadge,
                          note.kind === 'summary' ? styles.summaryNoteBadge : styles.reflectionNoteBadge,
                        ]}
                      >
                        {note.kind === 'summary' ? 'AI 总结' : '读书心得'}
                      </Text>
                      <Text style={styles.noteText}>{note.content}</Text>
                    </Pressable>
                  );
                })
              ) : null}
            </View>
          );
        })
      )}

      <Modal visible={!!reflectionBook} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setReflectionBook(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>添加读书心得</Text>
            <TextInput
              style={[styles.input, styles.noteEditInput]}
              value={reflectionText}
              onChangeText={setReflectionText}
              multiline
              placeholder="写下这本书给你的想法、问题或感受"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setReflectionBook(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveReflection}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!editingNote} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setEditingNote(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>
              编辑{editingNote?.kind === 'summary' ? '总结' : '读书心得'}
            </Text>
            <TextInput
              style={[styles.input, styles.noteEditInput]}
              value={editText}
              onChangeText={setEditText}
              multiline
              placeholder="内容"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.noteModalButtons}>
              <Pressable style={styles.modalDelete} onPress={handleDeleteNote}>
                <Text style={styles.modalDeleteText}>删除</Text>
              </Pressable>
              <View style={styles.modalRightButtons}>
                <Pressable style={styles.modalCancel} onPress={() => setEditingNote(null)}>
                  <Text style={styles.modalCancelText}>取消</Text>
                </Pressable>
                <Pressable style={styles.modalConfirm} onPress={handleSaveNoteEdit}>
                  <Text style={styles.modalConfirmText}>保存</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function ReadingSettingsTab({ showToast }: { showToast: ToastFn }) {
  const keyboardHeight = useKeyboardHeight();
  const { readingConfig, setReadingConfig, apiConfigs, activeConfigIndex } = useSettingsStore();
  const [baseUrl, setBaseUrl] = useState(readingConfig.baseUrl);
  const [apiKey, setApiKey] = useState(readingConfig.apiKey);
  const [model, setModel] = useState(readingConfig.model);
  const [systemPrompt, setSystemPrompt] = useState(readingConfig.systemPrompt);
  const [summarySystemPrompt, setSummarySystemPrompt] = useState(
    readingConfig.summarySystemPrompt || DEFAULT_SUMMARY_SYSTEM_PROMPT
  );
  const [sourceCharLimit, setSourceCharLimit] = useState(String(readingConfig.sourceCharLimit));
  const [conversationMessageLimit, setConversationMessageLimit] = useState(String(readingConfig.conversationMessageLimit));
  const [testing, setTesting] = useState(false);

  function handleUseChatAPI() {
    const config = apiConfigs[activeConfigIndex];
    if (!config) {
      Alert.alert('提示', '普通对话还没有可复制的 API 配置');
      return;
    }
    setBaseUrl(config.baseUrl);
    setApiKey(config.apiKey);
    setModel(config.model);
  }

  function handleSave() {
    const sourceLimit = parsePositiveInt(sourceCharLimit, '原文字数');
    const messageLimit = parsePositiveInt(conversationMessageLimit, '对话条数');
    if (!sourceLimit || !messageLimit) return;

    setReadingConfig({
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
      systemPrompt: systemPrompt.trim(),
      summarySystemPrompt: summarySystemPrompt.trim() || DEFAULT_SUMMARY_SYSTEM_PROMPT,
      sourceCharLimit: sourceLimit,
      conversationMessageLimit: messageLimit,
    });
    showToast('共读设置已保存');
  }

  async function handleTest() {
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      Alert.alert('提示', '请先填写 Base URL、API Key 和 Model');
      return;
    }
    setTesting(true);
    try {
      const response = await fetch(`${baseUrl.trim().replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: model.trim(),
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
      }
      showToast('API 配置有效');
    } catch (error: any) {
      Alert.alert('连接失败', error?.message || '请求失败');
    } finally {
      setTesting(false);
    }
  }

  function parsePositiveInt(value: string, label: string): number | null {
    const num = parseInt(value.trim(), 10);
    if (!Number.isFinite(num) || num <= 0) {
      Alert.alert('提示', `请输入有效的${label}`);
      return null;
    }
    return num;
  }

  return (
    <ScrollView
      style={styles.settingsContent}
      contentContainerStyle={{ paddingBottom: keyboardHeight + 28 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>共读 API</Text>
      <View style={styles.field}>
        <Text style={styles.label}>Base URL</Text>
        <TextInput
          style={styles.input}
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder="https://api.openai.com/v1"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="sk-..."
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Model</Text>
        <TextInput
          style={styles.input}
          value={model}
          onChangeText={setModel}
          placeholder="模型名称"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.secondaryButton} onPress={handleUseChatAPI}>
          <Text style={styles.secondaryButtonText}>复制普通对话 API</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={handleTest} disabled={testing}>
          {testing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.secondaryButtonText}>测试连接</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>上下文配置</Text>
      <View style={styles.field}>
        <Text style={styles.label}>System Prompt</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          multiline
          placeholder="共读时发送给 AI 的系统提示词"
          placeholderTextColor={colors.textTertiary}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>总结 System Prompt</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={summarySystemPrompt}
          onChangeText={setSummarySystemPrompt}
          multiline
          placeholder="总结共读聊天时发送给 AI 的系统提示词，可约束字数、格式和重点"
          placeholderTextColor={colors.textTertiary}
        />
      </View>
      <View style={styles.twoColumn}>
        <View style={[styles.field, styles.flexField]}>
          <Text style={styles.label}>原文字数</Text>
          <TextInput
            style={styles.input}
            value={sourceCharLimit}
            onChangeText={setSourceCharLimit}
            keyboardType="number-pad"
            placeholder="4000"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
        <View style={[styles.field, styles.flexField]}>
          <Text style={styles.label}>对话条数</Text>
          <TextInput
            style={styles.input}
            value={conversationMessageLimit}
            onChangeText={setConversationMessageLimit}
            keyboardType="number-pad"
            placeholder="8"
            placeholderTextColor={colors.textTertiary}
          />
        </View>
      </View>
      <Pressable style={styles.saveButton} onPress={handleSave}>
        <Text style={styles.saveButtonText}>保存设置</Text>
      </Pressable>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerButton: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  backIcon: { fontSize: 28, color: colors.text, lineHeight: 30 },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center' },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 6,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  tabTextActive: { color: '#FFFFFF' },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  summaryContent: { flex: 1 },
  summaryContentInner: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 },
  settingsContent: { flex: 1, padding: 20 },
  bookshelfActions: { marginBottom: 12 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  bookList: { paddingBottom: 24 },
  emptyList: { flexGrow: 1 },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  cover: { width: 54, height: 76, borderRadius: 6, backgroundColor: colors.border },
  coverPlaceholder: {
    width: 54,
    height: 76,
    borderRadius: 6,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverPlaceholderText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  bookInfo: { flex: 1, marginLeft: 12, gap: 4 },
  bookTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  bookAuthor: { fontSize: 13, color: colors.textSecondary },
  bookMeta: { fontSize: 12, color: colors.textTertiary },
  deleteButton: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
  deleteIcon: { fontSize: 22, color: colors.textTertiary },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, color: colors.text, fontFamily: fonts.serifBold, marginBottom: 8 },
  emptyText: { fontSize: 14, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: colors.background, borderRadius: 16, padding: 20, width: '86%', maxHeight: '78%' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 14 },
  coverEdit: { alignSelf: 'center', marginBottom: 16 },
  coverLarge: { width: 92, height: 128, borderRadius: 8, backgroundColor: colors.border },
  coverLargePlaceholder: {
    width: 92,
    height: 128,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 6 },
  noteModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
  },
  modalRightButtons: { flexDirection: 'row', gap: 12 },
  modalDelete: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  modalDeleteText: { fontSize: 15, color: colors.danger, fontWeight: '500' },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  modalCancelText: { fontSize: 15, color: colors.textSecondary },
  modalConfirm: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary },
  modalConfirmText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  summaryBookSection: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryBookHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryBookTitleWrap: { flex: 1 },
  summaryBookTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  summaryBookAuthor: { marginTop: 3, fontSize: 12, color: colors.textTertiary },
  summaryChevron: {
    width: 26,
    textAlign: 'center',
    fontSize: 18,
    color: colors.textTertiary,
  },
  summaryBookActions: {
    alignItems: 'flex-end',
    marginTop: 10,
  },
  addReflectionButton: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addReflectionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  summaryEmptyText: {
    fontSize: 13,
    color: colors.textTertiary,
    paddingVertical: 8,
  },
  noteItem: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 8,
  },
  summaryNote: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primaryLight,
  },
  highlightNote: {
    backgroundColor: HIGHLIGHT_COLOR,
    borderColor: HIGHLIGHT_COLOR,
  },
  reflectionNote: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  noteBadge: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 8,
  },
  summaryNoteBadge: {
    backgroundColor: colors.primary,
    color: '#FFFFFF',
  },
  highlightNoteBadge: {
    backgroundColor: lightColors.text,
    color: HIGHLIGHT_COLOR,
  },
  reflectionNoteBadge: {
    backgroundColor: colors.inputBackground,
    color: colors.textSecondary,
  },
  noteText: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
  },
  noteEditInput: {
    minHeight: 180,
    maxHeight: 320,
    textAlignVertical: 'top',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 10,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  field: { marginBottom: 14 },
  flexField: { flex: 1 },
  label: { fontSize: 14, color: colors.text, marginBottom: 6, fontWeight: '500' },
  input: {
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: colors.text,
  },
  multilineInput: { minHeight: 120, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  secondaryButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600', color: colors.primary, textAlign: 'center' },
  twoColumn: { flexDirection: 'row', gap: 12 },
  saveButton: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
});

let styles = createStyles(colors);
