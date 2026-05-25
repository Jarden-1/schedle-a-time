import Taro, { useLoad } from '@tarojs/taro';
import { View, Text, Button, ScrollView, Image } from '@tarojs/components';
import { useState, useMemo, useCallback } from 'react';
import { Event, TimeMode } from '@/types';
import { useAppStore } from '@/store';
import { buildUserProfile, formatDate, generateDateSlots, generateTimeSlots, hasCompleteUserProfile, mapWeeklyUnavailableToEventSlots, parseSlotKey } from '@/utils';
import TimeGridSelector from '@/components/TimeGridSelector';
import Loading from '@/components/Loading';
import LoginCard from '@/components/LoginCard';
import { findParticipantForSelection, getSubmitNickName, isProxyRoute } from './helpers';
import './index.scss';
import guideGif from '@/assets/guide/time-select-guide.gif';

const TEMPLATE_ID = 'WENxWVN5m0myVwQAeA99G9ryFIhFHu5hcQFb1BLaSJU';

export default function SelectTime() {
  const [event, setEvent] = useState<Event | null>(null);
  const [nickname, setNickname] = useState('');
  const [isProxyMode, setIsProxyMode] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const [showGuide, setShowGuide] = useState(false);
  const [fixedUnavailableKeys, setFixedUnavailableKeys] = useState<Set<string>>(new Set());

  const closeGuide = () => {
    setShowGuide(false);
    Taro.setStorageSync('guide_time_grid_seen', true);
  };

  // 强制多选（父级控制子组件进入拖拽模式）
  const [forceDragMode, setForceDragMode] = useState(false);

  const {
    events,
    updateAvailabilityAPI,
    getEventById,
    currentUser,
    userNickName,
    setCurrentUser,
    setUserNickName,
    weeklyUnavailableSlots,
    autoApplyWeeklyUnavailable,
    fetchWeeklyUnavailableAPI
  } = useAppStore();

  const getEventSlotKeys = useCallback((evt: Event) => {
    if (evt.timeMode === TimeMode.DATE_ONLY || (evt.timeMode as any) === 'DATE_ONLY') {
      return generateDateSlots(evt.dateRange.start, evt.dateRange.end);
    }
    return generateTimeSlots(
      evt.dateRange.start,
      evt.dateRange.end,
      evt.timeRange?.start || '09:00',
      evt.timeRange?.end || '18:00',
      evt.granularity
    );
  }, []);

  const applyDefaultSelection = useCallback((evt: Event, weeklySlots: string[]) => {
    const allKeys = getEventSlotKeys(evt);
    const unavailableKeys = evt.timeMode === TimeMode.TIME_SLOT || (evt.timeMode as any) === 'TIME_SLOT'
      ? mapWeeklyUnavailableToEventSlots(allKeys, weeklySlots)
      : new Set<string>();
    setFixedUnavailableKeys(unavailableKeys);
    setSelectedSlots(new Set(allKeys.filter((key) => !unavailableKeys.has(key))));
  }, [getEventSlotKeys]);

  useLoad(async (options) => {
    const { id, nickname: nick } = options as any;
    const proxyMode = isProxyRoute(options);
    setIsProxyMode(!!proxyMode);

    // 先从本地查找，同时异步获取云端最新数据
    const localEvent = events.find((e) => e.id === id);
    let settings = {
      weeklyUnavailableSlots,
      autoApplyWeeklyUnavailable
    };

    if (!proxyMode) {
      const remoteSettings = await fetchWeeklyUnavailableAPI();
      if (remoteSettings) settings = remoteSettings;
    }

    if (localEvent) {
      setEvent(localEvent);
      checkExistingSelection(localEvent, nick, proxyMode, settings);
    }

    // 获取云端最新数据
    const cloudEvent = await getEventById(id);
    if (cloudEvent) {
      setEvent(cloudEvent);
      // 🚨 移除了 if (!localEvent) 的限制，确保每次拿到云端最新数据都强制触发回显！
      checkExistingSelection(cloudEvent, nick, proxyMode, settings);
    }

    const currentEvt = cloudEvent || localEvent;
    if (currentEvt && currentEvt.timeMode === TimeMode.TIME_SLOT) {
      if (!Taro.getStorageSync('guide_time_grid_seen')) {
        setShowGuide(true);
      }
    }

    setInitialLoading(false);
  });

  // 🚨 修复 1：代填模式下绝对屏蔽 openid 匹配！
  const checkExistingSelection = (
    evt: Event,
    nick?: string,
    proxyMode?: boolean,
    settings?: { weeklyUnavailableSlots: string[]; autoApplyWeeklyUnavailable: boolean }
  ) => {
    let target = null;
    const decodedNick = nick ? decodeURIComponent(nick).trim() : '';

    // 非代填模式，才允许使用 openid 匹配真实用户
    if (!proxyMode && currentUser?.openid) {
      target = evt.participants.find((p) => p.openid === currentUser.openid);
    }

    // 如果没找到，或者是代填模式，严格使用昵称匹配
    if (!target && decodedNick) {
      target = evt.participants.find((p) => p.nickName === decodedNick);
    }

    const allKeys = getEventSlotKeys(evt);
    const unavailableKeys = evt.timeMode === TimeMode.TIME_SLOT || (evt.timeMode as any) === 'TIME_SLOT'
      ? mapWeeklyUnavailableToEventSlots(allKeys, settings?.weeklyUnavailableSlots || [])
      : new Set<string>();
    setFixedUnavailableKeys(unavailableKeys);

    if (target && Array.isArray(target.availableSlots) && target.availableSlots.length > 0) {
      setSelectedSlots(new Set(target.availableSlots));
      setNickname(target.nickName);
    } else {
      setNickname(target?.nickName || decodedNick);
      if (!proxyMode && settings?.autoApplyWeeklyUnavailable) {
        applyDefaultSelection(evt, settings.weeklyUnavailableSlots);
      }
    }
  };

  const timeSlots = useMemo(() => {
    if (!event) return [];
    if (event.timeMode === 'date_only') {
      const slots: string[] = [];
      const start = new Date(event.dateRange.start);
      const end = new Date(event.dateRange.end);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        slots.push(d.toISOString().split('T')[0]);
      }
      return slots;
    }

    return generateTimeSlots(
      event.dateRange.start,
      event.dateRange.end,
      event.timeRange?.start || '09:00',
      event.timeRange?.end || '18:00',
      event.granularity
    );
  }, [event]);

  const dateLabels = useMemo((): string[] => {
    if (!event) return [];
    const dates: string[] = [];
    const start = new Date(event.dateRange.start);
    const end = new Date(event.dateRange.end);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }, [event]);

  const rowLabels = useMemo((): string[] => {
    if (!event) return [];
    if (event.timeMode !== TimeMode.TIME_SLOT) return [];

    // 从 timeSlots 中提取 startTime 列表（保证与现有 slotKey 格式完全一致）
    const set = new Set<string>();
    timeSlots.forEach((k) => {
      try {
        const { startTime } = parseSlotKey(k);
        set.add(startTime);
      } catch {
        // ignore
      }
    });
    return Array.from(set).sort();
  }, [event, timeSlots]);

  const toggleSlot = useCallback((slot: string) => {
    setSelectedSlots((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(slot)) {
        newSet.delete(slot);
      } else {
        newSet.add(slot);
      }
      return newSet;
    });
  }, []);

  const handleClear = useCallback(() => {
    setSelectedSlots(new Set());
  }, []);

  const handleInvert = useCallback(() => {
    const newSet = new Set(timeSlots.filter((s) => !selectedSlots.has(s)));
    setSelectedSlots(newSet);
  }, [selectedSlots, timeSlots]);

  const handleApplyWeeklyUnavailable = useCallback(async () => {
    if (!event) return;
    const settings = await fetchWeeklyUnavailableAPI();
    applyDefaultSelection(event, settings?.weeklyUnavailableSlots || weeklyUnavailableSlots);
    Taro.showToast({ title: '已套用常规不可用时段', icon: 'none' });
  }, [applyDefaultSelection, event, fetchWeeklyUnavailableAPI, weeklyUnavailableSlots]);

  // 🚨 修复 2 & 3：强化最终身份兜底 + 引入 1.5 秒安全订阅机制
  const handleSubmit = async () => {
    if (!event) return;

    const finalNickname = getSubmitNickName({ isProxyMode, nickname, currentUser });

    if (!finalNickname) {
      Taro.showToast({ title: isProxyMode ? '请填写代填昵称' : '请先完成登录资料', icon: 'none' });
      return;
    }

    if (selectedSlots.size === 0) {
      Taro.showToast({ title: '请至少选择一个时间', icon: 'none' });
      return;
    }

    // 🚨 安全订阅逻辑：使用 Promise.race 加上 1.5 秒超时保护！
    // 即使微信 PC 模拟器在这里发生死锁，1.5 秒后也会自动 catch 并继续执行后续提交流程，绝不卡死！
    try {
      await Promise.race([
        Taro.requestSubscribeMessage({ tmplIds: [TEMPLATE_ID] } as any),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Subscription timeout')), 1500))
      ]);
    } catch (err) {
      console.log('用户拒绝订阅、环境不支持或请求超时', err);
    }

    const existingParticipant = findParticipantForSelection(event, {
      isProxyMode,
      nickname: finalNickname,
      currentUser
    });
    const isUpdate = !!(
      existingParticipant &&
      existingParticipant.availableSlots &&
      existingParticipant.availableSlots.length > 0
    );

    setSaving(true);
    Taro.showLoading({ title: isUpdate ? '更新中...' : '提交中...' });

    try {
      const success = await updateAvailabilityAPI(event.id, finalNickname, Array.from(selectedSlots), isProxyMode);
      Taro.hideLoading();

      if (success) {
        Taro.showToast({
          title: isUpdate ? '修改成功' : '提交成功',
          icon: 'success',
          duration: 1500
        });
        setTimeout(() => {
          const pages = Taro.getCurrentPages();
          const prevPage = pages.length > 1 ? pages[pages.length - 2] : null;

          // 如果上一页是事件详情页，直接正常返回即可（避免路由栈冗余）
          if (prevPage && prevPage.route && prevPage.route.includes('pages/event/detail/index')) {
            Taro.navigateBack();
          } else {
            // 如果是从创建页过来的（原路由已被销毁），强制跳转到详情页
            Taro.redirectTo({ url: `/pages/event/detail/index?id=${event.id}` });
          }
        }, 1500);
      } else {
        Taro.showToast({ title: '提交失败，请重试', icon: 'none' });
      }
    } catch (error) {
      Taro.hideLoading();
      Taro.showToast({ title: '提交失败，请重试', icon: 'none' });
    } finally {
      setSaving(false);
    }
  };

  if (initialLoading) {
    return (
      <View className="select-page">
        <Loading fullScreen text="加载中..." />
      </View>
    );
  }

  if (!event) {
    return (
      <View className="select-page">
        <View className="error-state">
          <Text className="error-text">事件加载失败</Text>
          <Button className="retry-btn" onClick={() => Taro.navigateBack()}>
            返回
          </Button>
        </View>
      </View>
    );
  }

  if (!isProxyMode && !hasCompleteUserProfile(currentUser)) {
    return (
      <View className="select-page">
        <View className="select-login-card">
          <LoginCard
            title="请先登录后选择时间"
            submitText="登录并继续选择"
            initialNickName={nickname || userNickName || ''}
            initialAvatarUrl={currentUser?.avatarUrl || ''}
            onCancel={() => Taro.redirectTo({ url: `/pages/event/detail/index?id=${event.id}` })}
            onSuccess={(user) => {
              setCurrentUser(buildUserProfile(user.openid || user.id, user.nickName || '', user.avatarUrl || user.avatarFileId || ''));
              setUserNickName(user.nickName || '');
              setNickname(user.nickName || '');
              Taro.showToast({ title: '登录成功，可以选择时间了', icon: 'success' });
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View className="select-page">
      <View className="header">
        <Text className="title">选择您的空闲时间</Text>
        <View className="subtitle">
          <Text className="event-title-highlight">{event.title}</Text>
          <View className={`action-hint ${forceDragMode ? 'action-hint--active' : ''}`}>
            {event.timeMode === TimeMode.TIME_SLOT
              ? (forceDragMode ? '✨ 页面已锁定。如需上下翻页，请先关闭连选' : '💡 点击单选，长按或开启底部「连选」可滑动拖拽')
              : '💡 点击方格选择您的空闲日期'}
          </View>
        </View>
      </View>

      <View className="top-operation-panel">
        <View className="top-operation-row">
          <View className="legend">
            <View className="legend-item">
              <View className="legend-box legend-box--empty" />
              <Text className="legend-text">可选</Text>
            </View>
            <View className="legend-item">
              <View className="legend-box legend-box--selected" />
              <Text className="legend-text">已选</Text>
            </View>
            {fixedUnavailableKeys.size > 0 ? (
              <View className="legend-item">
                <View className="legend-box legend-box--busy" />
                <Text className="legend-text">预设不可用</Text>
              </View>
            ) : null}
          </View>
          <Text className="selection-count">已选 {selectedSlots.size}</Text>
        </View>

        <View className="pill-buttons">
          <View className="pill-btn pill-btn--primary" onClick={handleApplyWeeklyUnavailable}>
            套用预设
          </View>
          <View className="pill-btn" onClick={handleClear}>
            清空
          </View>
          <View className="pill-btn" onClick={handleInvert}>
            反选
          </View>
          <View
            className={`pill-btn ${forceDragMode ? 'pill-btn--active' : ''}`}
            onClick={() => {
              try { Taro.vibrateShort(); } catch { /* ignore */ }
              setForceDragMode((v) => !v);
            }}
          >
            {forceDragMode ? '关闭连选' : '开启连选'}
          </View>
        </View>

        {fixedUnavailableKeys.size > 0 ? (
          <Text className="weekly-hint">已识别 {fixedUnavailableKeys.size} 个常规不可用时段，可手动改回。</Text>
        ) : autoApplyWeeklyUnavailable ? (
          <Text className="weekly-hint">未命中常规不可用时段，可在“我的”里维护每周时间表。</Text>
        ) : null}
      </View>

      {event.timeMode === TimeMode.TIME_SLOT ? (
        <View className="time-grid-container time-grid-container--matrix">
          <TimeGridSelector
            slotKeys={timeSlots}
            selected={selectedSlots}
            onChange={(next) => setSelectedSlots(next)}
            rowLabels={rowLabels}
            dateLabels={dateLabels}
            forceDragMode={forceDragMode}
            hintedKeys={fixedUnavailableKeys}
          />
        </View>
      ) : (
        <ScrollView className="time-grid-container" scrollY scrollWithAnimation>
          <View className="date-section" style={{ marginTop: '10px' }}>
            <View className="slots-grid">
              {timeSlots.map((slot) => (
                <View
                  key={slot}
                  className={`slot-item ${selectedSlots.has(slot) ? 'selected' : ''} ${fixedUnavailableKeys.has(slot) ? 'fixed-busy' : ''}`}
                  onClick={() => toggleSlot(slot)}
                >
                  <Text className="slot-text">{formatDate(slot)}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      <View className="footer">
        <View className="action-buttons">
          <Button className="btn-secondary" onClick={() => Taro.navigateBack()} disabled={saving}>
            取消
          </Button>
          <Button
            className="btn-primary"
            onClick={handleSubmit}
            loading={saving}
            disabled={saving || selectedSlots.size === 0}
          >
            确认提交
          </Button>
        </View>
      </View>

      {/* 新手引导弹窗 */}
      {showGuide && (
        <View className="guide-modal-overlay">
          <View className="guide-modal-content">
            <View className="guide-title">操作提示</View>
            <Image src={guideGif} className="guide-gif" mode="aspectFit" />
            <Text className="guide-desc">点击方格单选，长按并拖拽可快速连选哦～</Text>
            <Button className="btn-primary" style={{ width: '100%', marginTop: '10px' }} onClick={closeGuide}>
              我知道了，去选时间
            </Button>
          </View>
        </View>
      )}
    </View>
  );
}
