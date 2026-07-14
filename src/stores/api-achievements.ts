import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { sqliteStorage } from '../db/kv-storage';

export type ApiAchievementMetric = 'activeDays' | 'totalTokens';
type ApiAchievementFeatureScope = 'all' | 'chat' | 'reading' | 'radio' | 'unknown';
export type ApiAchievementCategory = 'companionDays' | 'totalTokens' | 'season' | 'anniversary';
export type ApiAchievementSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type ApiAchievementBadgePattern =
  | 'award'
  | 'sparkles'
  | 'heart'
  | 'message'
  | 'book'
  | 'radio'
  | 'bolt'
  | 'gem'
  | 'flower'
  | 'sun'
  | 'leaf'
  | 'snowflake';
export type ApiAchievementBadgeColor = 'amber' | 'green' | 'blue' | 'rose' | 'violet' | 'cyan';

export interface ApiAchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: ApiAchievementCategory;
  metric: ApiAchievementMetric;
  feature: ApiAchievementFeatureScope;
  target: number;
  year?: number;
  season?: ApiAchievementSeason;
  badgePattern: ApiAchievementBadgePattern;
  badgeColor: ApiAchievementBadgeColor;
  badgeImageUri?: string;
  createdAt: number;
  updatedAt: number;
}

interface ApiAchievementsState {
  _hydrated: boolean;
  achievements: ApiAchievementDefinition[];
  anniversaryCheckIns: string[];
  saveAchievement: (achievement: ApiAchievementDefinition) => void;
  recordAnniversaryCheckIn: (dateKey: string) => void;
  resetDefaultAchievements: () => void;
}

const now = 0;

const COMPANION_DAY_STAGES: Array<Pick<ApiAchievementDefinition, 'id' | 'name' | 'description' | 'target' | 'badgePattern' | 'badgeColor'>> = [
  {
    id: 'companion-days-30',
    name: '相伴 30 天',
    description: '第一个月的稳定陪伴。',
    target: 30,
    badgePattern: 'heart',
    badgeColor: 'rose',
  },
  {
    id: 'companion-days-100',
    name: '相伴 100 天',
    description: '一百天的日常回响。',
    target: 100,
    badgePattern: 'award',
    badgeColor: 'amber',
  },
  {
    id: 'companion-days-365',
    name: '相伴 365 天',
    description: '跨过完整一年的陪伴。',
    target: 365,
    badgePattern: 'sparkles',
    badgeColor: 'green',
  },
  {
    id: 'companion-days-520',
    name: '相伴 520 天',
    description: '把喜欢写进长线里。',
    target: 520,
    badgePattern: 'gem',
    badgeColor: 'violet',
  },
  {
    id: 'companion-days-999',
    name: '相伴 999 天',
    description: '很久很久以后的仍然在场。',
    target: 999,
    badgePattern: 'award',
    badgeColor: 'cyan',
  },
];

const TOKEN_STAGES: Array<Pick<ApiAchievementDefinition, 'id' | 'name' | 'description' | 'target' | 'badgePattern' | 'badgeColor'>> = [
  {
    id: 'total-tokens-1yi',
    name: '1 亿 tokens',
    description: '第一次抵达亿级对话量。',
    target: 100000000,
    badgePattern: 'bolt',
    badgeColor: 'blue',
  },
  {
    id: 'total-tokens-10yi',
    name: '10 亿 tokens',
    description: '思绪与回应累积成河。',
    target: 1000000000,
    badgePattern: 'sparkles',
    badgeColor: 'violet',
  },
  {
    id: 'total-tokens-100yi',
    name: '100 亿 tokens',
    description: '长程协作进入新的量级。',
    target: 10000000000,
    badgePattern: 'gem',
    badgeColor: 'cyan',
  },
  {
    id: 'total-tokens-1000yi',
    name: '1000 亿 tokens',
    description: '巨量灵感被认真记录。',
    target: 100000000000,
    badgePattern: 'award',
    badgeColor: 'amber',
  },
  {
    id: 'total-tokens-100000yi',
    name: '100000 亿 tokens',
    description: '一座属于你们的长期档案馆。',
    target: 10000000000000,
    badgePattern: 'radio',
    badgeColor: 'rose',
  },
];

const SEASONS: Array<{
  key: ApiAchievementSeason;
  label: string;
  description: string;
  badgePattern: ApiAchievementBadgePattern;
  badgeColor: ApiAchievementBadgeColor;
}> = [
  {
    key: 'spring',
    label: '春',
    description: '3-5 月累计陪伴达到 60 天。',
    badgePattern: 'flower',
    badgeColor: 'green',
  },
  {
    key: 'summer',
    label: '夏',
    description: '6-8 月累计陪伴达到 60 天。',
    badgePattern: 'sun',
    badgeColor: 'amber',
  },
  {
    key: 'autumn',
    label: '秋',
    description: '9-11 月累计陪伴达到 60 天。',
    badgePattern: 'leaf',
    badgeColor: 'rose',
  },
  {
    key: 'winter',
    label: '冬',
    description: '12-2 月累计陪伴达到 60 天。',
    badgePattern: 'snowflake',
    badgeColor: 'cyan',
  },
];

