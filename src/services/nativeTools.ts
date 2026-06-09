import { NativeModules, Platform } from 'react-native';
import * as Battery from 'expo-battery';
import * as Calendar from 'expo-calendar';
import * as Device from 'expo-device';
import {
  buildAndroidAccessibilityElementSummary,
  buildAndroidAccessibilityScreenSummary,
} from '../utils/androidAccessibilityControl';

function toJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function batteryStateToText(state: Battery.BatteryState): string {
  switch (state) {
    case Battery.BatteryState.CHARGING:
      return 'charging';
    case Battery.BatteryState.FULL:
      return 'full';
    case Battery.BatteryState.UNPLUGGED:
      return 'unplugged';
    case Battery.BatteryState.UNKNOWN:
    default:
      return 'unknown';
  }
}

function deviceTypeToText(type: Device.DeviceType): string {
  switch (type) {
    case Device.DeviceType.PHONE:
      return 'phone';
    case Device.DeviceType.TABLET:
      return 'tablet';
    case Device.DeviceType.DESKTOP:
      return 'desktop';
    case Device.DeviceType.TV:
      return 'tv';
    case Device.DeviceType.UNKNOWN:
    default:
      return 'unknown';
  }
}

function parseDate(value: unknown, fallback?: Date): Date {
  if (typeof value !== 'string' || !value.trim()) {
    if (fallback) return fallback;
    throw new Error('缺少日期参数');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`日期格式无效: ${value}`);
  }
  return date;
}

