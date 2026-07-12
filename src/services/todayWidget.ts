import { NativeModules, Platform } from 'react-native';
import {
  getApiUsageSummaryByDate,
  getCalendarTodosByDate,
  getCompanionActiveDateKeys,
} from '../db/operations';
import { useSettingsStore } from '../stores/settings';
import type { CalendarTodo } from '../types';

interface TodayTodoWidgetModule {
  updateSnapshot: (snapshot: TodayWidgetSnapshot) => Promise<boolean>;
  refresh: () => Promise<boolean>;
}

interface TodayWidgetTodo {
  id: string;
  title: string;
  dateKey: string;
  scheduledTime?: string;
  done: boolean;
}

interface TodayWidgetSnapshot {
  displayName: string;
  handle: string;
  avatarUri: string;
  quote: string;
  dateKey: string;
  dateLabel: string;
  todos: TodayWidgetTodo[];
  activeDays: number;
  todayMessages: number;
  todayTokens: number;
  updatedAt: number;
}

const TodayTodoWidget = NativeModules.TodayTodoWidget as TodayTodoWidgetModule | undefined;

export async function syncTodayWidget(): Promise<boolean> {
  if (Platform.OS !== 'android' || !TodayTodoWidget) return false;

  const todayKey = localDateKey(new Date());
  const [todos, activeDateKeys, usage] = await Promise.all([
    getCalendarTodosByDate(todayKey),
    getCompanionActiveDateKeys().catch(() => []),
    getApiUsageSummaryByDate(todayKey).catch(() => null),
  ]);

  const { todayWidgetConfig, appearanceConfig } = useSettingsStore.getState();
  const snapshot: TodayWidgetSnapshot = {
    displayName:
      todayWidgetConfig.displayName ||
      appearanceConfig?.userDisplayName ||
      'You',
    handle: todayWidgetConfig.handle || 'ysclaude',
    avatarUri:
      todayWidgetConfig.avatarUri ||
      appearanceConfig?.userAvatarImageUri ||
      '',
    quote: todayWidgetConfig.quote || 'One thing at a time.',
    dateKey: todayKey,
    dateLabel: formatDateLabel(new Date()),
    todos: todos.map(mapTodo),
    activeDays: activeDateKeys.length,
    todayMessages: usage?.successCalls ?? 0,
    todayTokens: usage?.totalTokens ?? 0,
    updatedAt: Date.now(),
  };

  await TodayTodoWidget.updateSnapshot(snapshot);
  return true;
}

export async function refreshTodayWidget(): Promise<boolean> {
  if (Platform.OS !== 'android' || !TodayTodoWidget) return false;
  await TodayTodoWidget.refresh();
  return true;
}

function mapTodo(todo: CalendarTodo): TodayWidgetTodo {
  return {
    id: todo.id,
    title: todo.title,
    dateKey: todo.dateKey,
    scheduledTime: todo.scheduledTime,
    done: !!todo.completedAt,
  };
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}
