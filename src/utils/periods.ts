import { PeriodRecord } from '../types';

export interface PeriodPrediction {
  startDate: string;
  endDate: string;
  durationDays: number;
  cycleDays: number;
}

type CompletedPeriodRecord = PeriodRecord & { endDate: string };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDateKey(value: string): Date | null {
  const match = value.match(DATE_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function localDateKeyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysToDateKey(key: string, days: number): string {
  const date = parseLocalDateKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + days);
  return localDateKeyFromDate(date);
}

export function daysBetweenDateKeys(startKey: string, endKey: string): number {
  const start = parseLocalDateKey(startKey);
  const end = parseLocalDateKey(endKey);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function inclusiveDaysBetweenDateKeys(startKey: string, endKey: string): number {
  return daysBetweenDateKeys(startKey, endKey) + 1;
}

function isDateKeyInRange(key: string, startKey: string, endKey: string): boolean {
  return key >= startKey && key <= endKey;
}

export function getDateKeysInRange(startKey: string, endKey: string): string[] {
  const start = parseLocalDateKey(startKey);
  const end = parseLocalDateKey(endKey);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const result: string[] = [];
  const current = new Date(start);
  while (current.getTime() <= end.getTime()) {
    result.push(localDateKeyFromDate(current));
    current.setDate(current.getDate() + 1);
  }
  return result;
}

export function findPeriodRecordForDate(
  records: PeriodRecord[],
  dateKey: string
): PeriodRecord | null {
  const today = localDateKeyFromDate(new Date());
  return records.find((record) => {
    if (record.endDate) {
      return isDateKeyInRange(dateKey, record.startDate, record.endDate);
    }
    return isDateKeyInRange(dateKey, record.startDate, today);
  }) || null;
}

export function buildPeriodDateSet(records: PeriodRecord[]): Set<string> {
  const keys = new Set<string>();
  records.forEach((record) => {
    if (!record.endDate) {
      keys.add(record.startDate);
      return;
    }
    getDateKeysInRange(record.startDate, record.endDate).forEach((key) => keys.add(key));
  });
  return keys;
}

function isCompletedPeriodRecord(record: PeriodRecord): record is CompletedPeriodRecord {
  if (!record.endDate) return false;
  const duration = inclusiveDaysBetweenDateKeys(record.startDate, record.endDate);
  return !!parseLocalDateKey(record.startDate) && !!parseLocalDateKey(record.endDate) && duration > 0;
}

function sortedValidRecords(records: PeriodRecord[]): CompletedPeriodRecord[] {
  return records
    .filter(isCompletedPeriodRecord)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function averageRounded(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(1, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
}

export function calculatePeriodPrediction(
  records: PeriodRecord[],
  _anchorDateKey = localDateKeyFromDate(new Date())
): PeriodPrediction | null {
  const sorted = sortedValidRecords(records);
  if (sorted.length === 0) return null;

  const recent = sorted.slice(-3);
  const last = sorted[sorted.length - 1];
  const durations = recent.map((record) =>
    inclusiveDaysBetweenDateKeys(record.startDate, record.endDate)
  );
  const durationDays = averageRounded(durations);
  const intervals: number[] = [];

  for (let index = 1; index < recent.length; index++) {
    const interval = daysBetweenDateKeys(recent[index - 1].startDate, recent[index].startDate);
    if (interval > 0) intervals.push(interval);
  }

  const cycleDays = intervals.length > 0 ? averageRounded(intervals) : 28;
  // A prediction must only advance from a real record. If the user does not
  // record the predicted period, keep this prediction overdue instead of
  // treating the prediction itself as the start of another cycle.
  const startDate = addDaysToDateKey(last.startDate, cycleDays);
  const endDate = addDaysToDateKey(startDate, durationDays - 1);

  return { startDate, endDate, durationDays, cycleDays };
}

export function buildPeriodSystemPrompt(records: PeriodRecord[]): string | null {
  const today = localDateKeyFromDate(new Date());
  const actualRecord = findPeriodRecordForDate(records, today);
  if (actualRecord) {
    const dayIndex = inclusiveDaysBetweenDateKeys(actualRecord.startDate, today);
    if (!actualRecord.endDate) {
      return [
        '用户已开启生理期状态提醒。',
        `根据用户本地记录，今天 ${today} 处于已记录但尚未填写结束日期的经期第 ${dayIndex} 天，开始日期为 ${actualRecord.startDate}。`,
        '请在相关对话中保持体贴和克制；不要主动展开医疗建议，除非用户明确询问。',
      ].join('\n');
    }
    const duration = inclusiveDaysBetweenDateKeys(actualRecord.startDate, actualRecord.endDate);
    return [
      '用户已开启生理期状态提醒。',
      `根据用户本地记录，今天 ${today} 处于已记录经期第 ${dayIndex} 天，记录区间为 ${actualRecord.startDate} 至 ${actualRecord.endDate}，共 ${duration} 天。`,
      '请在相关对话中保持体贴和克制；不要主动展开医疗建议，除非用户明确询问。',
    ].join('\n');
  }

  const prediction = calculatePeriodPrediction(records, today);
  if (!prediction) return null;

  const daysUntilStart = daysBetweenDateKeys(today, prediction.startDate);
  const inPredictedPeriod = isDateKeyInRange(today, prediction.startDate, prediction.endDate);
  if (!inPredictedPeriod && (daysUntilStart < 0 || daysUntilStart > 2)) {
    return null;
  }

  if (inPredictedPeriod) {
    const completedRecords = sortedValidRecords(records);
    const lastRecord = completedRecords[completedRecords.length - 1];
    const daysSinceLastStart = daysBetweenDateKeys(lastRecord.startDate, today);
    return [
      '用户已开启生理期状态提醒。',
      `用户上一次记录的生理期为 ${lastRecord.startDate} 至 ${lastRecord.endDate}，距上次开始已经过了 ${daysSinceLastStart} 天；目前没有新的生理期记录，根据周期推算，生理期可能在近日开始。`,
      '请勿将预测日期描述为用户已经处于生理期。这只是基于历史记录的推测，不是确定事实。请在相关对话中保持体贴和克制；不要主动展开医疗建议，除非用户明确询问。',
    ].join('\n');
  }

  return [
    '用户已开启生理期状态提醒。',
    `根据用户本地记录推算，预计下次生理期将于 ${prediction.startDate} 开始，预计持续 ${prediction.durationDays} 天，今天距离预计开始还有 ${daysUntilStart} 天。`,
    '这是预测信息，不是确定事实。请在相关对话中保持体贴和克制；不要主动展开医疗建议，除非用户明确询问。',
  ].join('\n');
}
