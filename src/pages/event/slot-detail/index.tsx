import Taro, { useLoad } from '@tarojs/taro';
import { View, Text, ScrollView, Button, Image } from '@tarojs/components';
import { useState, useMemo } from 'react';
import { Event } from '@/types';
import { useAppStore } from '@/store';
import { formatDate, getParticipantDisplayName, parseSlotKey } from '@/utils';
import Loading from '@/components/Loading';
import './index.scss';

export default function SlotDetail() {
  const [event, setEvent] = useState<Event | null>(null);
  const [slotKey, setSlotKey] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [expandedUnavailable, setExpandedUnavailable] = useState<Set<string>>(new Set());
  const { events, getEventById, confirmTimeAPI, currentUser } = useAppStore();

  // 在组件顶层定义
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const displayTimeSlots = useMemo(() => {
    if (!slotKey || !event) return [];
    const keys = slotKey.split(',').sort();

    if (event.timeMode === 'date_only' || (event.timeMode as any) === 'DATE_ONLY') {
      return keys.map(dateStr => {
        const d = new Date(dateStr);
        return `${formatDate(dateStr, 'MM月DD日')}(${weekNames[d.getDay()]})`;
      });
    }

    const parsed = keys.map(k => parseSlotKey(k));
    const byDate: Record<string, typeof parsed> = {};
    parsed.forEach(p => {
      if (!byDate[p.date]) byDate[p.date] = [];
      byDate[p.date].push(p);
    });

    const result: string[] = [];
    Object.keys(byDate).sort().forEach(date => {
      const slots = byDate[date].sort((a, b) => a.startTime.localeCompare(b.startTime));
      const d = new Date(date);
      const dateStr = `${formatDate(date, 'MM月DD日')}(${weekNames[d.getDay()]})`;

      if (slots.length === 0) return;
      let currentStart = slots[0].startTime;
      let currentEnd = slots[0].endTime;

      for (let i = 1; i < slots.length; i++) {
        if (slots[i].startTime === currentEnd) {
          currentEnd = slots[i].endTime; // 连续，合并结束时间
        } else {
          result.push(`${dateStr} ${currentStart}-${currentEnd}`); // 不连续，切断
          currentStart = slots[i].startTime;
          currentEnd = slots[i].endTime;
        }
      }
      result.push(`${dateStr} ${currentStart}-${currentEnd}`);
    });

    return result;
  }, [slotKey, event]);

  const hasAdminAuth = useMemo(() => {
    if (!event) return false;
    const openid = currentUser?.openid;
    if (!openid) return false;
    return openid === event.creatorId || (event.adminIds?.includes(openid) ?? false);
  }, [currentUser?.openid, event]);

  const isCrossDay = useMemo(() => {
    if (!slotKey || !event) return false;
    if (event.timeMode === 'date_only' || (event.timeMode as any) === 'DATE_ONLY') return false;
    try {
      const keys = slotKey.split(',').sort();
      const uniqueDates = new Set(keys.map(k => parseSlotKey(k).date));
      return uniqueDates.size > 1;
    } catch {
      return false;
    }
  }, [slotKey, event]);

  const handleConfirm = async () => {
    if (!event || !slotKey || confirming) return;

    const { confirm } = await Taro.showModal({
      title: '确认该时间？',
      content: '确认后事件将锁定，参与者将无法继续修改时间。',
      confirmColor: '#07c160'
    });

    if (!confirm) return;

    setConfirming(true);
    Taro.showLoading({ title: '确认中...' });

    try {
      const keys = slotKey.split(',').sort();

      const payload = keys.map(key => {
        const { date, startTime, endTime } = parseSlotKey(key);
        return { date, startTime, endTime: endTime || '' };
      });

      const success = await confirmTimeAPI(event.id, payload);

      Taro.hideLoading();

      if (success) {
        Taro.showToast({ title: '已确认！', icon: 'success', duration: 1500 });
        setTimeout(() => {
          Taro.redirectTo({ url: `/pages/event/detail/index?id=${event.id}` });
        }, 1500);
      } else {
        Taro.showToast({ title: '确认失败，请重试', icon: 'none' });
      }
    } catch (error) {
      Taro.hideLoading();
      Taro.showToast({ title: '确认失败，请重试', icon: 'none' });
    } finally {
      setConfirming(false);
    }
  };

  useLoad(async (options) => {
    const { id, slot } = options;
    const cloudEvent = await getEventById(id);
    if (cloudEvent) {
      setEvent(cloudEvent);
    } else {
      const localEvent = events.find(e => e.id === id);
      if (localEvent) setEvent(localEvent);
    }
    if (slot) {
      setSlotKey(decodeURIComponent(slot));
    }
    setInitialLoading(false);
  });

  const availability = useMemo(() => {
    if (!event || !slotKey) return { available: [], unavailable: [] };
    const available: any[] = [];
    const unavailable: any[] = [];
    const keys = slotKey.split(',').sort(); // 🚨 优雅修复

    const formatMissingRanges = (missingKeys: string[]) => {
      if (event.timeMode === 'date_only' || (event.timeMode as any) === 'DATE_ONLY') {
        return missingKeys.map(k => {
          const d = new Date(k);
          return `${formatDate(k, 'MM/DD')}(${weekNames[d.getDay()]})`;
        });
      }

      const parsed = missingKeys.map(k => parseSlotKey(k)).sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.startTime.localeCompare(b.startTime);
      });
      const byDate: Record<string, typeof parsed> = {};
      parsed.forEach(item => {
        if (!byDate[item.date]) byDate[item.date] = [];
        byDate[item.date].push(item);
      });

      const ranges: string[] = [];
      Object.keys(byDate).sort().forEach(date => {
        const slots = byDate[date];
        const d = new Date(date);
        const dateText = `${formatDate(date, 'MM/DD')}(${weekNames[d.getDay()]})`;
        let start = slots[0]?.startTime;
        let end = slots[0]?.endTime;
        for (let i = 1; i < slots.length; i++) {
          if (slots[i].startTime === end) {
            end = slots[i].endTime;
          } else {
            ranges.push(`${dateText} ${start}-${end}`);
            start = slots[i].startTime;
            end = slots[i].endTime;
          }
        }
        if (start) ranges.push(`${dateText} ${start}-${end}`);
      });
      return ranges;
    };

    event.participants.forEach(p => {
      const availableSlots = Array.isArray(p.availableSlots) ? p.availableSlots : [];
      const missingKeys = keys.filter(k => !availableSlots.includes(k));
      const displayName = getParticipantDisplayName(p);
      const participantKey = p.participantId || p.openid || p.nickName || displayName;
      if (missingKeys.length === 0) {
        available.push({ ...p, displayName, participantKey });
      } else {
        const missingRanges = formatMissingRanges(missingKeys);
        const missingStatus = availableSlots.length === 0
          ? '未填写时间'
          : missingKeys.length === keys.length
            ? '所选时段均没空'
            : `缺席 ${missingKeys.length}/${keys.length} 个时段`;
        const missingSummary = missingRanges.length > 2
          ? `${missingRanges.slice(0, 2).join('，')} 等 ${missingRanges.length} 段`
          : missingRanges.join('，');
        unavailable.push({
          ...p,
          displayName,
          participantKey,
          missingRanges,
          missingSummary,
          missingStatus
        });
      }
    });
    return { available, unavailable };
  }, [event, slotKey]);

  const toggleUnavailableDetail = (key: string) => {
    setExpandedUnavailable(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (initialLoading) {
    return (
      <View className="slot-detail-page">
        <Loading fullScreen text="加载中..." />
      </View>
    );
  }

  if (!event || displayTimeSlots.length === 0) {
    return (
      <View className="slot-detail-page">
        <View className="error-state">
          <Text className="error-text">数据加载失败</Text>
          <Text className="error-tip" onClick={() => Taro.navigateBack()}>点击返回</Text>
        </View>
      </View>
    );
  }

  const { available, unavailable } = availability;
  const total = available.length + unavailable.length;
  const availablePercent = total > 0 ? Math.round((available.length / total) * 100) : 0;

  return (
    <View className="slot-detail-page">
      <View className="slot-header">
        <Text className="event-title">{event.title}</Text>
        <View className="slot-times-container">
          {displayTimeSlots.map((timeStr, idx) => (
            <Text key={idx} className="slot-time-row">{timeStr}</Text>
          ))}
        </View>
        <View className="summary-bar">
          <View className="progress-container">
            <View className="progress-bg">
              <View className="progress-fill" style={{ width: `${availablePercent}%` }} />
            </View>
            <Text className="progress-text">{availablePercent}% 有空 ({available.length}/{total}人)</Text>
          </View>
        </View>
      </View>

      <ScrollView className="detail-content" scrollY scrollWithAnimation>
        <View className="section available-section">
          <View className="section-header">
            <Text className="section-title">✅ 有空 ({available.length}人)</Text>
            <Text className="section-percent">{availablePercent}%</Text>
          </View>
          {available.length > 0 ? (
            <View className="user-grid">
              {available.map((p: any) => (
                <View key={p.participantKey} className="user-card available">
                  {p?.avatarUrl && p.avatarUrl.trim() !== '' ? (
                    <Image className="avatar-img" src={p.avatarUrl} mode="aspectFill" />
                  ) : (
                    <View className="avatar-fallback">👤</View>
                  )}
                  <Text className="name">{p.displayName}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View className="empty-hint"><Text>暂无人有空 😔</Text></View>
          )}
        </View>

        <View className="section unavailable-section">
          <View className="section-header">
            <Text className="section-title">❌ 没空 ({unavailable.length}人)</Text>
            <Text className="section-percent">{100 - availablePercent}%</Text>
          </View>
          {unavailable.length > 0 ? (
            <View className="vertical-user-list">
              {unavailable.map((p: any) => (
                <View
                  key={p.participantKey}
                  className="vertical-user-item"
                  onClick={() => toggleUnavailableDetail(p.participantKey)}
                >
                  <View className="avatar-wrapper">
                    {p?.avatarUrl && p.avatarUrl.trim() !== '' ? (
                      <Image className="avatar-img" src={p.avatarUrl} mode="aspectFill" />
                    ) : (
                      <View className="avatar-fallback">👤</View>
                    )}
                  </View>
                  <View className="info-wrapper">
                    <Text className="user-name">{p.displayName}</Text>
                    <View className="missing-status-row">
                      <Text className="missing-status">{p.missingStatus}</Text>
                      {p.missingRanges.length > 2 ? (
                        <Text className="missing-toggle">
                          {expandedUnavailable.has(p.participantKey) ? '收起' : '展开'}
                        </Text>
                      ) : null}
                    </View>
                    <Text className="missing-reason">
                      {expandedUnavailable.has(p.participantKey) ? p.missingRanges.join('，') : p.missingSummary}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="empty-hint success"><Text>所有人都有空！🎉</Text></View>
          )}
        </View>
        <View className="safe-area-bottom"></View>
      </ScrollView>

      {hasAdminAuth && (
        <View className="fixed-bottom-bar">
          <Button
            className="fixed-confirm-btn"
            onClick={handleConfirm}
            disabled={confirming || isCrossDay}
            loading={confirming}
            style={{ backgroundColor: isCrossDay ? '#ccc' : '#07c160' }}
          >
            {isCrossDay ? '⚠️ 暂不支持跨天确认' : '🎉 就定这个时间！'}
          </Button>
        </View>
      )}
    </View>
  );
}
