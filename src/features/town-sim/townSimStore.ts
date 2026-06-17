import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { randomUUID } from 'expo-crypto';
import { sqliteStorage } from '../../db/kv-storage';

export const TOKENS_PER_COIN = 100;

export type TownResourceId = 'wheat' | 'vegetable' | 'egg' | 'milk' | 'flour' | 'cloth';
export type TownCropId = 'wheat' | 'vegetable';
export type TownAnimalId = 'chicken' | 'cow';
export type TownRecipeId = 'flour' | 'cloth';

export interface TownCropPlot {
  id: string;
  cropId: TownCropId | null;
  plantedAt: number | null;
  readyAt: number | null;
}

export interface TownAnimalPen {
  id: string;
  animalId: TownAnimalId;
  count: number;
  lastCollectedAt: number;
}

export interface TownResident {
  id: string;
  name: string;
  role: string;
  happiness: number;
}

export interface TownOrder {
  id: string;
  title: string;
  resourceId: TownResourceId;
  amount: number;
  rewardCoins: number;
  rewardReputation: number;
}

export interface TownSimState {
  _hydrated: boolean;
  coins: number;
  exchangedTokens: number;
  reputation: number;
  townLevel: number;
  plots: TownCropPlot[];
  pens: TownAnimalPen[];
  resources: Record<TownResourceId, number>;
  residents: TownResident[];
  orders: TownOrder[];
  lastTickAt: number;

  redeemCoinsFromTokens: (totalTokens: number, coinAmount?: number) => number;
  plantCrop: (plotId: string, cropId: TownCropId) => boolean;
  harvestPlot: (plotId: string) => boolean;
  buyPlot: () => boolean;
  buyAnimal: (animalId: TownAnimalId) => boolean;
  collectAnimalProduct: (penId: string) => boolean;
  craftRecipe: (recipeId: TownRecipeId) => boolean;
  fulfillOrder: (orderId: string) => boolean;
  addResident: () => boolean;
  upgradeTown: () => boolean;
  refreshOrders: () => void;
  clearTown: () => void;
}

export const RESOURCE_LABELS: Record<TownResourceId, string> = {
  wheat: '小麦',
  vegetable: '蔬菜',
  egg: '鸡蛋',
  milk: '牛奶',
  flour: '面粉',
  cloth: '布匹',
};

export const CROP_DEFINITIONS: Record<TownCropId, {
  label: string;
  cost: number;
  durationMs: number;
  yield: number;
  resourceId: TownResourceId;
}> = {
  wheat: {
    label: '小麦',
    cost: 3,
    durationMs: 2 * 60 * 1000,
    yield: 4,
    resourceId: 'wheat',
  },
  vegetable: {
    label: '蔬菜',
    cost: 5,
    durationMs: 4 * 60 * 1000,
    yield: 5,
    resourceId: 'vegetable',
  },
};

export const ANIMAL_DEFINITIONS: Record<TownAnimalId, {
  label: string;
  cost: number;
  durationMs: number;
  productId: TownResourceId;
  productAmount: number;
}> = {
  chicken: {
    label: '鸡',
    cost: 35,
    durationMs: 5 * 60 * 1000,
    productId: 'egg',
    productAmount: 2,
  },
  cow: {
    label: '奶牛',
    cost: 90,
    durationMs: 12 * 60 * 1000,
    productId: 'milk',
    productAmount: 2,
  },
};

export const RECIPE_DEFINITIONS: Record<TownRecipeId, {
  label: string;
  costCoins: number;
  inputs: Partial<Record<TownResourceId, number>>;
  outputId: TownResourceId;
  outputAmount: number;
}> = {
  flour: {
    label: '磨面粉',
    costCoins: 2,
    inputs: { wheat: 3 },
    outputId: 'flour',
    outputAmount: 2,
  },
  cloth: {
    label: '织布',
    costCoins: 4,
    inputs: { vegetable: 2, milk: 1 },
    outputId: 'cloth',
    outputAmount: 1,
  },
};

const RESIDENT_NAMES = ['林夏', '周禾', '阿青', '小满', '许砚', '宁舟'];
const RESIDENT_ROLES = ['农事帮手', '牧场照料员', '手工作坊学徒', '集市记录员'];
const ORDER_POOL: Array<Omit<TownOrder, 'id'>> = [
  { title: '早餐摊需要新鲜鸡蛋', resourceId: 'egg', amount: 4, rewardCoins: 24, rewardReputation: 3 },
  { title: '磨坊收购一批小麦', resourceId: 'wheat', amount: 8, rewardCoins: 20, rewardReputation: 2 },
  { title: '旅店订购蔬菜汤底', resourceId: 'vegetable', amount: 6, rewardCoins: 26, rewardReputation: 3 },
  { title: '面包房需要面粉', resourceId: 'flour', amount: 4, rewardCoins: 42, rewardReputation: 5 },
  { title: '裁缝铺预订布匹', resourceId: 'cloth', amount: 2, rewardCoins: 58, rewardReputation: 7 },
  { title: '咖啡车补充牛奶', resourceId: 'milk', amount: 3, rewardCoins: 36, rewardReputation: 4 },
];

