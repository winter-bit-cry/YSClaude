import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import * as Battery from 'expo-battery';
import * as Calendar from 'expo-calendar';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import {
  buildAndroidAccessibilityElementSummary,
  buildAndroidAccessibilityScreenSummary,
} from '../utils/androidAccessibilityControl';
import {
  captureShizukuScreenContext,
  ensureShizukuPermission,
  shizukuClickNode,
  shizukuCommitText,
  shizukuDeleteText,
  shizukuEditorAction,
  shizukuGlobalAction,
  shizukuScrollNode,
  shizukuSwipe,
  shizukuTap,
  shizukuTapRelative,
} from './shizukuDeviceControl';

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
      getNotifications: (appQuery: string | null, limit: number) => Promise<unknown>;
      openNotificationAccessSettings: () => Promise<boolean>;
      getClipboard: () => Promise<unknown>;
      findContacts: (name: string, limit: number) => Promise<unknown>;
      editContact: (name: string | null, phone: string | null, email: string | null) => Promise<boolean>;
      composeSms: (phone: string, message: string | null) => Promise<boolean>;
      dialPhone: (phone: string) => Promise<boolean>;
    }
  | undefined;


function ensureAndroidSystemTools(): NonNullable<typeof AndroidSystemTools> {
  if (Platform.OS !== 'android') {
    throw new Error('该工具仅支持 Android');
  }
  if (!AndroidSystemTools) {
    throw new Error('Android 原生模块未加载，请重新运行 npx expo run:android 安装包含原生模块的新包');
  }
  return AndroidSystemTools;
}

function asNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
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

export async function readNotifications(args: Record<string, any>): Promise<string> {
  const module = ensureAndroidSystemTools();
  const result = await module.getNotifications(args.app ? String(args.app) : null, asNumber(args.limit, 50));
  return toJson(result);
}

export async function openNotificationAccessSettings(): Promise<string> {
  await ensureAndroidSystemTools().openNotificationAccessSettings();
  return toJson({ opened: true, target: 'notification_listener_settings' });
}

export async function readClipboard(_args: Record<string, any>): Promise<string> {
  return toJson(await ensureAndroidSystemTools().getClipboard());
}

export async function editContact(args: Record<string, any>): Promise<string> {
  await ensureAndroidSystemTools().editContact(args.name ? String(args.name) : null, args.phone ? String(args.phone) : null, args.email ? String(args.email) : null);
  return toJson({ opened: true, action: 'contact_editor' });
}

export async function findContacts(args: Record<string, any>): Promise<string> {
  const name = String(args.name || '').trim();
  if (!name) throw new Error('请提供要查找的联系人姓名');
  const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS)
    || (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS)) === PermissionsAndroid.RESULTS.GRANTED;
  if (!granted) throw new Error('未获得通讯录读取权限，请在系统设置中允许 YSClaude 读取联系人');
  const limit = Math.max(1, Math.min(50, asNumber(args.limit, 10)));
  return toJson(await ensureAndroidSystemTools().findContacts(name, limit));
}

export async function composeSms(args: Record<string, any>): Promise<string> {
  const phone = String(args.phone || '').trim();
  if (!phone) throw new Error('缺少手机号');
  await ensureAndroidSystemTools().composeSms(phone, args.message ? String(args.message) : null);
  return toJson({ opened: true, action: 'sms_composer', recipient: phone, requiresUserConfirmation: true });
}

export async function dialPhone(args: Record<string, any>): Promise<string> {
  const phone = String(args.phone || '').trim();
  if (!phone) throw new Error('缺少电话号码');
  await ensureAndroidSystemTools().dialPhone(phone);
  return toJson({ opened: true, action: 'dialer', phone, requiresUserConfirmation: true });
}

export async function readWeather(args: Record<string, any>): Promise<string> {
  const requestedCity = String(args.city || '').trim();
  let latitude = Number(args.latitude);
  let longitude = Number(args.longitude);
  let city = requestedCity;
  if (!city && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    const current = await Location.getForegroundPermissionsAsync();
    const permission = current.granted ? current : await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('未获得定位权限，请提供 latitude 和 longitude 或在系统设置中允许定位');
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    latitude = position.coords.latitude;
    longitude = position.coords.longitude;
  }
  if (!city) {
    const places = await Location.reverseGeocodeAsync({ latitude, longitude });
    const place = places[0];
    city = String(place?.district || place?.city || place?.subregion || place?.region || '').trim();
  }
  if (!city) throw new Error('无法识别当前城市，请通过 city 参数提供城市或区县名称');
  const url = `https://uapis.cn/api/v1/misc/weather?city=${encodeURIComponent(city)}&extended=true&forecast=true&lang=zh`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`天气服务请求失败 (${response.status})`);
  return toJson({ provider: 'UAPI 国内天气', queryCity: city, ...(await response.json()) });
}

