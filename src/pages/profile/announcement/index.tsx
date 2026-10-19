import Taro, { useLoad } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { useState } from 'react';
import { Announcement } from '@/types';
import { useAppStore } from '@/store';
import Loading from '@/components/Loading';
import EmptyState from '@/components/EmptyState';
import { formatDate } from '@/utils';
import './index.scss';
import { usePageView } from '@/hooks/usePageView';
import { track, } from '@/services/telemetry';
import { TRACK } from '@/constants/app';

export default function AnnouncementPage() {
  usePageView('announcement');
  const { latestAnnouncement, fetchLatestAnnouncementAPI, markAnnouncementRead } = useAppStore();
  const [announcement, setAnnouncement] = useState<Announcement | null>(latestAnnouncement);
  const [loading, setLoading] = useState(true);

  useLoad(async () => {
    const latest = await fetchLatestAnnouncementAPI();
    const next = latest || latestAnnouncement;
    setAnnouncement(next);
    if (next?.id) markAnnouncementRead(next.id);
    if (next?.id) track(TRACK.ANNOUNCEMENT_READ, { id: next.id });
    setLoading(false);
  });

  if (loading) {
    return (
      <View className="announcement-page">
        <Loading fullScreen text="加载中..." />
      </View>
    );
  }

  if (!announcement) {
    return (
      <View className="announcement-page">
        <EmptyState
          icon="📣"
          title="暂无公告"
          description="有新功能上线时会在这里告诉你。"
          actionText="返回"
          onAction={() => Taro.navigateBack()}
        />
      </View>
    );
  }

  return (
    <View className="announcement-page">
      <View className="announcement-card">
        <Text className="tag">最新公告</Text>
        <Text className="title">{announcement.title}</Text>
        <Text className="date">{formatDate(announcement.publishedAt, 'YYYY年MM月DD日')}</Text>
        <Text className="content">{announcement.content}</Text>
        {announcement.actionPath && announcement.actionText ? (
          <Button className="action-btn" onClick={() => Taro.navigateTo({ url: announcement.actionPath! })}>
            {announcement.actionText}
          </Button>
        ) : null}
      </View>
    </View>
  );
}
