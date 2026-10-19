import dayjs from 'dayjs';

import { getParticipantDisplayName, getParticipantKey } from './participants';
import { parseSlotKey, timeToMinutes } from './time';

export interface MergedSlot {
  date: string;
  startTime: string;
  endTime: string;
  availableCount: number;
  totalCount: number;
  availableUsers: string[];
  matchRate: number;
  slotKeys: string[];
  vipCount?: number;
  recommendReason?: string;
}

export const mergeConsecutiveSlots = (
  slots: { slotKey: string; availableCount: number; totalCount: number; availableUsers: string[]; rate: number }[]
): MergedSlot[] => {
  if (slots.length === 0) return [];

  const merged: MergedSlot[] = [];
  let current: MergedSlot | null = null;
  const sortedSlots = [...slots].sort((a, b) => a.slotKey.localeCompare(b.slotKey));

  for (const slot of sortedSlots) {
    const { date, startTime, endTime } = parseSlotKey(slot.slotKey);

    if (!current) {
      current = {
        date,
        startTime,
        endTime,
        availableCount: slot.availableCount,
        totalCount: slot.totalCount,
        availableUsers: [...slot.availableUsers],
        matchRate: slot.rate,
        slotKeys: [slot.slotKey]
      };
    } else {
      const isConsecutive =
        current.date === date &&
        current.availableCount === slot.availableCount &&
        current.endTime === startTime &&
        JSON.stringify(current.availableUsers.sort()) === JSON.stringify([...slot.availableUsers].sort());

      if (isConsecutive) {
        current.endTime = endTime;
        current.slotKeys.push(slot.slotKey);
      } else {
        merged.push(current);
        current = {
          date,
          startTime,
          endTime,
          availableCount: slot.availableCount,
          totalCount: slot.totalCount,
          availableUsers: [...slot.availableUsers],
          matchRate: slot.rate,
          slotKeys: [slot.slotKey]
        };
      }
    }
  }

  if (current) merged.push(current);
  return merged;
};

const formatDuration = (mins: number) => {
  if (mins % 60 === 0) return `${mins / 60}小时`;
  if (mins < 60) return `${mins}分钟`;
  return `${(mins / 60).toFixed(1).replace('.0', '')}小时`;
};

const getWindowSortKey = (window: any) => window.slotKeys?.[0] || `${window.date || window.startDate || ''}_${window.startTime || ''}`;

const getUnavailableCount = (window: any) => Math.max((window.totalCount || 0) - (window.availableCount || 0), 0);

const compareRecommendationWindows = (a: any, b: any) => (
  (b.vipCount || 0) - (a.vipCount || 0) ||
  (b.availableCount || 0) - (a.availableCount || 0) ||
  getUnavailableCount(a) - getUnavailableCount(b) ||
  (b.matchRate || 0) - (a.matchRate || 0) ||
  getWindowSortKey(a).localeCompare(getWindowSortKey(b))
);

const resolveRecommendationReason = (
  window: any,
  options: { hasVips: boolean; vipTotal: number; maxAvailable: number; earliestQualifiedKey?: string }
) => {
  if (options.hasVips && window.vipCount >= options.vipTotal) return '👑 核心齐聚';
  if (window.availableCount === options.maxAvailable) return '👥 人气最旺';
  if (options.earliestQualifiedKey && getWindowSortKey(window) === options.earliestQualifiedKey) return '🚀 最早成行';
  return '⚖️ 优质备选';
};

const buildIdentityContext = (participants: any[] = [], vipIds: string[] = []) => {
  const nameByKey = new Map<string, string>();
  const vipKeys = new Set<string>();
  participants.forEach((participant) => {
    const key = getParticipantKey(participant);
    if (!key) return;
    nameByKey.set(key, getParticipantDisplayName(participant));
    if (Array.isArray(vipIds) && participant?.openid && vipIds.includes(participant.openid)) {
      vipKeys.add(key);
    }
  });
  return { nameByKey, vipKeys };
};

const resolveAvailableIds = (slot: any): string[] => {
  if (Array.isArray(slot?.availableIds)) return slot.availableIds;
  if (Array.isArray(slot?.availableUsers)) return slot.availableUsers;
  return [];
};

const toDisplayNames = (ids: string[], nameByKey: Map<string, string>) =>
  ids.map(id => nameByKey.get(id) || id);

