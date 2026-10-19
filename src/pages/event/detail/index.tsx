import Taro, { useLoad, useShareAppMessage, useDidShow } from '@tarojs/taro';
import { View, Text, Button, Image, Picker } from '@tarojs/components';
import { useState, useCallback, useEffect } from 'react';
import { Event, EventStatus } from '@/types';
import { useAppStore } from '@/store';
import { buildUserProfile, formatDate, formatTime, generateShareInfo, hasCompleteUserProfile } from '@/utils';
import Loading from '@/components/Loading';
import EmptyState from '@/components/EmptyState';
import LoginCard from '@/components/LoginCard';
import { getEventStatus, getMergedConfirmedSlots, isEventLocked } from './helpers';
import './index.scss';

export default function EventDetail() {
  const [event, setEvent] = useState<Event | null>(null);
  const [eventId, setEventId] = useState<string>('');
  const [myNickname, setMyNickname] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  // 🚨 新增：内联编辑模式的状态
  const [editingField, setEditingField] = useState<'date' | 'time' | null>(null);
  const [tempDateStart, setTempDateStart] = useState('');
  const [tempDateEnd, setTempDateEnd] = useState('');
  const [tempTimeStart, setTempTimeStart] = useState('');
  const [tempTimeEnd, setTempTimeEnd] = useState('');

  useEffect(() => {
    if (event) {
      setTempDateStart(event.dateRange.start);
      setTempDateEnd(event.dateRange.end);
      if (event.timeRange) {
        setTempTimeStart(event.timeRange.start);
        setTempTimeEnd(event.timeRange.end);
      }
    }
  }, [event]);

  const handleSaveDate = async () => {
    if (!event) return; // 🛡️ 防御 1：确保 DOM 未卸载且 event 存在

    if (tempDateStart > tempDateEnd) {
      Taro.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    const { confirm } = await Taro.showModal({
      title: '高危操作确认',
      content: '修改日期范围可能导致部分已填写的可用时间失效，确定要修改吗？',
      confirmColor: '#ff4d4f'
    });
    if (!confirm) return;

    if (typeof updateEventAPI !== 'function') { // 🛡️ 防御 2：确保 API 成功挂载
      Taro.showToast({ title: '系统错误，API未挂载', icon: 'none' });
      return;
    }

    setActionLoading(true);
    const success = await updateEventAPI(event.id, { dateRange: { start: tempDateStart, end: tempDateEnd } });
    setActionLoading(false);

    if (success) {
      Taro.showToast({ title: '修改成功', icon: 'success' });
      setEditingField(null);
      loadEvent(event.id);
    } else {
      Taro.showToast({ title: '修改失败', icon: 'none' });
    }
  };

  const handleSaveTime = async () => {
    if (!event) return; // 🛡️ 防御 1：确保 event 存在

    if (tempTimeStart >= tempTimeEnd) {
      Taro.showToast({ title: '开始时间必须早于结束时间', icon: 'none' });
      return;
    }
    const { confirm } = await Taro.showModal({
      title: '高危操作确认',
      content: '修改每日时段可能导致原有的精确时间投票失效，确定要修改吗？',
      confirmColor: '#ff4d4f'
    });
    if (!confirm) return;

    if (typeof updateEventAPI !== 'function') { // 🛡️ 防御 2：确保 API 成功挂载
      Taro.showToast({ title: '系统错误，API未挂载', icon: 'none' });
      return;
    }

    setActionLoading(true);
    const success = await updateEventAPI(event.id, { timeRange: { start: tempTimeStart, end: tempTimeEnd } });
    setActionLoading(false);

    if (success) {
      Taro.showToast({ title: '修改成功', icon: 'success' });
      setEditingField(null);
      loadEvent(event.id);
    } else {
      Taro.showToast({ title: '修改失败', icon: 'none' });
    }
  };

  // 从 Store 提取方法
  const {
    events,
    userNickName,
    getEventById,
    updateEventAPI,
    loading: storeLoading,
    eventLoadError,
    currentUser,
    setCurrentUser,
    setUserNickName
  } = useAppStore();

  const loadEvent = useCallback(async (id: string) => {
    setEventId(id);
    setShowLogin(false);
    const cloudEvent = await getEventById(id);
    if (cloudEvent) {
      setEvent(cloudEvent);
      return;
    }

    // 🚨 只有网络类错误才允许回退到本地缓存；404 说明活动已被删除
    const { eventLoadError: loadError, events: cachedEvents } = useAppStore.getState();
    if (loadError?.type === 'not_found' || loadError?.type === 'auth') {
      setEvent(null);
      return;
    }
    const localEvent = cachedEvents.find(e => e.id === id);
    if (localEvent) {
      setEvent(localEvent);
    }
  }, [getEventById]);

  useEffect(() => {
    if (eventLoadError?.type === 'auth') {
      setEvent(null);
      setShowLogin(true);
    }
    if (eventLoadError?.type === 'not_found') {
      setEvent(null);
    }
  }, [eventLoadError]);

  useLoad((options) => {
    const { id } = options;
    if (id) loadEvent(id);
  });

  useDidShow(() => {
    const pages = Taro.getCurrentPages();
    const currentPage = pages[pages.length - 1];
    const id = currentPage.options?.id;
    if (id) loadEvent(id);
  });

  useShareAppMessage(() => {
    return generateShareInfo(event);
  });

  const handleShare = () => {
    Taro.showShareMenu({ withShareTicket: true });
  };

  const handleLoginSuccess = (user: any) => {
    setCurrentUser(buildUserProfile(user.openid || user.id, user.nickName || '', user.avatarUrl || user.avatarFileId || ''));
    setUserNickName(user.nickName || '');
    setMyNickname(user.nickName || '');
    setShowLogin(false);

    if (event) {
      Taro.showToast({ title: '登录成功，正在进入选择页', icon: 'success' });
      setTimeout(() => {
        Taro.navigateTo({
          url: `/pages/event/select/index?id=${event.id}&nickname=${encodeURIComponent(user.nickName || '')}`
        });
      }, 200);
      return;
    }

    Taro.showToast({ title: '登录成功，正在加载活动', icon: 'success' });
    setTimeout(() => loadEvent(eventId), 200);
  };

  const handleSelectTime = async () => {
    if (!event) return;

    if (isEventLocked(event)) {
      Taro.showToast({ title: '该事件已锁定收集，无法修改', icon: 'none' });
      return;
    }

    setActionLoading(true);
    try {
      const current = currentUser;
      if (!current || !hasCompleteUserProfile(current)) {
        setShowLogin(true);
        return;
      }

      const nickname = current.nickName.trim();

      Taro.navigateTo({
        url: `/pages/event/select/index?id=${event.id}&nickname=${encodeURIComponent(nickname)}`
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewDecision = () => {
    if (!event) return;
    Taro.navigateTo({ url: `/pages/event/decision/index?id=${event.id}` });
  };

  const handleGoToParticipants = () => {
    if (!event) return;
    Taro.navigateTo({ url: `/pages/event/participants/index?id=${event.id}` });
  };

  const handleProxyFill = () => {
    if (!event) return;
    Taro.showModal({
      title: '代填空闲时间',
      content: '',
      editable: true,
      placeholderText: '请输入代填成员的昵称',
      success: (res: any) => {
        if (res.confirm && res.content?.trim()) {
          let rawName = res.content.trim();
          // 防止管理员自己手痒加了后缀重复
          if (rawName.endsWith('(代填)')) rawName = rawName.replace(/\(代填\)$/, '').trim();
          const proxyName = `${rawName} (代填)`;
          Taro.navigateTo({
            url: `/pages/event/select/index?id=${event.id}&nickname=${encodeURIComponent(proxyName)}&isProxy=1`
          });
        }
      }
    } as any);
  };

  // 🚨 发起人专属：取消确认功能
  const handleRevokeConfirm = async () => {
    if (!event) return;
    const { confirm } = await Taro.showModal({
      title: '重新选时？',
      content: '将撤销当前的确认时间，重新开放给所有人填写。'
    });
    if (!confirm) return;

    setActionLoading(true);
    Taro.showLoading({ title: '撤销中' });
    try {
      if (typeof updateEventAPI === 'function') {
        await updateEventAPI(event.id, { status: EventStatus.ACTIVE, confirmedSlot: null });
      }
      Taro.showToast({ title: '已撤销', icon: 'success' });
      loadEvent(event.id); // 刷新
    } catch (e) {
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      Taro.hideLoading();
      setActionLoading(false);
    }
  };

  const myOpenid = currentUser?.openid;
  const isCreator = !!(myOpenid && event?.creatorId && event.creatorId === myOpenid);
  const isAdmin = event?.adminIds?.includes(myOpenid || '');
  const canManage = isCreator || isAdmin;
  const isLoggedIn = hasCompleteUserProfile(currentUser);
  const selfNick = (myNickname || userNickName).trim();
  // 🚨 终极修复：增加 OpenID 兜底匹配，防止后端 nickName 丢失导致匹配失败
  const participantHasSubmitted = (p: any) => (
    p?.hasSubmitted === true || (Array.isArray(p?.availableSlots) && p.availableSlots.length > 0)
  );

  const hasSubmitted = !!event?.participants.some(p => {
    const matchOpenid = !!myOpenid && p.openid === myOpenid;
    const matchNick = !!selfNick && p.nickName === selfNick;
    return (matchOpenid || matchNick) && participantHasSubmitted(p);
  });

  // 🚨 优先用服务端下发的已填写人数（决策不公开时他人时段会被裁剪）
  const submittedCount = typeof event?.submittedCount === 'number'
    ? event.submittedCount
    : event?.participants.filter(participantHasSubmitted).length || 0;

  // 🚨 根据 allowInvite 严格控制普通参与者分享权限
  useEffect(() => {
    if (!event) {
      Taro.hideShareMenu();
      return;
    }

    const canShare = isCreator || event.allowInvite;
    if (canShare) {
      Taro.showShareMenu({ withShareTicket: true });
    } else {
      Taro.hideShareMenu();
    }
  }, [event, isCreator]);

  if (storeLoading && !event) {
    return (
      <View className="detail-page">
        <Loading fullScreen text="加载中..." />
      </View>
    );
  }

  if ((showLogin || eventLoadError?.type === 'auth') && !event) {
    return (
      <View className="detail-page">
        <View style={{ padding: '16px' } as any}>
          <LoginCard
            title="请先登录后参与活动"
            submitText="登录并继续"
            initialNickName={userNickName || currentUser?.nickName || ''}
            initialAvatarUrl={currentUser?.avatarUrl || ''}
            onCancel={() => Taro.switchTab({ url: '/pages/index/index' })}
            onSuccess={handleLoginSuccess}
          />
        </View>
      </View>
    );
  }

  if (!eventId) {
    return (
      <View className="detail-page">
        <EmptyState
          icon="🔗"
          title="邀请链接缺少活动信息"
          description="请让发起人重新分享活动链接"
          actionText="返回首页"
          onAction={() => Taro.switchTab({ url: '/pages/index/index' })}
        />
      </View>
    );
  }

  if (!event) {
    const isNetworkError = eventLoadError?.type === 'network' || eventLoadError?.type === 'server' || eventLoadError?.type === 'unknown';
    return (
      <View className="detail-page">
        <EmptyState
          icon={isNetworkError ? '📶' : '😕'}
          title={isNetworkError ? eventLoadError?.message || '活动加载失败' : '活动不存在或已删除'}
          description={isNetworkError ? '请检查网络后重试，或稍后再打开邀请链接' : '请检查链接是否正确，或联系发起人确认活动状态'}
          actionText={isNetworkError ? '重新加载' : '返回首页'}
          onAction={() => {
            if (isNetworkError && eventId) {
              loadEvent(eventId);
            } else {
              Taro.switchTab({ url: '/pages/index/index' });
            }
          }}
        />
      </View>
    );
  }

  const normalizedStatus = getEventStatus(event);
  const isLocked = isEventLocked(event);
  const mergedConfirmedSlots = getMergedConfirmedSlots(event);

  return (
    <View className="detail-page">
      <View className="event-card">
        <View className="event-header">
          <Text className="event-title">{event.title}</Text>
          <View className={`status-badge ${normalizedStatus.toLowerCase()}`}>
            <Text>
              {normalizedStatus === 'ACTIVE' ? '🟢 进行中' : null}
              {normalizedStatus === 'CONFIRMED' ? '🎉 已确认' : null}
              {normalizedStatus === 'CLOSED' ? '⛔ 已关闭' : null}
            </Text>
          </View>
        </View>

        {event.description ? (
          <View className="event-description"><Text>{event.description}</Text></View>
        ) : null}

        <View className="event-info">
          <View className="info-row">
            <Text className="info-label">📅 时间范围</Text>
            {editingField === 'date' ? (
              <View className="edit-inline-container">
                <Picker mode="date" value={tempDateStart} onChange={(e) => setTempDateStart(e.detail.value)}>
                  <Text className="edit-picker-value">{formatDate(tempDateStart, 'MM/DD')}</Text>
                </Picker>
                <Text className="edit-separator">至</Text>
                <Picker mode="date" value={tempDateEnd} start={tempDateStart} onChange={(e) => setTempDateEnd(e.detail.value)}>
                  <Text className="edit-picker-value">{formatDate(tempDateEnd, 'MM/DD')}</Text>
                </Picker>
                <View className="edit-actions">
                  <Text className="edit-btn cancel" onClick={() => setEditingField(null)}>取消</Text>
                  <Text className="edit-btn save" onClick={handleSaveDate}>保存</Text>
                </View>
              </View>
            ) : (
              <View className="value-with-action">
                <Text className="info-value">{formatDate(event.dateRange.start)} - {formatDate(event.dateRange.end)}</Text>
                {canManage && !isLocked ? (
                  <View className="edit-icon-text" onClick={() => setEditingField('date')}>修改</View>
                ) : null}
              </View>
            )}
          </View>
          {event.timeMode === 'time_slot' && event.timeRange ? (
            <View className="info-row">
              <Text className="info-label">🕐 每日时段</Text>
              {editingField === 'time' ? (
                <View className="edit-inline-container">
                  <Picker mode="time" value={tempTimeStart} onChange={(e) => setTempTimeStart(e.detail.value)}>
                    <Text className="edit-picker-value">{tempTimeStart}</Text>
                  </Picker>
                  <Text className="edit-separator">至</Text>
                  <Picker mode="time" value={tempTimeEnd} start={tempTimeStart} onChange={(e) => setTempTimeEnd(e.detail.value)}>
                    <Text className="edit-picker-value">{tempTimeEnd}</Text>
                  </Picker>
                  <View className="edit-actions">
                    <Text className="edit-btn cancel" onClick={() => setEditingField(null)}>取消</Text>
                    <Text className="edit-btn save" onClick={handleSaveTime}>保存</Text>
                  </View>
                </View>
              ) : (
                <View className="value-with-action">
                  <Text className="info-value">{formatTime(event.timeRange.start)} - {formatTime(event.timeRange.end)}</Text>
                  {canManage && !isLocked ? (
                    <View className="edit-icon-text" onClick={() => setEditingField('time')}>修改</View>
                  ) : null}
                </View>
              )}
            </View>
          ) : null}
          <View className="info-row">
            <Text className="info-label">👤 发起人</Text>
            <Text className="info-value">{event.creatorNickName}</Text>
          </View>
          
          {/* 🚨 优化后的参与情况卡片，不再嵌套在 info-row 内部 */}
          <View className="participants-summary" onClick={handleGoToParticipants}>
            <View className="participants-summary-top">
              <View className="participants-summary-left">
                <View className="participants-summary-copy">
                  <Text className="participants-summary-title">成员管理</Text>
                  <Text className="participants-summary-desc">
                    {canManage ? '可修改显示名、设置重点嘉宾' : '查看成员填写情况'}
                  </Text>
                  <View className="participants-summary-meta">
                    <Text className="participants-summary-count">{submittedCount} 人已填写</Text>
                    {canManage ? <Text className="participants-summary-extra">· 可设置重点嘉宾</Text> : null}
                  </View>
                </View>
              </View>
              <Text className="participants-summary-hint">
                {canManage ? '管理 〉' : '查看 〉'}
              </Text>
            </View>
          </View>

        </View>
      </View>

      <View className="my-status-card">
        <Text className="card-title">我的参与</Text>
        {showLogin && !isLoggedIn ? (
          <View className="inline-login-wrap">
            <LoginCard
              title="登录后选择空闲时间"
              submitText="登录并继续选择"
              initialNickName={userNickName || ''}
              initialAvatarUrl={currentUser?.avatarUrl || ''}
              showTips={false}
              onCancel={() => setShowLogin(false)}
              onSuccess={handleLoginSuccess}
            />
          </View>
        ) : isLocked ? (
          <View className="status-content">
            <Text className="status-text">
              {hasSubmitted ? '✅ 已提交 (事件已锁定)' : '该事件已结束收集，无法继续填写'}
            </Text>
          </View>
        ) : hasSubmitted ? (
          <View className="status-content">
            <Text className="status-text success">✅ 已提交空闲时间</Text>
            <Button
              className="btn-outline"
              size="mini"
              onClick={handleSelectTime}
              disabled={actionLoading}
            >
              修改时间
            </Button>
          </View>
        ) : (
          <View className="status-content">
            <Text className="status-text">⏳ 还未填写</Text>
            <Button
              className="btn-primary"
              size="mini"
              onClick={handleSelectTime}
              disabled={actionLoading}
            >
              {isLoggedIn ? '选择空闲时间' : '登录并选择时间'}
            </Button>
          </View>
        )}
      </View>

      {/* 🚨 核心修复：如果是管理员，或者决策面板设置为公开，都可以看到此入口 */}
      {(canManage || event.isDecisionPublic) && normalizedStatus === 'ACTIVE' ? (
        <View className="creator-actions">
          <Text className="card-title">
            {canManage ? (isCreator ? '发起人操作' : '管理员操作') : '实时决策面板'}
          </Text>
          <Button
            className="btn-primary decision-btn"
            onClick={handleViewDecision}
            disabled={actionLoading}
          >
            查看决策面板
          </Button>

          {/* 🚨 邀请按钮依然严格仅限发起人/管理员在此处显示 */}
          {canManage ? (
            <>
              <Button
                className="btn-outline share-btn"
                onClick={handleShare}
                openType="share"
              >
                <Image className="share-icon" src="/icon/share.png" mode="aspectFit" />
                <Text>邀请参与者</Text>
              </Button>
              {/* 🚨 新增代填入口 */}
              <Button
                className="btn-outline share-btn"
                style={{ marginTop: '12px' }}
                onClick={handleProxyFill}
              >
                <Text>✍️ 代填空闲时间</Text>
              </Button>
            </>
          ) : null}
        </View>
      ) : null}

      {normalizedStatus === 'CONFIRMED' ? (
          <View className="confirmed-card">
            <Text className="card-title">🎉 最终确认时间</Text>

            {mergedConfirmedSlots.length > 0 ? (
              <View className="confirmed-time-list">
                {mergedConfirmedSlots.map((slot: any, idx: number) => {
                  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                  const d = new Date(slot.date.replace(/-/g, '/'));
                  const weekStr = weekNames[d.getDay()];

                  return (
                    <View key={idx} className="confirmed-time-row">
                      <Text className="date">{formatDate(slot.date, 'MM/DD')}({weekStr})</Text>
                      {slot.startTime && event.timeMode !== 'date_only' && (
                        <Text className="time">{formatTime(slot.startTime)} - {formatTime(slot.endTime)}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ) : (
              <View className="confirmed-time-empty"><Text>未找到具体时间数据</Text></View>
            )}

            {/* 🚨 无论时间数据长什么样，只要是管理员，永远给你反悔的机会 */}
            {canManage ? (
              <Button
                className="revoke-btn"
                onClick={handleRevokeConfirm}
                disabled={actionLoading}
              >
                撤销确认，重新选时
              </Button>
            ) : null}
          </View>
      ) : null}

      {!canManage && event.allowInvite ? (
        <View className="share-section">
          <Button
            className="btn-outline share-btn"
            onClick={handleShare}
            openType="share"
          >
            <Image className="share-icon" src="/icon/share.png" mode="aspectFit" />
            <Text>分享给朋友</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}
