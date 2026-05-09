import dayjs from 'dayjs';

import shareBgMeeting from '@/assets/share/share-bg-meeting.png';
import shareBgSocial from '@/assets/share/share-bg-social.png';
import shareBgOutdoor from '@/assets/share/share-bg-outdoor.png';

// 🚨 新增：极其稳固的日期生成器（防时区 Bug）
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

// 🚨 新增：安全的星期计算（防 Safari 解析 Bug）
export const getWeekDay = (dateStr: string): string => {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[dayjs(dateStr).day()];
};

// 🚨 替换：带逗号兼容的日期格式化
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

// 🚨 替换：防白屏的时间截取
export const formatTime = (time: string): string => {
  if (!time) return '';
  return String(time).substring(0, 5);
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

export const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const minutesToTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

export const parseSlotKey = (key: string): { date: string; startTime: string; endTime: string } => {
  if (!key.includes('_')) return { date: key, startTime: '', endTime: '' };
  const [date, timeRange] = key.split('_');
  const [startTime, endTime] = timeRange.split('-');
  return { date, startTime, endTime };
};

export const generateId = (): string => {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const getParticipantDisplayName = (participant: any, fallback = '未命名'): string => {
  const eventDisplayName = participant?.eventDisplayName;
  if (typeof eventDisplayName === 'string' && eventDisplayName.trim()) {
    return eventDisplayName.trim();
  }

  return participant?.nickName || participant?.nickname || fallback;
};

export const generateShareInfo = (event: any) => {
  if (!event) return { title: '约时间工具', path: '/pages/index/index' };

  // 1. 智能匹配底图逻辑
  let bgUrl = shareBgMeeting; // 默认使用商务会议图
  const title = event.title || '约时间事件';

  if (title.includes('饭') || title.includes('聚') || title.includes('吃') || title.includes('喝') || title.includes('茶')) {
    bgUrl = shareBgSocial;
  } else if (title.includes('团建') || title.includes('户外') || title.includes('玩') || title.includes('游') || title.includes('运动')) {
    bgUrl = shareBgOutdoor;
  }

  // 2. 提取发起人昵称作为背书
  const creatorName = event.creatorNickName || '你的好友';

  // 3. 根据事件状态动态生成文案
  let shareTitle = `【${creatorName}】邀请你参与「${title}」的时间协调，点击填写 👆`;

  if (String(event.status).toUpperCase() === 'CONFIRMED') {
    shareTitle = `【${creatorName}】发起的「${title}」已确认最终时间，快来看看吧！`;
  } else if (String(event.status).toUpperCase() === 'CLOSED') {
    shareTitle = `【${creatorName}】发起的「${title}」已停止收集。`;
  }

  // 4. 返回完整配置
  return {
    title: shareTitle,
    path: `/pages/event/detail/index?id=${event.id}`,
    imageUrl: bgUrl
  };
};

export const debounce = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

// 连续时段聚合
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
  
  // 按日期和时间排序
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
      // 检查是否是连续的（相同日期、相同人数、结束时间等于当前开始时间）
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

// 检查事件是否已过期
export const isEventExpired = (event: any): boolean => {
  if (!event.dateRange?.end) return false;
  const endDate = dayjs(event.dateRange.end).endOf('day');
  return dayjs().isAfter(endDate);
};

// 生成分享海报文案
export const generateSharePosterText = (event: any): string => {
  const status = event.status === 'confirmed' ? '✅ 已确定时间' : '📅 收集中';
  return `约时间：${event.title}\n${status}\n点击参与 →`;
};

export const snapTime = (timeStr: string, granularity: number, type: 'start' | 'end'): string => {
  const minutes = timeToMinutes(timeStr);
  let snappedMinutes;
  if (type === 'start') {
    snappedMinutes = Math.floor(minutes / granularity) * granularity;
  } else {
    snappedMinutes = Math.ceil(minutes / granularity) * granularity;
  }
  // 限制在 00:00 到 23:59 之间
  snappedMinutes = Math.min(Math.max(snappedMinutes, 0), 24 * 60 - 1);
  return minutesToTime(snappedMinutes);
};

// 候选时间统计类型（从全局 types 引入，避免在 utils 内重复定义）
type CandidateSlot = import('@/types').CandidateSlot;

/**
 * 基于滑动窗口的智能时段推荐算法
 * @param candidateSlots 所有已被选中的基础时间粒度(如30分钟)候选列表
 * @param targetDurationMinutes 预期会议/活动时长(分钟)
 * @param granularityMinutes 基础时间粒度(分钟)，如 30
 * @returns 匹配人数降序排列的连续时间段列表
 */
// 辅助函数：格式化分钟数为易读的时长
const formatDuration = (mins: number) => {
  if (mins % 60 === 0) return `${mins / 60}小时`;
  if (mins < 60) return `${mins}分钟`;
  return `${(mins / 60).toFixed(1).replace('.0', '')}小时`;
};

export const findBestSlidingWindows = (
  candidateSlots: any[],
  targetDurationMinutes: number,
  granularityMinutes: number,
  participants: any[] = [],
  vipIds: string[] = []
): any[] => {
  if (candidateSlots.length === 0 || targetDurationMinutes <= 0) return [];

  const vipNickNames = participants.filter(p => vipIds?.includes(p.openid)).map(p => getParticipantDisplayName(p));

  const slotsByDate = new Map<string, any[]>();
  candidateSlots.forEach(slot => {
    const date = slot.slot.date;
    if (!slotsByDate.has(date)) slotsByDate.set(date, []);
    slotsByDate.get(date)!.push(slot);
  });

  let currentDuration = targetDurationMinutes;
  let allWindows: any[] = [];
  let isDowngraded = false;

  // 🚨 核心特性 1：智能降级循环
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
          let intersectedUsers = windowSlots[0].availableUsers;
          for (let j = 1; j < windowSlots.length; j++) {
            intersectedUsers = intersectedUsers.filter((u: string) => windowSlots[j].availableUsers.includes(u));
          }
          if (intersectedUsers.length > 0) {
            const totalCount = windowSlots[0].totalCount;
            const vCount = intersectedUsers.filter((u: string) => vipNickNames.includes(u)).length;
            const nCount = intersectedUsers.length - vCount;
            allWindows.push({
              date: windowSlots[0].slot.date,
              startTime: windowSlots[0].slot.startTime,
              endTime: windowSlots[windowSlots.length - 1].slot.endTime,
              availableCount: intersectedUsers.length,
              totalCount: totalCount,
              availableUsers: intersectedUsers,
              matchRate: intersectedUsers.length / totalCount,
              slotKeys: windowSlots.map(s => `${s.slot.date}_${s.slot.startTime}-${s.slot.endTime}`),
              vipCount: vCount,
              normalCount: nCount,
              score: (vCount * 10) + nCount // VIP 一票否决权
            });
          }
        }
      }
    });

    // 如果当前时长下找到了任何一个有人能参加的时段，停止降级
    const maxAvailable = Math.max(...allWindows.map(w => w.availableCount), 0);
    if (maxAvailable > 0) break;

    // 否则，降低一个时间粒度继续尝试
    currentDuration -= granularityMinutes;
    isDowngraded = true;
  }

  const downgradeHint = isDowngraded
    ? `未能满足${formatDuration(targetDurationMinutes)}，已为您推荐最长交集(${formatDuration(currentDuration)})`
    : undefined;

  const top5: any[] = [];

  // 🚨 核心特性 2：同质化去重判定
  const isTooSimilar = (newWin: any) => {
    return top5.some(existing => {
      // 必须是同一天
      if (existing.date !== newWin.date) return false;
      // 必须有时间重叠
      const hasOverlap = newWin.slotKeys.some((k: string) => existing.slotKeys.includes(k));
      if (!hasOverlap) return false;
      // 必须人员完全一致
      const sameUsers = existing.availableUsers.length === newWin.availableUsers.length &&
                        existing.availableUsers.every((u: string) => newWin.availableUsers.includes(u));
      return hasOverlap && sameUsers;
    });
  };

  const tryAddWindow = (window: any, reason: string) => {
    if (top5.length >= 5) return;
    if (!isTooSimilar(window)) {
      window.recommendReason = reason;
      window.downgradeHint = downgradeHint;
      top5.push(window);
    }
  };

  // 1. 👑 核心齐聚 (VIP最高优先)
  if (vipIds && vipIds.length > 0) {
    const vipSorted = [...allWindows].sort((a, b) => b.vipCount - a.vipCount || b.availableCount - a.availableCount);
    if (vipSorted.length > 0 && vipSorted[0].vipCount > 0) tryAddWindow(vipSorted[0], '👑 核心齐聚');
  }

  // 2. 👥 人气最旺
  const popSorted = [...allWindows].sort((a, b) => b.availableCount - a.availableCount || b.vipCount - a.vipCount);
  if (popSorted.length > 0) tryAddWindow(popSorted[0], '👥 人气最旺');

  // 3. 🚀 最早成行 (及格线：匹配率 >= 50%)
  const earlySorted = [...allWindows].filter(w => w.matchRate >= 0.5).sort((a, b) => a.slotKeys[0].localeCompare(b.slotKeys[0]));
  if (earlySorted.length > 0) tryAddWindow(earlySorted[0], '🚀 最早成行');

  // 4 & 5. ⚖️ 综合最佳
  const scoreSorted = [...allWindows].sort((a, b) => b.score - a.score);
  for (const w of scoreSorted) {
    if (top5.length >= 5) break;
    tryAddWindow(w, '⚖️ 优质备选');
  }

  return top5;
};