export const findBestSlidingWindows = (
  candidateSlots: any[],
  targetDurationMinutes: number,
  granularityMinutes: number,
  participants: any[] = [],
  vipIds: string[] = []
): any[] => {
  if (candidateSlots.length === 0 || targetDurationMinutes <= 0) return [];

  const { nameByKey, vipKeys } = buildIdentityContext(participants, vipIds);
  const slotsByDate = new Map<string, any[]>();
  candidateSlots.forEach(slot => {
    const date = slot.slot.date;
    if (!slotsByDate.has(date)) slotsByDate.set(date, []);
    slotsByDate.get(date)!.push(slot);
  });

  let currentDuration = targetDurationMinutes;
  let allWindows: any[] = [];
  let isDowngraded = false;

  while (currentDuration >= granularityMinutes) {
    const windowSize = Math.max(1, Math.ceil(currentDuration / granularityMinutes));
    allWindows = [];

    slotsByDate.forEach((dailySlots) => {
      dailySlots.sort((a, b) => timeToMinutes(a.slot.startTime) - timeToMinutes(b.slot.startTime));
      for (let i = 0; i <= dailySlots.length - windowSize; i++) {
        const windowSlots = dailySlots.slice(i, i + windowSize);
        let isConsecutive = true;
        for (let j = 0; j < windowSlots.length - 1; j++) {
          if (windowSlots[j].slot.endTime !== windowSlots[j + 1].slot.startTime) {
            isConsecutive = false; break;
          }
        }
        if (isConsecutive) {
          // 🚨 用稳定身份求交集，避免同名用户被合并成同一个人
          let intersectedIds: string[] = resolveAvailableIds(windowSlots[0]);
          for (let j = 1; j < windowSlots.length; j++) {
            const slotIds = resolveAvailableIds(windowSlots[j]);
            intersectedIds = intersectedIds.filter((id: string) => slotIds.includes(id));
          }
          if (intersectedIds.length > 0) {
            const totalCount = windowSlots[0].totalCount;
            const vCount = intersectedIds.filter((id: string) => vipKeys.has(id)).length;
            const nCount = intersectedIds.length - vCount;
            allWindows.push({
              date: windowSlots[0].slot.date,
              startTime: windowSlots[0].slot.startTime,
              endTime: windowSlots[windowSlots.length - 1].slot.endTime,
              availableCount: intersectedIds.length,
              totalCount: totalCount,
              availableIds: intersectedIds,
              availableUsers: toDisplayNames(intersectedIds, nameByKey),
              matchRate: intersectedIds.length / totalCount,
              slotKeys: windowSlots.map(s => `${s.slot.date}_${s.slot.startTime}-${s.slot.endTime}`),
              vipCount: vCount,
              normalCount: nCount,
              score: (vCount * 10) + nCount
            });
          }
        }
      }
    });

    const maxAvailable = Math.max(...allWindows.map(w => w.availableCount), 0);
    if (maxAvailable > 0) break;

    currentDuration -= granularityMinutes;
    isDowngraded = true;
  }

  const downgradeHint = isDowngraded
    ? `未能满足${formatDuration(targetDurationMinutes)}，已为您推荐最长交集(${formatDuration(currentDuration)})`
    : undefined;

  const top5: any[] = [];
  const maxAvailable = Math.max(...allWindows.map(w => w.availableCount), 0);
  const earliestQualifiedWindow = [...allWindows]
    .filter(w => w.matchRate >= 0.5)
    .sort((a, b) => getWindowSortKey(a).localeCompare(getWindowSortKey(b)))[0];
  const earliestQualifiedKey = earliestQualifiedWindow ? getWindowSortKey(earliestQualifiedWindow) : undefined;

  const isTooSimilar = (newWin: any) => {
    return top5.some(existing => {
      if (existing.date !== newWin.date) return false;
      const hasOverlap = newWin.slotKeys.some((k: string) => existing.slotKeys.includes(k));
      if (!hasOverlap) return false;
      const existingIds = existing.availableIds || [];
      const newIds = newWin.availableIds || [];
      const sameUsers = existingIds.length === newIds.length &&
                        existingIds.every((id: string) => newIds.includes(id));
      return hasOverlap && sameUsers;
    });
  };

  const tryAddWindow = (window: any) => {
    if (top5.length >= 5) return;
    if (!isTooSimilar(window)) {
      top5.push({
        ...window,
        recommendReason: resolveRecommendationReason(window, {
          hasVips: vipKeys.size > 0,
          vipTotal: vipKeys.size,
          maxAvailable,
          earliestQualifiedKey
        }),
        downgradeHint
      });
    }
  };

  const rankedWindows = [...allWindows].sort(compareRecommendationWindows);
  for (const w of rankedWindows) {
    if (top5.length >= 5) break;
    tryAddWindow(w);
  }

  return top5;
};

