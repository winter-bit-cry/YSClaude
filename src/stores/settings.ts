import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { sqliteStorage } from '../db/kv-storage';
import { APIConfig } from '../types';
import { DEFAULT_HOTBOARD_PLATFORM_TYPES } from '../utils/hotboardPlatforms';

export interface NamedAPIConfig extends APIConfig {
  name: string;
}

// HiddenRange 已迁移到 src/types，这里 re-export 保持旧的 import 路径兼容。
export type { HiddenRange } from '../types';

export interface TTSConfig {
  groupId: string;
  apiKey: string;
  model: string;
  voiceId: string;
  speed: number;
  vol: number;
  pitch: number;
}

export interface MemoryVaultConfig {
  enabled: boolean;
  baseUrl: string;
  adminToken: string;
  topK: number;
  tokenBudget: number;
  maxToolCalls: number;
}

export interface WebSearchConfig {
  enabled: boolean;
  tavilyApiKey: string;
  maxResults: number;
}

export interface WebPageReaderConfig {
  enabled: boolean;
  renderServiceUrl: string;
}

export interface WebInteractionConfig {
  enabled: boolean;
  maxToolCalls: number;
}

export interface HotboardConfig {
  enabled: boolean;
  apiKey: string;
  platforms: string;
}

export interface NativeToolConfig {
  deviceInfoEnabled: boolean;
  batteryStatusEnabled: boolean;
  appUsageStatsEnabled: boolean;
  calendarEnabled: boolean;
}

interface SettingsState {
  _hydrated: boolean;
  apiConfigs: NamedAPIConfig[];
  activeConfigIndex: number;
  systemPrompt: string;
  systemPrompts: { name: string; content: string }[];
  maxOutputTokens: number | null;
  stripThinking: boolean;
  ttsConfig: TTSConfig;
  memoryVaultConfig: MemoryVaultConfig;
  webSearchConfig: WebSearchConfig;
  webPageReaderConfig: WebPageReaderConfig;
  webInteractionConfig: WebInteractionConfig;
  hotboardConfig: HotboardConfig;
  nativeToolConfig: NativeToolConfig;

  setActiveConfig: (index: number) => void;
  saveAPIConfig: (config: NamedAPIConfig) => void;
  removeAPIConfig: (index: number) => void;
  setSystemPrompt: (prompt: string) => void;
  setSystemPrompts: (prompts: { name: string; content: string }[]) => void;
  setMaxOutputTokens: (tokens: number | null) => void;
  setStripThinking: (value: boolean) => void;
  setTTSConfig: (config: Partial<TTSConfig>) => void;
  setMemoryVaultConfig: (config: Partial<MemoryVaultConfig>) => void;
  setWebSearchConfig: (config: Partial<WebSearchConfig>) => void;
  setWebPageReaderConfig: (config: Partial<WebPageReaderConfig>) => void;
  setWebInteractionConfig: (config: Partial<WebInteractionConfig>) => void;
  setHotboardConfig: (config: Partial<HotboardConfig>) => void;
  setNativeToolConfig: (config: Partial<NativeToolConfig>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      _hydrated: false,
      apiConfigs: [],
      activeConfigIndex: 0,
      systemPrompt: 'You are a helpful assistant.',
      systemPrompts: [
        { name: '默认', content: 'You are a helpful assistant.' },
      ],
      maxOutputTokens: null,
      stripThinking: false,
      ttsConfig: {
        groupId: '',
        apiKey: '',
        model: 'speech-02-hd',
        voiceId: '',
        speed: 1,
        vol: 1,
        pitch: 0,
      },
      memoryVaultConfig: {
        enabled: false,
        baseUrl: '',
        adminToken: '',
        topK: 5,
        tokenBudget: 2000,
        maxToolCalls: 3,
      },
      webSearchConfig: {
        enabled: false,
        tavilyApiKey: '',
        maxResults: 5,
      },
      webPageReaderConfig: {
        enabled: false,
        renderServiceUrl: '',
      },
      webInteractionConfig: {
        enabled: false,
        maxToolCalls: 8,
      },
      hotboardConfig: {
        enabled: false,
        apiKey: '',
        platforms: DEFAULT_HOTBOARD_PLATFORM_TYPES.join(','),
      },
      nativeToolConfig: {
        deviceInfoEnabled: false,
        batteryStatusEnabled: false,
        appUsageStatsEnabled: false,
        calendarEnabled: false,
      },

      setActiveConfig: (index) => set({ activeConfigIndex: index }),

      saveAPIConfig: (config) =>
        set((state) => {
          const existingIndex = state.apiConfigs.findIndex((c) => c.name === config.name);
          if (existingIndex >= 0) {
            const configs = [...state.apiConfigs];
            configs[existingIndex] = config;
            return { apiConfigs: configs };
          }
          return { apiConfigs: [...state.apiConfigs, config] };
        }),

      removeAPIConfig: (index) =>
        set((state) => ({
          apiConfigs: state.apiConfigs.filter((_, i) => i !== index),
          activeConfigIndex:
            state.activeConfigIndex >= state.apiConfigs.length - 1
              ? Math.max(0, state.apiConfigs.length - 2)
              : state.activeConfigIndex,
        })),

      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
      setSystemPrompts: (prompts) => set({ systemPrompts: prompts }),

      setMaxOutputTokens: (tokens) => set({ maxOutputTokens: tokens }),
      setStripThinking: (value) => set({ stripThinking: value }),
      setTTSConfig: (config) =>
        set((state) => ({ ttsConfig: { ...state.ttsConfig, ...config } })),
      setMemoryVaultConfig: (config) =>
        set((state) => ({ memoryVaultConfig: { ...state.memoryVaultConfig, ...config } })),
      setWebSearchConfig: (config) =>
        set((state) => ({ webSearchConfig: { ...state.webSearchConfig, ...config } })),
      setWebPageReaderConfig: (config) =>
        set((state) => ({ webPageReaderConfig: { ...state.webPageReaderConfig, ...config } })),
      setWebInteractionConfig: (config) =>
        set((state) => ({ webInteractionConfig: { ...state.webInteractionConfig, ...config } })),
      setHotboardConfig: (config) =>
        set((state) => ({ hotboardConfig: { ...state.hotboardConfig, ...config } })),
      setNativeToolConfig: (config) =>
        set((state) => ({ nativeToolConfig: { ...state.nativeToolConfig, ...config } })),
    }),
    {
      name: 'ysclaude-settings',
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        apiConfigs: state.apiConfigs,
        activeConfigIndex: state.activeConfigIndex,
        systemPrompt: state.systemPrompt,
        systemPrompts: state.systemPrompts,
        maxOutputTokens: state.maxOutputTokens,
        stripThinking: state.stripThinking,
        ttsConfig: state.ttsConfig,
        memoryVaultConfig: state.memoryVaultConfig,
        webSearchConfig: state.webSearchConfig,
        webPageReaderConfig: state.webPageReaderConfig,
        webInteractionConfig: state.webInteractionConfig,
        hotboardConfig: state.hotboardConfig,
        nativeToolConfig: state.nativeToolConfig,
      }),
      onRehydrateStorage: () => () => {
        useSettingsStore.setState({ _hydrated: true });
      },
    }
  )
);