// 新增针对日期模式的智能推荐算法
export const findBestDateWindows = (
  candidateSlots: any[],
  targetDays: number,
  participants: any[] = [],
  vipIds: string[] = []
): any[] => {
  if (candidateSlots.length === 0 || targetDays <= 0) return [];
  const vipNickNames = participants.filter(p => vipIds?.includes(p.openid)).map(p => getParticipantDisplayName(p));

  // 日期模式下 candidateSlot.slot.date 已经是唯一的
  const sortedSlots = [...candidateSlots].sort((a, b) => a.slot.date.localeCompare(b.slot.date));

  let currentDays = Math.min(targetDays, sortedSlots.length);
  let allWindows: any[] = [];
  let isDowngraded = false;

  // 🚨 循环寻找连续日期，找不到则自动降级天数
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
        let intersectedUsers = windowSlots[0].availableUsers;
        for (let j = 1; j < windowSlots.length; j++) {
          intersectedUsers = intersectedUsers.filter((u: string) => windowSlots[j].availableUsers.includes(u));
        }
        if (intersectedUsers.length > 0) {
          const vCount = intersectedUsers.filter((u: string) => vipNickNames.includes(u)).length;
          const nCount = intersectedUsers.length - vCount;
          allWindows.push({
            date: windowSlots[0].slot.date, // 保留以兼容旧组件
            startDate: windowSlots[0].slot.date,
            endDate: windowSlots[windowSlots.length - 1].slot.date,
            availableCount: intersectedUsers.length,
            totalCount: windowSlots[0].totalCount,
            availableUsers: intersectedUsers,
            matchRate: intersectedUsers.length / windowSlots[0].totalCount,
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

  const isTooSimilar = (newWin: any) => top3.some(existing =>
    existing.slotKeys.some((k: string) => newWin.slotKeys.includes(k)) &&
    existing.availableUsers.length === newWin.availableUsers.length &&
    existing.availableUsers.every((u: string) => newWin.availableUsers.includes(u))
  );

  const tryAdd = (win: any, reason: string) => {
    if (top3.length >= 3) return;
    if (!isTooSimilar(win)) {
      win.recommendReason = reason;
      win.downgradeHint = downgradeHint;
      top3.push(win);
    }
  };

  if (vipIds && vipIds.length > 0) {
    const vipSorted = [...allWindows].sort((a, b) => b.vipCount - a.vipCount || b.availableCount - a.availableCount);
    if (vipSorted.length > 0 && vipSorted[0].vipCount > 0) tryAdd(vipSorted[0], '👑 核心齐聚');
  }

  const popSorted = [...allWindows].sort((a, b) => b.availableCount - a.availableCount || b.vipCount - a.vipCount);
  if (popSorted.length > 0) tryAdd(popSorted[0], '👥 人气最旺');

  const scoreSorted = [...allWindows].sort((a, b) => b.score - a.score);
  for (const w of scoreSorted) {
    if (top3.length >= 3) break;
    tryAdd(w, '⚖️ 优质备选');
  }

  return top3;
};