export const findBestDateWindows = (
  candidateSlots: any[],
  targetDays: number,
  participants: any[] = [],
  vipIds: string[] = []
): any[] => {
  if (candidateSlots.length === 0 || targetDays <= 0) return [];
  const { nameByKey, vipKeys } = buildIdentityContext(participants, vipIds);
  const sortedSlots = [...candidateSlots].sort((a, b) => a.slot.date.localeCompare(b.slot.date));

  let currentDays = Math.min(targetDays, sortedSlots.length);
  let allWindows: any[] = [];
  let isDowngraded = false;

  while (currentDays >= 1) {
    allWindows = [];
    for (let i = 0; i <= sortedSlots.length - currentDays; i++) {
      const windowSlots = sortedSlots.slice(i, i + currentDays);
      let isConsecutive = true;
      for (let j = 0; j < windowSlots.length - 1; j++) {
        const d1 = dayjs(windowSlots[j].slot.date);
        const d2 = dayjs(windowSlots[j + 1].slot.date);
        if (d2.diff(d1, 'day') !== 1) {
          isConsecutive = false; break;
        }
      }

      if (isConsecutive || currentDays === 1) {
        // 🚨 同上：按稳定身份求交集
        let intersectedIds: string[] = resolveAvailableIds(windowSlots[0]);
        for (let j = 1; j < windowSlots.length; j++) {
          const slotIds = resolveAvailableIds(windowSlots[j]);
          intersectedIds = intersectedIds.filter((id: string) => slotIds.includes(id));
        }
        if (intersectedIds.length > 0) {
          const vCount = intersectedIds.filter((id: string) => vipKeys.has(id)).length;
          const nCount = intersectedIds.length - vCount;
          allWindows.push({
            date: windowSlots[0].slot.date,
            startDate: windowSlots[0].slot.date,
            endDate: windowSlots[windowSlots.length - 1].slot.date,
            availableCount: intersectedIds.length,
            totalCount: windowSlots[0].totalCount,
            availableIds: intersectedIds,
            availableUsers: toDisplayNames(intersectedIds, nameByKey),
            matchRate: intersectedIds.length / windowSlots[0].totalCount,
            slotKeys: windowSlots.map(s => s.slot.date),
            vipCount: vCount,
            normalCount: nCount,
            score: (vCount * 10) + nCount
          });
        }
      }
    }

    if (allWindows.length > 0) {
      if (currentDays < targetDays) isDowngraded = true;
      break;
    }
    currentDays--;
  }

  const downgradeHint = isDowngraded ? `未找到连续${targetDays}天的最佳组合，已降级推荐连续${currentDays}天` : undefined;
  const top3: any[] = [];
  const maxAvailable = Math.max(...allWindows.map(w => w.availableCount), 0);

  const isTooSimilar = (newWin: any) => top3.some(existing =>
    existing.slotKeys.some((k: string) => newWin.slotKeys.includes(k)) &&
    (existing.availableIds || []).length === (newWin.availableIds || []).length &&
    (existing.availableIds || []).every((id: string) => (newWin.availableIds || []).includes(id))
  );

  const tryAdd = (win: any) => {
    if (top3.length >= 3) return;
    if (!isTooSimilar(win)) {
      top3.push({
        ...win,
        recommendReason: resolveRecommendationReason(win, {
          hasVips: vipKeys.size > 0,
          vipTotal: vipKeys.size,
          maxAvailable
        }),
        downgradeHint
      });
    }
  };

  const rankedWindows = [...allWindows].sort(compareRecommendationWindows);
  for (const w of rankedWindows) {
    if (top3.length >= 3) break;
    tryAdd(w);
  }

  return top3;
};
