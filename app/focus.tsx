import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { FocusSession, FocusTask, FocusTimerMode } from '../src/types';
import { lightColors, useThemeColors, type ThemeColors } from '../src/theme/colors';
import { fonts } from '../src/theme/fonts';
import { focusElapsedMs, localDateKeyForFocus, useFocusStore } from '../src/stores/focus';

let colors = lightColors;

const TABS = ['今日任务', '专注统计', '预留'] as const;
const MACARON = {
  mint: '#DDF4E7',
  mintText: '#237257',
  peach: '#FFE1D6',
  peachText: '#A14B36',
  lavender: '#E9E2FF',
  lavenderText: '#6652A8',
  lemon: '#FFF2B8',
  lemonText: '#88701F',
  sky: '#DDF0FF',
  skyText: '#356F9A',
  rose: '#FFDDE8',
  roseText: '#A03D63',
  aqua: '#D7F7F3',
  aquaText: '#28786F',
  pistachio: '#E7F6C7',
  pistachioText: '#5E7625',
  lilac: '#F0DFFF',
  lilacText: '#744CA0',
  apricot: '#FFE8C7',
  apricotText: '#91602A',
  periwinkle: '#DDE5FF',
  periwinkleText: '#425CA4',
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function formatDateTitle(key: string): string {
  const date = dateFromKey(key);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string): string | null {
  const text = value.trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return localDateKeyForFocus(date.getTime());
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function sessionDuration(session: FocusSession): number {
  if (session.status === 'completed' || session.status === 'abandoned') {
    const end = session.endedAt || session.updatedAt;
    return Math.max(0, end - session.startedAt - session.pausedDurationMs);
  }
  return focusElapsedMs(session);
}

function completedSessionCount(sessions: FocusSession[]): number {
  return sessions.filter((session) => session.status === 'completed').length;
}

function totalCompletedDuration(sessions: FocusSession[]): number {
  return sessions
    .filter((session) => session.status === 'completed')
    .reduce((sum, session) => sum + sessionDuration(session), 0);
}

function isFocusTaskDone(task: FocusTask): boolean {
  return task.timerMode === 'countup'
    ? task.completedCount >= 1
    : task.completedCount >= task.targetCount;
}

interface FocusStatRow {
  title: string;
  duration: number;
  count: number;
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = (angle - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function pieSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  if (sweep >= 359.99) {
    const top = polarToCartesian(cx, cy, radius, 0);
    const bottom = polarToCartesian(cx, cy, radius, 180);
    return [
      `M ${cx} ${cy}`,
      `L ${top.x} ${top.y}`,
      `A ${radius} ${radius} 0 1 1 ${bottom.x} ${bottom.y}`,
      `A ${radius} ${radius} 0 1 1 ${top.x} ${top.y}`,
      'Z',
    ].join(' ');
  }
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    'Z',
  ].join(' ');
}

function pieSliceOffset(startAngle: number, endAngle: number, distance: number): { x: number; y: number } {
  const middle = (startAngle + endAngle) / 2;
  const radians = (middle - 90) * Math.PI / 180;
  return {
    x: distance * Math.cos(radians),
    y: distance * Math.sin(radians),
  };
}

function pieLabelPosition(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): { x: number; y: number } {
  const middle = (startAngle + endAngle) / 2;
  return polarToCartesian(cx, cy, radius * 0.58, middle);
}

function compactTaskLabel(title: string): string {
  const clean = title.trim();
  if (clean.length <= 6) return clean;
  return `${clean.slice(0, 5)}…`;
}

export default function FocusScreen() {
  colors = useThemeColors();
  styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState(0);
  const [createVisible, setCreateVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<FocusTask | null>(null);
  const [dateJumpVisible, setDateJumpVisible] = useState(false);

  const {
    tasks,
    sessions,
    activeSession,
    selectedDateKey,
    isLoading,
    error,
    loadToday,
    loadDate,
    createTask,
    updateTask,
    deleteTask,
    manuallyCompleteTask,
    startFocus,
    pauseFocus,
    resumeFocus,
    completeFocus,
    abandonFocus,
  } = useFocusStore();

  useFocusEffect(
    useCallback(() => {
      loadToday();
    }, [loadToday])
  );

  const openCreate = useCallback(() => setCreateVisible(true), []);
  const closeCreate = useCallback(() => setCreateVisible(false), []);
  const closeEditor = useCallback(() => setEditingTask(null), []);

  const shiftDate = useCallback((days: number) => {
    const next = localDateKeyForFocus(addDays(dateFromKey(selectedDateKey), days).getTime());
    loadDate(next);
  }, [loadDate, selectedDateKey]);

  const handleComplete = useCallback(() => {
    Alert.alert('完成专注', '结束当前专注并记为完成？', [
      { text: '取消', style: 'cancel' },
      { text: '完成', onPress: () => completeFocus() },
    ]);
  }, [completeFocus]);

  const handleAbandon = useCallback(() => {
    Alert.alert('放弃专注', '结束当前专注并记为放弃？', [
      { text: '取消', style: 'cancel' },
      { text: '放弃', style: 'destructive', onPress: () => abandonFocus() },
    ]);
  }, [abandonFocus]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>‹</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.title}>番茄专注</Text>
          <Text style={styles.subtitle}>任务、计时和专注记录</Text>
        </View>
        <Pressable style={styles.headerButton} onPress={openCreate}>
          <Text style={styles.headerPlus}>＋</Text>
        </Pressable>
      </View>

      <View style={styles.tabBar}>
        {TABS.map((tab, index) => (
          <Pressable
            key={tab}
            style={[styles.tab, index === activeTab && styles.tabActive]}
            onPress={() => setActiveTab(index)}
          >
            <Text style={[styles.tabText, index === activeTab && styles.tabTextActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {activeTab === 0 ? (
        <TaskTab
          tasks={tasks}
          activeSession={activeSession}
          isLoading={isLoading}
          onCreate={openCreate}
          onEdit={setEditingTask}
          onStart={startFocus}
          onPause={pauseFocus}
          onResume={resumeFocus}
          onComplete={handleComplete}
          onAbandon={handleAbandon}
        />
      ) : activeTab === 1 ? (
        <StatsTab
          sessions={sessions}
          selectedDateKey={selectedDateKey}
          onPrev={() => shiftDate(-1)}
          onNext={() => shiftDate(1)}
          onToday={() => loadDate(localDateKeyForFocus())}
          onOpenDateJump={() => setDateJumpVisible(true)}
        />
      ) : (
        <View style={styles.emptyPage}>
          <Text style={styles.emptyTitle}>暂时留空</Text>
          <Text style={styles.emptyText}>这里先等你下一步想法。</Text>
        </View>
      )}

      <CreateTaskModal
        visible={createVisible}
        onClose={closeCreate}
        onCreate={async (input) => {
          await createTask(input);
          closeCreate();
        }}
      />
      <TaskEditorModal
        visible={!!editingTask}
        task={editingTask}
        activeSession={activeSession}
        onClose={closeEditor}
        onSave={async (task, input) => {
          await updateTask(task.id, input);
          closeEditor();
        }}
        onDelete={async (task) => {
          await deleteTask(task.id);
          closeEditor();
        }}
        onManualComplete={async (task, minutes) => {
          await manuallyCompleteTask(task.id, minutes);
          closeEditor();
        }}
      />
      <DateJumpModal
        visible={dateJumpVisible}
        selectedDateKey={selectedDateKey}
        onClose={() => setDateJumpVisible(false)}
        onJump={async (dateKey) => {
          await loadDate(dateKey);
          setDateJumpVisible(false);
        }}
      />
    </View>
  );
}

function TaskTab({
  tasks,
  activeSession,
  isLoading,
  onCreate,
  onEdit,
  onStart,
  onPause,
  onResume,
  onComplete,
  onAbandon,
}: {
  tasks: FocusTask[];
  activeSession: FocusSession | null;
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (task: FocusTask) => void;
  onStart: (taskId: string) => Promise<FocusSession | null>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onComplete: () => void;
  onAbandon: () => void;
}) {
  const renderTask = useCallback<ListRenderItem<FocusTask>>(({ item, index }) => (
    <TaskRow
      task={item}
      colorIndex={index}
      onStart={() => onStart(item.id)}
      onEdit={() => onEdit(item)}
      activeSession={activeSession}
    />
  ), [activeSession, onEdit, onStart]);

  return (
    <View style={styles.content}>
      {activeSession ? (
        <ActiveFocusPanel
          session={activeSession}
          onPause={onPause}
          onResume={onResume}
          onComplete={onComplete}
          onAbandon={onAbandon}
        />
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>今日任务</Text>
        <Pressable style={styles.smallAction} onPress={onCreate}>
          <Text style={styles.smallActionText}>新建</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>正在加载</Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          renderItem={renderTask}
          contentContainerStyle={tasks.length === 0 ? styles.emptyList : styles.taskList}
          ListEmptyComponent={
            <View style={styles.emptyPage}>
              <Text style={styles.emptyTitle}>今天还没有任务</Text>
              <Text style={styles.emptyText}>新建一个任务，然后进入专注。</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function TaskRow({
  task,
  colorIndex,
  activeSession,
  onStart,
  onEdit,
}: {
  task: FocusTask;
  colorIndex: number;
  activeSession: FocusSession | null;
  onStart: () => void;
  onEdit: () => void;
}) {
  const done = isFocusTaskDone(task);
  const swatches = [
    [MACARON.mint, MACARON.mintText],
    [MACARON.peach, MACARON.peachText],
    [MACARON.lavender, MACARON.lavenderText],
    [MACARON.sky, MACARON.skyText],
    [MACARON.rose, MACARON.roseText],
    [MACARON.aqua, MACARON.aquaText],
    [MACARON.pistachio, MACARON.pistachioText],
    [MACARON.lilac, MACARON.lilacText],
    [MACARON.apricot, MACARON.apricotText],
    [MACARON.periwinkle, MACARON.periwinkleText],
  ];
  const [bg, fg] = swatches[colorIndex % swatches.length];
  const disabled = !!activeSession && activeSession.taskId !== task.id;

  return (
    <Pressable style={[styles.taskRow, { backgroundColor: bg }]} onLongPress={onEdit}>
      <View style={styles.taskMain}>
        <Text style={[styles.taskTitle, { color: fg }, done && styles.taskTitleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={[styles.taskMeta, { color: fg }]}>
          {task.timerMode === 'countdown' ? `倒计时 · ${formatDuration(task.durationMs)}` : '正计时 · 无上限'} · {task.completedCount}/{task.targetCount} 次
        </Text>
      </View>
      <Pressable
        style={[styles.focusButton, disabled && styles.focusButtonDisabled]}
        onPress={onStart}
        disabled={disabled}
      >
        <Text style={styles.focusButtonText}>专注</Text>
      </Pressable>
    </Pressable>
  );
}

function ActiveFocusPanel({
  session,
  onPause,
  onResume,
  onComplete,
  onAbandon,
}: {
  session: FocusSession;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onComplete: () => void;
  onAbandon: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = focusElapsedMs(session, now);
  const displayMs =
    session.timerMode === 'countdown'
      ? Math.max(0, session.plannedDurationMs - elapsed)
      : elapsed;

  return (
    <View style={styles.activePanel}>
      <Text style={styles.activeLabel}>{session.status === 'paused' ? '已暂停' : '专注中'}</Text>
      <Text style={styles.activeTask} numberOfLines={1}>{session.taskTitle}</Text>
      <Text style={styles.activeMode}>
        {session.timerMode === 'countup' ? '正计时 · 无上限' : `倒计时 · ${formatDuration(session.plannedDurationMs)}`}
      </Text>
      <Text style={styles.timerText}>{formatClock(displayMs)}</Text>
      <View style={styles.focusActions}>
        <Pressable
          style={[styles.controlButton, styles.pauseButton]}
          onPress={session.status === 'paused' ? onResume : onPause}
        >
          <Text style={styles.controlButtonText}>{session.status === 'paused' ? '继续' : '暂停'}</Text>
        </Pressable>
        <Pressable style={[styles.controlButton, styles.doneButton]} onPress={onComplete}>
          <Text style={styles.doneButtonText}>完成</Text>
        </Pressable>
        <Pressable style={[styles.controlButton, styles.abandonButton]} onPress={onAbandon}>
          <Text style={styles.abandonButtonText}>放弃</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatsTab({
  sessions,
  selectedDateKey,
  onPrev,
  onNext,
  onToday,
  onOpenDateJump,
}: {
  sessions: FocusSession[];
  selectedDateKey: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onOpenDateJump: () => void;
}) {
  const completed = sessions.filter((session) => session.status === 'completed');
  const totalDuration = totalCompletedDuration(sessions);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rows = useMemo(() => {
    const map = new Map<string, FocusStatRow>();
    for (const session of completed) {
      const current = map.get(session.taskId) || { title: session.taskTitle, duration: 0, count: 0 };
      current.duration += sessionDuration(session);
      current.count += 1;
      map.set(session.taskId, current);
    }
    return [...map.values()].sort((a, b) => b.duration - a.duration);
  }, [completed]);
  const pieColors = [
    MACARON.lavender,
    MACARON.sky,
    MACARON.rose,
    MACARON.aqua,
    MACARON.apricot,
    MACARON.pistachio,
    MACARON.periwinkle,
    MACARON.peach,
  ];
  const normalizedSelectedIndex =
    selectedIndex === null || rows.length === 0
      ? null
      : Math.min(selectedIndex, rows.length - 1);
  const selectedRow = normalizedSelectedIndex === null ? null : rows[normalizedSelectedIndex];

  useEffect(() => {
    if (selectedIndex !== null && selectedIndex > rows.length - 1) setSelectedIndex(null);
  }, [rows.length, selectedIndex]);

  return (
    <ScrollView style={styles.content} contentContainerStyle={styles.statsContent}>
      <View style={styles.dateNav}>
        <Pressable style={styles.dateButton} onPress={onPrev}>
          <Text style={styles.dateButtonText}>‹</Text>
        </Pressable>
        <Pressable style={styles.dateTitleButton} onPress={onOpenDateJump}>
          <Text style={styles.dateTitle}>{formatDateTitle(selectedDateKey)}</Text>
          <Text style={styles.dateHint}>点击跳转日期</Text>
        </Pressable>
        <Pressable style={styles.dateButton} onPress={onNext}>
          <Text style={styles.dateButtonText}>›</Text>
        </Pressable>
      </View>
      <Pressable style={styles.todayButton} onPress={onToday}>
        <Text style={styles.todayButtonText}>今天</Text>
      </Pressable>

      <View style={styles.statsGrid}>
        <View style={[styles.statTile, { backgroundColor: MACARON.lemon }]}>
          <Text style={[styles.statValue, { color: MACARON.lemonText }]}>{completedSessionCount(sessions)}</Text>
          <Text style={[styles.statLabel, { color: MACARON.lemonText }]}>专注次数</Text>
        </View>
        <View style={[styles.statTile, { backgroundColor: MACARON.mint }]}>
          <Text style={[styles.statValue, { color: MACARON.mintText }]}>{formatDuration(totalDuration)}</Text>
          <Text style={[styles.statLabel, { color: MACARON.mintText }]}>专注总时长</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>任务分布</Text>
      {rows.length === 0 ? (
        <View style={styles.emptyPage}>
          <Text style={styles.emptyTitle}>暂无统计</Text>
          <Text style={styles.emptyText}>完成专注后会在这里记录。</Text>
        </View>
      ) : (
        <>
          <FocusPieChart
            rows={rows}
            totalDuration={totalDuration}
            sliceColors={pieColors}
            selectedIndex={normalizedSelectedIndex}
            onSelect={setSelectedIndex}
            onClear={() => setSelectedIndex(null)}
          />
          {selectedRow ? (
            <View style={styles.pieDetail}>
              <View style={[styles.pieDetailDot, { backgroundColor: pieColors[(normalizedSelectedIndex || 0) % pieColors.length] }]} />
              <View style={styles.pieDetailText}>
                <Text style={styles.pieDetailTitle} numberOfLines={1}>{selectedRow.title}</Text>
                <Text style={styles.pieDetailMeta}>{formatDuration(selectedRow.duration)} · {selectedRow.count} 次</Text>
              </View>
            </View>
          ) : null}
          {rows.map((row, index) => {
            const ratio = totalDuration > 0 ? row.duration / totalDuration : 0;
            return (
              <Pressable key={row.title + index} style={styles.statRow} onPress={() => setSelectedIndex(index)}>
                <View style={styles.statRowTop}>
                  <View style={[styles.legendDot, { backgroundColor: pieColors[index % pieColors.length] }]} />
                  <Text style={styles.statTaskTitle} numberOfLines={1}>{row.title}</Text>
                  <Text style={styles.statTaskMeta}>{formatDuration(row.duration)} · {row.count} 次</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.max(6, ratio * 100)}%`, backgroundColor: pieColors[index % pieColors.length] }]} />
                </View>
              </Pressable>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

function FocusPieChart({
  rows,
  totalDuration,
  sliceColors,
  selectedIndex,
  onSelect,
  onClear,
}: {
  rows: FocusStatRow[];
  totalDuration: number;
  sliceColors: string[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onClear: () => void;
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 92;
  const popout = 10;
  let angle = 0;

  if (rows.length === 1) {
    return (
      <View style={styles.pieWrap}>
        <Svg width={size} height={size}>
          <Rect width={size} height={size} fill="transparent" onPress={onClear} />
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            fill={sliceColors[0]}
            onPress={() => onSelect(0)}
          />
          <SvgText
            x={cx}
            y={cy + 4}
            fill={colors.text}
            fontSize={12}
            fontWeight="700"
            textAnchor="middle"
          >
            {compactTaskLabel(rows[0].title)}
          </SvgText>
        </Svg>
      </View>
    );
  }

  return (
    <View style={styles.pieWrap}>
      <Svg width={size} height={size}>
        <Rect width={size} height={size} fill="transparent" onPress={onClear} />
        {rows.map((row, index) => {
          const slice = totalDuration > 0 ? row.duration / totalDuration : 0;
          const startAngle = angle;
          const endAngle = index === rows.length - 1 ? 360 : angle + slice * 360;
          const offset = index === selectedIndex
            ? pieSliceOffset(startAngle, endAngle, popout)
            : { x: 0, y: 0 };
          angle = endAngle;
          return (
            <Path
              key={`${row.title}-${index}`}
              d={pieSlicePath(cx + offset.x, cy + offset.y, radius, startAngle, endAngle)}
              fill={sliceColors[index % sliceColors.length]}
              onPress={() => onSelect(index)}
            />
          );
        })}
        {rows.map((row, index) => {
          const previousDuration = rows
            .slice(0, index)
            .reduce((sum, item) => sum + item.duration, 0);
          const startAngle = totalDuration > 0 ? previousDuration / totalDuration * 360 : 0;
          const endAngle =
            index === rows.length - 1
              ? 360
              : startAngle + (totalDuration > 0 ? row.duration / totalDuration * 360 : 0);
          const offset = index === selectedIndex
            ? pieSliceOffset(startAngle, endAngle, popout)
            : { x: 0, y: 0 };
          const label = pieLabelPosition(cx + offset.x, cy + offset.y, radius, startAngle, endAngle);
          const showLabel = endAngle - startAngle >= 18;
          if (!showLabel) return null;
          return (
            <SvgText
              key={`${row.title}-${index}-label`}
              x={label.x}
              y={label.y}
              fill={colors.text}
              fontSize={10}
              fontWeight="700"
              textAnchor="middle"
              onPress={() => onSelect(index)}
            >
              {compactTaskLabel(row.title)}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

function CreateTaskModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { title: string; timerMode: FocusTimerMode; durationMinutes: number; targetCount?: number }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [timerMode, setTimerMode] = useState<FocusTimerMode>('countdown');
  const [durationText, setDurationText] = useState('25');
  const [targetText, setTargetText] = useState('');
  const busyRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setTimerMode('countdown');
    setDurationText('25');
    setTargetText('');
  }, [visible]);

  const submit = useCallback(async () => {
    if (busyRef.current) return;
    const durationMinutes = parseInt(durationText.trim(), 10);
    const targetCount = targetText.trim() ? parseInt(targetText.trim(), 10) : undefined;
    if (!title.trim()) {
      Alert.alert('提示', '任务名称不能为空');
      return;
    }
    if (timerMode === 'countdown' && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
      Alert.alert('提示', '请输入有效时长');
      return;
    }
    if (targetText.trim() && (!Number.isFinite(targetCount) || (targetCount || 0) <= 0)) {
      Alert.alert('提示', '请输入有效专注次数');
      return;
    }
    busyRef.current = true;
    try {
      await onCreate({
        title,
        timerMode,
        durationMinutes: timerMode === 'countup' ? 0 : durationMinutes,
        targetCount,
      });
    } finally {
      busyRef.current = false;
    }
  }, [durationText, onCreate, targetText, timerMode, title]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
          <Text style={styles.modalTitle}>新建任务</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="任务名称"
            placeholderTextColor={colors.textTertiary}
          />

          <View style={styles.segmented}>
            <Pressable
              style={[styles.segment, timerMode === 'countdown' && styles.segmentActive]}
              onPress={() => setTimerMode('countdown')}
            >
              <Text style={[styles.segmentText, timerMode === 'countdown' && styles.segmentTextActive]}>倒计时</Text>
            </Pressable>
            <Pressable
              style={[styles.segment, timerMode === 'countup' && styles.segmentActive]}
              onPress={() => setTimerMode('countup')}
            >
              <Text style={[styles.segmentText, timerMode === 'countup' && styles.segmentTextActive]}>正计时</Text>
            </Pressable>
          </View>

          <View style={styles.inputRow}>
            {timerMode === 'countdown' ? (
              <TextInput
                style={[styles.input, styles.inputHalf]}
                value={durationText}
                onChangeText={setDurationText}
                keyboardType="number-pad"
                placeholder="时长/分钟"
                placeholderTextColor={colors.textTertiary}
              />
            ) : null}
            <TextInput
              style={[styles.input, styles.inputHalf]}
              value={targetText}
              onChangeText={setTargetText}
              keyboardType="number-pad"
              placeholder="次数，默认1"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>取消</Text>
            </Pressable>
            <Pressable style={styles.modalConfirm} onPress={submit}>
              <Text style={styles.modalConfirmText}>创建</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

function TaskEditorModal({
  visible,
  task,
  activeSession,
  onClose,
  onSave,
  onDelete,
  onManualComplete,
}: {
  visible: boolean;
  task: FocusTask | null;
  activeSession: FocusSession | null;
  onClose: () => void;
  onSave: (task: FocusTask, input: { title: string; timerMode: FocusTimerMode; durationMinutes: number; targetCount?: number }) => Promise<void>;
  onDelete: (task: FocusTask) => Promise<void>;
  onManualComplete: (task: FocusTask, minutes: number) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [timerMode, setTimerMode] = useState<FocusTimerMode>('countdown');
  const [durationText, setDurationText] = useState('25');
  const [targetText, setTargetText] = useState('1');
  const [manualMinutesText, setManualMinutesText] = useState('25');
  const busyRef = useRef(false);
  const isActiveTask = !!task && activeSession?.taskId === task.id;

  useEffect(() => {
    if (!visible || !task) return;
    setTitle(task.title);
    setTimerMode(task.timerMode);
    setDurationText(task.durationMs > 0 ? String(Math.max(1, Math.round(task.durationMs / 60000))) : '25');
    setTargetText(String(task.targetCount));
    setManualMinutesText(task.durationMs > 0 ? String(Math.max(1, Math.round(task.durationMs / 60000))) : '25');
  }, [task, visible]);

  const submit = useCallback(async () => {
    if (!task || busyRef.current) return;
    const durationMinutes = parseInt(durationText.trim(), 10);
    const targetCount = targetText.trim() ? parseInt(targetText.trim(), 10) : undefined;
    if (!title.trim()) {
      Alert.alert('提示', '任务名称不能为空');
      return;
    }
    if (timerMode === 'countdown' && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
      Alert.alert('提示', '请输入有效时长');
      return;
    }
    if (!Number.isFinite(targetCount) || (targetCount || 0) <= 0) {
      Alert.alert('提示', '请输入有效专注次数');
      return;
    }
    busyRef.current = true;
    try {
      await onSave(task, {
        title,
        timerMode,
        durationMinutes: timerMode === 'countup' ? 0 : durationMinutes,
        targetCount,
      });
    } finally {
      busyRef.current = false;
    }
  }, [durationText, onSave, targetText, task, timerMode, title]);

  const confirmDelete = useCallback(() => {
    if (!task || isActiveTask) return;
    Alert.alert('删除任务', `确定删除「${task.title}」及其专注记录？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          onDelete(task).catch(() => undefined);
        },
      },
    ]);
  }, [isActiveTask, onDelete, task]);

  const manualComplete = useCallback(async () => {
    if (!task || busyRef.current) return;
    const minutes = parseInt(manualMinutesText.trim(), 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      Alert.alert('提示', '请输入有效专注分钟数');
      return;
    }
    busyRef.current = true;
    try {
      await onManualComplete(task, minutes);
    } finally {
      busyRef.current = false;
    }
  }, [manualMinutesText, onManualComplete, task]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
          <Text style={styles.modalTitle}>编辑任务</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="任务名称"
            placeholderTextColor={colors.textTertiary}
          />

          <View style={styles.segmented}>
            <Pressable
              style={[styles.segment, timerMode === 'countdown' && styles.segmentActive]}
              onPress={() => setTimerMode('countdown')}
            >
              <Text style={[styles.segmentText, timerMode === 'countdown' && styles.segmentTextActive]}>倒计时</Text>
            </Pressable>
            <Pressable
              style={[styles.segment, timerMode === 'countup' && styles.segmentActive]}
              onPress={() => setTimerMode('countup')}
            >
              <Text style={[styles.segmentText, timerMode === 'countup' && styles.segmentTextActive]}>正计时</Text>
            </Pressable>
          </View>

          <View style={styles.inputRow}>
            {timerMode === 'countdown' ? (
              <TextInput
                style={[styles.input, styles.inputHalf]}
                value={durationText}
                onChangeText={setDurationText}
                keyboardType="number-pad"
                placeholder="时长/分钟"
                placeholderTextColor={colors.textTertiary}
              />
            ) : null}
            <TextInput
              style={[styles.input, styles.inputHalf]}
              value={targetText}
              onChangeText={setTargetText}
              keyboardType="number-pad"
              placeholder="专注次数"
              placeholderTextColor={colors.textTertiary}
            />
          </View>

          <View style={styles.manualPanel}>
            <Text style={styles.manualTitle}>手动完成一次</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputHalf, styles.manualInput]}
                value={manualMinutesText}
                onChangeText={setManualMinutesText}
                keyboardType="number-pad"
                placeholder="专注分钟数"
                placeholderTextColor={colors.textTertiary}
              />
              <Pressable style={styles.manualButton} onPress={manualComplete}>
                <Text style={styles.manualButtonText}>标记完成</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.modalActionsSplit}>
            <Pressable
              style={[styles.modalDelete, isActiveTask && styles.modalDeleteDisabled]}
              onPress={confirmDelete}
              disabled={isActiveTask}
            >
              <Text style={styles.modalDeleteText}>删除</Text>
            </Pressable>
            <View style={styles.modalActionsRight}>
              <Pressable style={styles.modalCancel} onPress={onClose}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={submit}>
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

function DateJumpModal({
  visible,
  selectedDateKey,
  onClose,
  onJump,
}: {
  visible: boolean;
  selectedDateKey: string;
  onClose: () => void;
  onJump: (dateKey: string) => Promise<void>;
}) {
  const [text, setText] = useState(selectedDateKey);
  const busyRef = useRef(false);

  useEffect(() => {
    if (visible) setText(selectedDateKey);
  }, [selectedDateKey, visible]);

  const submit = useCallback(async () => {
    if (busyRef.current) return;
    const key = parseDateInput(text);
    if (!key) {
      Alert.alert('提示', '请输入有效日期，例如 2026-06-03');
      return;
    }
    busyRef.current = true;
    try {
      await onJump(key);
    } finally {
      busyRef.current = false;
    }
  }, [onJump, text]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
          <Text style={styles.modalTitle}>跳转日期</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="2026-06-03"
            placeholderTextColor={colors.textTertiary}
            keyboardType="numbers-and-punctuation"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>取消</Text>
            </Pressable>
            <Pressable style={styles.modalConfirm} onPress={submit}>
              <Text style={styles.modalConfirmText}>跳转</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIcon: {
    fontSize: 34,
    lineHeight: 36,
    color: colors.text,
  },
  headerPlus: {
    fontSize: 27,
    lineHeight: 30,
    color: colors.text,
  },
  headerTitleBlock: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textTertiary,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  tab: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: MACARON.lavender,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: MACARON.lavenderText,
  },
  errorText: {
    marginHorizontal: 16,
    marginBottom: 8,
    color: colors.danger,
    fontSize: 13,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  smallAction: {
    minHeight: 32,
    paddingHorizontal: 13,
    borderRadius: 8,
    backgroundColor: MACARON.sky,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: MACARON.skyText,
  },
  taskList: {
    gap: 10,
    paddingBottom: 28,
  },
  taskRow: {
    minHeight: 86,
    borderRadius: 8,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  taskMain: {
    flex: 1,
    gap: 7,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    opacity: 0.62,
  },
  taskMeta: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.78,
  },
  focusButton: {
    minWidth: 58,
    height: 38,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  focusButtonDisabled: {
    opacity: 0.45,
  },
  focusButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  activePanel: {
    backgroundColor: MACARON.peach,
    borderRadius: 8,
    padding: 18,
    marginBottom: 16,
    alignItems: 'center',
  },
  activeLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: MACARON.peachText,
  },
  activeTask: {
    marginTop: 5,
    fontSize: 16,
    fontWeight: '700',
    color: MACARON.peachText,
  },
  activeMode: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: MACARON.peachText,
    opacity: 0.78,
  },
  timerText: {
    marginTop: 14,
    fontSize: 54,
    lineHeight: 62,
    fontFamily: fonts.mono,
    color: '#2E2522',
  },
  focusActions: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 16,
  },
  controlButton: {
    minWidth: 74,
    minHeight: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  pauseButton: {
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  doneButton: {
    backgroundColor: MACARON.mint,
  },
  abandonButton: {
    backgroundColor: '#FFFFFF',
  },
  controlButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  doneButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: MACARON.mintText,
  },
  abandonButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.danger,
  },
  loadingRow: {
    minHeight: 70,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  loadingText: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyPage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 44,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 7,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  dateButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateButtonText: {
    fontSize: 28,
    color: colors.text,
  },
  dateTitleButton: {
    alignItems: 'center',
  },
  dateTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
  },
  dateHint: {
    marginTop: 3,
    fontSize: 12,
    color: colors.textTertiary,
  },
  todayButton: {
    alignSelf: 'center',
    minHeight: 32,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: MACARON.sky,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  todayButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: MACARON.skyText,
  },
  statsContent: {
    paddingBottom: 30,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statTile: {
    flex: 1,
    minHeight: 92,
    borderRadius: 8,
    padding: 14,
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    marginTop: 7,
    fontSize: 12,
    fontWeight: '700',
  },
  statRow: {
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  statRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statTaskTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  statTaskMeta: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  progressTrack: {
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  progressFill: {
    height: 9,
    borderRadius: 5,
    backgroundColor: MACARON.lavender,
  },
  pieWrap: {
    width: 220,
    height: 220,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  pieCenter: {
    position: 'absolute',
    width: 94,
    minHeight: 54,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  pieCenterValue: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  pieCenterLabel: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  pieDetail: {
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  pieDetailDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  pieDetailText: {
    flex: 1,
  },
  pieDetailTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
  },
  pieDetailMeta: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,20,19,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  modalPanel: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 8,
    backgroundColor: colors.background,
    padding: 18,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 14,
  },
  input: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.text,
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputHalf: {
    flex: 1,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 4,
    marginBottom: 10,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: MACARON.mint,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: MACARON.mintText,
  },
  manualPanel: {
    borderRadius: 8,
    backgroundColor: MACARON.lemon,
    padding: 12,
    marginBottom: 12,
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: MACARON.lemonText,
    marginBottom: 9,
  },
  manualInput: {
    marginBottom: 0,
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  manualButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: MACARON.lemonText,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalActionsSplit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  modalActionsRight: {
    flexDirection: 'row',
    gap: 10,
  },
  modalDelete: {
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
  },
  modalDeleteDisabled: {
    opacity: 0.45,
  },
  modalDeleteText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.danger,
  },
  modalCancel: {
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  modalConfirm: {
    minHeight: 38,
    paddingHorizontal: 17,
    borderRadius: 8,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalConfirmText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});

let styles = createStyles(colors);
