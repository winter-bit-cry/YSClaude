export type TopBarIconKey =
  | 'history'
  | 'reading'
  | 'web'
  | 'accounting'
  | 'focus'
  | 'calendar'
  | 'music'
  | 'settings';

export const TOP_BAR_ICON_LABELS: Record<TopBarIconKey, string> = {
  history: '历史',
  reading: '阅读',
  web: '网页',
  accounting: '记账',
  focus: '专注',
  calendar: '日历',
  music: '音乐',
  settings: '设置',
};

export const TOP_BAR_ICON_KEYS: TopBarIconKey[] = [
  'history',
  'reading',
  'web',
  'accounting',
  'focus',
  'calendar',
  'music',
  'settings',
];
