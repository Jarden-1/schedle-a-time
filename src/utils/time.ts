import dayjs from 'dayjs';

export const generateDateSlots = (startDate: string, endDate: string): string[] => {
  const slots: string[] = [];
  let current = dayjs(startDate);
  const end = dayjs(endDate);
  while (current.isBefore(end) || current.isSame(end, 'day')) {
    slots.push(current.format('YYYY-MM-DD'));
    current = current.add(1, 'day');
  }
  return slots;
};

export const getWeekDay = (dateStr: string): string => {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[dayjs(dateStr).day()];
};

export const formatDate = (date: string | Date, format?: string): string => {
  const fmt = format || 'MM月DD日';
  if (typeof date === 'string' && date.includes(',')) {
    return date
      .split(',')
      .map(d => dayjs(d.trim()).format(fmt))
      .join(', ');
  }
  return dayjs(date).format(fmt);
};

export const formatTime = (time: string): string => {
  if (!time) return '';
  return String(time).substring(0, 5);
};

export const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const minutesToTime = (minutes: number): string => {
  // 允许 24:00 作为「当天结束」的边界，否则 23:30 起的最后一个格子会被截掉
  const safe = Math.max(0, Math.min(Math.round(minutes), 24 * 60));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

export const generateTimeSlots = (
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  granularity: number
): string[] => {
  const slots: string[] = [];
  const start = dayjs(startDate);
  const end = dayjs(endDate);

  let currentDate = start;
  while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
    let currentMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    while (currentMinutes + granularity <= endMinutes) {
      const slotStart = minutesToTime(currentMinutes);
      const slotEnd = minutesToTime(currentMinutes + granularity);
      slots.push(`${currentDate.format('YYYY-MM-DD')}_${slotStart}-${slotEnd}`);
      currentMinutes += granularity;
    }

    currentDate = currentDate.add(1, 'day');
  }

  return slots;
};

export const parseSlotKey = (key: string): { date: string; startTime: string; endTime: string } => {
  if (!key.includes('_')) return { date: key, startTime: '', endTime: '' };
  const [date, timeRange] = key.split('_');
  const [startTime, endTime] = timeRange.split('-');
  return { date, startTime, endTime };
};

export const snapTime = (timeStr: string, granularity: number, type: 'start' | 'end'): string => {
  const minutes = timeToMinutes(timeStr);
  let snappedMinutes;
  if (type === 'start') {
    snappedMinutes = Math.floor(minutes / granularity) * granularity;
  } else {
    snappedMinutes = Math.ceil(minutes / granularity) * granularity;
  }
  const upperBound = type === 'end' ? 24 * 60 : 24 * 60 - 1;
  snappedMinutes = Math.min(Math.max(snappedMinutes, 0), upperBound);
  return minutesToTime(snappedMinutes);
};

/** 结束时间是否合法（允许 24:00 表示当天结束） */
export const isValidEndTime = (timeStr: string): boolean => {
  if (timeStr === '24:00') return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr || '');
};