function uniqueAchievementYears(years: number[]): number[] {
  return [...new Set(years.filter((year) => Number.isFinite(year) && year >= 2026))]
    .sort((a, b) => a - b);
}

function uniqueAnniversaryYears(years: number[]): number[] {
  return [...new Set(years.filter((year) => Number.isFinite(year) && year >= 2027))]
    .sort((a, b) => a - b);
}

function getDefaultApiAchievements(years: number[] = [new Date().getFullYear()]): ApiAchievementDefinition[] {
  const currentYear = new Date().getFullYear();
  const seasonYears = uniqueAchievementYears(years).filter((year) => year <= Math.max(2026, currentYear));
  const anniversaryYears = uniqueAnniversaryYears(years).filter((year) => year <= Math.max(2027, currentYear));
  const stageAchievements: ApiAchievementDefinition[] = [
    ...COMPANION_DAY_STAGES.map((stage) => ({
      ...stage,
      category: 'companionDays' as const,
      metric: 'activeDays' as const,
      feature: 'all' as const,
      createdAt: now,
      updatedAt: now,
    })),
    ...TOKEN_STAGES.map((stage) => ({
      ...stage,
      category: 'totalTokens' as const,
      metric: 'totalTokens' as const,
      feature: 'all' as const,
      createdAt: now,
      updatedAt: now,
    })),
  ];

  const seasonAchievements = seasonYears.flatMap((year) =>
    SEASONS
      .filter((season) => season.key !== 'spring' || year >= 2027)
      .map((season) => ({
        id: `season-${year}-${season.key}`,
        name: `${year} ${season.label}日章`,
        description: season.description,
        category: 'season' as const,
        metric: 'activeDays' as const,
        feature: 'all' as const,
        target: 60,
        year,
        season: season.key,
        badgePattern: season.badgePattern,
        badgeColor: season.badgeColor,
        createdAt: now,
        updatedAt: now,
      }))
  );

  const anniversaryAchievements = anniversaryYears.map((year) => {
    const anniversaryIndex = year - 2026;
    return {
      id: `anniversary-${year}`,
      name: `${anniversaryIndex} 周年纪念日`,
      description: `${year} 年 5 月 6 日当天登录即可获得。`,
      category: 'anniversary' as const,
      metric: 'activeDays' as const,
      feature: 'all' as const,
      target: 1,
      year,
      badgePattern: 'heart' as const,
      badgeColor: 'rose' as const,
      createdAt: now,
      updatedAt: now,
    };
  });

  return [...stageAchievements, ...anniversaryAchievements, ...seasonAchievements];
}

const DEFAULT_API_ACHIEVEMENTS: ApiAchievementDefinition[] = getDefaultApiAchievements();

export function getApiAchievementDefinitions(
  customizations: ApiAchievementDefinition[],
  years: number[] = [new Date().getFullYear()]
): ApiAchievementDefinition[] {
  const customizedById = new Map(customizations.map((item) => [item.id, item]));
  return getDefaultApiAchievements(years).map((definition) => {
    const custom = customizedById.get(definition.id);
    if (!custom) return definition;
    return {
      ...definition,
      name: custom.name || definition.name,
      description: custom.description || definition.description,
      badgePattern: custom.badgePattern || definition.badgePattern,
      badgeImageUri: custom.badgeImageUri || definition.badgeImageUri,
      createdAt: custom.createdAt || definition.createdAt,
      updatedAt: custom.updatedAt || definition.updatedAt,
    };
  });
}

export const useApiAchievementsStore = create<ApiAchievementsState>()(
  persist(
    (set) => ({
      _hydrated: false,
      achievements: DEFAULT_API_ACHIEVEMENTS,
      anniversaryCheckIns: [],

      saveAchievement: (achievement) =>
        set((state) => {
          const exists = state.achievements.some((item) => item.id === achievement.id);
          return {
            achievements: exists
              ? state.achievements.map((item) => (item.id === achievement.id ? achievement : item))
              : [...state.achievements, achievement],
          };
        }),

      recordAnniversaryCheckIn: (dateKey) =>
        set((state) => {
          if (state.anniversaryCheckIns.includes(dateKey)) return state;
          return {
            anniversaryCheckIns: [...state.anniversaryCheckIns, dateKey],
          };
        }),

      resetDefaultAchievements: () =>
        set({
          achievements: DEFAULT_API_ACHIEVEMENTS.map((item) => ({
            ...item,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })),
        }),
    }),
    {
      name: 'api-achievements-storage',
      storage: createJSONStorage(() => sqliteStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state._hydrated = true;
      },
    }
  )
);