function emptyResources(): Record<TownResourceId, number> {
  return {
    wheat: 0,
    vegetable: 0,
    egg: 0,
    milk: 0,
    flour: 0,
    cloth: 0,
  };
}

function createPlot(): TownCropPlot {
  return {
    id: randomUUID(),
    cropId: null,
    plantedAt: null,
    readyAt: null,
  };
}

function createResident(index = 0): TownResident {
  return {
    id: randomUUID(),
    name: RESIDENT_NAMES[index % RESIDENT_NAMES.length],
    role: RESIDENT_ROLES[index % RESIDENT_ROLES.length],
    happiness: 72,
  };
}

function createOrders(offset = 0): TownOrder[] {
  return [0, 1, 2].map((step) => ({
    ...ORDER_POOL[(offset + step) % ORDER_POOL.length],
    id: randomUUID(),
  }));
}

function createInitialState() {
  return {
    _hydrated: false,
    coins: 60,
    exchangedTokens: 0,
    reputation: 0,
    townLevel: 1,
    plots: [createPlot(), createPlot()],
    pens: [
      {
        id: randomUUID(),
        animalId: 'chicken' as TownAnimalId,
        count: 1,
        lastCollectedAt: Date.now(),
      },
    ],
    resources: emptyResources(),
    residents: [createResident(0)],
    orders: createOrders(),
    lastTickAt: Date.now(),
  };
}

function canSpendResources(
  resources: Record<TownResourceId, number>,
  inputs: Partial<Record<TownResourceId, number>>
): boolean {
  return Object.entries(inputs).every(([resourceId, amount]) => (
    resources[resourceId as TownResourceId] >= (amount ?? 0)
  ));
}

function spendResources(
  resources: Record<TownResourceId, number>,
  inputs: Partial<Record<TownResourceId, number>>
): Record<TownResourceId, number> {
  const next = { ...resources };
  Object.entries(inputs).forEach(([resourceId, amount]) => {
    next[resourceId as TownResourceId] -= amount ?? 0;
  });
  return next;
}

function updateTownLevel(reputation: number): number {
  if (reputation >= 90) return 4;
  if (reputation >= 45) return 3;
  if (reputation >= 15) return 2;
  return 1;
}

