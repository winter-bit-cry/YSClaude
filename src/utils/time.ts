// 时间相关工具：当前时间格式化、消息间时间戳分隔判断与格式化。

const pad = (n: number) => String(n).padStart(2, '0');

/** 完整本地时间：YYYY-MM-DD HH:mm */
export function formatFullTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 当前本地时间（YYYY-MM-DD HH:mm），用于注入 system prompt 最前面。 */
export function formatCurrentTime(): string {
  return formatFullTime(Date.now());
}

/** 仅日期：YYYY-MM-DD（用作上传日记的 date 默认值）。 */
export function formatDateOnly(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 智能格式（聊天页分隔 + 发给 AI 的标记共用）：
 * - 今天 → HH:mm
 * - 昨天 → 昨天 HH:mm
 * - 更早 → YYYY-MM-DD HH:mm
 */
export function formatSmartTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();

  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (dayDiff <= 0) return hm;
  if (dayDiff === 1) return `昨天 ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** 发给 AI 的时间标记文本（智能格式）。与聊天页分隔同源，保持一致。 */
export function formatTimeMarker(ts: number): string {
  return formatSmartTime(ts);
}

/** 消息间插入时间戳分隔的间隔阈值（毫秒）：30 分钟。 */
export const TIME_GAP_THRESHOLD_MS = 30 * 60 * 1000;
