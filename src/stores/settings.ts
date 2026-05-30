import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { sqliteStorage } from '../db/kv-storage';
import { APIConfig } from '../types';

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

interface SettingsState {
  _hydrated: boolean;
  apiConfigs: NamedAPIConfig[];
  activeConfigIndex: number;
  systemPrompt: string;
  systemPrompts: { name: string; content: string }[];
  maxOutputTokens: number | null;
  ttsConfig: TTSConfig;
  memoryVaultConfig: MemoryVaultConfig;
  webSearchConfig: WebSearchConfig;

  setActiveConfig: (index: number) => void;
  saveAPIConfig: (config: NamedAPIConfig) => void;
  removeAPIConfig: (index: number) => void;
  setSystemPrompt: (prompt: string) => void;
  setSystemPrompts: (prompts: { name: string; content: string }[]) => void;
  setMaxOutputTokens: (tokens: number | null) => void;
  setTTSConfig: (config: Partial<TTSConfig>) => void;
  setMemoryVaultConfig: (config: Partial<MemoryVaultConfig>) => void;
  setWebSearchConfig: (config: Partial<WebSearchConfig>) => void;
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
      setTTSConfig: (config) =>
        set((state) => ({ ttsConfig: { ...state.ttsConfig, ...config } })),
      setMemoryVaultConfig: (config) =>
        set((state) => ({ memoryVaultConfig: { ...state.memoryVaultConfig, ...config } })),
      setWebSearchConfig: (config) =>
        set((state) => ({ webSearchConfig: { ...state.webSearchConfig, ...config } })),
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
        ttsConfig: state.ttsConfig,
        memoryVaultConfig: state.memoryVaultConfig,
        webSearchConfig: state.webSearchConfig,
      }),
      onRehydrateStorage: () => () => {
        useSettingsStore.setState({ _hydrated: true });
      },
    }
  )
);