export const useTownSimStore = create<TownSimState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      redeemCoinsFromTokens: (totalTokens, coinAmount) => {
        const state = get();
        const claimableTokens = Math.max(0, totalTokens - state.exchangedTokens);
        const maxCoins = Math.floor(claimableTokens / TOKENS_PER_COIN);
        const coinsToClaim = Math.max(0, Math.min(coinAmount ?? maxCoins, maxCoins));
        if (coinsToClaim <= 0) return 0;
        set({
          coins: state.coins + coinsToClaim,
          exchangedTokens: state.exchangedTokens + coinsToClaim * TOKENS_PER_COIN,
          lastTickAt: Date.now(),
        });
        return coinsToClaim;
      },

      plantCrop: (plotId, cropId) => {
        const crop = CROP_DEFINITIONS[cropId];
        const state = get();
        const plot = state.plots.find((item) => item.id === plotId);
        if (!plot || plot.cropId || state.coins < crop.cost) return false;
        const now = Date.now();
        set({
          coins: state.coins - crop.cost,
          plots: state.plots.map((item) => (
            item.id === plotId
              ? { ...item, cropId, plantedAt: now, readyAt: now + crop.durationMs }
              : item
          )),
          lastTickAt: now,
        });
        return true;
      },

      harvestPlot: (plotId) => {
        const state = get();
        const plot = state.plots.find((item) => item.id === plotId);
        if (!plot?.cropId || !plot.readyAt || Date.now() < plot.readyAt) return false;
        const crop = CROP_DEFINITIONS[plot.cropId];
        set({
          resources: {
            ...state.resources,
            [crop.resourceId]: state.resources[crop.resourceId] + crop.yield,
          },
          plots: state.plots.map((item) => (
            item.id === plotId
              ? { ...item, cropId: null, plantedAt: null, readyAt: null }
              : item
          )),
          lastTickAt: Date.now(),
        });
        return true;
      },

      buyPlot: () => {
        const state = get();
        const cost = 45 + state.plots.length * 20;
        if (state.coins < cost || state.plots.length >= 6) return false;
        set({
          coins: state.coins - cost,
          plots: [...state.plots, createPlot()],
          lastTickAt: Date.now(),
        });
        return true;
      },

      buyAnimal: (animalId) => {
        const state = get();
        const animal = ANIMAL_DEFINITIONS[animalId];
        if (state.coins < animal.cost) return false;
        const existingPen = state.pens.find((pen) => pen.animalId === animalId);
        set({
          coins: state.coins - animal.cost,
          pens: existingPen
            ? state.pens.map((pen) => (
                pen.id === existingPen.id ? { ...pen, count: pen.count + 1 } : pen
              ))
            : [
                ...state.pens,
                { id: randomUUID(), animalId, count: 1, lastCollectedAt: Date.now() },
              ],
          lastTickAt: Date.now(),
        });
        return true;
      },

      collectAnimalProduct: (penId) => {
        const state = get();
        const pen = state.pens.find((item) => item.id === penId);
        if (!pen) return false;
        const animal = ANIMAL_DEFINITIONS[pen.animalId];
        const now = Date.now();
        if (now - pen.lastCollectedAt < animal.durationMs) return false;
        set({
          resources: {
            ...state.resources,
            [animal.productId]: state.resources[animal.productId] + animal.productAmount * pen.count,
          },
          pens: state.pens.map((item) => (
            item.id === penId ? { ...item, lastCollectedAt: now } : item
          )),
          lastTickAt: now,
        });
        return true;
      },

      craftRecipe: (recipeId) => {
        const recipe = RECIPE_DEFINITIONS[recipeId];
        const state = get();
        if (state.coins < recipe.costCoins || !canSpendResources(state.resources, recipe.inputs)) {
          return false;
        }
        const nextResources = spendResources(state.resources, recipe.inputs);
        set({
          coins: state.coins - recipe.costCoins,
          resources: {
            ...nextResources,
            [recipe.outputId]: nextResources[recipe.outputId] + recipe.outputAmount,
          },
          lastTickAt: Date.now(),
        });
        return true;
      },

      fulfillOrder: (orderId) => {
        const state = get();
        const order = state.orders.find((item) => item.id === orderId);
        if (!order || state.resources[order.resourceId] < order.amount) return false;
        const nextReputation = state.reputation + order.rewardReputation;
        set({
          coins: state.coins + order.rewardCoins,
          reputation: nextReputation,
          townLevel: updateTownLevel(nextReputation),
          resources: {
            ...state.resources,
            [order.resourceId]: state.resources[order.resourceId] - order.amount,
          },
          orders: state.orders.map((item) => (
            item.id === orderId
              ? { ...ORDER_POOL[(Date.now() + item.rewardCoins) % ORDER_POOL.length], id: randomUUID() }
              : item
          )),
          lastTickAt: Date.now(),
        });
        return true;
      },

      addResident: () => {
        const state = get();
        const cost = 80 + state.residents.length * 30;
        if (state.coins < cost || state.residents.length >= 8) return false;
        set({
          coins: state.coins - cost,
          residents: [...state.residents, createResident(state.residents.length)],
          lastTickAt: Date.now(),
        });
        return true;
      },

      upgradeTown: () => {
        const state = get();
        const nextLevel = state.townLevel + 1;
        const cost = nextLevel * 120;
        const requiredReputation = (nextLevel - 1) * 20;
        if (nextLevel > 5 || state.coins < cost || state.reputation < requiredReputation) return false;
        set({
          coins: state.coins - cost,
          townLevel: nextLevel,
          lastTickAt: Date.now(),
        });
        return true;
      },

      refreshOrders: () => {
        set({
          orders: createOrders(Math.floor(Date.now() / 1000) % ORDER_POOL.length),
          lastTickAt: Date.now(),
        });
      },

      clearTown: () => {
        set({ ...createInitialState(), _hydrated: true });
      },
    }),
    {
      name: 'ysclaude-town-sim',
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        coins: state.coins,
        exchangedTokens: state.exchangedTokens,
        reputation: state.reputation,
        townLevel: state.townLevel,
        plots: state.plots,
        pens: state.pens,
        resources: state.resources,
        residents: state.residents,
        orders: state.orders,
        lastTickAt: state.lastTickAt,
      }),
      onRehydrateStorage: () => () => {
        useTownSimStore.setState({ _hydrated: true });
      },
    }
  )
);
