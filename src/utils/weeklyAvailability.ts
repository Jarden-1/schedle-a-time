import { generateTimeSlots, minutesToTime, parseSlotKey, timeToMinutes } from './time';

export const WEEK_REFERENCE_DATES = [
  '2026-01-05',
  '2026-01-06',
  '2026-01-07',
  '2026-01-08',
  '2026-01-09',
  '2026-01-10',
  '2026-01-11'
];

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const WEEKLY_START_TIME = '08:00';
export const WEEKLY_END_TIME = '24:00';
export const WEEKLY_GRANULARITY = 30;

export const generateWeeklyGridSlotKeys = (): string[] => (
  generateTimeSlots(
    WEEK_REFERENCE_DATES[0],
    WEEK_REFERENCE_DATES[WEEK_REFERENCE_DATES.length - 1],
    WEEKLY_START_TIME,
    WEEKLY_END_TIME,
    WEEKLY_GRANULARITY
  )
);

export const weeklyKeyToGridKey = (weeklyKey: string): string => {
  const [weekday, range] = weeklyKey.split('_');
  const date = WEEK_REFERENCE_DATES.find((item) => {
    const [year, month, day] = item.split('-').map(Number);
    return new Date(year, month - 1, day).getDay() === Number(weekday);
  });
  return date && range ? `${date}_${range}` : '';
};

export const gridKeyToWeeklyKey = (gridKey: string): string => {
  const { date, startTime, endTime } = parseSlotKey(gridKey);
  if (!date || !startTime || !endTime) return '';
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return `${weekday}_${startTime}-${endTime}`;
};

export const eventSlotToWeeklyKey = (slotKey: string): string => {
  const { date, startTime, endTime } = parseSlotKey(slotKey);
  if (!date || !startTime || !endTime) return '';
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return `${weekday}_${startTime}-${endTime}`;
};

export const eventSlotToWeeklyKeys = (slotKey: string): string[] => {
  const { date, startTime, endTime } = parseSlotKey(slotKey);
  if (!date || !startTime || !endTime) return [];
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const keys: string[] = [];

  for (let current = startMinutes; current < endMinutes; current += WEEKLY_GRANULARITY) {
    const next = Math.min(current + WEEKLY_GRANULARITY, endMinutes);
    keys.push(`${weekday}_${minutesToTime(current)}-${minutesToTime(next)}`);
  }

  return keys;
};

export const mapWeeklyUnavailableToEventSlots = (
  eventSlotKeys: string[],
  weeklyUnavailableSlots: string[]
): Set<string> => {
  const weeklySet = new Set(weeklyUnavailableSlots);
  return new Set(eventSlotKeys.filter((slotKey) => eventSlotToWeeklyKeys(slotKey).some((key) => weeklySet.has(key))));
};
