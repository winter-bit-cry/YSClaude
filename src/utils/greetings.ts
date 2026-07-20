const DEFAULT_GREETING = 'What shall we think through?';

const DEFAULT_COMMON_GREETINGS = [
  'Welcome,user',
  'Hey there,user',
  'user returns!',
  'Back at it,user',
  'Coffee and Claude time?',
  "Let's noodle",
  "Let's jump in,user",
  'Golden hour thinking',
  DEFAULT_GREETING,
];

const DEFAULT_MORNING_GREETINGS = [
  'Morning,user',
  'Good morning,user',
];

const DEFAULT_AFTERNOON_GREETINGS = [
  'Afternoon,user',
  'Good afternoon,user',
];

const DEFAULT_EVENING_GREETINGS = [
  'Good evening,user',
  'Up late,user?',
  'Hello,night owl',
  'Moonlit chat?',
  'Burning the midnight tokens',
];

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function normalizeCustomGreetings(value?: string): string[] {
  return (value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface PickGreetingOptions {
  useDefaultGreetings?: boolean;
  defaultGreetingName?: string;
  now?: Date;
}

export function pickGreeting(
  customGreetings?: string,
  options: PickGreetingOptions = {}
): string {
  const pool = [
    ...buildDefaultGreetingPool(options),
    ...normalizeCustomGreetings(customGreetings),
  ];
  if (pool.length === 0) return DEFAULT_GREETING;
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildDefaultGreetingPool(options: PickGreetingOptions): string[] {
  const name = options.defaultGreetingName?.trim();
  if (!options.useDefaultGreetings || !name) return [];

  const now = options.now || new Date();
  const weekday = WEEKDAYS[now.getDay()];
  const weekdayGreetings = [
    `Happy ${weekday},user`,
    ...(weekday === 'Sunday' ? ['Sunday session,user?'] : []),
  ];
  return [
    ...DEFAULT_COMMON_GREETINGS,
    ...timePool(now.getHours()),
    ...weekdayGreetings,
  ].map((greeting) => greeting.replace(/\buser\b/g, name));
}

function timePool(hour: number): string[] {
  if (hour >= 5 && hour < 11) return DEFAULT_MORNING_GREETINGS;
  if (hour >= 11 && hour < 18) return DEFAULT_AFTERNOON_GREETINGS;
  return DEFAULT_EVENING_GREETINGS;
}
