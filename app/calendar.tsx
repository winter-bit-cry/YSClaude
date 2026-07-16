import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Droplets,
  Eye,
  MessageSquareText,
  Newspaper,
  Plus,
  X,
} from 'lucide-react-native';
import { CalendarTodo, PeriodRecord } from '../src/types';
import {
  createCalendarTodo,
  deleteCalendarTodo,
  getCalendarTodosByDate,
  getConversationMessageDates,
  getDailyPaperDateKeys,
  getFirstMessageInDateRange,
  getUnfinishedCalendarTodosBeforeDate,
  updateCalendarTodo,
} from '../src/db/operations';
import { useChatStore } from '../src/stores/chat';
import { usePeriodStore } from '../src/stores/period';
import { useSettingsStore } from '../src/stores/settings';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';
import {
  addDaysToDateKey,
  buildPeriodDateSet,
  calculatePeriodPrediction,
  findPeriodRecordForDate,
  getDateKeysInRange,
} from '../src/utils/periods';
import { syncTodayWidget } from '../src/services/todayWidget';

let colors = lightColors;

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const TODO_SWATCHES = [
  ['#DDF4E7', '#237257'],
  ['#DDEBFF', '#2F5D9C'],
  ['#FFE1D6', '#A14B36'],
  ['#FFF2B8', '#88701F'],
  ['#E9E2FF', '#6652A8'],
  ['#D7F7F3', '#28786F'],
];

type ParsedTodoInput = {
  title: string;
  scheduledTime?: string;
};

type CyclePhase = 'follicular' | 'ovulation' | 'luteal';

const CYCLE_PHASE_META: Record<CyclePhase, { label: string; backgroundColor: string; textColor: string }> = {
  follicular: { label: '卵泡期', backgroundColor: '#E3F5EA', textColor: '#237257' },
  ovulation: { label: '排卵期', backgroundColor: '#FFF1B8', textColor: '#8B6B16' },
  luteal: { label: '黄体期', backgroundColor: '#EDE6FF', textColor: '#6652A8' },
};

