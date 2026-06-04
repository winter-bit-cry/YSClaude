import { create } from 'zustand';
import { randomUUID } from 'expo-crypto';
import { FocusSession, FocusTask, FocusTimerMode } from '../types';
import {
  createFocusTask,
  deleteFocusTask,
  getActiveFocusSession,
  getFocusSessionsByDate,
  getFocusTask,
  getFocusTasksByDate,
  incrementFocusTaskCompletedCount,
  insertFocusSession,
  updateFocusTask,
  updateFocusSession,
} from '../db/operations';
import { sendFocusSystemEvent } from '../services/focusChatEvents';

interface CreateTaskInput {
  title: string;
  timerMode: FocusTimerMode;
  durationMinutes: number;
  targetCount?: number;
}

interface FocusState {
  tasks: FocusTask[];
  sessions: FocusSession[];
  activeSession: FocusSession | null;
  selectedDateKey: string;
  isLoading: boolean;
  error: string | null;

  loadToday: () => Promise<void>;
  loadDate: (dateKey: string) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<void>;
  updateTask: (id: string, input: CreateTaskInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  manuallyCompleteTask: (taskId: string, minutes: number) => Promise<void>;
  startFocus: (taskId: string) => Promise<FocusSession | null>;
  pauseFocus: () => Promise<void>;
  resumeFocus: () => Promise<void>;
  completeFocus: () => Promise<void>;
  abandonFocus: () => Promise<void>;
  refreshActiveSession: () => Promise<void>;
}

export function localDateKeyForFocus(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function focusElapsedMs(session: FocusSession, now = Date.now()): number {
  const effectiveNow =
    session.status === 'paused' && session.pauseStartedAt
      ? session.pauseStartedAt
      : now;
  return Math.max(0, effectiveNow - session.startedAt - session.pausedDurationMs);
}

function finalPausedDuration(session: FocusSession, now: number): number {
  if (session.status !== 'paused' || !session.pauseStartedAt) {
    return session.pausedDurationMs;
  }
  return session.pausedDurationMs + Math.max(0, now - session.pauseStartedAt);
}

function formatDurationForEvent(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function modeLabel(mode: FocusTimerMode): string {
  return mode === 'countup' ? '正计时' : '倒计时';
}

function plannedDurationForInput(input: CreateTaskInput): number {
  return input.timerMode === 'countup'
    ? 0
    : Math.max(1, input.durationMinutes) * 60000;
}

function plannedTextForEvent(task: Pick<FocusTask, 'timerMode' | 'durationMs'>): string {
  return task.timerMode === 'countup'
    ? '无时间上限'
    : `计划时长 ${formatDurationForEvent(task.durationMs)}`;
}

async function loadFocusData(dateKey: string): Promise<Pick<FocusState, 'tasks' | 'sessions' | 'activeSession'>> {
  const tasks = await getFocusTasksByDate(dateKey);
  const sessions = await getFocusSessionsByDate(dateKey);
  const activeSession = await getActiveFocusSession();
  return { tasks, sessions, activeSession };
}

export const useFocusStore = create<FocusState>((set, get) => ({
  tasks: [],
  sessions: [],
  activeSession: null,
  selectedDateKey: localDateKeyForFocus(),
  isLoading: false,
  error: null,

  loadToday: async () => {
    await get().loadDate(localDateKeyForFocus());
  },

  loadDate: async (dateKey) => {
    set({ isLoading: true, error: null, selectedDateKey: dateKey });
    try {
      const data = await loadFocusData(dateKey);
      set({ ...data, isLoading: false });
    } catch (error: any) {
      set({ isLoading: false, error: error?.message || '加载专注数据失败' });
    }
  },

  createTask: async (input) => {
    const title = input.title.trim();
    if (!title) {
      set({ error: '任务名称不能为空' });
      return;
    }
    const now = Date.now();
    const task: FocusTask = {
      id: randomUUID(),
      title,
      timerMode: input.timerMode,
      durationMs: plannedDurationForInput(input),
      targetCount: Math.max(1, input.targetCount || 1),
      completedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await createFocusTask(task);
    await get().loadDate(localDateKeyForFocus(now));
  },

  updateTask: async (id, input) => {
    const title = input.title.trim();
    if (!title) {
      set({ error: '任务名称不能为空' });
      return;
    }
    const now = Date.now();
    await updateFocusTask(id, {
      title,
      timerMode: input.timerMode,
      durationMs: plannedDurationForInput(input),
      targetCount: Math.max(1, input.targetCount || 1),
      updatedAt: now,
    });
    set({ error: null });
    await get().loadDate(get().selectedDateKey);
  },

  deleteTask: async (id) => {
    const activeSession = get().activeSession;
    if (activeSession?.taskId === id) {
      set({ error: '正在专注的任务不能删除' });
      return;
    }
    await deleteFocusTask(id);
    set({ error: null });
    await get().loadDate(get().selectedDateKey);
  },

  manuallyCompleteTask: async (taskId, minutes) => {
    const task = await getFocusTask(taskId);
    if (!task) {
      set({ error: '任务不存在' });
      return;
    }
    const durationMs = Math.max(1, minutes) * 60000;
    const now = Date.now();
    const startedAt = now - durationMs;
    const session: FocusSession = {
      id: randomUUID(),
      taskId: task.id,
      taskTitle: task.title,
      timerMode: task.timerMode,
      plannedDurationMs: task.durationMs,
      startedAt,
      endedAt: now,
      pausedDurationMs: 0,
      status: 'completed',
      endReason: 'completed',
      createdAt: startedAt,
      updatedAt: now,
    };
    await insertFocusSession(session);
    await incrementFocusTaskCompletedCount(task.id, now);
    set({ error: null });
    await get().loadDate(get().selectedDateKey);

    sendFocusSystemEvent(
      `专注：用户手动标记完成了一次「${task.title}」专注，记录时长 ${formatDurationForEvent(durationMs)}。`
    ).catch(() => undefined);
  },

  startFocus: async (taskId) => {
    if (get().activeSession) {
      set({ error: '当前已有专注进行中' });
      return null;
    }

    const task = await getFocusTask(taskId);
    if (!task) {
      set({ error: '任务不存在' });
      return null;
    }

    const now = Date.now();
    const session: FocusSession = {
      id: randomUUID(),
      taskId: task.id,
      taskTitle: task.title,
      timerMode: task.timerMode,
      plannedDurationMs: task.durationMs,
      startedAt: now,
      pausedDurationMs: 0,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };

    await insertFocusSession(session);
    set({ activeSession: session, error: null });
    await get().loadDate(get().selectedDateKey);

    sendFocusSystemEvent(
      `专注：用户开始专注「${task.title}」，模式为${modeLabel(task.timerMode)}，${plannedTextForEvent(task)}。`
    ).catch(() => undefined);

    return session;
  },

  pauseFocus: async () => {
    const session = get().activeSession;
    if (!session || session.status !== 'running') return;
    const now = Date.now();
    await updateFocusSession(session.id, {
      status: 'paused',
      pauseStartedAt: now,
      updatedAt: now,
    });
    set({ activeSession: { ...session, status: 'paused', pauseStartedAt: now, updatedAt: now } });
  },

  resumeFocus: async () => {
    const session = get().activeSession;
    if (!session || session.status !== 'paused') return;
    const now = Date.now();
    const pausedDurationMs = finalPausedDuration(session, now);
    const nextSession: FocusSession = {
      ...session,
      status: 'running',
      pausedDurationMs,
      pauseStartedAt: undefined,
      updatedAt: now,
    };
    await updateFocusSession(session.id, {
      status: 'running',
      pausedDurationMs,
      pauseStartedAt: null,
      updatedAt: now,
    });
    set({ activeSession: nextSession });
  },

  completeFocus: async () => {
    const session = get().activeSession;
    if (!session) return;
    const now = Date.now();
    const elapsedMs = focusElapsedMs(session, now);
    const pausedDurationMs = finalPausedDuration(session, now);
    await updateFocusSession(session.id, {
      status: 'completed',
      endReason: 'completed',
      endedAt: now,
      pausedDurationMs,
      pauseStartedAt: null,
      updatedAt: now,
    });
    await incrementFocusTaskCompletedCount(session.taskId, now);
    const task = await getFocusTask(session.taskId);
    set({ activeSession: null, error: null });
    await get().loadDate(get().selectedDateKey);

    const countText = task
      ? `当前累计 ${task.completedCount}/${task.targetCount} 次${task.completedCount >= task.targetCount ? '，任务已达到完成定义' : ''}`
      : '任务进度已更新';
    sendFocusSystemEvent(
      `专注：用户结束并完成了一次「${session.taskTitle}」专注，实际专注 ${formatDurationForEvent(elapsedMs)}。${countText}。`
    ).catch(() => undefined);
  },

  abandonFocus: async () => {
    const session = get().activeSession;
    if (!session) return;
    const now = Date.now();
    const elapsedMs = focusElapsedMs(session, now);
    const pausedDurationMs = finalPausedDuration(session, now);
    await updateFocusSession(session.id, {
      status: 'abandoned',
      endReason: 'abandoned',
      endedAt: now,
      pausedDurationMs,
      pauseStartedAt: null,
      updatedAt: now,
    });
    set({ activeSession: null, error: null });
    await get().loadDate(get().selectedDateKey);

    sendFocusSystemEvent(
      `专注：用户放弃了「${session.taskTitle}」专注，本次已进行 ${formatDurationForEvent(elapsedMs)}。`
    ).catch(() => undefined);
  },

  refreshActiveSession: async () => {
    const activeSession = await getActiveFocusSession();
    set({ activeSession });
  },
}));
