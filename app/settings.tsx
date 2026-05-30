import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  ActivityIndicator, Alert, Modal, FlatList, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import { useSettingsStore, NamedAPIConfig, TTSConfig, MemoryVaultConfig, WebSearchConfig } from '../src/stores/settings';
import { useChatStore } from '../src/stores/chat';
import { useDiaryStore } from '../src/stores/diary';
import { playTTS, stopTTS } from '../src/services/tts';
import { streamChat } from '../src/services/api';
import { Diary } from '../src/types';
import { getFavoriteDiaries } from '../src/db/operations';
import { uploadDiary } from '../src/services/tools';
import { formatFullTime, formatDateOnly } from '../src/utils/time';

const TABS = ['API 配置', '对话设置', 'TTS 配置', 'Tool 设置', '日记'] as const;

export default function SettingsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <Text style={styles.title}>设置</Text>
        <View style={styles.backButton} />
      </View>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        {TABS.map((tab, i) => (
          <Pressable
            key={tab}
            style={[styles.tab, i === activeTab && styles.tabActive]}
            onPress={() => setActiveTab(i)}
          >
            <Text style={[styles.tabText, i === activeTab && styles.tabTextActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {activeTab === 0 && <APIConfigTab />}
      {activeTab === 1 && <ChatSettingsTab />}
      {activeTab === 2 && <TTSConfigTab />}
      {activeTab === 3 && <ToolConfigTab />}
      {activeTab === 4 && <DiaryTab />}
    </View>
  );
}

/* ==================== API 配置 Tab ==================== */

function APIConfigTab() {
  const { _hydrated, apiConfigs, activeConfigIndex, saveAPIConfig, removeAPIConfig, setActiveConfig } = useSettingsStore();

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (_hydrated && apiConfigs.length > 0) {
      loadConfig(activeConfigIndex);
    }
  }, [_hydrated]);

  function loadConfig(index: number) {
    const config = apiConfigs[index];
    if (config) {
      setName(config.name);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setModel(config.model);
    }
  }

  function handleNew() {
    setName(''); setBaseUrl(''); setApiKey(''); setModel(''); setModels([]);
  }

  async function handleFetchModels() {
    if (!baseUrl || !apiKey) {
      Alert.alert('提示', '请先填写 Base URL 和 API Key');
      return;
    }
    setFetching(true);
    try {
      const url = `${baseUrl.trim().replace(/\/$/, '')}/models`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const ids: string[] = (data.data || []).map((m: any) => m.id).sort();
      if (ids.length === 0) {
        Alert.alert('提示', '未获取到模型列表');
      } else {
        setModels(ids);
        setShowModels(true);
      }
    } catch (e: any) {
      Alert.alert('获取失败', e.message);
    } finally {
      setFetching(false);
    }
  }

  async function handleTest() {
    if (!baseUrl || !apiKey || !model) {
      Alert.alert('提示', '请填写完整配置');
      return;
    }
    setTesting(true);
    try {
      const url = `${baseUrl.trim().replace(/\/$/, '')}/chat/completions`;
      const resp = await fetch(url, {
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
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
      }
      Alert.alert('连接成功', 'API 配置有效');
    } catch (e: any) {
      Alert.alert('连接失败', e.message);
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) { Alert.alert('提示', '请输入配置名称'); return; }
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      Alert.alert('提示', '请填写完整配置'); return;
    }
    const config: NamedAPIConfig = {
      name: trimmedName, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(),
    };
    saveAPIConfig(config);
    const newIndex = useSettingsStore.getState().apiConfigs.findIndex((c) => c.name === trimmedName);
    if (newIndex >= 0) setActiveConfig(newIndex);
    Alert.alert('已保存', `配置「${trimmedName}」已保存`);
  }

  function handleSelectConfig(index: number) {
    setActiveConfig(index);
    loadConfig(index);
  }

  function handleDeleteConfig(index: number) {
    const config = apiConfigs[index];
    Alert.alert('删除配置', `确定删除「${config.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: () => {
          removeAPIConfig(index);
          if (apiConfigs.length > 1) loadConfig(0);
          else handleNew();
        },
      },
    ]);
  }

  if (!_hydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.content}>
      {apiConfigs.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>已保存配置</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
            {apiConfigs.map((c, i) => (
              <Pressable
                key={i}
                style={[styles.configChip, i === activeConfigIndex && styles.configChipActive]}
                onPress={() => handleSelectConfig(i)}
                onLongPress={() => handleDeleteConfig(i)}
              >
                <Text style={[styles.configChipText, i === activeConfigIndex && styles.configChipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.configChip} onPress={handleNew}>
              <Text style={styles.configChipText}>＋ 新建</Text>
            </Pressable>
          </ScrollView>
        </>
      )}

      <Text style={styles.sectionTitle}>API 配置</Text>
      <View style={styles.field}>
        <Text style={styles.label}>配置名称</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName}
          placeholder="例如：Claude 中转" placeholderTextColor={colors.textTertiary} />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Base URL</Text>
        <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl}
          placeholder="https://api.openai.com/v1" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey}
          placeholder="sk-..." placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Model</Text>
        <View style={styles.modelRow}>
          <TextInput style={[styles.input, { flex: 1 }]} value={model} onChangeText={setModel}
            placeholder="claude-sonnet-4-6" placeholderTextColor={colors.textTertiary} autoCapitalize="none" />
          <Pressable style={styles.fetchButton} onPress={handleFetchModels} disabled={fetching}>
            {fetching ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.fetchButtonText}>拉取</Text>}
          </Pressable>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      {/* Model picker modal */}
      <Modal visible={showModels} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setShowModels(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>选择模型</Text>
            <FlatList
              data={models}
              keyExtractor={(item) => item}
              style={styles.modelList}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.modelItem, item === model && styles.modelItemActive]}
                  onPress={() => { setModel(item); setShowModels(false); }}
                >
                  <Text style={[styles.modelItemText, item === model && styles.modelItemTextActive]}>{item}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

/* ==================== 对话设置 Tab ==================== */

function ChatSettingsTab() {
  const { maxOutputTokens, systemPrompt, setSystemPrompt, setMaxOutputTokens } = useSettingsStore();
  // 隐藏楼层现在按对话独立存储，数据源改为 chat store
  const { messages, conversationId, hiddenRanges, addHiddenRange, removeHiddenRange } = useChatStore();
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [tokensStr, setTokensStr] = useState(maxOutputTokens ? String(maxOutputTokens) : '');
  const [promptText, setPromptText] = useState(systemPrompt);

  // 仅取 user/assistant 消息作为「楼层」序列（1-based）
  const floorMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  function handleAddRange() {
    const from = parseInt(fromStr, 10);
    const to = parseInt(toStr, 10);
    if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
      Alert.alert('提示', '请输入有效的范围（起始 ≤ 结束，且 ≥ 1）');
      return;
    }
    addHiddenRange({ from, to });
    setFromStr('');
    setToStr('');
  }

  // 预览：两个输入都为有效数字时，给出该范围首尾两条消息的摘要
  const preview = (() => {
    const from = parseInt(fromStr, 10);
    const to = parseInt(toStr, 10);
    if (isNaN(from) || isNaN(to) || from < 1 || to < from) return null;
    const firstMsg = floorMessages[from - 1] ?? null;
    const lastMsg = floorMessages[to - 1] ?? null;
    if (!firstMsg && !lastMsg) return null;
    return {
      from,
      to,
      first: firstMsg,
      last: from === to ? null : lastMsg,
    };
  })();

  function roleLabel(role: string) {
    return role === 'user' ? '你' : 'AI';
  }

  function snippet(text: string) {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }

  function handleSaveTokens() {
    const val = tokensStr.trim();
    if (!val) {
      setMaxOutputTokens(null);
      Alert.alert('已保存', '输出字数不限制');
      return;
    }
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      Alert.alert('提示', '请输入有效的正整数');
      return;
    }
    setMaxOutputTokens(num);
    Alert.alert('已保存', `AI 最大输出 ${num} tokens`);
  }

  const messageCount = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;

  return (
    <ScrollView style={styles.content}>
      {/* System Prompt */}
      <Text style={styles.sectionTitle}>System Prompt</Text>
      <Text style={styles.hint}>此内容会放在所有消息最前面发送给 AI</Text>
      <TextInput
        style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
        value={promptText}
        onChangeText={setPromptText}
        onBlur={() => setSystemPrompt(promptText.trim())}
        multiline
        placeholder="You are a helpful assistant."
        placeholderTextColor={colors.textTertiary}
      />

      {/* 消息条数 */}
      <Text style={styles.sectionTitle}>当前对话</Text>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>消息条数</Text>
        <Text style={styles.infoValue}>{messageCount} 条</Text>
      </View>

      {/* 隐藏消息 */}
      <Text style={styles.sectionTitle}>隐藏消息</Text>
      <Text style={styles.hint}>隐藏的消息不会发送给 AI，可用于节省 token。隐藏范围按对话独立保存，重叠或相邻的范围会自动合并。</Text>

      {!conversationId ? (
        <Text style={styles.hint}>请先打开一个对话后再设置隐藏范围。</Text>
      ) : (
        <>
          {hiddenRanges.length > 0 && (
            <View style={styles.rangeList}>
              {hiddenRanges.map((r, i) => (
                <View key={i} style={styles.rangeItem}>
                  <Text style={styles.rangeText}>第 {r.from} 条 ~ 第 {r.to} 条</Text>
                  <Pressable onPress={() => removeHiddenRange(i)}>
                    <Text style={styles.rangeDelete}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View style={styles.rangeInputRow}>
            <Text style={styles.rangeLabel}>从第</Text>
            <TextInput style={styles.rangeInput} value={fromStr} onChangeText={setFromStr}
              keyboardType="number-pad" placeholder="X" placeholderTextColor={colors.textTertiary} />
            <Text style={styles.rangeLabel}>条到第</Text>
            <TextInput style={styles.rangeInput} value={toStr} onChangeText={setToStr}
              keyboardType="number-pad" placeholder="Y" placeholderTextColor={colors.textTertiary} />
            <Text style={styles.rangeLabel}>条</Text>
            <Pressable style={styles.rangeAddButton} onPress={handleAddRange}>
              <Text style={styles.rangeAddText}>添加</Text>
            </Pressable>
          </View>

          {/* 预览：选定范围的首尾两条消息 */}
          {preview && (
            <View style={styles.previewBox}>
              <Text style={styles.previewHint}>预览所选范围</Text>
              {preview.first ? (
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>
                    第 {preview.from} 条（{roleLabel(preview.first.role)}）
                  </Text>
                  <Text style={styles.previewText} numberOfLines={2}>
                    {snippet(preview.first.content) || '（空消息）'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.previewText}>第 {preview.from} 条超出当前消息范围</Text>
              )}
              {preview.last !== null && (
                preview.last ? (
                  <View style={[styles.previewItem, { marginTop: 8 }]}>
                    <Text style={styles.previewLabel}>
                      第 {preview.to} 条（{roleLabel(preview.last.role)}）
                    </Text>
                    <Text style={styles.previewText} numberOfLines={2}>
                      {snippet(preview.last.content) || '（空消息）'}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.previewText, { marginTop: 8 }]}>
                    第 {preview.to} 条超出当前消息范围
                  </Text>
                )
              )}
            </View>
          )}
        </>
      )}

      {/* AI 输出字数限制 */}
      <Text style={styles.sectionTitle}>AI 输出限制</Text>
      <Text style={styles.hint}>限制 AI 单次回复的最大 token 数，留空则不限制</Text>
      <View style={styles.modelRow}>
        <TextInput style={[styles.input, { flex: 1 }]} value={tokensStr} onChangeText={setTokensStr}
          keyboardType="number-pad" placeholder="不限制" placeholderTextColor={colors.textTertiary} />
        <Pressable style={styles.fetchButton} onPress={handleSaveTokens}>
          <Text style={styles.fetchButtonText}>保存</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* ==================== TTS 配置 Tab ==================== */

const TTS_MODELS = ['speech-02-hd', 'speech-02-turbo', 'speech-2.8-hd'];

function TTSConfigTab() {
  const { ttsConfig, setTTSConfig } = useSettingsStore();
  const [groupId, setGroupId] = useState(ttsConfig.groupId);
  const [apiKey, setApiKey] = useState(ttsConfig.apiKey);
  const [model, setModel] = useState(ttsConfig.model);
  const [voiceId, setVoiceId] = useState(ttsConfig.voiceId);
  const [speed, setSpeed] = useState(String(ttsConfig.speed));
  const [vol, setVol] = useState(String(ttsConfig.vol));
  const [pitch, setPitch] = useState(String(ttsConfig.pitch));
  const [testing, setTesting] = useState(false);

  function handleSave() {
    if (!groupId.trim() || !apiKey.trim()) {
      Alert.alert('提示', '请填写 Group ID 和 API Key');
      return;
    }
    if (!voiceId.trim()) {
      Alert.alert('提示', '请填写 Voice ID');
      return;
    }
    const s = parseFloat(speed) || 1;
    const v = parseFloat(vol) || 1;
    const p = parseFloat(pitch) || 0;
    setTTSConfig({ groupId: groupId.trim(), apiKey: apiKey.trim(), model, voiceId: voiceId.trim(), speed: s, vol: v, pitch: p });
    Alert.alert('已保存', 'TTS 配置已保存');
  }

  async function handleTest() {
    if (!groupId.trim() || !apiKey.trim() || !voiceId.trim()) {
      Alert.alert('提示', '请先填写 Group ID、API Key 和 Voice ID');
      return;
    }
    setTesting(true);
    try {
      const testConfig: TTSConfig = {
        groupId: groupId.trim(),
        apiKey: apiKey.trim(),
        model,
        voiceId: voiceId.trim(),
        speed: parseFloat(speed) || 1,
        vol: parseFloat(vol) || 1,
        pitch: parseFloat(pitch) || 0,
      };
      await playTTS('你好，这是一段语音合成测试。', testConfig);
      Alert.alert('播放成功', 'TTS 配置有效');
    } catch (e: any) {
      Alert.alert('播放失败', e.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <ScrollView style={styles.content}>
      <Text style={styles.sectionTitle}>MiniMax TTS</Text>
      <Text style={styles.hint}>使用 MiniMax 语音合成服务，需要 Group ID 和 API Key</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Group ID</Text>
        <TextInput style={styles.input} value={groupId} onChangeText={setGroupId}
          placeholder="MiniMax Group ID" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>API Key</Text>
        <TextInput style={styles.input} value={apiKey} onChangeText={setApiKey}
          placeholder="MiniMax API Key" placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Voice ID</Text>
        <TextInput style={styles.input} value={voiceId} onChangeText={setVoiceId}
          placeholder="例如：male-qn-qingse" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>模型</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.configList}>
          {TTS_MODELS.map((m) => (
            <Pressable key={m}
              style={[styles.configChip, m === model && styles.configChipActive]}
              onPress={() => setModel(m)}
            >
              <Text style={[styles.configChipText, m === model && styles.configChipTextActive]}>{m}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>语速（0.5 ~ 2.0）</Text>
        <TextInput style={styles.input} value={speed} onChangeText={setSpeed}
          keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>音量（0.1 ~ 10）</Text>
        <TextInput style={styles.input} value={vol} onChangeText={setVol}
          keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>音调（-12 ~ 12）</Text>
        <TextInput style={styles.input} value={pitch} onChangeText={setPitch}
          keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTest} disabled={testing}>
          {testing ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试播放</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* ==================== Tool 设置 Tab ==================== */

function ToolConfigTab() {
  const { memoryVaultConfig, webSearchConfig, setMemoryVaultConfig, setWebSearchConfig } = useSettingsStore();

  // 记忆库本地 state
  const [mvEnabled, setMvEnabled] = useState(memoryVaultConfig.enabled);
  const [mvBaseUrl, setMvBaseUrl] = useState(memoryVaultConfig.baseUrl);
  const [mvTopK, setMvTopK] = useState(String(memoryVaultConfig.topK));
  const [mvTokenBudget, setMvTokenBudget] = useState(String(memoryVaultConfig.tokenBudget));
  const [mvMaxCalls, setMvMaxCalls] = useState(String(memoryVaultConfig.maxToolCalls));
  const [mvAdminToken, setMvAdminToken] = useState(memoryVaultConfig.adminToken);
  const [mvTesting, setMvTesting] = useState(false);

  // 联网搜索本地 state
  const [wsEnabled, setWsEnabled] = useState(webSearchConfig.enabled);
  const [wsApiKey, setWsApiKey] = useState(webSearchConfig.tavilyApiKey);
  const [wsMaxResults, setWsMaxResults] = useState(String(webSearchConfig.maxResults));

  function handleSaveMemory() {
    const topK = parseInt(mvTopK, 10);
    const tokenBudget = parseInt(mvTokenBudget, 10);
    const maxToolCalls = parseInt(mvMaxCalls, 10);
    if (mvEnabled && !mvBaseUrl.trim()) {
      Alert.alert('提示', '启用记忆库时请填写记忆库地址');
      return;
    }
    setMemoryVaultConfig({
      enabled: mvEnabled,
      baseUrl: mvBaseUrl.trim(),
      adminToken: mvAdminToken.trim(),
      topK: isNaN(topK) || topK <= 0 ? 5 : topK,
      tokenBudget: isNaN(tokenBudget) || tokenBudget <= 0 ? 2000 : tokenBudget,
      maxToolCalls: isNaN(maxToolCalls) || maxToolCalls <= 0 ? 3 : maxToolCalls,
    });
    Alert.alert('已保存', '记忆库配置已保存');
  }

  async function handleTestMemory() {
    if (!mvBaseUrl.trim()) {
      Alert.alert('提示', '请先填写记忆库地址');
      return;
    }
    setMvTesting(true);
    try {
      const url = `${mvBaseUrl.trim().replace(/\/$/, '')}/health`;
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      Alert.alert('连接成功', '记忆库服务正常');
    } catch (e: any) {
      Alert.alert('连接失败', e.message);
    } finally {
      setMvTesting(false);
    }
  }

  function handleSaveWebSearch() {
    const maxResults = parseInt(wsMaxResults, 10);
    if (wsEnabled && !wsApiKey.trim()) {
      Alert.alert('提示', '启用联网搜索时请填写 Tavily API Key');
      return;
    }
    setWebSearchConfig({
      enabled: wsEnabled,
      tavilyApiKey: wsApiKey.trim(),
      maxResults: isNaN(maxResults) || maxResults <= 0 ? 5 : maxResults,
    });
    Alert.alert('已保存', '联网搜索配置已保存');
  }

  return (
    <ScrollView style={styles.content}>
      {/* ===== 记忆库 Memory Vault ===== */}
      <Text style={styles.sectionTitle}>记忆库 Memory Vault</Text>
      <Text style={styles.hint}>AI 可自主调用记忆库进行语义搜索和日记查询</Text>

      <View style={styles.switchRow}>
        <Text style={styles.label}>启用记忆库</Text>
        <Switch
          value={mvEnabled}
          onValueChange={setMvEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>记忆库地址</Text>
        <TextInput style={styles.input} value={mvBaseUrl} onChangeText={setMvBaseUrl}
          placeholder="https://your-memory-vault.com" placeholderTextColor={colors.textTertiary}
          autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>管理员 Token（上传日记用）</Text>
        <TextInput style={styles.input} value={mvAdminToken} onChangeText={setMvAdminToken}
          placeholder="ADMIN_TOKEN" placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>返回条数 (top_k)</Text>
        <TextInput style={styles.input} value={mvTopK} onChangeText={setMvTopK}
          keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Token 预算</Text>
        <TextInput style={styles.input} value={mvTokenBudget} onChangeText={setMvTokenBudget}
          keyboardType="number-pad" placeholder="2000" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>最大查询次数（每轮）</Text>
        <TextInput style={styles.input} value={mvMaxCalls} onChangeText={setMvMaxCalls}
          keyboardType="number-pad" placeholder="3" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.testButton} onPress={handleTestMemory} disabled={mvTesting}>
          {mvTesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.testButtonText}>测试连接</Text>}
        </Pressable>
        <Pressable style={styles.saveButton} onPress={handleSaveMemory}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>

      {/* ===== 联网搜索 Web Search ===== */}
      <Text style={styles.sectionTitle}>联网搜索 Web Search</Text>
      <Text style={styles.hint}>AI 可自主调用 Tavily 搜索互联网获取实时信息</Text>

      <View style={styles.switchRow}>
        <Text style={styles.label}>启用联网搜索</Text>
        <Switch
          value={wsEnabled}
          onValueChange={setWsEnabled}
          trackColor={{ true: colors.primary }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Tavily API Key</Text>
        <TextInput style={styles.input} value={wsApiKey} onChangeText={setWsApiKey}
          placeholder="tvly-..." placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>搜索结果数量</Text>
        <TextInput style={styles.input} value={wsMaxResults} onChangeText={setWsMaxResults}
          keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.textTertiary} />
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.saveButton} onPress={handleSaveWebSearch}>
          <Text style={styles.saveButtonText}>保存配置</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* ==================== 日记 Tab ==================== */

function DiaryTab() {
  const { diaries, loadDiaries, addDiary, editDiary, toggleFavorite, removeDiary } = useDiaryStore();
  // 隐藏楼层随对话独立，与待总结的消息同源，统一从 chat store 取
  const { messages, hiddenRanges } = useChatStore();
  const { apiConfigs, activeConfigIndex, systemPrompt, maxOutputTokens, memoryVaultConfig } = useSettingsStore();

  // AI 总结相关 state
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [summaryTitle, setSummaryTitle] = useState('');
  const summaryAbort = useRef<AbortController | null>(null);

  // 编辑日记 Modal state
  const [editing, setEditing] = useState<Diary | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // 新建日记 Modal state
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createContent, setCreateContent] = useState('');

  // 上传到云端记忆库 Modal state
  const [uploadTarget, setUploadTarget] = useState<Diary | null>(null);
  const [uploadDate, setUploadDate] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadDiaries();
  }, []);

  async function handleSummarize() {
    const config = apiConfigs[activeConfigIndex];
    if (!config || !config.baseUrl || !config.apiKey) {
      Alert.alert('提示', '请先在设置中配置 API');
      return;
    }

    // 取当前对话的 user/assistant 消息
    const chatMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (chatMessages.length === 0) {
      Alert.alert('提示', '当前对话没有可总结的消息');
      return;
    }

    const total = chatMessages.length;
    let from = parseInt(fromStr, 10);
    let to = parseInt(toStr, 10);
    if (isNaN(from)) from = 1;
    if (isNaN(to)) to = total;
    if (from < 1) from = 1;
    if (to > total) to = total;
    if (from > to) {
      Alert.alert('提示', '请输入有效的范围（起始 ≤ 结束）');
      return;
    }

    // 按 1-based index 取范围内、且未被隐藏的消息
    const selected = chatMessages.filter((_, index) => {
      const msgNum = index + 1;
      if (msgNum < from || msgNum > to) return false;
      const hidden = hiddenRanges.some((r) => msgNum >= r.from && msgNum <= r.to);
      return !hidden;
    });

    if (selected.length === 0) {
      Alert.alert('提示', '所选范围内没有未隐藏的消息');
      return;
    }

    // 拼接对话内容
    const conversationText = selected
      .map((m) => `${m.role === 'user' ? '用户' : '我'}：${m.content}`)
      .join('\n\n');

    // 已收藏日记作为近期日记
    const favorites = await getFavoriteDiaries();
    const memoryMessages: { role: string; content: string }[] = [];
    if (favorites.length > 0) {
      const memoryContent = favorites
        .map((d) => `${d.title}\n${d.content}`)
        .join('\n\n---\n\n');
      memoryMessages.push({ role: 'system', content: `以下是你的近期日记：\n\n${memoryContent}` });
    }

    const summaryPrompt =
      '请你以第一人称、流水账的形式，把下面这段对话总结成一篇今天的日记。' +
      '只输出日记正文，不要加任何额外说明或标题。';

    setSummarizing(true);
    setSummaryText('');
    summaryAbort.current = new AbortController();

    try {
      await streamChat(
        {
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...memoryMessages,
            { role: 'user', content: `${summaryPrompt}\n\n以下是对话内容：\n\n${conversationText}` },
          ],
          maxTokens: maxOutputTokens || undefined,
        },
        (token: string) => setSummaryText((prev) => prev + token),
        summaryAbort.current.signal
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        Alert.alert('总结失败', e.message || '请求失败');
      }
    } finally {
      setSummarizing(false);
      summaryAbort.current = null;
    }
  }

  function handleStopSummarize() {
    summaryAbort.current?.abort();
    setSummarizing(false);
  }

  async function handleSaveSummary() {
    const content = summaryText.trim();
    if (!content) {
      Alert.alert('提示', '没有可保存的内容');
      return;
    }
    const title = summaryTitle.trim() || `日记 ${formatFullTime(Date.now())}`;
    await addDiary(title, content);
    setSummaryText('');
    setSummaryTitle('');
    setFromStr('');
    setToStr('');
    Alert.alert('已保存', '日记已保存');
  }

  function handleOpenCreate() {
    setCreateTitle('');
    setCreateContent('');
    setCreating(true);
  }

  async function handleSaveCreate() {
    const content = createContent.trim();
    const title = createTitle.trim();
    if (!content && !title) {
      Alert.alert('提示', '请输入日记内容');
      return;
    }
    await addDiary(title || `日记 ${formatFullTime(Date.now())}`, content);
    setCreating(false);
    setCreateTitle('');
    setCreateContent('');
  }

  function handleOpenUpload(d: Diary) {
    setUploadTarget(d);
    setUploadDate(formatDateOnly(d.createdAt));
  }

  async function handleConfirmUpload() {
    if (!uploadTarget) return;
    const date = uploadDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      Alert.alert('提示', '请输入正确的日期格式：YYYY-MM-DD');
      return;
    }
    // 标题并入正文：标题\n正文
    const title = uploadTarget.title.trim();
    const body = uploadTarget.content.trim();
    const content = title ? `${title}\n${body}` : body;
    if (!content) {
      Alert.alert('提示', '该日记内容为空，无法上传');
      return;
    }
    setUploading(true);
    try {
      await uploadDiary(date, content, memoryVaultConfig);
      setUploadTarget(null);
      Alert.alert('上传成功', `日记已上传到云端记忆库（${date}）`);
    } catch (e: any) {
      Alert.alert('上传失败', e.message || '请求失败');
    } finally {
      setUploading(false);
    }
  }

  function handleOpenEdit(d: Diary) {
    setEditing(d);
    setEditTitle(d.title);
    setEditContent(d.content);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    await editDiary(editing.id, { title: editTitle.trim(), content: editContent.trim() });
    setEditing(null);
  }

  function handleDeleteDiary(d: Diary) {
    Alert.alert('删除日记', `确定删除「${d.title || '无标题'}」？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => removeDiary(d.id) },
    ]);
  }

  return (
    <ScrollView style={styles.content}>
      {/* AI 日记总结 */}
      <Text style={styles.sectionTitle}>AI 日记总结</Text>
      <Text style={styles.hint}>选择消息范围，让 AI 以第一人称流水账总结为日记（自动排除已隐藏消息，留空则全部）</Text>

      <View style={styles.rangeInputRow}>
        <Text style={styles.rangeLabel}>从第</Text>
        <TextInput style={styles.rangeInput} value={fromStr} onChangeText={setFromStr}
          keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.textTertiary} />
        <Text style={styles.rangeLabel}>条到第</Text>
        <TextInput style={styles.rangeInput} value={toStr} onChangeText={setToStr}
          keyboardType="number-pad" placeholder="末" placeholderTextColor={colors.textTertiary} />
        <Text style={styles.rangeLabel}>条</Text>
        {summarizing ? (
          <Pressable style={styles.rangeAddButton} onPress={handleStopSummarize}>
            <Text style={styles.rangeAddText}>停止</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.rangeAddButton} onPress={handleSummarize}>
            <Text style={styles.rangeAddText}>总结</Text>
          </Pressable>
        )}
      </View>

      {(summaryText.length > 0 || summarizing) && (
        <View style={styles.summaryBox}>
          <TextInput
            style={styles.summaryTitleInput}
            value={summaryTitle}
            onChangeText={setSummaryTitle}
            placeholder="日记标题（留空自动生成）"
            placeholderTextColor={colors.textTertiary}
          />
          <TextInput
            style={styles.summaryContentInput}
            value={summaryText}
            onChangeText={setSummaryText}
            multiline
            placeholder="AI 总结内容将显示在这里..."
            placeholderTextColor={colors.textTertiary}
          />
          {summarizing ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          ) : (
            <Pressable style={styles.saveButton} onPress={handleSaveSummary}>
              <Text style={styles.saveButtonText}>保存为日记</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* 我的日记 */}
      <View style={styles.diaryHeaderRow}>
        <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>我的日记</Text>
        <Pressable style={styles.diaryAddButton} onPress={handleOpenCreate}>
          <Text style={styles.diaryAddText}>+ 新建</Text>
        </Pressable>
      </View>
      {diaries.length === 0 ? (
        <Text style={styles.hint}>暂无日记</Text>
      ) : (
        diaries.map((d) => (
          <Pressable
            key={d.id}
            style={styles.diaryItem}
            onPress={() => handleOpenEdit(d)}
            onLongPress={() => handleDeleteDiary(d)}
          >
            <Pressable style={styles.diaryStar} onPress={() => toggleFavorite(d.id)} hitSlop={8}>
              <Text style={[styles.diaryStarText, d.isFavorite && styles.diaryStarActive]}>
                {d.isFavorite ? '★' : '☆'}
              </Text>
            </Pressable>
            <View style={styles.diaryContent}>
              <Text style={styles.diaryTitle} numberOfLines={1}>{d.title || '无标题'}</Text>
              <Text style={styles.diaryPreview} numberOfLines={1}>{d.content}</Text>
              <Text style={styles.diaryDate}>{formatFullTime(d.createdAt)}</Text>
            </View>
            <Pressable style={styles.diaryUpload} onPress={() => handleOpenUpload(d)} hitSlop={8}>
              <Text style={styles.diaryUploadText}>上传</Text>
            </Pressable>
          </Pressable>
        ))
      )}

      <View style={{ height: 40 }} />

      {/* 编辑日记 Modal */}
      <Modal visible={!!editing} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setEditing(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>编辑日记</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="日记标题"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={styles.summaryContentInput}
              value={editContent}
              onChangeText={setEditContent}
              multiline
              placeholder="日记内容"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setEditing(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveEdit}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* 新建日记 Modal */}
      <Modal visible={creating} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => setCreating(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>新建日记</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={createTitle}
              onChangeText={setCreateTitle}
              placeholder="日记标题（留空自动生成）"
              placeholderTextColor={colors.textTertiary}
            />
            <TextInput
              style={styles.summaryContentInput}
              value={createContent}
              onChangeText={setCreateContent}
              multiline
              placeholder="日记内容"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => setCreating(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleSaveCreate}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* 上传日记到云端 Modal */}
      <Modal visible={!!uploadTarget} transparent animationType="fade">
        <Pressable style={styles.overlay} onPress={() => !uploading && setUploadTarget(null)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>上传到云端记忆库</Text>
            <Text style={styles.hint}>标题将并入正文上传。请确认日期（一个日期对应一篇云端日记，重复日期可能覆盖）</Text>
            <TextInput
              style={styles.summaryTitleInput}
              value={uploadDate}
              onChangeText={setUploadDate}
              placeholder="日期 YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancel} onPress={() => !uploading && setUploadTarget(null)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={handleConfirmUpload} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>上传</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

/* ==================== Styles ==================== */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backButton: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  backIcon: { fontSize: 22, color: colors.text },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center' },
  tabBar: {
    flexGrow: 0, paddingTop: 12,
  },
  tabBarContent: {
    paddingHorizontal: 16, gap: 4,
  },
  tab: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  tabTextActive: { color: '#FFFFFF' },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
  },
  content: { flex: 1, padding: 20 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    marginBottom: 10, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  diaryHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10, marginTop: 8,
  },
  diaryAddButton: {
    backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6,
  },
  diaryAddText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
  configList: { marginBottom: 16 },
  configChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface, marginRight: 8,
  },
  configChipActive: { backgroundColor: colors.primary },
  configChipText: { fontSize: 13, fontWeight: '500', color: colors.text },
  configChipTextActive: { color: '#FFFFFF' },
  field: { marginBottom: 14 },
  label: { fontSize: 14, color: colors.text, marginBottom: 6, fontWeight: '500' },
  input: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 12, padding: 14, fontSize: 14, color: colors.text,
  },
  modelRow: { flexDirection: 'row', gap: 8 },
  fetchButton: {
    backgroundColor: colors.primary, borderRadius: 12,
    paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center',
  },
  fetchButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 32 },
  testButton: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  testButtonText: { fontSize: 15, fontWeight: '500', color: colors.primary },
  saveButton: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  saveButtonText: { fontSize: 15, fontWeight: '500', color: '#FFFFFF' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: colors.background, borderRadius: 16, padding: 20, width: '85%', maxHeight: '60%' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 12 },
  modelList: { maxHeight: 300 },
  modelItem: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, marginBottom: 2 },
  modelItemActive: { backgroundColor: colors.surface },
  modelItemText: { fontSize: 14, color: colors.text },
  modelItemTextActive: { color: colors.primary, fontWeight: '500' },
  // Chat settings styles
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 12,
  },
  infoLabel: { fontSize: 14, color: colors.text, fontWeight: '500' },
  infoValue: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.textTertiary, marginBottom: 12 },
  rangeList: { marginBottom: 12 },
  rangeItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6,
  },
  rangeText: { fontSize: 14, color: colors.text },
  rangeDelete: { fontSize: 20, color: colors.danger, paddingHorizontal: 8 },
  rangeInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20,
  },
  rangeLabel: { fontSize: 14, color: colors.text },
  rangeInput: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: colors.text,
    width: 50, textAlign: 'center',
  },
  rangeAddButton: {
    backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
  },
  rangeAddText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  previewBox: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 20,
  },
  previewHint: {
    fontSize: 11, color: colors.textTertiary, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  previewItem: { gap: 3 },
  previewLabel: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  previewText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  // Diary styles
  summaryBox: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20,
  },
  summaryTitleInput: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 10, padding: 12, fontSize: 15, fontWeight: '500', color: colors.text, marginBottom: 10,
  },
  summaryContentInput: {
    backgroundColor: colors.inputBackground, borderWidth: 1, borderColor: colors.inputBorder,
    borderRadius: 10, padding: 12, fontSize: 14, color: colors.text,
    minHeight: 140, textAlignVertical: 'top', marginBottom: 10,
  },
  diaryItem: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8,
  },
  diaryStar: { paddingRight: 12, paddingTop: 1 },
  diaryStarText: { fontSize: 20, color: colors.textTertiary },
  diaryStarActive: { color: colors.primary },
  diaryContent: { flex: 1, gap: 3 },
  diaryTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  diaryPreview: { fontSize: 13, color: colors.textSecondary },
  diaryDate: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  diaryUpload: {
    alignSelf: 'center', marginLeft: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, backgroundColor: colors.primaryLight,
    borderWidth: 0.5, borderColor: colors.border,
  },
  diaryUploadText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 },
  modalCancel: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  modalCancelText: { fontSize: 15, color: colors.textSecondary },
  modalConfirm: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary },
  modalConfirmText: { fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
});