const TIME_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const TIME_MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function dateRangeForKey(key: string): { startAt: number; endAt: number } {
  const [year, month, day] = key.split('-').map((part) => parseInt(part, 10));
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

function buildCalendarCells(month: Date): Array<Date | null> {
  const first = startOfMonth(month);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatSelectedDate(key: string): string {
  const date = dateFromKey(key);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeScheduledTime(value: string): string | null | undefined {
  const text = value.trim();
  if (!text) return undefined;

  let hourText = '';
  let minuteText = '';
  const compact = text.match(/^(\d{3,4})$/);
  if (compact) {
    const raw = compact[1];
    hourText = raw.length === 3 ? raw.slice(0, 1) : raw.slice(0, 2);
    minuteText = raw.length === 3 ? raw.slice(1) : raw.slice(2);
  } else {
    const match = text.match(/^(\d{1,2})(?:[:：点时]\s*(\d{1,2})?)?\s*分?$/);
    if (!match) return null;
    hourText = match[1];
    minuteText = match[2] || '0';
  }

  const hour = parseInt(hourText, 10);
  const minute = parseInt(minuteText || '0', 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTodoInput(rawTitle: string, selectedTime?: string): ParsedTodoInput | null {
  let title = rawTitle.trim();
  if (!title) return null;
  if (selectedTime) return { title, scheduledTime: selectedTime };

  const leading = title.match(/^(\d{1,2})(?:[:：点时]\s*(\d{1,2})?)\s*(.+)$/);
  if (!leading) return { title };

  const parsed = normalizeScheduledTime(`${leading[1]}:${leading[2] || '0'}`);
  if (!parsed) return { title };
  title = leading[3].trim();
  return title ? { title, scheduledTime: parsed } : null;
}

function isTodoDone(todo: CalendarTodo): boolean {
  return !!todo.completedAt;
}

function formatTodoLine(todo: CalendarTodo): string {
  return todo.scheduledTime ? `${todo.scheduledTime} ${todo.title}` : todo.title;
}

function buildPeriodPreview(records: PeriodRecord[], todayKey: string): string {
  const actualRecord = findPeriodRecordForDate(records, todayKey);
  if (actualRecord) {
    if (!actualRecord.endDate) {
      return `今天会发送：正在记录中，开始日期为 ${actualRecord.startDate}。`;
    }
    return `今天会发送：当前记录区间为 ${actualRecord.startDate} 至 ${actualRecord.endDate}。`;
  }

  const prediction = calculatePeriodPrediction(records, todayKey);
  if (!prediction) return '暂无可用的生理期记录或预测。';
  if (todayKey >= prediction.startDate && todayKey <= prediction.endDate) {
    return `今天会发送：预测当前处于生理期，区间为 ${prediction.startDate} 至 ${prediction.endDate}，预计持续 ${prediction.durationDays} 天。`;
  }
  const notifyStartDate = addDaysToDateKey(prediction.startDate, -2);
  if (todayKey >= notifyStartDate && todayKey < prediction.startDate) {
    return `今天会发送：预测下次生理期将于 ${prediction.startDate} 开始，预计持续 ${prediction.durationDays} 天。`;
  }
  return `当前不会发送：仅在预计开始前 2 天（${notifyStartDate}）至经期内发送；预测下次开始为 ${prediction.startDate}。`;
}

function buildTodoPreview(todos: CalendarTodo[]): string[] {
  const unfinished = todos.filter((todo) => !isTodoDone(todo));
  if (unfinished.length === 0) return ['今天没有未完成待办。'];
  return unfinished.map((todo, index) => `${index + 1}. ${formatTodoLine(todo)}`);
}

function buildCyclePhaseMap(records: PeriodRecord[]): Map<string, CyclePhase> {
  const phaseMap = new Map<string, CyclePhase>();
  const prediction = calculatePeriodPrediction(records);
  if (!prediction) return phaseMap;

  const ovulationDay = addDaysToDateKey(prediction.startDate, -14);
  const fertileStart = addDaysToDateKey(ovulationDay, -5);
  const fertileEnd = addDaysToDateKey(ovulationDay, 1);
  const lutealStart = addDaysToDateKey(fertileEnd, 1);
  const lutealEnd = addDaysToDateKey(prediction.startDate, -1);

  const latestCompleted = records
    .filter((record): record is PeriodRecord & { endDate: string } => !!record.endDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  const follicularStart = latestCompleted
    ? addDaysToDateKey(latestCompleted.endDate, 1)
    : addDaysToDateKey(prediction.startDate, -prediction.cycleDays + prediction.durationDays);
  const follicularEnd = addDaysToDateKey(fertileStart, -1);

  getDateKeysInRange(follicularStart, follicularEnd).forEach((key) => phaseMap.set(key, 'follicular'));
  getDateKeysInRange(fertileStart, fertileEnd).forEach((key) => phaseMap.set(key, 'ovulation'));
  getDateKeysInRange(lutealStart, lutealEnd).forEach((key) => phaseMap.set(key, 'luteal'));

  return phaseMap;
}

export default function CalendarScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const todayKey = dateKey(new Date());
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [chatDateKeys, setChatDateKeys] = useState<Set<string>>(new Set());
  const [dailyPaperDateKeys, setDailyPaperDateKeys] = useState<Set<string>>(new Set());
  const [todos, setTodos] = useState<CalendarTodo[]>([]);
  const [todayPreviewTodos, setTodayPreviewTodos] = useState<CalendarTodo[]>([]);
  const [overdueTodos, setOverdueTodos] = useState<CalendarTodo[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [periodActionVisible, setPeriodActionVisible] = useState(false);
  const [syncVisible, setSyncVisible] = useState(false);
  const [cyclePhasesVisible, setCyclePhasesVisible] = useState(false);
  const [editingTodo, setEditingTodo] = useState<CalendarTodo | null>(null);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoUsesTime, setTodoUsesTime] = useState(false);
  const [todoHour, setTodoHour] = useState('18');
  const [todoMinute, setTodoMinute] = useState('00');
  const busyRef = useRef(false);
  const todoInputRef = useRef<TextInput>(null);

  const conversationId = useChatStore((state) => state.conversationId);
  const loadConversationAroundMessage = useChatStore((state) => state.loadConversationAroundMessage);
  const periodSendToAI = useSettingsStore((state) => !!state.periodConfig?.sendToAI);
  const sendTodayTodosToAI = useSettingsStore((state) => !!state.calendarAiSyncConfig?.sendTodayTodosToAI);
  const setPeriodConfig = useSettingsStore((state) => state.setPeriodConfig);
  const setCalendarAiSyncConfig = useSettingsStore((state) => state.setCalendarAiSyncConfig);
  const {
    periodRecords,
    loadPeriodRecords,
    addPeriodRecord,
    editPeriodRecord,
    removePeriodRecord,
  } = usePeriodStore();

  const periodDateKeys = useMemo(() => buildPeriodDateSet(periodRecords), [periodRecords]);
  const periodPrediction = useMemo(() => calculatePeriodPrediction(periodRecords), [periodRecords]);
  const predictedPeriodDateKeys = useMemo(() => {
    if (!periodPrediction) return new Set<string>();
    return new Set(getDateKeysInRange(periodPrediction.startDate, periodPrediction.endDate));
  }, [periodPrediction]);
  const pendingPeriodRecord = useMemo(
    () => periodRecords.find((record) => !record.endDate) || null,
    [periodRecords]
  );
  const selectedHasChat = chatDateKeys.has(selectedDateKey);
  const selectedHasDailyPaper = dailyPaperDateKeys.has(selectedDateKey);
  const aiSyncCount = Number(periodSendToAI) + Number(sendTodayTodosToAI);
  const periodPreview = useMemo(() => buildPeriodPreview(periodRecords, todayKey), [periodRecords, todayKey]);
  const todoPreview = useMemo(() => buildTodoPreview(todayPreviewTodos), [todayPreviewTodos]);
  const cyclePhaseMap = useMemo(() => buildCyclePhaseMap(periodRecords), [periodRecords]);
  const selectedPeriodRecord = useMemo(
    () => findPeriodRecordForDate(periodRecords, selectedDateKey),
    [periodRecords, selectedDateKey]
  );
  const selectedTodoTime = todoUsesTime ? `${todoHour}:${todoMinute}` : undefined;

  const refreshTodos = useCallback(async (key: string) => {
    setTodos(await getCalendarTodosByDate(key));
  }, []);

  const refreshTodayPreviewTodos = useCallback(async () => {
    setTodayPreviewTodos(await getCalendarTodosByDate(todayKey));
  }, [todayKey]);

  const refreshOverdueTodos = useCallback(async () => {
    setOverdueTodos(await getUnfinishedCalendarTodosBeforeDate(todayKey));
  }, [todayKey]);

  const refreshPage = useCallback(async () => {
    setLoading(true);
    try {
      const [dates, paperDates, selectedTodos, overdue] = await Promise.all([
        conversationId ? getConversationMessageDates(conversationId) : Promise.resolve([]),
        getDailyPaperDateKeys(),
        getCalendarTodosByDate(selectedDateKey),
        getUnfinishedCalendarTodosBeforeDate(todayKey),
        loadPeriodRecords(),
      ]);
      setChatDateKeys(new Set(dates));
      setDailyPaperDateKeys(new Set(paperDates));
      setTodos(selectedTodos);
      setOverdueTodos(overdue);
    } finally {
      setLoading(false);
    }
  }, [conversationId, loadPeriodRecords, selectedDateKey, todayKey]);

  useFocusEffect(
    useCallback(() => {
      refreshPage().catch(() => undefined);
    }, [refreshPage])
  );

  const selectDate = useCallback((key: string) => {
    setSelectedDateKey(key);
    refreshTodos(key).catch(() => undefined);
  }, [refreshTodos]);

  const shiftMonth = useCallback((count: number) => {
    setCalendarMonth((current) => addMonths(current, count));
  }, []);

  const openAiSync = useCallback(async () => {
    setSyncVisible(true);
    try {
      await refreshTodayPreviewTodos();
    } catch {
      setTodayPreviewTodos([]);
    }
  }, [refreshTodayPreviewTodos]);

  const openPeriodActions = useCallback(() => {
    setPeriodActionVisible(true);
  }, []);

  const recordPeriodStart = useCallback(async () => {
    const target = selectedPeriodRecord || pendingPeriodRecord;
    if (target) {
      if (target.endDate && selectedDateKey > target.endDate) {
        Alert.alert('无法修改', '开始日期不能晚于当前结束日期。');
        return;
      }
      await editPeriodRecord(target.id, { startDate: selectedDateKey });
    } else {
      await addPeriodRecord(selectedDateKey, null);
    }
    setPeriodActionVisible(false);
    await loadPeriodRecords();
  }, [
    addPeriodRecord,
    editPeriodRecord,
    loadPeriodRecords,
    pendingPeriodRecord,
    selectedDateKey,
    selectedPeriodRecord,
  ]);

  const recordPeriodEnd = useCallback(async () => {
    const target = selectedPeriodRecord || pendingPeriodRecord;
    if (!target) {
      Alert.alert('没有可结束的记录', '请先记录一个开始日期。');
      return;
    }
    if (selectedDateKey <= target.startDate) {
      Alert.alert('选择结束日', `结束日期需要晚于 ${target.startDate}。`);
      return;
    }
    await editPeriodRecord(target.id, { endDate: selectedDateKey });
    setPeriodActionVisible(false);
    await loadPeriodRecords();
  }, [editPeriodRecord, loadPeriodRecords, pendingPeriodRecord, selectedDateKey, selectedPeriodRecord]);

  const deletePeriodRecordForSelection = useCallback(() => {
    const target = selectedPeriodRecord || pendingPeriodRecord;
    if (!target) {
      Alert.alert('没有可删除的记录', '这一天没有生理期记录。');
      return;
    }
    const label = target.endDate ? `${target.startDate} 至 ${target.endDate}` : `${target.startDate} 开始的未结束记录`;
    Alert.alert('删除记录', `确定删除 ${label}？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          removePeriodRecord(target.id)
            .then(() => {
              setPeriodActionVisible(false);
              return loadPeriodRecords();
            })
            .catch(() => undefined);
        },
      },
    ]);
  }, [
    loadPeriodRecords,
    pendingPeriodRecord,
    removePeriodRecord,
    selectedPeriodRecord,
  ]);

  const openDailyPaper = useCallback(() => {
    router.push(`/daily-paper/${selectedDateKey}`);
  }, [router, selectedDateKey]);

  const jumpToChatDate = useCallback(async () => {
    if (!conversationId) {
      Alert.alert('没有当前对话', '先进入一个对话后，再从日历跳转聊天记录。');
      return;
    }
    if (!selectedHasChat) {
      Alert.alert('没有聊天记录', '这一天没有当前对话的消息。');
      return;
    }
    const { startAt, endAt } = dateRangeForKey(selectedDateKey);
    const firstMessage = await getFirstMessageInDateRange(conversationId, startAt, endAt);
    if (!firstMessage) {
      Alert.alert('没有聊天记录', '这一天没有找到可跳转的消息。');
      return;
    }
    await loadConversationAroundMessage(conversationId, firstMessage.id);
    router.replace('/');
  }, [conversationId, loadConversationAroundMessage, router, selectedDateKey, selectedHasChat]);

  const openCreateTodo = useCallback(() => {
    setEditingTodo(null);
    setTodoTitle('');
    setTodoUsesTime(false);
    setTodoHour('18');
    setTodoMinute('00');
    setCreateVisible(true);
  }, []);

  const moveOverdueTodosToToday = useCallback(async () => {
    if (busyRef.current || overdueTodos.length === 0) return;
    const now = Date.now();
    busyRef.current = true;
    try {
      await Promise.all(
        overdueTodos.map((todo) =>
          updateCalendarTodo(todo.id, {
            dateKey: todayKey,
            updatedAt: now,
          })
        )
      );
      setCalendarMonth(startOfMonth(new Date()));
      setSelectedDateKey(todayKey);
      await Promise.all([
        refreshTodos(todayKey),
        refreshTodayPreviewTodos(),
        refreshOverdueTodos(),
      ]);
      syncTodayWidget().catch(() => undefined);
    } finally {
      busyRef.current = false;
    }
  }, [overdueTodos, refreshOverdueTodos, refreshTodayPreviewTodos, refreshTodos, todayKey]);

  const openEditTodo = useCallback((todo: CalendarTodo) => {
    const [hour = '18', minute = '00'] = (todo.scheduledTime || '18:00').split(':');
    setEditingTodo(todo);
    setTodoTitle(todo.title);
    setTodoUsesTime(!!todo.scheduledTime);
    setTodoHour(hour);
    setTodoMinute(minute);
    setCreateVisible(true);
  }, []);

  const handleTodoUsesTimeChange = useCallback((value: boolean) => {
    if (value) {
      todoInputRef.current?.blur();
      Keyboard.dismiss();
    }
    setTodoUsesTime(value);
  }, []);

  const submitTodo = useCallback(async () => {
    if (busyRef.current) return;
    const parsed = parseTodoInput(todoTitle, selectedTodoTime);
    if (!parsed) {
      Alert.alert('提示', '请输入待办内容。');
      return;
    }

    const now = Date.now();
    busyRef.current = true;
    try {
      if (editingTodo) {
        await updateCalendarTodo(editingTodo.id, {
          title: parsed.title,
          scheduledTime: parsed.scheduledTime || null,
          updatedAt: now,
        });
      } else {
        await createCalendarTodo({
          id: randomUUID(),
          title: parsed.title,
          dateKey: selectedDateKey,
          scheduledTime: parsed.scheduledTime,
          createdAt: now,
          updatedAt: now,
        });
      }
      setCreateVisible(false);
      setEditingTodo(null);
      await refreshTodos(selectedDateKey);
      await refreshOverdueTodos();
      if (selectedDateKey === todayKey) {
        await refreshTodayPreviewTodos();
        syncTodayWidget().catch(() => undefined);
      }
    } finally {
      busyRef.current = false;
    }
  }, [editingTodo, refreshOverdueTodos, refreshTodayPreviewTodos, refreshTodos, selectedDateKey, selectedTodoTime, todoTitle, todayKey]);

  const toggleTodoDone = useCallback(async (todo: CalendarTodo) => {
    const now = Date.now();
    await updateCalendarTodo(todo.id, {
      completedAt: isTodoDone(todo) ? null : now,
      updatedAt: now,
    });
    await refreshTodos(selectedDateKey);
    await refreshOverdueTodos();
    if (selectedDateKey === todayKey) {
      await refreshTodayPreviewTodos();
      syncTodayWidget().catch(() => undefined);
    }
  }, [refreshOverdueTodos, refreshTodayPreviewTodos, refreshTodos, selectedDateKey, todayKey]);

  const deleteEditingTodo = useCallback(() => {
    if (!editingTodo) return;
    Alert.alert('删除待办', `确定删除「${editingTodo.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteCalendarTodo(editingTodo.id)
            .then(async () => {
              setCreateVisible(false);
              setEditingTodo(null);
              await refreshTodos(selectedDateKey);
              await refreshOverdueTodos();
              if (selectedDateKey === todayKey) {
                await refreshTodayPreviewTodos();
                syncTodayWidget().catch(() => undefined);
              }
            })
            .catch(() => undefined);
        },
      },
    ]);
  }, [editingTodo, refreshOverdueTodos, refreshTodayPreviewTodos, refreshTodos, selectedDateKey, todayKey]);

  const cells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }]}> 
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()} accessibilityLabel="返回">
          <ChevronLeft color={colors.text} size={24} />
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title}>日历</Text>
          <Text style={styles.subtitle}>{formatSelectedDate(selectedDateKey)}</Text>
        </View>
        <Pressable style={[styles.headerButton, aiSyncCount > 0 && styles.headerButtonActive]} onPress={openAiSync} accessibilityLabel="AI 同步设置">
          <Eye color={aiSyncCount > 0 ? colors.primary : colors.text} size={21} />
        </Pressable>
        <Pressable style={styles.headerButton} onPress={() => {
          const now = new Date();
          const key = dateKey(now);
          setCalendarMonth(startOfMonth(now));
          selectDate(key);
        }} accessibilityLabel="回到今天">
          <CalendarDays color={colors.text} size={22} />
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.monthHeader}>
          <Pressable style={styles.monthButton} onPress={() => shiftMonth(-1)} accessibilityLabel="上个月">
            <ChevronLeft color={colors.text} size={22} />
          </Pressable>
          <Text style={styles.monthTitle}>{formatMonthTitle(calendarMonth)}</Text>
          <Pressable style={styles.monthButton} onPress={() => shiftMonth(1)} accessibilityLabel="下个月">
            <ChevronRight color={colors.text} size={22} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} style={styles.weekdayText}>{label}</Text>
          ))}
        </View>

        <View style={styles.calendarGrid}>
          {cells.map((cell, index) => {
            if (!cell) return <View key={`empty-${index}`} style={styles.calendarCell} />;
            const key = dateKey(cell);
            const selected = key === selectedDateKey;
            const isToday = key === todayKey;
            const hasChat = chatDateKeys.has(key);
            const hasDailyPaper = dailyPaperDateKeys.has(key);
            const isActualPeriod = periodDateKeys.has(key);
            const isPredictedPeriod = !isActualPeriod && predictedPeriodDateKeys.has(key);
            const cyclePhase = cyclePhasesVisible && !isActualPeriod && !isPredictedPeriod
              ? cyclePhaseMap.get(key)
              : undefined;
            const cyclePhaseMeta = cyclePhase ? CYCLE_PHASE_META[cyclePhase] : undefined;
            return (
              <Pressable
                key={key}
                style={[
                  styles.calendarCell,
                  cyclePhaseMeta && { backgroundColor: cyclePhaseMeta.backgroundColor },
                  selected && styles.calendarCellSelected,
                ]}
                onPress={() => selectDate(key)}
                accessibilityLabel={`选择 ${key}`}
              >
                <Text
                  style={[
                    styles.dayText,
                    isToday && styles.dayTextToday,
                    selected && styles.dayTextSelected,
                    isActualPeriod && styles.dayTextPeriod,
                    isPredictedPeriod && styles.dayTextPredicted,
                    cyclePhaseMeta && !selected && { color: cyclePhaseMeta.textColor },
                  ]}
                >
                  {cell.getDate()}
                </Text>
                <View style={styles.dotRow}>
                  {hasChat && <View style={[styles.dot, styles.chatDot]} />}
                  {hasDailyPaper && <View style={[styles.dot, styles.paperDot]} />}
                  {(isActualPeriod || isPredictedPeriod) && <View style={[styles.dot, styles.periodDot]} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.phasePanel}>
          <View style={styles.phaseToggleRow}>
            <View style={styles.phaseToggleTextBlock}>
              <Text style={styles.phaseTitle}>周期阶段</Text>
              <Text style={styles.phaseDescription}>按最近记录预测，仅作日历提示。</Text>
            </View>
            <Switch
              value={cyclePhasesVisible}
              onValueChange={setCyclePhasesVisible}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={cyclePhasesVisible ? colors.primary : colors.textTertiary}
            />
          </View>
          {cyclePhasesVisible ? (
            <View style={styles.phaseLegend}>
              {(Object.keys(CYCLE_PHASE_META) as CyclePhase[]).map((phase) => {
                const meta = CYCLE_PHASE_META[phase];
                return (
                  <View key={phase} style={styles.phaseLegendItem}>
                    <View style={[styles.phaseLegendSwatch, { backgroundColor: meta.backgroundColor }]} />
                    <Text style={styles.phaseLegendText}>{meta.label}</Text>
                  </View>
                );
              })}
              <View style={styles.phaseLegendItem}>
                <View style={[styles.phaseLegendDot, styles.periodDot]} />
                <Text style={styles.phaseLegendText}>经期/预测经期</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <IconAction icon={<Droplets color={colors.primary} size={21} />} label="生理期记录" onPress={openPeriodActions} />
          <IconAction icon={<Newspaper color="#2F5D9C" size={21} />} label="日报" onPress={openDailyPaper} active={selectedHasDailyPaper} />
          <IconAction icon={<MessageSquareText color="#28786F" size={21} />} label="跳转聊天记录" onPress={jumpToChatDate} active={selectedHasChat} />
          <IconAction icon={<Plus color={colors.text} size={22} />} label="添加待办" onPress={openCreateTodo} />
        </View>

        <View style={styles.todoHeader}>
          <Text style={styles.todoTitle}>待办</Text>
          <View style={styles.todoHeaderActions}>
            {overdueTodos.length > 0 ? (
              <Pressable style={styles.moveTodayButton} onPress={() => void moveOverdueTodosToToday()}>
                <ArrowRight color={colors.primary} size={15} />
                <Text style={styles.moveTodayText}>移到今天 {overdueTodos.length}</Text>
              </Pressable>
            ) : null}
            {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          </View>
        </View>

        <View style={styles.todoList}>
          {todos.length === 0 ? (
            <View style={styles.emptyTodos}>
              <Text style={styles.emptyTitle}>没有待办</Text>
              <Text style={styles.emptyText}>点加号给这一天放一件要做的事。</Text>
            </View>
          ) : (
            todos.map((todo, index) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                index={index}
                onToggleDone={() => toggleTodoDone(todo)}
                onEdit={() => openEditTodo(todo)}
              />
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={periodActionVisible} transparent animationType="fade" onRequestClose={() => setPeriodActionVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setPeriodActionVisible(false)}>
          <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>生理期记录</Text>
              <Pressable style={styles.modalClose} onPress={() => setPeriodActionVisible(false)} accessibilityLabel="关闭">
                <X color={colors.textSecondary} size={20} />
              </Pressable>
            </View>
            <Text style={styles.modalHint}>{formatSelectedDate(selectedDateKey)}</Text>
            <Pressable style={styles.sheetActionItem} onPress={recordPeriodStart}>
              <Text style={styles.sheetActionTitle}>记录开始</Text>
              <Text style={styles.sheetActionHint}>把选中日期设为开始日。</Text>
            </Pressable>
            <Pressable style={styles.sheetActionItem} onPress={recordPeriodEnd}>
              <Text style={styles.sheetActionTitle}>记录结束</Text>
              <Text style={styles.sheetActionHint}>把选中日期设为结束日。</Text>
            </Pressable>
            <Pressable style={[styles.sheetActionItem, styles.sheetDangerItem]} onPress={deletePeriodRecordForSelection}>
              <Text style={[styles.sheetActionTitle, styles.sheetDangerText]}>删除记录</Text>
              <Text style={styles.sheetActionHint}>删除选中日期所在的记录。</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.modalKeyboardRoot}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setCreateVisible(false)}>
            <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingTodo ? '编辑待办' : '添加待办'}</Text>
              <Pressable style={styles.modalClose} onPress={() => setCreateVisible(false)} accessibilityLabel="关闭">
                <X color={colors.textSecondary} size={20} />
              </Pressable>
            </View>
            <TextInput
              ref={todoInputRef}
              style={styles.input}
              value={todoTitle}
              onChangeText={setTodoTitle}
              placeholder="待办内容，例如 18点拿快递"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <SyncSwitchRow
              title="执行时间"
              text={todoUsesTime ? `${todoHour}:${todoMinute}` : '不设置具体时间'}
              value={todoUsesTime}
              onValueChange={handleTodoUsesTimeChange}
            />
            {todoUsesTime ? (
              <TimeWheelPicker
                hour={todoHour}
                minute={todoMinute}
                onHourChange={setTodoHour}
                onMinuteChange={setTodoMinute}
              />
            ) : null}
            <Pressable style={styles.confirmButton} onPress={submitTodo}>
              <Check color="#FFFFFF" size={18} />
              <Text style={styles.confirmText}>{editingTodo ? '保存' : '添加'}</Text>
            </Pressable>
            {editingTodo ? (
              <Pressable style={styles.deleteButton} onPress={deleteEditingTodo}>
                <Text style={styles.deleteButtonText}>删除待办</Text>
              </Pressable>
            ) : null}
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={syncVisible} transparent animationType="fade" onRequestClose={() => setSyncVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSyncVisible(false)}>
          <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>AI 同步</Text>
              <Pressable style={styles.modalClose} onPress={() => setSyncVisible(false)} accessibilityLabel="关闭">
                <X color={colors.textSecondary} size={20} />
              </Pressable>
            </View>

            <SyncSwitchRow
              title="生理期状态"
              text="仅在预计生理期前 2 天或经期内，把本地记录推算出的简短提醒附带给 AI。"
              value={periodSendToAI}
              onValueChange={(value) => setPeriodConfig({ sendToAI: value })}
            />
            <SyncSwitchRow
              title="今日待办"
              text="允许 AI 看到今天尚未完成的待办和执行时间。"
              value={sendTodayTodosToAI}
              onValueChange={(value) => setCalendarAiSyncConfig({ sendTodayTodosToAI: value })}
            />

            <View style={styles.previewBox}>
              <Text style={styles.previewTitle}>同步预览</Text>
              {periodSendToAI ? (
                <Text selectable style={styles.previewText}>生理期：{periodPreview}</Text>
              ) : (
                <Text style={styles.previewMuted}>生理期：未开启</Text>
              )}
              {sendTodayTodosToAI ? (
                <View style={styles.previewList}>
                  <Text style={styles.previewText}>今日待办：</Text>
                  {todoPreview.map((line) => (
                    <Text selectable key={line} style={styles.previewText}>{line}</Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.previewMuted}>今日待办：未开启</Text>
              )}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function SyncSwitchRow({
  title,
  text,
  value,
  onValueChange,
}: {
  title: string;
  text: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.syncRow}>
      <View style={styles.syncTextBlock}>
        <Text style={styles.syncTitle}>{title}</Text>
        <Text style={styles.syncDescription}>{text}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primaryLight }}
        thumbColor={value ? colors.primary : colors.textTertiary}
      />
    </View>
  );
}

function IconAction({
  icon,
  label,
  active = false,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.actionButton, active && styles.actionButtonActive]} onPress={onPress} accessibilityLabel={label}>
      {icon}
    </Pressable>
  );
}

function TimeWheelPicker({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: string;
  minute: string;
  onHourChange: (value: string) => void;
  onMinuteChange: (value: string) => void;
}) {
  return (
    <View style={styles.timePicker}>
      <TimeWheelColumn
        values={TIME_HOURS}
        selectedValue={hour}
        suffix="时"
        onChange={onHourChange}
      />
      <Text style={styles.timePickerSeparator}>:</Text>
      <TimeWheelColumn
        values={TIME_MINUTES}
        selectedValue={minute}
        suffix="分"
        onChange={onMinuteChange}
      />
    </View>
  );
}

function TimeWheelColumn({
  values,
  selectedValue,
  suffix,
  onChange,
}: {
  values: string[];
  selectedValue: string;
  suffix: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView style={styles.timeWheelColumn} contentContainerStyle={styles.timeWheelContent}>
      {values.map((value) => {
        const selected = value === selectedValue;
        return (
          <Pressable
            key={value}
            style={[styles.timeWheelItem, selected && styles.timeWheelItemSelected]}
            onPress={() => onChange(value)}
          >
            <Text style={[styles.timeWheelText, selected && styles.timeWheelTextSelected]}>
              {value}{suffix}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function TodoRow({
  todo,
  index,
  onToggleDone,
  onEdit,
}: {
  todo: CalendarTodo;
  index: number;
  onToggleDone: () => void;
  onEdit: () => void;
}) {
  const done = isTodoDone(todo);
  const [bg, fg] = TODO_SWATCHES[index % TODO_SWATCHES.length];
  return (
    <Pressable style={[styles.todoRow, { backgroundColor: bg }]} onLongPress={onEdit} delayLongPress={320}> 
      <Pressable style={styles.checkButton} onPress={onToggleDone} accessibilityLabel={done ? '标记未完成' : '标记完成'}>
        {done ? <CheckCircle2 color={fg} size={25} /> : <Circle color={fg} size={25} />}
      </Pressable>
      <View style={styles.todoMain}>
        <View style={styles.todoLine}>
          {todo.scheduledTime ? <Text style={[styles.todoTime, { color: fg }]}>{todo.scheduledTime}</Text> : null}
          <Text style={[styles.todoName, { color: fg }, done && styles.todoNameDone]} numberOfLines={2}>
            {todo.title}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    minHeight: 54,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  headerButtonActive: {
    backgroundColor: colors.primaryLight,
  },
  headerTitleBlock: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 14,
  },
  monthHeader: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBackground,
  },
  monthTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  weekRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
  },
  calendarCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    gap: 5,
  },
  calendarCellSelected: {
    backgroundColor: colors.primaryLight,
  },
  dayText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  dayTextToday: {
    color: colors.primary,
  },
  dayTextSelected: {
    color: colors.primary,
  },
  dayTextPeriod: {
    color: '#B8326B',
  },
  dayTextPredicted: {
    color: '#9A6A2D',
  },
  dotRow: {
    height: 5,
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  chatDot: {
    backgroundColor: '#28786F',
  },
  paperDot: {
    backgroundColor: '#2F5D9C',
  },
  periodDot: {
    backgroundColor: '#D94F91',
  },
  phasePanel: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBackground,
    padding: 10,
    gap: 10,
  },
  phaseToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  phaseToggleTextBlock: {
    flex: 1,
    gap: 3,
  },
  phaseTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  phaseDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  phaseLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  phaseLegendItem: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phaseLegendSwatch: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phaseLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  phaseLegendText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 8,
  },
  actionButton: {
    width: 48,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHover,
  },
  actionButtonActive: {
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  todoHeader: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  todoHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexShrink: 1,
  },
  todoTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  moveTodayButton: {
    minHeight: 30,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: colors.primaryLight,
  },
  moveTodayText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  todoList: {
    gap: 8,
    minHeight: 210,
  },
  emptyTodos: {
    minHeight: 210,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.inputBackground,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  todoRow: {
    minHeight: 54,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  checkButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todoMain: {
    flex: 1,
  },
  todoLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  todoTime: {
    minWidth: 46,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  todoName: {
    flex: 1,
    minWidth: 120,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  todoNameDone: {
    textDecorationLine: 'line-through',
    opacity: 0.62,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    justifyContent: 'flex-end',
    padding: 14,
  },
  modalKeyboardRoot: {
    flex: 1,
  },
  modalPanel: {
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    padding: 16,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  modalHint: {
    color: colors.textSecondary,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHover,
  },
  input: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.text,
    backgroundColor: colors.background,
    fontSize: 15,
  },
  confirmButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  confirmText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  deleteButton: {
    minHeight: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerSurface,
  },
  deleteButtonText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '800',
  },
  sheetActionItem: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: 12,
    gap: 4,
  },
  sheetDangerItem: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerSurface,
  },
  sheetActionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  sheetActionHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  sheetDangerText: {
    color: colors.danger,
  },
  timePicker: {
    minHeight: 150,
    maxHeight: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timePickerSeparator: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: '800',
  },
  timeWheelColumn: {
    flex: 1,
    maxHeight: 170,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  timeWheelContent: {
    padding: 6,
    gap: 4,
  },
  timeWheelItem: {
    minHeight: 34,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeWheelItemSelected: {
    backgroundColor: colors.primaryLight,
  },
  timeWheelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  timeWheelTextSelected: {
    color: colors.primary,
    fontWeight: '900',
  },
  syncRow: {
    minHeight: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  syncTextBlock: {
    flex: 1,
    gap: 4,
  },
  syncTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  syncDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  previewBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHover,
    padding: 12,
    gap: 8,
  },
  previewTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  previewList: {
    gap: 4,
  },
  previewText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  previewMuted: {
    color: colors.textTertiary,
    fontSize: 13,
    lineHeight: 19,
  },
});

let styles = createStyles(colors);
