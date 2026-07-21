import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSettingsPageColors } from '../../theme/colors';
import { useSettingsStore } from '../../stores/settings';
import { useDiaryStore } from '../../stores/diary';
import {
  deleteLocalMemory,
  exportAndShareMemoryVaultData,
  listLocalMemories,
  LocalMemory,
  pickAndImportMemoryVaultData,
  saveLocalMemory,
  splitDiaryToLocalMemories,
  updateLocalMemory,
} from '../../services/localMemoryVault';
import { formatDateOnly, formatFullTime } from '../../utils/time';
import { type Diary } from '../../types';
import { createSettingsStyles } from './styles';
import { ButtonRow, SettingsGroup, SettingsRow } from './ui';

type SettingsTabProps = {
  showToast: (message: string) => void;
  keyboardBottomInset: number;
};

export function DiaryTab({ showToast, keyboardBottomInset }: SettingsTabProps) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => createSettingsStyles(colors), [colors]);
  const { diaries, loadDiaries, addDiary, editDiary, toggleFavorite, removeDiary } = useDiaryStore();
  const { memoryVaultConfig, setMemoryVaultConfig } = useSettingsStore();
  const [memories, setMemories] = useState<LocalMemory[]>([]);
  const [editingDiary, setEditingDiary] = useState<Diary | null>(null);
  const [creatingDiary, setCreatingDiary] = useState(false);
  const [diaryTitle, setDiaryTitle] = useState('');
  const [diaryContent, setDiaryContent] = useState('');
  const [diaryEntryDate, setDiaryEntryDate] = useState(formatDateOnly(Date.now()));
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [editingMemory, setEditingMemory] = useState<LocalMemory | null>(null);
  const [creatingMemory, setCreatingMemory] = useState(false);
  const [memorySummary, setMemorySummary] = useState('');
  const [memoryOriginal, setMemoryOriginal] = useState('');
  const [memoryDate, setMemoryDate] = useState('');
  const [memoryTags, setMemoryTags] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [section, setSection] = useState<'config' | 'diaries' | 'memories'>('config');
  const [diarySearchDate, setDiarySearchDate] = useState('');
  const [memorySearchDate, setMemorySearchDate] = useState('');
  const [diaryPage, setDiaryPage] = useState(1);
  const [memoryPage, setMemoryPage] = useState(1);
  const pageSize = 10;

  const [enabled, setEnabled] = useState(memoryVaultConfig.enabled);
  const [searchMemoryEnabled, setSearchMemoryEnabled] = useState(memoryVaultConfig.searchMemoryEnabled !== false);
  const [keywordSearchMemoryEnabled, setKeywordSearchMemoryEnabled] = useState(memoryVaultConfig.keywordSearchMemoryEnabled !== false);
  const [queryDiaryEnabled, setQueryDiaryEnabled] = useState(memoryVaultConfig.queryDiaryEnabled !== false);
  const [saveMemoryEnabled, setSaveMemoryEnabled] = useState(memoryVaultConfig.saveMemoryEnabled !== false);
  const [addDiaryEnabled, setAddDiaryEnabled] = useState(memoryVaultConfig.addDiaryEnabled !== false);
  const [provider, setProvider] = useState<'openai' | 'google'>(memoryVaultConfig.embeddingProvider || 'openai');
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState(memoryVaultConfig.embeddingBaseUrl || 'https://api.openai.com/v1');
  const [embeddingApiKey, setEmbeddingApiKey] = useState(memoryVaultConfig.embeddingApiKey || '');
  const [embeddingModel, setEmbeddingModel] = useState(memoryVaultConfig.embeddingModel || 'text-embedding-3-small');
  const [splitBaseUrl, setSplitBaseUrl] = useState(memoryVaultConfig.splitBaseUrl || 'https://api.openai.com/v1');
  const [splitApiKey, setSplitApiKey] = useState(memoryVaultConfig.splitApiKey || '');
  const [splitModel, setSplitModel] = useState(memoryVaultConfig.splitModel || 'gpt-4o-mini');
  const [topK, setTopK] = useState(String(memoryVaultConfig.topK || 5));

  async function refresh() {
    await Promise.all([loadDiaries(), listLocalMemories().then(setMemories)]);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredDiaries = useMemo(
    () => diaries.filter((diary) => !diarySearchDate.trim() || diary.date === diarySearchDate.trim()),
    [diaries, diarySearchDate],
  );
  const filteredMemories = useMemo(
    () => memories.filter((memory) => !memorySearchDate.trim() || memory.date === memorySearchDate.trim()),
    [memories, memorySearchDate],
  );
  const diaryPageCount = Math.max(1, Math.ceil(filteredDiaries.length / pageSize));
  const memoryPageCount = Math.max(1, Math.ceil(filteredMemories.length / pageSize));
  const visibleDiaries = filteredDiaries.slice((diaryPage - 1) * pageSize, diaryPage * pageSize);
  const visibleMemories = filteredMemories.slice((memoryPage - 1) * pageSize, memoryPage * pageSize);

  useEffect(() => setDiaryPage(1), [diarySearchDate]);
  useEffect(() => setMemoryPage(1), [memorySearchDate]);
  useEffect(() => {
    if (diaryPage > diaryPageCount) setDiaryPage(diaryPageCount);
  }, [diaryPage, diaryPageCount]);
  useEffect(() => {
    if (memoryPage > memoryPageCount) setMemoryPage(memoryPageCount);
  }, [memoryPage, memoryPageCount]);

  function currentConfig() {
    return {
      ...memoryVaultConfig,
      enabled,
      searchMemoryEnabled,
      keywordSearchMemoryEnabled,
      queryDiaryEnabled,
      saveMemoryEnabled,
      addDiaryEnabled,
      embeddingProvider: provider,
      embeddingBaseUrl: embeddingBaseUrl.trim(),
      embeddingApiKey: embeddingApiKey.trim(),
      embeddingModel: embeddingModel.trim(),
      splitBaseUrl: splitBaseUrl.trim(),
      splitApiKey: splitApiKey.trim(),
      splitModel: splitModel.trim(),
      topK: Math.max(1, Number.parseInt(topK, 10) || 5),
    };
  }

  function saveConfig() {
    setMemoryVaultConfig(currentConfig());
    showToast('记忆配置已保存');
  }

  async function testEmbedding() {
    try {
      const { generateMemoryEmbedding } = await import('../../services/localMemoryVault');
      const result = await generateMemoryEmbedding('记忆管理测试', currentConfig());
      if (!result?.length) throw new Error('请填写向量 API Key');
      showToast(`向量 API 正常（${result.length} 维）`);
    } catch (error: any) {
      Alert.alert('测试失败', error.message || '请求失败');
    }
  }

  function openCreateDiary() {
    setDiaryTitle('');
    setDiaryContent('');
    setDiaryEntryDate(formatDateOnly(Date.now()));
    setCreatingDiary(true);
  }

  function openEditDiary(diary: Diary) {
    setEditingDiary(diary);
    setDiaryTitle(diary.title);
    setDiaryContent(diary.content);
    setDiaryEntryDate(diary.date);
  }

  async function saveDiary() {
    if (!diaryTitle.trim() && !diaryContent.trim()) return;
    const date = diaryEntryDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T12:00:00`).getTime())) {
      Alert.alert('提示', '日期格式应为 YYYY-MM-DD');
      return;
    }
    if (editingDiary) {
      await editDiary(editingDiary.id, { title: diaryTitle.trim(), content: diaryContent.trim(), date });
      setEditingDiary(null);
    } else {
      await addDiary(diaryTitle.trim() || `日记 ${formatFullTime(Date.now())}`, diaryContent.trim(), date);
      setCreatingDiary(false);
    }
  }

  async function splitDiary(diary: Diary) {
    setSplittingId(diary.id);
    try {
      const content = [diary.title, diary.content].filter(Boolean).join('\n');
      const count = await splitDiaryToLocalMemories(diary.date, content, currentConfig());
      setMemories(await listLocalMemories());
      Alert.alert('拆分完成', `已写入 ${count} 条向量记忆。`);
    } catch (error: any) {
      Alert.alert('拆分失败', error.message || '请求失败');
    } finally {
      setSplittingId(null);
    }
  }

  function openMemory(memory: LocalMemory) {
    setEditingMemory(memory);
    setMemorySummary(memory.summary);
    setMemoryOriginal(memory.original);
    setMemoryDate(memory.date);
    setMemoryTags(memory.tags.join(', '));
  }

  function openCreateMemory() {
    setCreatingMemory(true);
    setMemorySummary('');
    setMemoryOriginal('');
    setMemoryDate(new Date().toISOString().slice(0, 10));
    setMemoryTags('');
  }

  async function saveMemoryEdit() {
    if ((!editingMemory && !creatingMemory) || !memorySummary.trim()) return;
    try {
      const tags = memoryTags.split(/[,，\n]+/).map((item) => item.trim()).filter(Boolean);
      if (editingMemory) {
        await updateLocalMemory(editingMemory.id, {
          summary: memorySummary.trim(),
          original: memoryOriginal.trim(),
          date: memoryDate.trim(),
          tags,
        }, currentConfig());
      } else {
        const { generateMemoryEmbedding } = await import('../../services/localMemoryVault');
        const embedding = await generateMemoryEmbedding(memorySummary.trim(), currentConfig());
        await saveLocalMemory({
          summary: memorySummary.trim(),
          original: memoryOriginal.trim() || memorySummary.trim(),
          date: memoryDate.trim(),
          tags,
          embedding,
          embeddingModel,
        });
      }
      setEditingMemory(null);
      setCreatingMemory(false);
      setMemories(await listLocalMemories());
    } catch (error: any) {
      Alert.alert('保存失败', error.message || '请求失败');
    }
  }

  async function toggleMemory(memory: LocalMemory) {
    await updateLocalMemory(memory.id, { active: !memory.active });
    setMemories(await listLocalMemories());
  }

  function confirmDeleteMemory(memory: LocalMemory) {
    Alert.alert('删除记忆', `确定删除“${memory.summary}”吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
        await deleteLocalMemory(memory.id);
        setMemories(await listLocalMemories());
      } },
    ]);
  }

  async function importData() {
    setTransferring(true);
    try {
      const result = await pickAndImportMemoryVaultData();
      if (result) {
        await refresh();
        Alert.alert('导入完成', `日记 ${result.importedDiaries} 篇，记忆 ${result.importedMemories} 条。`);
      }
    } catch (error: any) {
      Alert.alert('导入失败', error.message || '文件格式错误');
    } finally {
      setTransferring(false);
    }
  }

  async function exportData() {
    setTransferring(true);
    try {
      await exportAndShareMemoryVaultData();
      showToast('记忆数据已导出');
    } catch (error: any) {
      Alert.alert('导出失败', error.message || '无法导出');
    } finally {
      setTransferring(false);
    }
  }

  return (
    <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: keyboardBottomInset + 20 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
        {([['config', '数据与 API'], ['diaries', '日记'], ['memories', '向量记忆']] as const).map(([key, label]) => (
          <Pressable key={key} onPress={() => setSection(key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, backgroundColor: section === key ? colors.primary : colors.inputBackground }}>
            <Text style={{ color: section === key ? '#fff' : colors.textSecondary, fontWeight: '600' }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {section === 'config' && <>
      <SettingsGroup header="数据导入导出" footer="导入导出格式兼容 Memory Vault；完整日记写入 diaries，向量记忆写入 memory_items。">
        <ButtonRow label="导入记忆数据" onPress={() => void importData()} loading={transferring} />
        <ButtonRow label="导出记忆数据" onPress={() => void exportData()} disabled={transferring} />
      </SettingsGroup>

      <SettingsGroup header="记忆库配置">
        <SettingsRow label="启用聊天记忆" right={<Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />} />
        <SettingsRow label="语义搜索记忆" sublabel="search_memory_vault" right={<Switch value={searchMemoryEnabled} onValueChange={setSearchMemoryEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />} />
        <SettingsRow label="关键词搜索记忆" sublabel="keyword_search_memory_vault" right={<Switch value={keywordSearchMemoryEnabled} onValueChange={setKeywordSearchMemoryEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />} />
        <SettingsRow label="按日期查询日记" sublabel="query_diary" right={<Switch value={queryDiaryEnabled} onValueChange={setQueryDiaryEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />} />
        <SettingsRow label="保存长期记忆" sublabel="save_memory" right={<Switch value={saveMemoryEnabled} onValueChange={setSaveMemoryEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />} />
        <SettingsRow label="添加日记" sublabel="add_diary" right={<Switch value={addDiaryEnabled} onValueChange={setAddDiaryEnabled} trackColor={{ false: colors.inputBorder, true: colors.primary }} />} />
        <SettingsRow label="Google 向量格式" sublabel="关闭时使用 OpenAI 兼容格式" right={<Switch value={provider === 'google'} onValueChange={(value) => {
          setProvider(value ? 'google' : 'openai');
          setEmbeddingBaseUrl(value ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com/v1');
          setEmbeddingModel(value ? 'gemini-embedding-001' : 'text-embedding-3-small');
        }} trackColor={{ false: colors.inputBorder, true: colors.primary }} />} />
        <TextInput style={styles.input} value={embeddingBaseUrl} onChangeText={setEmbeddingBaseUrl} placeholder="向量 API 地址" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
        <TextInput style={styles.input} value={embeddingApiKey} onChangeText={setEmbeddingApiKey} placeholder="向量 API Key" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
        <TextInput style={styles.input} value={embeddingModel} onChangeText={setEmbeddingModel} placeholder="向量模型" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
        <TextInput style={styles.input} value={splitBaseUrl} onChangeText={setSplitBaseUrl} placeholder="日记拆分 API 地址" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
        <TextInput style={styles.input} value={splitApiKey} onChangeText={setSplitApiKey} placeholder="日记拆分 API Key" placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
        <TextInput style={styles.input} value={splitModel} onChangeText={setSplitModel} placeholder="日记拆分模型" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
        <TextInput style={styles.input} value={topK} onChangeText={setTopK} placeholder="召回条数" placeholderTextColor={colors.textTertiary} keyboardType="number-pad" />
        <ButtonRow label="测试向量 API" onPress={() => void testEmbedding()} />
        <ButtonRow label="保存配置" onPress={saveConfig} />
      </SettingsGroup>
      </>}

      {section === 'diaries' && <>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TextInput style={styles.input} value={diarySearchDate} onChangeText={setDiarySearchDate} placeholder="按日期检索（YYYY-MM-DD）" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
      </View>
      <SettingsGroup header={`日记（${diaries.length}）`} footer="点击编辑；右侧按钮调用拆分 API 并写入向量记忆。">
        <ButtonRow label="＋ 新增日记" onPress={openCreateDiary} />
        {visibleDiaries.map((diary) => (
          <SettingsRow key={diary.id} label={diary.title || '无标题'} sublabel={`${diary.date} · ${diary.content.slice(0, 80)}\n${formatFullTime(diary.createdAt)}`} onPress={() => openEditDiary(diary)} onLongPress={() => Alert.alert('删除日记', '确定删除这篇日记吗？', [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => void removeDiary(diary.id) },
          ])} left={<Pressable onPress={() => void toggleFavorite(diary.id)}><Text style={styles.diaryStarText}>{diary.isFavorite ? '★' : '☆'}</Text></Pressable>} right={<Pressable onPress={() => void splitDiary(diary)} disabled={splittingId === diary.id}>{splittingId === diary.id ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.diaryUploadText}>拆分</Text>}</Pressable>} />
        ))}
        {!visibleDiaries.length && <SettingsRow label="没有符合日期条件的日记" disabled />}
        <Pagination page={diaryPage} pageCount={diaryPageCount} setPage={setDiaryPage} colors={colors} />
      </SettingsGroup>
      </>}

      {section === 'memories' && <>
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <TextInput style={styles.input} value={memorySearchDate} onChangeText={setMemorySearchDate} placeholder="按日期检索（YYYY-MM-DD）" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
      </View>
      <SettingsGroup header={`记忆条目（${memories.length}）`} footer="点击编辑，点击状态切换启用/隐藏，长按删除。">
        <ButtonRow label="＋ 新增记忆条目" onPress={openCreateMemory} />
        {visibleMemories.map((memory) => (
          <SettingsRow key={memory.id} label={memory.summary} sublabel={`${memory.date || '未知日期'}${memory.tags.length ? ` · ${memory.tags.join('、')}` : ''}`} onPress={() => openMemory(memory)} onLongPress={() => confirmDeleteMemory(memory)} right={<Pressable onPress={() => void toggleMemory(memory)}><Text style={{ color: memory.active ? colors.primary : colors.textTertiary }}>{memory.active ? '启用' : '隐藏'}</Text></Pressable>} />
        ))}
        {!visibleMemories.length && <SettingsRow label="没有符合日期条件的向量记忆" disabled />}
        <Pagination page={memoryPage} pageCount={memoryPageCount} setPage={setMemoryPage} colors={colors} />
      </SettingsGroup>
      </>}

      <DiaryEditor visible={creatingDiary || !!editingDiary} title={diaryTitle} content={diaryContent} date={diaryEntryDate} setTitle={setDiaryTitle} setContent={setDiaryContent} setDate={setDiaryEntryDate} onCancel={() => { setCreatingDiary(false); setEditingDiary(null); }} onSave={() => void saveDiary()} styles={styles} colors={colors} />

      <Modal visible={!!editingMemory || creatingMemory} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => { setEditingMemory(null); setCreatingMemory(false); }}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>{creatingMemory ? '新增记忆' : '编辑记忆'}</Text>
            <TextInput style={styles.input} value={memorySummary} onChangeText={setMemorySummary} placeholder="摘要" placeholderTextColor={colors.textTertiary} />
            <TextInput style={[styles.summaryContentInput, styles.diaryModalContentInput]} value={memoryOriginal} onChangeText={setMemoryOriginal} placeholder="原文" placeholderTextColor={colors.textTertiary} multiline />
            <TextInput style={styles.input} value={memoryDate} onChangeText={setMemoryDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} />
            <TextInput style={styles.input} value={memoryTags} onChangeText={setMemoryTags} placeholder="标签，逗号分隔" placeholderTextColor={colors.textTertiary} />
            <View style={styles.modalButtons}><Pressable style={styles.modalCancel} onPress={() => { setEditingMemory(null); setCreatingMemory(false); }}><Text style={styles.modalCancelText}>取消</Text></Pressable><Pressable style={styles.modalConfirm} onPress={() => void saveMemoryEdit()}><Text style={styles.modalConfirmText}>保存</Text></Pressable></View>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function Pagination({ page, pageCount, setPage, colors }: {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  colors: ReturnType<typeof useSettingsPageColors>;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18, paddingVertical: 14 }}>
      <Pressable disabled={page <= 1} onPress={() => setPage(page - 1)}>
        <Text style={{ color: page <= 1 ? colors.textTertiary : colors.primary }}>上一页</Text>
      </Pressable>
      <Text style={{ color: colors.textSecondary }}>第 {page} / {pageCount} 页</Text>
      <Pressable disabled={page >= pageCount} onPress={() => setPage(page + 1)}>
        <Text style={{ color: page >= pageCount ? colors.textTertiary : colors.primary }}>下一页</Text>
      </Pressable>
    </View>
  );
}

function DiaryEditor({ visible, title, content, date, setTitle, setContent, setDate, onCancel, onSave, styles, colors }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={styles.overlay} onPress={onCancel}>
        <View style={styles.modal} onStartShouldSetResponder={() => true}>
          <Text style={styles.modalTitle}>编辑日记</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="标题" placeholderTextColor={colors.textTertiary} />
          <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
          <TextInput style={[styles.summaryContentInput, styles.diaryModalContentInput]} value={content} onChangeText={setContent} placeholder="日记内容" placeholderTextColor={colors.textTertiary} multiline />
          <View style={styles.modalButtons}><Pressable style={styles.modalCancel} onPress={onCancel}><Text style={styles.modalCancelText}>取消</Text></Pressable><Pressable style={styles.modalConfirm} onPress={onSave}><Text style={styles.modalConfirmText}>保存</Text></Pressable></View>
        </View>
      </Pressable>
    </Modal>
  );
}