function getArg(args: Record<string, any>, ...names: string[]): unknown {
  for (const name of names) {
    if (args[name] !== undefined && args[name] !== null && args[name] !== '') {
      return args[name];
    }
  }
  return undefined;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

const AndroidSystemTools = NativeModules.AndroidSystemTools as
  | {
      getAppUsageStats: (startTime: number, endTime: number, limit: number) => Promise<unknown>;
      openUsageAccessSettings: () => Promise<boolean>;
    }
  | undefined;

const AccessibilityScreenContext = NativeModules.AccessibilityScreenContext as
  | {
      openAccessibilitySettings: () => Promise<boolean>;
      openInputMethodSettings: () => Promise<boolean>;
      showInputMethodPicker: () => Promise<boolean>;
      switchToYSClaudeInputMethod: () => Promise<AccessibilityActionResult>;
      isAccessibilityServiceEnabled: () => Promise<boolean>;
      isInputMethodReady: () => Promise<boolean>;
      captureScreenContext: () => Promise<{ imageUri?: string | null; nodeTree: string }>;
      tap: (x: number, y: number) => Promise<AccessibilityActionResult>;
      tapRelative: (xRatio: number, yRatio: number) => Promise<AccessibilityActionResult>;
      swipe: (
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        durationMs: number
      ) => Promise<AccessibilityActionResult>;
      clickNode: (nodeId: string) => Promise<AccessibilityActionResult>;
      scrollNode: (nodeId: string, direction: string) => Promise<AccessibilityActionResult>;
      setNodeText: (nodeId: string, text: string) => Promise<AccessibilityActionResult>;
      setFocusedText: (text: string) => Promise<AccessibilityActionResult>;
      commitInputMethodText: (text: string) => Promise<AccessibilityActionResult>;
      performInputMethodAction: (action: string) => Promise<AccessibilityActionResult>;
      deleteInputMethodText: (beforeLength: number, afterLength: number) => Promise<AccessibilityActionResult>;
      performGlobalAction: (action: string) => Promise<AccessibilityActionResult>;
    }
  | undefined;

interface AccessibilityActionResult {
  success: boolean;
  message: string;
  nodeTree?: string | null;
}

const ACCESSIBILITY_TOOL_TIMEOUT_MS = 4200;
const INPUT_METHOD_READY_TIMEOUT_MS = 2600;
const INPUT_METHOD_READY_POLL_MS = 120;

function ensureAndroidSystemTools(): NonNullable<typeof AndroidSystemTools> {
  if (Platform.OS !== 'android') {
    throw new Error('该工具仅支持 Android');
  }
  if (!AndroidSystemTools) {
    throw new Error('Android 原生模块未加载，请重新运行 npx expo run:android 安装包含原生模块的新包');
  }
  return AndroidSystemTools;
}

function ensureAccessibilityScreenContext(): NonNullable<typeof AccessibilityScreenContext> {
  if (Platform.OS !== 'android') {
    throw new Error('This tool only supports Android');
  }
  if (!AccessibilityScreenContext) {
    throw new Error('Accessibility native module is not loaded. Rebuild the Android development app.');
  }
  return AccessibilityScreenContext;
}

function parseMaybeJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function formatAccessibilityAction(result: AccessibilityActionResult): string {
  const screen = parseMaybeJson(result.nodeTree);
  return toJson({
    success: result.success,
    message: result.message,
    interactiveElements: buildAndroidAccessibilityElementSummary(screen),
    screenSummary: buildAndroidAccessibilityScreenSummary(screen),
  });
}

async function withAccessibilityTimeout<T>(promise: Promise<T>, actionName: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${actionName} timed out waiting for Android accessibility service`));
        }, ACCESSIBILITY_TOOL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInputMethodReady(
  module: NonNullable<typeof AccessibilityScreenContext>,
  timeoutMs = INPUT_METHOD_READY_TIMEOUT_MS
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await module.isInputMethodReady()) return true;
    await sleep(INPUT_METHOD_READY_POLL_MS);
  }
  return await module.isInputMethodReady();
}

async function ensureYSClaudeInputMethodReady(
  module: NonNullable<typeof AccessibilityScreenContext>,
  actionName: string
): Promise<AccessibilityActionResult | null> {
  if (await module.isInputMethodReady()) return null;

  const switchResult = await withAccessibilityTimeout(
    module.switchToYSClaudeInputMethod(),
    `${actionName}:switch_to_ysclaude_ime`
  );
  if (!switchResult.success) return switchResult;

  const ready = await waitForInputMethodReady(module);
  if (!ready) {
    return {
      success: false,
      message: 'YSClaude IME was selected, but no active input connection is ready. Tap or click an input field first.',
      nodeTree: switchResult.nodeTree,
    };
  }
  return null;
}

function getTimeRangeArgs(args: Record<string, any>, defaultDays: number): { startDate: Date; endDate: Date } {
  const endDate = parseDate(
    getArg(args, 'end_date', 'endDate', 'end_time', 'endTime'),
    new Date()
  );
  const startDate = parseDate(
    getArg(args, 'start_date', 'startDate', 'start_time', 'startTime'),
    new Date(endDate.getTime() - defaultDays * 24 * 60 * 60 * 1000)
  );
  return { startDate, endDate };
}

async function ensureCalendarPermission(): Promise<void> {
  const current = await Calendar.getCalendarPermissions();
  if (current.granted) return;

  const requested = await Calendar.requestCalendarPermissions();
  if (!requested.granted) {
    throw new Error('未获得日历权限，请在系统权限设置中允许访问日历');
  }
}

async function getWritableCalendar(calendarId?: string): Promise<Calendar.ExpoCalendar> {
  if (calendarId) return await Calendar.ExpoCalendar.get(calendarId);

  try {
    const defaultCalendar = Calendar.getDefaultCalendarSync();
    if (defaultCalendar?.id) return defaultCalendar;
  } catch {
    // Fall through to selecting a writable calendar from the list.
  }

  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const writableCalendar = calendars.find((calendar) => calendar.allowsModifications) || calendars[0];
  if (!writableCalendar) {
    throw new Error('未找到可写日历');
  }
  return writableCalendar;
}

export async function readDeviceInfo(): Promise<string> {
  const [deviceType, uptime, maxMemory] = await Promise.all([
    Device.getDeviceTypeAsync(),
    Device.getUptimeAsync().catch(() => null),
    Device.getMaxMemoryAsync().catch(() => null),
  ]);

  return toJson({
    platform: Platform.OS,
    isDevice: Device.isDevice,
    deviceType: deviceTypeToText(deviceType),
    brand: Device.brand,
    manufacturer: Device.manufacturer,
    modelName: Device.modelName,
    modelId: Device.modelId,
    designName: Device.designName,
    productName: Device.productName,
    deviceYearClass: Device.deviceYearClass,
    deviceName: Device.deviceName,
    osName: Device.osName,
    osVersion: Device.osVersion,
    osBuildId: Device.osBuildId,
    osInternalBuildId: Device.osInternalBuildId,
    osBuildFingerprint: Device.osBuildFingerprint,
    platformApiLevel: Device.platformApiLevel,
    supportedCpuArchitectures: Device.supportedCpuArchitectures,
    totalMemoryBytes: Device.totalMemory,
    maxMemoryBytes: maxMemory,
    uptimeSeconds: uptime,
  });
}

export async function readBatteryStatus(): Promise<string> {
  const [powerState, batteryOptimizationEnabled] = await Promise.all([
    Battery.getPowerStateAsync(),
    Platform.OS === 'android'
      ? Battery.isBatteryOptimizationEnabledAsync().catch(() => null)
      : Promise.resolve(null),
  ]);

  return toJson({
    batteryLevel: powerState.batteryLevel,
    batteryPercent:
      typeof powerState.batteryLevel === 'number'
        ? Math.round(powerState.batteryLevel * 100)
        : null,
    batteryState: batteryStateToText(powerState.batteryState),
    lowPowerMode: powerState.lowPowerMode,
    batteryOptimizationEnabled,
  });
}

export async function readAppUsageStats(args: Record<string, any>): Promise<string> {
  const module = ensureAndroidSystemTools();
  const { startDate, endDate } = getTimeRangeArgs(args, 1);
  const limitValue = Number(getArg(args, 'limit', 'max_results', 'maxResults') || 20);
  const result = await module.getAppUsageStats(
    startDate.getTime(),
    endDate.getTime(),
    Number.isFinite(limitValue) ? limitValue : 20
  );
  return toJson(result);
}

export async function openUsageAccessSettings(): Promise<string> {
  const module = ensureAndroidSystemTools();
  await module.openUsageAccessSettings();
  return toJson({ opened: true, target: 'usage_access_settings' });
}

export async function openAccessibilitySettings(): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  await module.openAccessibilitySettings();
  return toJson({ opened: true, target: 'accessibility_settings' });
}

export async function openInputMethodSettings(): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  await module.openInputMethodSettings();
  return toJson({ opened: true, target: 'input_method_settings' });
}

export async function showInputMethodPicker(): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  await module.showInputMethodPicker();
  return toJson({ opened: true, target: 'input_method_picker' });
}

export async function switchToYSClaudeInputMethod(): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const result = await withAccessibilityTimeout(
    module.switchToYSClaudeInputMethod(),
    'switch_android_input_method_to_ysclaude'
  );
  return formatAccessibilityAction(result);
}

export async function readAccessibilityScreenContext(options: { includeFullTree?: boolean } = {}): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const context = await module.captureScreenContext();
  const screen = parseMaybeJson(context.nodeTree);
  const payload: Record<string, unknown> = {
    imageUri: context.imageUri || null,
    interactiveElements: buildAndroidAccessibilityElementSummary(screen),
    screenSummary: buildAndroidAccessibilityScreenSummary(screen),
  };
  if (options.includeFullTree) {
    payload.screen = screen;
  }
  return toJson(payload);
}

export async function isAccessibilityControlEnabled(): Promise<boolean> {
  const module = ensureAccessibilityScreenContext();
  return await module.isAccessibilityServiceEnabled();
}

export async function isInputMethodReady(): Promise<boolean> {
  const module = ensureAccessibilityScreenContext();
  return await module.isInputMethodReady();
}

export async function tapAccessibilityScreen(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const result = await withAccessibilityTimeout(
    module.tap(
      asNumber(getArg(args, 'x'), 0),
      asNumber(getArg(args, 'y'), 0)
    ),
    'tap_android_screen'
  );
  return formatAccessibilityAction(result);
}

export async function tapAccessibilityScreenRelative(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const result = await withAccessibilityTimeout(
    module.tapRelative(
      asNumber(getArg(args, 'x_ratio', 'xRatio'), 0.5),
      asNumber(getArg(args, 'y_ratio', 'yRatio'), 0.5)
    ),
    'tap_android_relative'
  );
  return formatAccessibilityAction(result);
}

export async function swipeAccessibilityScreen(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const result = await withAccessibilityTimeout(
    module.swipe(
      asNumber(getArg(args, 'start_x', 'startX'), 0),
      asNumber(getArg(args, 'start_y', 'startY'), 0),
      asNumber(getArg(args, 'end_x', 'endX'), 0),
      asNumber(getArg(args, 'end_y', 'endY'), 0),
      asNumber(getArg(args, 'duration_ms', 'durationMs'), 360)
    ),
    'swipe_android_screen'
  );
  return formatAccessibilityAction(result);
}

export async function clickAccessibilityNode(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const nodeId = String(getArg(args, 'node_id', 'nodeId', 'id') || '').trim();
  if (!nodeId) throw new Error('Missing node_id');
  const result = await withAccessibilityTimeout(module.clickNode(nodeId), 'click_android_node');
  return formatAccessibilityAction(result);
}

export async function scrollAccessibilityNode(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const nodeId = String(getArg(args, 'node_id', 'nodeId', 'id') || '').trim();
  if (!nodeId) throw new Error('Missing node_id');
  const direction = String(getArg(args, 'direction') || 'forward');
  const result = await withAccessibilityTimeout(module.scrollNode(nodeId, direction), 'scroll_android_node');
  return formatAccessibilityAction(result);
}

export async function setAccessibilityNodeText(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const nodeId = String(getArg(args, 'node_id', 'nodeId', 'id') || '').trim();
  if (!nodeId) throw new Error('Missing node_id');
  const textValue = getArg(args, 'text', 'value', 'content');
  if (typeof textValue !== 'string') throw new Error('Missing text');
  const result = await withAccessibilityTimeout(module.setNodeText(nodeId, textValue), 'set_android_text');
  return formatAccessibilityAction(result);
}

export async function setFocusedAccessibilityText(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const textValue = getArg(args, 'text', 'value', 'content');
  if (typeof textValue !== 'string') throw new Error('Missing text');
  const result = await withAccessibilityTimeout(module.setFocusedText(textValue), 'set_focused_android_text');
  return formatAccessibilityAction(result);
}

export async function commitInputMethodText(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const textValue = getArg(args, 'text', 'value', 'content');
  if (typeof textValue !== 'string') throw new Error('Missing text');
  const switchResult = await ensureYSClaudeInputMethodReady(module, 'ime_commit_android_text');
  if (switchResult) return formatAccessibilityAction(switchResult);
  const result = await withAccessibilityTimeout(module.commitInputMethodText(textValue), 'ime_commit_android_text');
  return formatAccessibilityAction(result);
}

export async function performInputMethodAction(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const action = String(getArg(args, 'action') || 'send');
  const switchResult = await ensureYSClaudeInputMethodReady(module, 'ime_android_action');
  if (switchResult) return formatAccessibilityAction(switchResult);
  const result = await withAccessibilityTimeout(module.performInputMethodAction(action), 'ime_android_action');
  return formatAccessibilityAction(result);
}

export async function deleteInputMethodText(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const beforeLength = asNumber(getArg(args, 'before_length', 'beforeLength'), 1);
  const afterLength = asNumber(getArg(args, 'after_length', 'afterLength'), 0);
  const switchResult = await ensureYSClaudeInputMethodReady(module, 'ime_delete_android_text');
  if (switchResult) return formatAccessibilityAction(switchResult);
  const result = await withAccessibilityTimeout(
    module.deleteInputMethodText(beforeLength, afterLength),
    'ime_delete_android_text'
  );
  return formatAccessibilityAction(result);
}

export async function performAccessibilityGlobalAction(args: Record<string, any>): Promise<string> {
  const module = ensureAccessibilityScreenContext();
  const action = String(getArg(args, 'action') || 'back');
  const result = await withAccessibilityTimeout(module.performGlobalAction(action), 'android_global_action');
  return formatAccessibilityAction(result);
}

export async function listCalendarEvents(args: Record<string, any>): Promise<string> {
  await ensureCalendarPermission();
  const now = new Date();
  const startDate = parseDate(getArg(args, 'start_date', 'startDate', 'start_time', 'startTime'), now);
  const endDate = parseDate(
    getArg(args, 'end_date', 'endDate', 'end_time', 'endTime'),
    addHours(startDate, 24)
  );
  const calendarIds = Array.isArray(args.calendar_ids) && args.calendar_ids.length > 0
    ? args.calendar_ids.map(String)
    : (await Calendar.getCalendars(Calendar.EntityTypes.EVENT)).map((calendar) => calendar.id);

  const events = await Calendar.listEvents(calendarIds, startDate, endDate);
  return toJson(events.map((event) => ({
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    allDay: event.allDay,
    location: event.location,
    notes: event.notes,
    timeZone: event.timeZone,
    status: event.status,
  })));
}

export async function createCalendarEvent(args: Record<string, any>): Promise<string> {
  await ensureCalendarPermission();
  const calendar = await getWritableCalendar(args.calendar_id ? String(args.calendar_id) : undefined);
  const startDate = parseDate(getArg(args, 'start_date', 'startDate', 'start_time', 'startTime'));
  const endDate = parseDate(
    getArg(args, 'end_date', 'endDate', 'end_time', 'endTime'),
    addHours(startDate, 1)
  );
  const event = await calendar.createEvent({
    title: String(args.title || '新日程'),
    startDate,
    endDate,
    allDay: Boolean(getArg(args, 'all_day', 'allDay')),
    location: args.location ? String(args.location) : undefined,
    notes: args.notes ? String(args.notes) : undefined,
    timeZone: args.time_zone ? String(args.time_zone) : undefined,
  });
  return toJson({ id: event.id, calendarId: calendar.id });
}

export async function updateCalendarEvent(args: Record<string, any>): Promise<string> {
  await ensureCalendarPermission();
  const id = String(args.id || '').trim();
  if (!id) throw new Error('缺少日程 id');

  const details: Record<string, any> = {};
  if (args.title !== undefined) details.title = String(args.title);
  const startValue = getArg(args, 'start_date', 'startDate', 'start_time', 'startTime');
  const endValue = getArg(args, 'end_date', 'endDate', 'end_time', 'endTime');
  const allDayValue = getArg(args, 'all_day', 'allDay');
  if (startValue !== undefined) details.startDate = parseDate(startValue);
  if (endValue !== undefined) details.endDate = parseDate(endValue);
  if (allDayValue !== undefined) details.allDay = Boolean(allDayValue);
  if (args.location !== undefined) details.location = String(args.location);
  if (args.notes !== undefined) details.notes = String(args.notes);
  if (args.time_zone !== undefined) details.timeZone = String(args.time_zone);

  const event = await Calendar.ExpoCalendarEvent.get(id);
  await event.update(details);
  return toJson({ id, updated: true });
}

export async function deleteCalendarEvent(args: Record<string, any>): Promise<string> {
  await ensureCalendarPermission();
  const id = String(args.id || '').trim();
  if (!id) throw new Error('缺少日程 id');
  const event = await Calendar.ExpoCalendarEvent.get(id);
  await event.delete();
  return toJson({ id, deleted: true });
}

export async function readUnsupportedNativeCapability(capability: string): Promise<string> {
  return toJson({
    supported: false,
    capability,
    reason:
      'Expo SDK 56 没有内置该系统能力的跨平台 API。需要后续添加自定义原生模块或接入第三方原生库，并在 development build 中运行。',
  });
}
