import * as Notifications from 'expo-notifications';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useSettingsStore } from '../stores/settings';
import { hideFloatingBallMessage, isFloatingBallShowing, showFloatingBallMessage } from './floatingBall';

// ─── 前后台状态追踪 ───────────────────────────────────────────
let currentAppState: AppStateStatus = AppState.currentState;

/**
 * 开始监听应用前后台切换。应在应用挂载时调用一次，返回取消订阅的函数。
 */
export function startAppStateListener(): () => void {
  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    currentAppState = next;
    if (next === 'active') {
      hideFloatingBallMessage().catch(() => {});
    }
  });
  return () => sub.remove();
}

/** 应用是否处于后台（非 active）。 */
export function isAppBackgrounded(): boolean {
  currentAppState = AppState.currentState;
  return currentAppState !== 'active';
}

// ─── 初始化（handler + Android 渠道）──────────────────────────
const NOTIFICATION_SOUND = 'messagealert.mp3';
const CHANNEL_ID = 'chat-replies-message-alert-v2';
const PROMPT_CACHE_CHANNEL_ID = 'prompt-cache-reminders-v1';
const PROMPT_CACHE_NOTIFICATION_KIND = 'prompt-cache-reminder';
let initialized = false;

/**
 * 幂等。设置通知 handler 并创建 Android 通知渠道。多次调用只生效一次。
 */
export async function initNotifications(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // handler：决定应用前台时收到通知如何处理（本流程下一般在后台，但 API 要求设置）
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const kind = notification.request.content.data?.kind;
      if (kind === PROMPT_CACHE_NOTIFICATION_KIND) {
        return {
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        };
      }

      const shouldShow = isAppBackgrounded();
      return {
        shouldShowAlert: shouldShow,
        shouldShowBanner: shouldShow,
        shouldShowList: shouldShow,
        shouldPlaySound: shouldShow,
        shouldSetBadge: false,
      };
    },
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '聊天回复',
      importance: Notifications.AndroidImportance.HIGH,
      sound: NOTIFICATION_SOUND,
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync(PROMPT_CACHE_CHANNEL_ID, {
      name: 'Prompt 缓存提醒',
      importance: Notifications.AndroidImportance.HIGH,
      sound: NOTIFICATION_SOUND,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

// ─── 权限请求 ─────────────────────────────────────────────────
let permissionGranted: boolean | null = null; // null = 尚未询问

export async function ensurePermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') {
      permissionGranted = true;
      return true;
    }
    const { status } = await Notifications.requestPermissionsAsync();
    permissionGranted = status === 'granted';
    return permissionGranted;
  } catch {
    permissionGranted = false;
    return false;
  }
}

// ─── 发送通知 ─────────────────────────────────────────────────
const BODY_MAX_LENGTH = 200;

interface NotifyReplyReadyOptions {
  showFloatingBall?: boolean;
  speakFloatingBall?: boolean;
}

async function shouldSkipNotificationForFloatingBall(): Promise<boolean> {
  if (!useSettingsStore.getState().floatingBallConfig.enabled) return false;
  try {
    return await isFloatingBallShowing();
  } catch {
    return false;
  }
}

/**
 * AI 回复完成时发送本地通知。
 * 若应用在前台、权限被拒或发送失败，则静默无操作，绝不影响聊天流程。
 */
export async function notifyReplyReady(
  replyText: string,
  options: NotifyReplyReadyOptions = {}
): Promise<void> {
  try {
    if (!isAppBackgrounded()) return; // 用户正在看应用
    if (await shouldSkipNotificationForFloatingBall()) return;
    if (!(await ensurePermission())) return; // 无权限

    const trimmed = replyText.trim();
    if (!trimmed) return;

    const body =
      trimmed.length > BODY_MAX_LENGTH
        ? trimmed.slice(0, BODY_MAX_LENGTH) + '…'
        : trimmed;

    if (options.showFloatingBall !== false && useSettingsStore.getState().floatingBallConfig.enabled) {
      showFloatingBallMessage(body, { speak: options.speakFloatingBall !== false }).catch(() => {});
    }

    if (!(await ensurePermission())) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Claude在呼叫你……',
        body,
        sound: NOTIFICATION_SOUND,
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // 静默忽略：通知失败绝不能影响聊天
  }
}

export async function cancelPromptCacheReminder(conversationId: string): Promise<void> {
  try {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      requests
        .filter((request) =>
          request.content.data?.kind === PROMPT_CACHE_NOTIFICATION_KIND &&
          request.content.data?.conversationId === conversationId
        )
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
    );
  } catch {
    // 静默忽略：取消失败时仍允许后续重新安排。
  }
}

export async function cancelAllPromptCacheReminders(): Promise<void> {
  try {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      requests
        .filter((request) => request.content.data?.kind === PROMPT_CACHE_NOTIFICATION_KIND)
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
    );
  } catch {
    // 静默忽略：通知失败不能影响设置保存。
  }
}

function minutesOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

function isInQuietHours(timestamp: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) return false;
  const current = minutesOfDay(timestamp);
  if (startMinutes < endMinutes) {
    return current >= startMinutes && current < endMinutes;
  }
  return current >= startMinutes || current < endMinutes;
}

function resolvePromptCacheReminderTime(triggerAt: number): number | null {
  const config = useSettingsStore.getState().promptCacheConfig;
  if (!config?.reminderEnabled) return null;

  const safeTriggerAt = Math.max(triggerAt, Date.now() + 1000);
  if (
    !config.quietHoursEnabled ||
    !isInQuietHours(safeTriggerAt, config.quietStartMinutes, config.quietEndMinutes)
  ) {
    return safeTriggerAt;
  }

  return null;
}

export async function schedulePromptCacheReminder({
  conversationId,
  triggerAt,
}: {
  conversationId: string;
  triggerAt: number;
}): Promise<boolean> {
  try {
    await cancelPromptCacheReminder(conversationId);
    const resolvedTriggerAt = resolvePromptCacheReminderTime(triggerAt);
    if (!resolvedTriggerAt) return false;
    if (!(await ensurePermission())) return false;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Claude 缓存快过期了',
        body: '回到应用后，可以在左下角加号里点“缓存保活”。',
        sound: NOTIFICATION_SOUND,
        data: {
          kind: PROMPT_CACHE_NOTIFICATION_KIND,
          conversationId,
          triggerAt: resolvedTriggerAt,
          originalTriggerAt: triggerAt,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(resolvedTriggerAt),
        channelId: Platform.OS === 'android' ? PROMPT_CACHE_CHANNEL_ID : undefined,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function rescheduleAllPromptCacheReminders(): Promise<void> {
  try {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    const reminders = requests.filter((request) => request.content.data?.kind === PROMPT_CACHE_NOTIFICATION_KIND);
    await Promise.all(reminders.map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));

    for (const request of reminders) {
      const conversationId = request.content.data?.conversationId;
      const originalTriggerAt = request.content.data?.originalTriggerAt || request.content.data?.triggerAt;
      if (typeof conversationId !== 'string' || typeof originalTriggerAt !== 'number') continue;
      await schedulePromptCacheReminder({ conversationId, triggerAt: originalTriggerAt });
    }
  } catch {
    // 静默忽略：提醒重排失败不影响设置保存。
  }
}
