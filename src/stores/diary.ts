import { create } from 'zustand';
import { Diary } from '../types';
import { randomUUID } from 'expo-crypto';
import {
  createDiary,
  updateDiary,
  deleteDiary,
  getAllDiaries,
} from '../db/operations';

interface DiaryState {
  diaries: Diary[];
  loadDiaries: () => Promise<void>;
  addDiary: (title: string, content: string, date: string) => Promise<void>;
  editDiary: (id: string, updates: { title?: string; content?: string; date?: string }) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  removeDiary: (id: string) => Promise<void>;
}

export const useDiaryStore = create<DiaryState>((set, get) => ({
  diaries: [],

  loadDiaries: async () => {
    const diaries = await getAllDiaries();
    set({ diaries });
  },

  addDiary: async (title: string, content: string, date: string) => {
    const now = Date.now();
    const diary: Diary = {
      id: randomUUID(),
      title,
      content,
      date,
      isFavorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await createDiary(diary);
    set((state) => ({ diaries: [diary, ...state.diaries] }));
  },

  editDiary: async (id: string, updates: { title?: string; content?: string; date?: string }) => {
    const now = Date.now();
    await updateDiary(id, { ...updates, updatedAt: now });
    set((state) => ({
      diaries: state.diaries
        .map((d) => (d.id === id ? { ...d, ...updates, updatedAt: now } : d))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }));
  },

  toggleFavorite: async (id: string) => {
    const diary = get().diaries.find((d) => d.id === id);
    if (!diary) return;
    const next = !diary.isFavorite;
    await updateDiary(id, { isFavorite: next });
    set((state) => ({
      diaries: state.diaries.map((d) =>
        d.id === id ? { ...d, isFavorite: next } : d
      ),
    }));
  },

  removeDiary: async (id: string) => {
    await deleteDiary(id);
    set((state) => ({
      diaries: state.diaries.filter((d) => d.id !== id),
    }));
  },
}));
