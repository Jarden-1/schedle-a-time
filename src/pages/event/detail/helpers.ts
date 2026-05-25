import { Event } from '@/types';

export const getEventStatus = (event?: Event | null): string => {
  return String(event?.status || '').toUpperCase();
};

export const isEventLocked = (event?: Event | null): boolean => {
  const status = getEventStatus(event);
  return status === 'CLOSED' || status === 'CONFIRMED';
};

export const getMergedConfirmedSlots = (event: Event): any[] => {
  let confirmedSlotsList: any[] = [];

  if (event.confirmedSlots && Array.isArray(event.confirmedSlots)) {
    confirmedSlotsList = event.confirmedSlots;
  } else if (event.confirmedSlot && event.confirmedSlot.date) {
    const dates = event.confirmedSlot.date.split(',');
    const startTimes = event.confirmedSlot.startTime ? event.confirmedSlot.startTime.split(',') : [];
    const endTimes = event.confirmedSlot.endTime ? event.confirmedSlot.endTime.split(',') : [];

    confirmedSlotsList = dates.map((d, i) => ({
      date: d,
      startTime: startTimes[i] || '',
      endTime: endTimes[i] || ''
    }));
  }

  const mergedConfirmedSlots: any[] = [];
  if (confirmedSlotsList.length === 0) return mergedConfirmedSlots;

  const sortedSlots = [...confirmedSlotsList].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });

  let current = { ...sortedSlots[0] };
  for (let i = 1; i < sortedSlots.length; i++) {
    const next = sortedSlots[i];
    if (current.date === next.date && current.endTime === next.startTime) {
      current.endTime = next.endTime;
    } else {
      mergedConfirmedSlots.push(current);
      current = { ...next };
    }
  }
  mergedConfirmedSlots.push(current);
  return mergedConfirmedSlots;
};
