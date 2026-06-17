import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Animated,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { lightColors, useThemeColors, type ThemeColors } from '../../src/theme/colors';
import { ActorScriptMount, GameScriptPoolPanel, GameScriptSelect } from '../../src/components/GameScriptSection';
import {
  GAME_MACARON_SWATCHES,
  useGameStore,
  type GameActor,
  type GameApiPreset,
  type GameScenario,
} from '../../src/stores/game';
import { useKeyboardHeight } from '../../src/hooks/useKeyboardHeight';

let colors = lightColors;
const CARD_GAP = 18;

function cloneScenario(scenario: GameScenario): GameScenario {
  return {
    ...scenario,
    narrator: { ...scenario.narrator },
    summarizer: scenario.summarizer ? { ...scenario.summarizer } : undefined,
    characters: scenario.characters.map((actor) => ({ ...actor })),
    hiddenRanges: scenario.hiddenRanges ? [...scenario.hiddenRanges] : [],
  };
}

async function pickImageUri(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [3, 4],
    quality: 0.9,
  });
  if (result.canceled) return null;
  return result.assets?.[0]?.uri ?? null;
}

function createCharacter(colorIndex = 0): GameActor {
  const swatch = GAME_MACARON_SWATCHES[colorIndex % GAME_MACARON_SWATCHES.length];
  return {
    id: randomUUID(),
    type: 'character',
    name: '新角色',
    prompt: '你是副本中的参与角色。根据自己的设定、当前场景和聊天历史自然回应。',
    apiPresetId: null,
    scriptEntryIds: [],
    bubbleColor: swatch.bg,
    textColor: swatch.text,
  };
}

function formatUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function GameHomeScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);

  const router = useRouter();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(320, Math.max(250, width * 0.74));
  const cardStride = cardWidth + CARD_GAP;
  const scrollX = useRef(new Animated.Value(0)).current;
  const hydrated = useGameStore((state) => state._hydrated);
  const scenarios = useGameStore((state) => state.scenarios);
  const messagesByScenario = useGameStore((state) => state.messagesByScenario);
  const createScenario = useGameStore((state) => state.createScenario);
  const saveScenario = useGameStore((state) => state.saveScenario);
  const ensureScenarioDefaults = useGameStore((state) => state.ensureScenarioDefaults);

  const [editingScenario, setEditingScenario] = useState<GameScenario | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);

  function handleCreateScenario() {
    const id = createScenario();
    const scenario = useGameStore.getState().scenarios.find((item) => item.id === id);
    if (scenario) setEditingScenario(cloneScenario(scenario));
  }

  useEffect(() => {
    scenarios.forEach((scenario) => {
      if (!scenario.summarizer || !scenario.hiddenRanges || scenario.scripts?.length) {
        ensureScenarioDefaults(scenario.id);
      }
    });
  }, [ensureScenarioDefaults, scenarios]);

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Game</Text>
        <Pressable style={styles.apiButton} onPress={() => setSettingsVisible(true)}>
          <Text style={styles.apiButtonText}>设置</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.builtinSection}>
          <Text style={styles.sectionTitle}>内置小游戏</Text>
          <Pressable style={styles.townSimCard} onPress={() => router.push('/game/town')}>
            <View style={styles.townSimVisual}>
              <Text style={styles.townSimGlyph}>田</Text>
            </View>
            <View style={styles.townSimInfo}>
              <Text style={styles.townSimTitle}>城镇经营</Text>
              <Text style={styles.townSimMeta}>Token 兑换金币 · 种植 · 养殖 · 手工业</Text>
            </View>
            <Text style={styles.townSimArrow}>›</Text>
          </Pressable>
        </View>

        <View style={styles.toolbar}>
          <Text style={styles.sectionTitle}>副本</Text>
          <Pressable style={styles.createButton} onPress={handleCreateScenario}>
            <Text style={styles.createButtonText}>新建</Text>
          </Pressable>
        </View>

        {scenarios.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>还没有副本</Text>
            <Text style={styles.emptyText}>新建一个副本，配置旁白、角色和各自的 API 后就可以进入群聊房间。</Text>
          </View>
        ) : (
          <Animated.FlatList
            data={scenarios}
            keyExtractor={(scenario) => scenario.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardStride}
            decelerationRate="fast"
            bounces={false}
            contentContainerStyle={[
              styles.carouselContent,
              { paddingHorizontal: (width - cardWidth) / 2 },
            ]}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              { useNativeDriver: true }
            )}
            scrollEventThrottle={16}
            renderItem={({ item: scenario, index }) => {
              const messageCount = messagesByScenario[scenario.id]?.length ?? 0;
              const inputRange = [
                (index - 1) * cardStride,
                index * cardStride,
                (index + 1) * cardStride,
              ];
              const animatedCardStyle = {
                opacity: scrollX.interpolate({
                  inputRange,
                  outputRange: [0.68, 1, 0.68],
                  extrapolate: 'clamp',
                }),
                transform: [
                  { perspective: 900 },
                  {
                    translateX: scrollX.interpolate({
                      inputRange,
                      outputRange: [-18, 0, 18],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    rotateY: scrollX.interpolate({
                      inputRange,
                      outputRange: ['18deg', '0deg', '-18deg'],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    scale: scrollX.interpolate({
                      inputRange,
                      outputRange: [0.9, 1, 0.9],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              };

              return (
                <Animated.View style={[styles.carouselItem, { width: cardWidth, marginRight: CARD_GAP }, animatedCardStyle]}>
                  <Pressable style={styles.scenarioCard} onPress={() => router.push(`/game/${scenario.id}`)}>
                    {scenario.cardFaceUri ? (
                      <Image source={{ uri: scenario.cardFaceUri }} style={styles.cardFaceImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.defaultCardFace}>
                        <Text style={styles.defaultCardInitial}>{scenario.title.slice(0, 2)}</Text>
                        <View style={styles.defaultCardActors}>
                          {[scenario.narrator, ...(scenario.summarizer ? [scenario.summarizer] : []), ...scenario.characters].slice(0, 5).map((actor) => (
                            <View key={actor.id} style={styles.actorBadge}>
                              <Text style={styles.actorBadgeText}>{actor.name.slice(0, 2)}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                    <View style={styles.cardInfoPanel}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{scenario.title}</Text>
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {scenario.characters.length} 个角色 · {messageCount} 条消息 · {formatUpdatedAt(scenario.updatedAt)}
                      </Text>
                      {!!scenario.description && (
                        <Text style={styles.cardDescription} numberOfLines={2}>{scenario.description}</Text>
                      )}
                    </View>
                  </Pressable>
                </Animated.View>
              );
            }}
          />
        )}
      </View>

      <ScenarioEditor
        scenario={editingScenario}
        onClose={() => setEditingScenario(null)}
        onSave={(scenario) => {
          saveScenario(scenario);
          setEditingScenario(null);
        }}
      />
      <GameSettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </View>
  );
}

function ScenarioEditor({
  scenario,
  onClose,
  onSave,
}: {
  scenario: GameScenario | null;
  onClose: () => void;
  onSave: (scenario: GameScenario) => void;
}) {
  const apiPresets = useGameStore((state) => state.apiPresets);
  const gameScripts = useGameStore((state) => state.gameScripts);
  const keyboardHeight = useKeyboardHeight();
  const [draft, setDraft] = useState<GameScenario | null>(scenario);
  const selectedScript = draft ? gameScripts.find((script) => script.id === draft.scriptId) ?? null : null;

  useEffect(() => {
    setDraft(scenario);
  }, [scenario]);

  function updateNarrator(patch: Partial<GameActor>) {
    setDraft((current) =>
      current ? { ...current, narrator: { ...current.narrator, ...patch } } : current
    );
  }

  async function pickCardFace() {
    const uri = await pickImageUri();
    if (uri) {
      setDraft((current) => (current ? { ...current, cardFaceUri: uri } : current));
    }
  }

  function updateSummarizer(patch: Partial<GameActor>) {
    setDraft((current) =>
      current?.summarizer
        ? { ...current, summarizer: { ...current.summarizer, ...patch } }
        : current
    );
  }

  function updateCharacter(actorId: string, patch: Partial<GameActor>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            characters: current.characters.map((actor) =>
              actor.id === actorId ? { ...actor, ...patch } : actor
            ),
          }
        : current
    );
  }

  function removeCharacter(actorId: string) {
    setDraft((current) =>
      current
        ? { ...current, characters: current.characters.filter((actor) => actor.id !== actorId) }
        : current
    );
  }

  function updateScriptId(scriptId: string | null) {
    setDraft((current) =>
      current
        ? {
            ...current,
            scriptId,
            narrator: { ...current.narrator, scriptEntryIds: [] },
            characters: current.characters.map((actor) => ({ ...actor, scriptEntryIds: [] })),
          }
        : current
    );
  }

  function handleSave() {
    if (!draft) return;
    if (!draft.title.trim()) {
      Alert.alert('提示', '请输入副本名称');
      return;
    }
    if (!draft.narrator.name.trim()) {
      Alert.alert('提示', '请输入旁白名称');
      return;
    }
    onSave({
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      systemPrompt: draft.systemPrompt.trim(),
      scriptId: draft.scriptId ?? null,
      scripts: undefined,
      narrator: {
        ...draft.narrator,
        name: draft.narrator.name.trim(),
        prompt: draft.narrator.prompt.trim(),
      },
      summarizer: draft.summarizer
        ? {
            ...draft.summarizer,
            name: draft.summarizer.name.trim() || '总结AI',
            prompt: draft.summarizer.prompt.trim(),
          }
        : undefined,
      characters: draft.characters.map((actor) => ({
        ...actor,
        name: actor.name.trim() || '角色',
        prompt: actor.prompt.trim(),
      })),
    });
  }

  return (
    <Modal visible={!!scenario} animationType="slide" onRequestClose={onClose}>
      {draft && (
        <View style={[styles.modalScreen, { paddingBottom: keyboardHeight }]}>
          <View style={styles.modalHeader}>
            <Pressable style={styles.headerButton} onPress={onClose}>
              <Text style={styles.headerButtonText}>‹</Text>
            </Pressable>
            <Text style={styles.modalTitle}>副本配置</Text>
            <Pressable style={styles.modalSaveButton} onPress={handleSave}>
              <Text style={styles.modalSaveText}>保存</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            <Text style={styles.sectionTitle}>基础</Text>
            <CardFacePicker
              cardFaceUri={draft.cardFaceUri}
              title={draft.title}
              onPick={pickCardFace}
              onRemove={() => setDraft({ ...draft, cardFaceUri: undefined })}
            />
            <Field label="副本名称" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
            <Field
              label="简介"
              value={draft.description}
              onChangeText={(description) => setDraft({ ...draft, description })}
              multiline
            />
            <Field
              label="副本 System Prompt"
              value={draft.systemPrompt}
              onChangeText={(systemPrompt) => setDraft({ ...draft, systemPrompt })}
              multiline
              tall
            />

            <GameScriptSelect value={draft.scriptId} onChange={updateScriptId} />

            <Text style={styles.sectionTitle}>旁白</Text>
            <View style={styles.editorCard}>
              <Field label="名称" value={draft.narrator.name} onChangeText={(name) => updateNarrator({ name })} />
              <PresetSelect
                label="API 配置"
                value={draft.narrator.apiPresetId}
                presets={apiPresets}
                onChange={(apiPresetId) => updateNarrator({ apiPresetId })}
              />
              <Field
                label="旁白身份提示词"
                value={draft.narrator.prompt}
                onChangeText={(prompt) => updateNarrator({ prompt })}
                multiline
                tall
              />
              <ActorScriptMount
                actor={draft.narrator}
                script={selectedScript}
                onChange={(scriptEntryIds) => updateNarrator({ scriptEntryIds })}
              />
            </View>

            {draft.summarizer && (
              <>
                <Text style={styles.sectionTitle}>总结 AI</Text>
                <View style={styles.editorCard}>
                  <Field label="名称" value={draft.summarizer.name} onChangeText={(name) => updateSummarizer({ name })} />
                  <PresetSelect
                    label="API 配置"
                    value={draft.summarizer.apiPresetId}
                    presets={apiPresets}
                    onChange={(apiPresetId) => updateSummarizer({ apiPresetId })}
                  />
                  <Field
                    label="总结身份提示词"
                    value={draft.summarizer.prompt}
                    onChangeText={(prompt) => updateSummarizer({ prompt })}
                    multiline
                    tall
                  />
                </View>
              </>
            )}

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>参与角色</Text>
              <Pressable
                style={styles.smallButton}
                onPress={() => setDraft({ ...draft, characters: [...draft.characters, createCharacter(draft.characters.length)] })}
              >
                <Text style={styles.smallButtonText}>添加</Text>
              </Pressable>
            </View>

            {draft.characters.map((actor, index) => (
              <View key={actor.id} style={styles.editorCard}>
                <View style={styles.actorEditorHeader}>
                  <Text style={styles.actorEditorTitle}>角色 {index + 1}</Text>
                  <Pressable style={styles.deleteActorButton} onPress={() => removeCharacter(actor.id)}>
                    <Text style={styles.deleteText}>删除</Text>
                  </Pressable>
                </View>
                <Field label="名称" value={actor.name} onChangeText={(name) => updateCharacter(actor.id, { name })} />
                <PresetSelect
                  label="API 配置"
                  value={actor.apiPresetId}
                  presets={apiPresets}
                  onChange={(apiPresetId) => updateCharacter(actor.id, { apiPresetId })}
                />
                <Field
                  label="角色设定"
                  value={actor.prompt}
                  onChangeText={(prompt) => updateCharacter(actor.id, { prompt })}
                  multiline
                  tall
                />
                <ActorScriptMount
                  actor={actor}
                  script={selectedScript}
                  onChange={(scriptEntryIds) => updateCharacter(actor.id, { scriptEntryIds })}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

function GameSettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const apiPresets = useGameStore((state) => state.apiPresets);
  const saveApiPreset = useGameStore((state) => state.saveApiPreset);
  const removeApiPreset = useGameStore((state) => state.removeApiPreset);
  const keyboardHeight = useKeyboardHeight();
  const [activeTab, setActiveTab] = useState<'api' | 'script'>('api');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [temperature, setTemperature] = useState('');
  const [maxTokens, setMaxTokens] = useState('');

  function loadPreset(preset: GameApiPreset) {
    setEditingId(preset.id);
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setApiKey(preset.apiKey);
    setModel(preset.model);
    setModels([]);
    setShowModels(false);
    setTemperature(typeof preset.temperature === 'number' ? String(preset.temperature) : '');
    setMaxTokens(typeof preset.maxTokens === 'number' ? String(preset.maxTokens) : '');
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setModels([]);
    setShowModels(false);
    setTemperature('');
    setMaxTokens('');
  }

  async function handleFetchModels() {
    if (!baseUrl.trim() || !apiKey.trim()) {
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
      const ids: string[] = (data.data || []).map((item: any) => item.id).filter(Boolean).sort();
      if (ids.length === 0) {
        Alert.alert('提示', '没有获取到模型列表');
      } else {
        setModels(ids);
        setShowModels(true);
      }
    } catch (error: any) {
      Alert.alert('拉取失败', error?.message || '无法获取模型列表');
    } finally {
      setFetching(false);
    }
  }

  async function handleTest() {
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      Alert.alert('提示', '请填写 Base URL、API Key 和 Model');
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
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 120)}`);
      }
      Alert.alert('连接有效', '副本 API 配置测试通过');
    } catch (error: any) {
      Alert.alert('连接失败', error?.message || '请求失败');
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      Alert.alert('提示', '请填写名称、Base URL、API Key 和 Model');
      return;
    }
    const parsedTemperature = temperature.trim() ? Number(temperature.trim()) : undefined;
    const parsedMaxTokens = maxTokens.trim() ? Number(maxTokens.trim()) : undefined;
    if (parsedTemperature !== undefined && !Number.isFinite(parsedTemperature)) {
      Alert.alert('提示', 'temperature 必须是数字');
      return;
    }
    if (parsedMaxTokens !== undefined && (!Number.isFinite(parsedMaxTokens) || parsedMaxTokens <= 0)) {
      Alert.alert('提示', 'max tokens 必须是正数');
      return;
    }

    saveApiPreset({
      id: editingId || undefined,
      name,
      baseUrl,
      apiKey,
      model,
      temperature: parsedTemperature,
      maxTokens: parsedMaxTokens,
    });
    resetForm();
  }

  function handleDelete(preset: GameApiPreset) {
    Alert.alert('删除 API 配置', `确定删除「${preset.name}」吗？引用它的角色会清空选择。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removeApiPreset(preset.id);
          if (editingId === preset.id) resetForm();
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalScreen, { paddingBottom: keyboardHeight }]}>
        <View style={styles.modalHeader}>
          <Pressable style={styles.headerButton} onPress={onClose}>
            <Text style={styles.headerButtonText}>‹</Text>
          </Pressable>
          <Text style={styles.modalTitle}>Game 设置</Text>
          {activeTab === 'api' ? (
            <Pressable style={styles.modalSaveButton} onPress={handleSave}>
              <Text style={styles.modalSaveText}>保存</Text>
            </Pressable>
          ) : (
            <View style={styles.headerButton} />
          )}
        </View>

        <View style={styles.settingsTabs}>
          <Pressable
            style={[styles.settingsTab, activeTab === 'api' && styles.settingsTabActive]}
            onPress={() => setActiveTab('api')}
          >
            <Text style={[styles.settingsTabText, activeTab === 'api' && styles.settingsTabTextActive]}>API 池</Text>
          </Pressable>
          <Pressable
            style={[styles.settingsTab, activeTab === 'script' && styles.settingsTabActive]}
            onPress={() => setActiveTab('script')}
          >
            <Text style={[styles.settingsTabText, activeTab === 'script' && styles.settingsTabTextActive]}>剧本池</Text>
          </Pressable>
        </View>

        {activeTab === 'api' ? (
          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            {apiPresets.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>已保存</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
                  {apiPresets.map((preset) => (
                    <Pressable
                      key={preset.id}
                      style={[styles.presetChip, editingId === preset.id && styles.presetChipActive]}
                      onPress={() => loadPreset(preset)}
                      onLongPress={() => handleDelete(preset)}
                    >
                      <Text style={[styles.presetChipText, editingId === preset.id && styles.presetChipTextActive]}>
                        {preset.name}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable style={styles.presetChip} onPress={resetForm}>
                    <Text style={styles.presetChipText}>新建</Text>
                  </Pressable>
                </ScrollView>
              </>
            )}

            <Text style={styles.sectionTitle}>配置</Text>
            <Field label="名称" value={name} onChangeText={setName} placeholder="例如：旁白模型" />
            <Field label="Base URL" value={baseUrl} onChangeText={setBaseUrl} placeholder="https://api.openai.com/v1" autoCapitalize="none" />
            <Field label="API Key" value={apiKey} onChangeText={setApiKey} placeholder="sk-..." secureTextEntry autoCapitalize="none" />
            <View style={styles.field}>
              <Text style={styles.label}>Model</Text>
              <View style={styles.modelRow}>
                <TextInput
                  style={[styles.input, styles.modelInput]}
                  value={model}
                  onChangeText={setModel}
                  placeholder="gpt-4.1"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                />
                <Pressable style={styles.fetchButton} onPress={handleFetchModels} disabled={fetching}>
                  {fetching ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.fetchButtonText}>拉取</Text>}
                </Pressable>
              </View>
            </View>
            <View style={styles.twoColumnRow}>
              <Field
                label="temperature"
                value={temperature}
                onChangeText={setTemperature}
                placeholder="可选"
                keyboardType="decimal-pad"
                compact
              />
              <Field
                label="max tokens"
                value={maxTokens}
                onChangeText={setMaxTokens}
                placeholder="可选"
                keyboardType="number-pad"
                compact
              />
            </View>
            <Pressable style={styles.testConnectionButton} onPress={handleTest} disabled={testing}>
              {testing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.testConnectionText}>测试连接</Text>
              )}
            </Pressable>
          </ScrollView>
        ) : (
          <GameScriptPoolPanel />
        )}

        <Modal visible={showModels} transparent animationType="fade" onRequestClose={() => setShowModels(false)}>
          <Pressable style={styles.overlay} onPress={() => setShowModels(false)}>
            <View style={styles.pickerPanel} onStartShouldSetResponder={() => true}>
              <Text style={styles.pickerTitle}>选择模型</Text>
              <ScrollView style={styles.modelList}>
                {models.map((item) => (
                  <Pressable
                    key={item}
                    style={[styles.pickerItem, item === model && styles.pickerItemActive]}
                    onPress={() => {
                      setModel(item);
                      setShowModels(false);
                    }}
                  >
                    <Text style={[styles.pickerItemText, item === model && styles.pickerItemTextActive]}>{item}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
}

function CardFacePicker({
  cardFaceUri,
  title,
  onPick,
  onRemove,
}: {
  cardFaceUri?: string;
  title: string;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.cardFacePicker}>
      <View style={styles.cardFacePreview}>
        {cardFaceUri ? (
          <Image source={{ uri: cardFaceUri }} style={styles.cardFacePreviewImage} resizeMode="cover" />
        ) : (
          <Text style={styles.cardFacePreviewText}>{title.slice(0, 2) || '副本'}</Text>
        )}
      </View>
      <View style={styles.cardFacePickerText}>
        <Text style={styles.label}>牌面</Text>
        <Text style={styles.cardFaceHint}>{cardFaceUri ? '已使用自定义牌面' : '默认牌面'}</Text>
      </View>
      <View style={styles.cardFaceActions}>
        <Pressable style={styles.cardFaceButton} onPress={onPick}>
          <Text style={styles.cardFaceButtonText}>上传</Text>
        </Pressable>
        {cardFaceUri && (
          <Pressable style={styles.cardFaceRemoveButton} onPress={onRemove}>
            <Text style={styles.cardFaceRemoveText}>移除</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function PresetSelect({
  label,
  value,
  presets,
  onChange,
}: {
  label: string;
  value: string | null;
  presets: GameApiPreset[];
  onChange: (value: string | null) => void;
}) {
  const [visible, setVisible] = useState(false);
  const selected = presets.find((preset) => preset.id === value);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.select} onPress={() => setVisible(true)}>
        <Text style={[styles.selectText, !selected && styles.placeholderText]}>
          {selected ? selected.name : '选择副本 API 配置'}
        </Text>
        <Text style={styles.selectArrow}>⌄</Text>
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <View style={styles.pickerPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.pickerTitle}>{label}</Text>
            <Pressable
              style={styles.pickerItem}
              onPress={() => {
                onChange(null);
                setVisible(false);
              }}
            >
              <Text style={styles.pickerItemText}>不选择</Text>
            </Pressable>
            {presets.map((preset) => (
              <Pressable
                key={preset.id}
                style={[styles.pickerItem, preset.id === value && styles.pickerItemActive]}
                onPress={() => {
                  onChange(preset.id);
                  setVisible(false);
                }}
              >
                <Text style={[styles.pickerItemText, preset.id === value && styles.pickerItemTextActive]}>
                  {preset.name}
                </Text>
                <Text style={styles.pickerMeta} numberOfLines={1}>{preset.model}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  tall,
  secureTextEntry,
  autoCapitalize,
  keyboardType,
  compact,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  tall?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  compact?: boolean;
}) {
  return (
    <View style={[styles.field, compact && styles.compactField]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.multilineInput, tall && styles.tallInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerButtonText: {
    fontSize: 28,
    lineHeight: 30,
    color: colors.text,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
  },
  apiButton: {
    minWidth: 38,
    height: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  apiButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingTop: 18,
  },
  builtinSection: {
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  townSimCard: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  townSimVisual: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  townSimGlyph: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '900',
  },
  townSimInfo: {
    flex: 1,
    minWidth: 0,
  },
  townSimTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  townSimMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  townSimArrow: {
    color: colors.textTertiary,
    fontSize: 28,
    lineHeight: 30,
  },
  contentInner: {
    padding: 18,
    paddingBottom: 36,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 18,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 10,
    marginTop: 8,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 18,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  scenarioCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  carouselContent: {
    alignItems: 'center',
    paddingTop: 22,
    paddingBottom: 36,
  },
  carouselItem: {
    height: 430,
  },
  cardFaceImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  defaultCardFace: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    padding: 20,
  },
  defaultCardInitial: {
    width: 118,
    height: 118,
    borderRadius: 59,
    lineHeight: 118,
    textAlign: 'center',
    overflow: 'hidden',
    backgroundColor: colors.inputBackground,
    color: colors.primary,
    fontSize: 34,
    fontWeight: '900',
  },
  defaultCardActors: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 22,
  },
  cardInfoPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 8,
    backgroundColor: colors.background === '#12100D' ? 'rgba(18,16,13,0.88)' : 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  cardMeta: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 4,
  },
  deleteText: {
    color: colors.danger,
  },
  cardDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  actorPreviewRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actorBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actorBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  modalScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  modalSaveButton: {
    minWidth: 38,
    height: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
  },
  modalSaveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  modalContent: {
    flex: 1,
  },
  modalContentInner: {
    padding: 18,
    paddingBottom: 40,
  },
  settingsTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  settingsTab: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsTabActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  settingsTabText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  settingsTabTextActive: {
    color: colors.primary,
  },
  editorCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardFacePicker: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 14,
  },
  cardFacePreview: {
    width: 54,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardFacePreviewImage: {
    width: '100%',
    height: '100%',
  },
  cardFacePreviewText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  cardFacePickerText: {
    flex: 1,
    minWidth: 0,
  },
  cardFaceHint: {
    color: colors.textTertiary,
    fontSize: 12,
  },
  cardFaceActions: {
    gap: 6,
  },
  cardFaceButton: {
    minHeight: 32,
    borderRadius: 8,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  cardFaceButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  cardFaceRemoveButton: {
    minHeight: 32,
    borderRadius: 8,
    backgroundColor: colors.dangerSurface,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  cardFaceRemoveText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: colors.primary,
  },
  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  actorEditorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  actorEditorTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  deleteActorButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  field: {
    marginBottom: 13,
  },
  compactField: {
    flex: 1,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 44,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
  },
  modelRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modelInput: {
    flex: 1,
  },
  fetchButton: {
    minWidth: 62,
    borderRadius: 10,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  fetchButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  testConnectionButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 24,
  },
  testConnectionText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  multilineInput: {
    minHeight: 78,
    lineHeight: 20,
  },
  tallInput: {
    minHeight: 118,
  },
  select: {
    minHeight: 44,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  placeholderText: {
    color: colors.textTertiary,
    fontWeight: '500',
  },
  selectArrow: {
    color: colors.textTertiary,
    fontSize: 18,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  pickerPanel: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '70%',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  pickerItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9,
    marginBottom: 4,
    backgroundColor: colors.inputBackground,
  },
  pickerItemActive: {
    backgroundColor: colors.primaryLight,
  },
  pickerItemText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  pickerItemTextActive: {
    color: colors.primary,
  },
  pickerMeta: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  modelList: {
    maxHeight: 320,
  },
  presetRow: {
    marginBottom: 14,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.surface,
    marginRight: 8,
  },
  presetChipActive: {
    backgroundColor: colors.primary,
  },
  presetChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  presetChipTextActive: {
    color: '#FFFFFF',
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 10,
  },
});

let styles = createStyles(colors);