export async function openAccessibilitySettings(): Promise<string> {
  await ensureShizukuPermission();
  return toJson({ ready: true, target: 'shizuku' });
}

export async function openInputMethodSettings(): Promise<string> {
  await shizukuCommitText('');
  return toJson({ ready: true, target: 'ysclaude_input_method' });
}

export async function showInputMethodPicker(): Promise<string> {
  await shizukuCommitText('');
  return toJson({ ready: true, target: 'ysclaude_input_method' });
}

export async function switchToYSClaudeInputMethod(): Promise<string> {
  await ensureShizukuPermission();
  const result = await shizukuCommitText('');
  return toJson(result);
}

export async function readAccessibilityScreenContext(options: { includeFullTree?: boolean } = {}): Promise<string> {
  const context = await captureShizukuScreenContext(true);
  const screen = context.screen;
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

export async function captureAccessibilityScreenFrame(): Promise<string | null> {
  return (await captureShizukuScreenContext(false)).imageUri || null;
}

export async function isAccessibilityControlEnabled(): Promise<boolean> {
  try { await ensureShizukuPermission(); return true; } catch { return false; }
}

export async function tapAccessibilityScreen(args: Record<string, any>): Promise<string> {
  await shizukuTap(asNumber(getArg(args, 'x'), 0), asNumber(getArg(args, 'y'), 0));
  return toJson({ success:true, message:'Tapped through Shizuku' });
}

export async function tapAccessibilityScreenRelative(args: Record<string, any>): Promise<string> {
  await shizukuTapRelative(asNumber(getArg(args, 'x_ratio', 'xRatio'), 0.5), asNumber(getArg(args, 'y_ratio', 'yRatio'), 0.5));
  return toJson({ success:true, message:'Tapped through Shizuku' });
}

export async function swipeAccessibilityScreen(args: Record<string, any>): Promise<string> {
  await shizukuSwipe(asNumber(getArg(args,'start_x','startX'),0),asNumber(getArg(args,'start_y','startY'),0),asNumber(getArg(args,'end_x','endX'),0),asNumber(getArg(args,'end_y','endY'),0),asNumber(getArg(args,'duration_ms','durationMs'),360));
  return toJson({ success:true, message:'Swiped through Shizuku' });
}

export async function clickAccessibilityNode(args: Record<string, any>): Promise<string> {
  const nodeId = String(getArg(args, 'node_id', 'nodeId', 'id') || '').trim();
  if (!nodeId) throw new Error('Missing node_id');
  await shizukuClickNode(nodeId); return toJson({ success:true, message:'Node coordinates tapped through Shizuku' });
}

export async function scrollAccessibilityNode(args: Record<string, any>): Promise<string> {
  const nodeId = String(getArg(args, 'node_id', 'nodeId', 'id') || '').trim();
  if (!nodeId) throw new Error('Missing node_id');
  const direction = String(getArg(args, 'direction') || 'forward');
  await shizukuScrollNode(nodeId, direction); return toJson({ success:true, message:'Node region scrolled through Shizuku' });
}

export async function setAccessibilityNodeText(args: Record<string, any>): Promise<string> {
  const nodeId = String(getArg(args, 'node_id', 'nodeId', 'id') || '').trim();
  if (!nodeId) throw new Error('Missing node_id');
  const textValue = getArg(args, 'text', 'value', 'content');
  if (typeof textValue !== 'string') throw new Error('Missing text');
  await shizukuClickNode(nodeId); const result = await shizukuCommitText(textValue); return toJson(result);
}

export async function setFocusedAccessibilityText(args: Record<string, any>): Promise<string> {
  const textValue = getArg(args, 'text', 'value', 'content');
  if (typeof textValue !== 'string') throw new Error('Missing text');
  return toJson(await shizukuCommitText(textValue));
}

export async function commitInputMethodText(args: Record<string, any>): Promise<string> {
  const textValue = getArg(args, 'text', 'value', 'content');
  if (typeof textValue !== 'string') throw new Error('Missing text');
  return toJson(await shizukuCommitText(textValue));
}

export async function performInputMethodAction(args: Record<string, any>): Promise<string> {
  const action = String(getArg(args, 'action') || 'send');
  return toJson(await shizukuEditorAction(action));
}

export async function deleteInputMethodText(args: Record<string, any>): Promise<string> {
  const beforeLength = asNumber(getArg(args, 'before_length', 'beforeLength'), 1);
  const afterLength = asNumber(getArg(args, 'after_length', 'afterLength'), 0);
  return toJson(await shizukuDeleteText(beforeLength, afterLength));
}

export async function performAccessibilityGlobalAction(args: Record<string, any>): Promise<string> {
  const action = String(getArg(args, 'action') || 'back');
  await shizukuGlobalAction(action); return toJson({ success:true, message:`Global action ${action} performed through Shizuku` });
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
