import Taro, { usePullDownRefresh, useDidShow } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { useState, useEffect } from 'react';
import { Event, EventStatus, ParticipantAvailability } from '@/types';
import { useAppStore } from '@/store';
import { formatDate } from '@/utils';
import SwipeAction from '@/components/SwipeAction';
import './index.scss';
import { usePageView } from '@/hooks/usePageView';
import { track } from '@/services/telemetry';
import { TRACK } from '@/constants/app';

type TabKey = 'all' | 'created' | 'joined';

type SwipeActionType = 'none' | 'creator' | 'admin' | 'participant';

type SwipeState = {
  openEventId: string;
  x: number;
};

const ACTION_ITEM_WIDTH = 84;

export default function Index() {
  usePageView('index');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [loaded, setLoaded] = useState(false);
  const [localEvents, setLocalEvents] = useState<Event[]>([]);
  const {
    events,
    fetchEvents,
    userNickName,
    setUserNickName,
    currentUser,
    setTabIndex,
    updateEventAPI,
    deleteEventAPI,
    leaveEventAPI,
    fetchLatestAnnouncementAPI
  } = useAppStore();

  useEffect(() => {
    setLoaded(true);

    const storedNickName = Taro.getStorageSync('userNickName');
    if (storedNickName) {
      setUserNickName(storedNickName);
    }

    fetchEvents()
      .catch((err) => console.error('获取事件失败', err));
  }, []);

  useDidShow(() => {
    setTabIndex(0);

    const nextTab = Taro.getStorageSync('indexActiveTab') as TabKey | '';
    if (nextTab) {
      setActiveTab(nextTab);
      Taro.removeStorageSync('indexActiveTab');
    }
    fetchEvents().catch((err) => console.error('首页 useDidShow 刷新失败', err));
    fetchLatestAnnouncementAPI().catch((err) => console.error('首页公告状态刷新失败', err));
  });

  useEffect(() => {
    setLocalEvents(events);
  }, [events]);

  usePullDownRefresh(() => {
    fetchEvents().then(() => {
      Taro.stopPullDownRefresh();
      Taro.showToast({ title: '刷新成功', icon: 'success', duration: 1000 });
    });
  });

  const filteredEvents = localEvents.filter((event) => {
    if (!event) return false;

    const openid = currentUser?.openid;
    let isCreator = false;
    if (openid && event.creatorId) {
      isCreator = event.creatorId === openid;
    } else if (userNickName && event.creatorNickName) {
      isCreator = event.creatorNickName === userNickName;
    }

    const isAdmin = !!(openid && Array.isArray(event.adminIds) && event.adminIds.includes(openid));

    const hasSubmitted = (p: any) => (
      p?.hasSubmitted === true || (Array.isArray(p?.availableSlots) && p.availableSlots.length > 0)
    );

    // 🚨 有 openid 时只认 openid，避免同名用户互相串数据
    const isParticipant = !!event.participants?.some((p) => {
      const isMe = openid ? p?.openid === openid : (!!userNickName && p?.nickName === userNickName);
      return isMe && hasSubmitted(p);
    });

    if (activeTab === 'all') return isCreator || isAdmin || isParticipant;
    if (activeTab === 'created') return isCreator;
    if (activeTab === 'joined') return (isAdmin || isParticipant) && !isCreator;

    return false;
  });

  const [swipe, setSwipe] = useState<SwipeState>({ openEventId: '', x: 0 });
  const [peekIndex, setPeekIndex] = useState<number>(-1);

  useEffect(() => {
    if (loaded && filteredEvents.length > 0) {
      if (!Taro.getStorageSync('guide_swipe_seen')) {
        // 延迟 600ms 等待页面完全渲染稳定后再触发动效
        const timer = setTimeout(() => {
          setPeekIndex(0); // 锁定第一个卡片
          Taro.setStorageSync('guide_swipe_seen', true);

          // 动画持续时间结束后，清除状态
          setTimeout(() => {
            setPeekIndex(-1);
          }, 2000);
        }, 600);
        return () => clearTimeout(timer);
      }
    }
  }, [loaded, filteredEvents.length]);

  const closeSwipe = () => setSwipe({ openEventId: '', x: 0 });

  const handleCreate = () => {
    Taro.navigateTo({ url: '/pages/create/index' });
  };

  const handleEventClick = (eventId: string) => {
    const target = localEvents.find((item) => item.id === eventId);
    track(TRACK.EVENT_OPEN, {
      participantCount: target?.participants?.length ?? 0,
      submittedCount: typeof target?.submittedCount === 'number' ? target.submittedCount : 0
    });
    Taro.navigateTo({ url: `/pages/event/detail/index?id=${eventId}` });
  };
  // 🚨 修复 1：强制大写匹配，防止拿不到文字
  const getStatusText = (status: any) => {
    const s = String(status).toUpperCase();
    switch (s) {
      case 'ACTIVE': return '进行中';
      case 'CONFIRMED': return '已确认';
      case 'CLOSED': return '已停止';
      default: return '';
    }
  };

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'created', label: '我发起的' },
    { key: 'joined', label: '我参与的' }
  ];

  const getSwipeType = (event: Event): SwipeActionType => {
    const openid = currentUser?.openid;
    let isCreator = false;
    if (openid && event.creatorId) {
      isCreator = event.creatorId === openid;
    } else if (userNickName && event.creatorNickName) {
      isCreator = event.creatorNickName === userNickName;
    }

    if (isCreator) return 'creator';

    const isAdmin = !!(openid && Array.isArray(event.adminIds) && event.adminIds.includes(openid));
    if (isAdmin) return 'admin';

    const isParticipant = !!event.participants?.some((p) => {
      const matchOpenid = !!openid && p.openid === openid;
      const matchNick = !!userNickName && p.nickName === userNickName;
      return matchOpenid || matchNick;
    });
    return isParticipant ? 'participant' : 'none';
  };

  const closeEvent = async (eventId: string) => {
    closeSwipe();
    setLocalEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, status: EventStatus.CLOSED } : e)));
    const success = await updateEventAPI(eventId, { status: EventStatus.CLOSED });
    if (success) {
      Taro.showToast({ title: '已停止收集', icon: 'success' });
    } else {
      await fetchEvents();
      Taro.showToast({ title: '停止收集失败', icon: 'none' });
    }
  };

  const resumeEvent = async (eventId: string) => {
    closeSwipe();
    setLocalEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, status: EventStatus.ACTIVE } : e)));
    const success = await updateEventAPI(eventId, { status: EventStatus.ACTIVE });
    if (success) {
      Taro.showToast({ title: '已恢复收集', icon: 'success' });
    } else {
      await fetchEvents();
      Taro.showToast({ title: '恢复收集失败', icon: 'none' });
    }
  };

  const deleteEvent = async (eventId: string) => {
    closeSwipe();
    setLocalEvents((prev) => prev.filter((e) => e.id !== eventId));
    const success = await deleteEventAPI(eventId);
    if (success) {
      Taro.showToast({ title: '已删除', icon: 'success' });
    } else {
      await fetchEvents();
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  };

  const quitEvent = async (eventId: string) => {
    closeSwipe();
    if (!userNickName) {
      Taro.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    // 先在本地移除，失败再回滚
    setLocalEvents((prev) => prev.filter((e) => e.id !== eventId));

    // 🚨 退出是自己的操作，走专属接口，不再借用「管理员移除成员」的 KICK_MEMBER
    const success = await leaveEventAPI(eventId);
    if (success) {
      Taro.showToast({ title: '已退出', icon: 'success' });
    } else {
      await fetchEvents();
      Taro.showToast({ title: '退出失败，请重试', icon: 'none' });
    }
  };

  // 🚨 修复 2：防止停止/继续逻辑判定失败
  const handleStopOrResumeCollect = (event: Event) => {
    if (String(event.status).toUpperCase() === 'CLOSED') {
      resumeEvent(event.id);
      return;
    }
    closeEvent(event.id);
  };

  const handleDeleteEvent = (eventId: string) => {
    closeSwipe();
    Taro.showModal({
      title: '确认删除',
      content: '删除后不可恢复，是否继续？',
      confirmText: '删除',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) deleteEvent(eventId);
      }
    });
  };

  const handleQuitEvent = (eventId: string) => {
    closeSwipe();
    Taro.showModal({
      title: '确认退出',
      content: '这将从你的列表中移除该事件，是否继续？',
      confirmText: '退出',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) quitEvent(eventId);
      }
    });
  };

  return (
    <View className='index-page'>
      <View className='hero-section'>
        <View className='hero-content'>
          <Text className='hero-title'>约时间工具</Text>
          <Text className='hero-subtitle'>把"大家什么时候有空？"变成一键决策</Text>
          <Button className='create-btn create-btn--hint' onClick={handleCreate}>
            + 发起约时间
          </Button>
        </View>
      </View>

      <View className='tab-section'>
        <View className='tab-list'>
          {tabs.map((tab) => (
            <View
              key={tab.key}
              className={`tab-item ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => {
                closeSwipe();
                setActiveTab(tab.key);
              }}
            >
              <Text className='tab-text'>{tab.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View className='event-list'>
        {!loaded ? (
          <View className='loading-text'>加载中...</View>
        ) : filteredEvents.length === 0 ? (
          <View className='empty-state'>
            <Text className='empty-icon'>📅</Text>
            <Text className='empty-title'>{activeTab === 'all' ? '暂无事件' : '暂无相关事件'}</Text>
            <Text className='empty-desc'>{activeTab === 'all' ? '发起一个约时间事件吧' : '切换其他标签看看'}</Text>
          </View>
        ) : (
          filteredEvents.map((event, index) => {
            const swipeType = getSwipeType(event);
            const isOpen = swipe.openEventId === event.id;

            // 🚨 新增：提取安全的防御性状态变量
            const normalizedStatusUpper = String(event.status).toUpperCase();
            const normalizedStatusLower = String(event.status).toLowerCase();

            const openid = currentUser?.openid;
            let isCreator = false;
            if (openid && event.creatorId) {
              isCreator = event.creatorId === openid;
            } else if (userNickName && event.creatorNickName) {
              isCreator = event.creatorNickName === userNickName;
            }
            const isAdmin = !!(openid && Array.isArray(event.adminIds) && event.adminIds.includes(openid));

            // 优先用服务端下发的已填写人数（决策不公开时他人时段会被裁剪）
            const submittedCount = typeof event.submittedCount === 'number'
              ? event.submittedCount
              : event.participants?.filter((p) => p.hasSubmitted === true || (Array.isArray(p.availableSlots) && p.availableSlots.length > 0)).length || 0;

            const card = (
              <View className={`event-card ${peekIndex === index && swipeType !== 'none' ? 'peek-bounce' : ''}`}>
                {/* 🚨 这里加入了 .card-inner 安全舱 */}
                <View className='card-inner'>
                  <View className='event-header'>
                    <View className='title-wrapper'>
                      <Text className='event-title'>{event.title || '未命名事件'}</Text>
                      {isCreator && <Text className='role-tag creator-tag'>👑 发起</Text>}
                      {!isCreator && isAdmin && <Text className='role-tag admin-tag'>⭐ 管理</Text>}
                    </View>
                    {/* 🚨 修复 3：强制转小写，确保完美匹配 index.scss 中的 .confirmed / .closed */}
                    <View className={`status-tag ${normalizedStatusLower}`}>
                      <Text className='tag-text'>{getStatusText(event.status)}</Text>
                    </View>
                  </View>

                  <View className='event-info'>
                    <Text className='info-item'>
                      📅{' '}
                      {event.dateRange
                        ? `${formatDate(event.dateRange.start)} - ${formatDate(event.dateRange.end)}`
                        : '未设置日期'}
                    </Text>
                    <Text className='info-item'>👤 发起人：{event.creatorNickName || '匿名'}</Text>
                    <Text className='info-item'>✍️ {submittedCount} 人已填写</Text>
                  </View>
                </View>
              </View>
            );

            if (swipeType === 'none') {
              return (
                <View
                  className='event-item-wrapper'
                  key={event.id || Math.random()}
                  onClick={() => handleEventClick(event.id)}
                >
                  {card}
                </View>
              );
            }

            // 🚨 修复 4：精准的左滑菜单分流逻辑
            let actions: any[] = [];
            if (swipeType === 'creator' || swipeType === 'admin') {
              if (normalizedStatusUpper === 'CONFIRMED') {
                // 已确认状态，仅保留删除，绝对不能出现收集按钮
                actions = [
                  { text: '删除', type: 'danger' as const, onClick: () => handleDeleteEvent(event.id) }
                ];
              } else {
                // ACTIVE 或 CLOSED 状态，保留收集切换
                actions = [
                  {
                    text: normalizedStatusUpper === 'CLOSED' ? '继续收集' : '停止收集',
                    type: 'warn' as const,
                    onClick: () => handleStopOrResumeCollect(event)
                  },
                  { text: '删除', type: 'danger' as const, onClick: () => handleDeleteEvent(event.id) }
                ];
              }
            } else {
              actions = [{ text: '退出', type: 'danger' as const, onClick: () => handleQuitEvent(event.id) }];
            }

            const actionWidth = actions.length * ACTION_ITEM_WIDTH;

            return (
              <View
                className='event-item-wrapper'
                key={event.id || Math.random()}
                onClick={() => {
                  if (isOpen) {
                    closeSwipe();
                  } else {
                    closeSwipe();
                    handleEventClick(event.id);
                  }
                }}
              >
                <SwipeAction
                  open={isOpen}
                  x={isOpen ? -actionWidth : 0}
                  actionWidth={actionWidth}
                  actions={actions}
                  onTouchStart={() => {
                    if (swipe.openEventId && swipe.openEventId !== event.id) {
                      closeSwipe();
                    }
                  }}
                  onOpenChange={(next) => {
                    if (!next.open) {
                      closeSwipe();
                      return;
                    }
                    setSwipe({ openEventId: event.id, x: next.x });
                  }}
                >
                  {card}
                </SwipeAction>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}
