import dayjs from 'dayjs';

import shareBgMeeting from '@/assets/share/share-bg-meeting.png';
import shareBgSocial from '@/assets/share/share-bg-social.png';
import shareBgOutdoor from '@/assets/share/share-bg-outdoor.png';

export const generateShareInfo = (event: any) => {
  if (!event) return { title: '约时间工具', path: '/pages/index/index' };

  let bgUrl = shareBgMeeting;
  const title = event.title || '约时间事件';

  if (title.includes('饭') || title.includes('聚') || title.includes('吃') || title.includes('喝') || title.includes('茶')) {
    bgUrl = shareBgSocial;
  } else if (title.includes('团建') || title.includes('户外') || title.includes('玩') || title.includes('游') || title.includes('运动')) {
    bgUrl = shareBgOutdoor;
  }

  const creatorName = event.creatorNickName || '你的好友';
  let shareTitle = `【${creatorName}】邀请你参与「${title}」的时间协调，点击填写 👆`;

  if (String(event.status).toUpperCase() === 'CONFIRMED') {
    shareTitle = `【${creatorName}】发起的「${title}」已确认最终时间，快来看看吧！`;
  } else if (String(event.status).toUpperCase() === 'CLOSED') {
    shareTitle = `【${creatorName}】发起的「${title}」已停止收集。`;
  }

  return {
    title: shareTitle,
    path: `/pages/event/detail/index?id=${event.id}`,
    imageUrl: bgUrl
  };
};

export const isEventExpired = (event: any): boolean => {
  if (!event.dateRange?.end) return false;
  const endDate = dayjs(event.dateRange.end).endOf('day');
  return dayjs().isAfter(endDate);
};

export const generateSharePosterText = (event: any): string => {
  const status = String(event.status || '').toUpperCase() === 'CONFIRMED' ? '✅ 已确定时间' : '📅 收集中';
  return `约时间：${event.title}\n${status}\n点击参与 →`;
};
