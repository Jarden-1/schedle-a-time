import Taro, { useLoad } from '@tarojs/taro';
import { View, Text, Button, Picker, ScrollView, Image } from '@tarojs/components';
import { useState, useMemo } from 'react';
import { Event, CandidateSlot, TimeMode } from '@/types';
import { useAppStore } from '@/store';
import { formatDate, formatTime, parseSlotKey, findBestSlidingWindows, findBestDateWindows, generateTimeSlots } from '@/utils';
import TimeGridSelector from '@/components/TimeGridSelector';
import Loading from '@/components/Loading';
import './index.scss';

export default function DecisionPanel() {
  const [event, setEvent] = useState<Event | null>(null);

  // 🚨 替换原本的单选状态
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [forceDragMode, setForceDragMode] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [targetDuration, setTargetDuration] = useState(60);

  const [showDecisionGuide, setShowDecisionGuide] = useState(false);
  const [decisionGuideStep, setDecisionGuideStep] = useState(1);

  const closeDecisionGuide = () => {
    setShowDecisionGuide(false);
    Taro.setStorageSync('guide_decision_seen', true);
  };

  const nextDecisionStep = () => {
    setDecisionGuideStep(2);
  };

  // 在组件顶部增加
  const [targetDays, setTargetDays] = useState(1);
  const dayOptions = [
    { label: '1天', value: 1 }, { label: '2天', value: 2 }, { label: '3天', value: 3 },
    { label: '4天', value: 4 }, { label: '5天', value: 5 }
  ];
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const isDateOnly = event?.timeMode === TimeMode.DATE_ONLY || (event?.timeMode as any) === 'DATE_ONLY';

  const { events, confirmTimeAPI, getEventById, currentUser } = useAppStore();

  const durationOptions = [
    { label: '30分钟', value: 30 },
    { label: '1小时', value: 60 },
    { label: '1.5小时', value: 90 },
    { label: '2小时', value: 120 },
    { label: '3小时', value: 180 },
    { label: '4小时', value: 240 }
  ];

  useLoad(async (options) => {
    const { id } = options;

    // 优先从云端获取最新数据
    const cloudEvent = await getEventById(id);
    if (cloudEvent) {
      setEvent(cloudEvent);
    } else {
      // 回退到本地
      const localEvent = events.find(e => e.id === id);
      if (localEvent) setEvent(localEvent);
    }

    setInitialLoading(false);

    if (!Taro.getStorageSync('guide_decision_seen')) {
      setShowDecisionGuide(true);
    }
  });

  // 🚨 权限判定：判断当前浏览者是否有权确认时间
  const myOpenid = currentUser?.openid;
  const isCreator = !!(myOpenid && event?.creatorId && event.creatorId === myOpenid);
  const isAdmin = !!(myOpenid && event?.adminIds?.includes(myOpenid));
  const canManage = isCreator || isAdmin;

  const candidateSlots = useMemo((): CandidateSlot[] => {
    if (!event || event.participants.length === 0) return [];

    const slotMap = new Map<string, string[]>();
    event.participants.forEach(participant => {
      participant.availableSlots.forEach(slot => {
        if (!slotMap.has(slot)) slotMap.set(slot, []);
        slotMap.get(slot)!.push(participant.nickName);
      });
    });
    
    const allParticipants = event.participants.map(p => p.nickName);
    const candidates: CandidateSlot[] = Array.from(slotMap.entries()).map(([slotKey, availableUsers]) => {
      const { date, startTime, endTime } = parseSlotKey(slotKey);
      const unavailableUsers = allParticipants.filter(name => !availableUsers.includes(name));
      return {
        slot: { date, startTime, endTime },
        availableCount: availableUsers.length,
        totalCount: allParticipants.length,
        availableUsers,
        unavailableUsers,
        matchRate: allParticipants.length > 0 ? availableUsers.length / allParticipants.length : 0
      };
    });
    
    return candidates.sort((a, b) => b.matchRate - a.matchRate || b.availableCount - a.availableCount);
  }, [event]);

  const top5Slots = useMemo(() => candidateSlots.slice(0, 5), [candidateSlots]);

  // 1. 提取去重后的时间行标签和日期列标签 (🚨 生成全局全量网格)
  const { rowLabels, dateLabels, slotKeys } = useMemo(() => {
    if (!event) return { rowLabels: [], dateLabels: [], slotKeys: [] };

    const allKeys: string[] = [];
    if (isDateOnly) {
      const start = new Date(event.dateRange.start);
      const end = new Date(event.dateRange.end);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        allKeys.push(d.toISOString().split('T')[0]);
      }
    } else {
      const slots = generateTimeSlots(
        event.dateRange.start,
        event.dateRange.end,
        event.timeRange?.start || '09:00',
        event.timeRange?.end || '18:00',
        event.granularity
      );
      allKeys.push(...slots);
    }

    const dates = new Set<string>();
    const times = new Set<string>();

    allKeys.forEach(k => {
      try {
        const { date, startTime } = parseSlotKey(k);
        dates.add(date);
        if (startTime) times.add(startTime);
      } catch { /* ignore */ }
    });

    return {
      rowLabels: Array.from(times).sort(),
      dateLabels: Array.from(dates).sort(),
      slotKeys: allKeys
    };
  }, [event, isDateOnly]);

  // 2. 构建热力图字典数据（包含匹配率和具体人数）
  const { heatmapData, heatmapCountData } = useMemo(() => {
    const rateMap: Record<string, number> = {};
    const countMap: Record<string, number> = {};
    candidateSlots.forEach(c => {
      const key = isDateOnly
        ? c.slot.date
        : `${c.slot.date}_${c.slot.startTime}-${c.slot.endTime}`;
      rateMap[key] = c.matchRate;
      countMap[key] = c.availableCount;
    });
    return { heatmapData: rateMap, heatmapCountData: countMap };
  }, [candidateSlots, isDateOnly]);

  // 🚨 核心：计算多个选中时段的综合人员状态（所有选中时段都有空的人，才算有空）
  const aggregatedStats = useMemo(() => {
    if (selectedKeys.size === 0) return null;
    const keysArr = Array.from(selectedKeys).sort();
    const allParticipants = event?.participants.map(p => p.nickName) || [];

    let available = [...allParticipants];
    keysArr.forEach(key => {
      const slotData = candidateSlots.find(c => {
        const k = isDateOnly ? c.slot.date : `${c.slot.date}_${c.slot.startTime}-${c.slot.endTime}`;
        return k === key;
      });
      const usersInThisSlot = slotData ? slotData.availableUsers : [];
      // 核心求交集算法
      available = available.filter(u => usersInThisSlot.includes(u));
    });

    const unavailable = allParticipants.filter(u => !available.includes(u));

    return {
      availableUsers: available,
      unavailableUsers: unavailable,
      count: keysArr.length,
      firstSlotDisplay: keysArr[0]
    };
  }, [selectedKeys, candidateSlots, event]);

  // 🚨 重构：修改 Top 5 列表的点击行为，从 Set单选改为 Set全选推荐包含的格子
  const handleTop5Click = (slotKeys: string[]) => {
    setSelectedKeys(new Set(slotKeys));
  };

  const bestWindows = useMemo(() => {
    if (!event) return [];
    if (isDateOnly) {
      return findBestDateWindows(candidateSlots, targetDays, event.participants || [], event.vipIds || []);
    } else {
      return findBestSlidingWindows(candidateSlots, targetDuration, event.granularity || 30, event.participants || [], event.vipIds || []);
    }
  }, [candidateSlots, targetDuration, targetDays, event, isDateOnly]);

  // 仅日期模式取 Top 3，时段模式取 Top 5
  const topMergedSlots = useMemo(() => bestWindows.slice(0, isDateOnly ? 3 : 5), [bestWindows, isDateOnly]);

  const handleConfirm = async () => {
    if (!event || selectedKeys.size === 0) return;

    // 二次确认
    const firstKey = Array.from(selectedKeys)[0];
    const { date, startTime, endTime } = parseSlotKey(firstKey);
    const { confirm } = await Taro.showModal({
      title: '确认时间',
      content: `确定选择 ${formatDate(date)} ${formatTime(startTime)}-${formatTime(endTime)} 吗？\n\n确认后将通知所有参与者。`,
      confirmColor: '#07c160',
      confirmText: '确认',
      cancelText: '再想想'
    });

    if (!confirm) return;

    setConfirming(true);
    Taro.showLoading({ title: '确认中...' });

    try {
      // 🚨 提取所有选中的时段，传给后端
      const confirmedSlots = Array.from(selectedKeys).map(key => {
        const { date, startTime, endTime } = parseSlotKey(key);
        return { date, startTime, endTime: endTime || '' };
      });

      const success = await confirmTimeAPI(event.id, confirmedSlots);
      Taro.hideLoading();

      if (success) {
        Taro.showToast({ title: '时间已确认', icon: 'success', duration: 1500 });
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

  const handleViewSlotDetail = (slot: CandidateSlot) => {
    const slotKey = `${slot.slot.date}_${slot.slot.startTime}-${slot.slot.endTime}`;
    Taro.navigateTo({
      url: `/pages/event/slot-detail/index?id=${event?.id}&slot=${encodeURIComponent(slotKey)}`
    });
  };

  if (initialLoading) {
    return (
      <View className="decision-page">
        <Loading fullScreen text="加载中..." />
      </View>
    );
  }

  if (!event) {
    return (
      <View className="decision-page">
        <View className="error-state">
          <Text className="error-text">事件加载失败</Text>
          <Button className="retry-btn" onClick={() => Taro.navigateBack()}>返回</Button>
        </View>
      </View>
    );
  }

  return (
    <View className="decision-page">
      <View className="header">
        <Text className="title">决策面板</Text>
        <View className="stats">
          <Text className="stat-item">📊 总参与：{event.participants.length} 人</Text>
          {candidateSlots.length > 0 && (
            <Text className="stat-item">🎯 最佳匹配：{Math.round(top5Slots[0]?.matchRate * 100)}%</Text>
          )}
        </View>
      </View>

      {candidateSlots.length > 0 ? (
        <>
          {/* 时长筛选器 */}
          <View className="duration-filter">
            <Text className="filter-label">{isDateOnly ? '⏱️ 预期活动天数：' : '⏱️ 预期活动时长：'}</Text>
            <Picker mode="selector" range={isDateOnly ? dayOptions : durationOptions} rangeKey="label" onChange={(e: any) => {
              if (isDateOnly) setTargetDays(dayOptions[Number(e.detail.value)].value);
              else setTargetDuration(durationOptions[Number(e.detail.value)].value);
            }}>
              <View className="picker-value">
                {isDateOnly ? dayOptions.find(opt => opt.value === targetDays)?.label : durationOptions.find(opt => opt.value === targetDuration)?.label} <Text className="arrow">▼</Text>
              </View>
            </Picker>
          </View>

          {bestWindows.length > 0 && (
            <View className="top3-section">
              <Text className="section-title">
                {isDateOnly ? '🏆 推荐日期组合 Top 3' : '🏆 推荐时段（已合并连续时间）Top 5'}
              </Text>

              {/* 🚨 新增：提取第一个推荐结果的 downgradeHint，作为全局横幅展示 */}
              {topMergedSlots[0]?.downgradeHint && (
                <View className="global-downgrade-banner">
                  <Text className="warn-text">⚠️ {topMergedSlots[0].downgradeHint}</Text>
                </View>
              )}

              {topMergedSlots.map((slot, index) => {
                // 🚨 核心修复：判断该卡片包含的所有 slotKey 是否都在 selectedKeys 中
                const isSelected = slot.slotKeys.length > 0 && slot.slotKeys.every((k: string) => selectedKeys.has(k));

                return (
                  <View
                    key={`merged-${slot.date}-${slot.startTime}`}
                    className={`top3-card rank-${index + 1} ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleTop5Click(slot.slotKeys)}
                  >
                    <View className="rank-badge">{index + 1}</View>
                    <View className="slot-info">
                      <View className="date-row">
                        <Text className="date">
                          {isDateOnly && slot.startDate !== slot.endDate
                            ? `${formatDate(slot.startDate, 'MM/DD')}(${weekNames[new Date(slot.startDate.replace(/-/g, '/')).getDay()]}) - ${formatDate(slot.endDate, 'MM/DD')}(${weekNames[new Date(slot.endDate.replace(/-/g, '/')).getDay()]})`
                            : `${formatDate(slot.date, 'MM/DD')}(${weekNames[new Date(slot.date.replace(/-/g, '/')).getDay()]})`
                          }
                        </Text>
                        {slot.recommendReason && <Text className="reason-tag">{slot.recommendReason}</Text>}
                      </View>
                      {/* 如果是日期模式，隐藏具体时间 */}
                      {!isDateOnly && <Text className="time">{formatTime(slot.startTime)} - {formatTime(slot.endTime)}</Text>}
                      {slot.slotKeys.length > 1 && (
                        <Text className="merged-hint">{isDateOnly ? `连续 ${slot.slotKeys.length} 天` : `连续 ${slot.slotKeys.length} 个时段`}</Text>
                      )}
                      {/* 🚨 务必删除这里原本存在的 slot.downgradeHint 渲染代码 */}
                    </View>
                    <View className="match-rate">
                      <Text className="rate-text">{Math.round(slot.matchRate * 100)}%</Text>
                      <Text className="count-text">{slot.availableCount}/{slot.totalCount} 人</Text>
                    </View>

                    {/* 🚨 新增：右上角选中角标 */}
                    {isSelected && <View className="selected-icon">✓</View>}
                  </View>
                );
              })}
            </View>
          )}

          {event.timeMode === TimeMode.TIME_SLOT && slotKeys.length > 0 && (
            <View className="heatmap-section">
              <View className="heatmap-header">
                <View className="header-top-row">
                  <Text className="section-title">🟩 全局热力图分布</Text>
                  <View className="pill-buttons">
                    <View className="pill-btn" onClick={() => setSelectedKeys(new Set())}>清空</View>
                    <View className={`pill-btn ${forceDragMode ? 'pill-btn--active' : ''}`} onClick={() => {
                      try { Taro.vibrateShort(); } catch { }
                      setForceDragMode(v => !v);
                    }}>
                      {forceDragMode ? '关闭连选' : '开启连选'}
                    </View>
                  </View>
                </View>
                <View className="heatmap-legend">
                  <Text className="legend-text">匹配度低</Text>
                  <View className="legend-gradient"></View>
                  <Text className="legend-text">匹配度高</Text>
                </View>
              </View>

              {/* 🚨 重构：开启 TimeGridSelector 的多选联动，并补充多选操作栏 */}
              <View className="time-grid-container time-grid-container--matrix">
                <TimeGridSelector
                  slotKeys={slotKeys}
                  selected={selectedKeys}
                  onChange={(next) => setSelectedKeys(next)}
                  rowLabels={rowLabels}
                  dateLabels={dateLabels}
                  readonlyMode={false}
                  forceDragMode={forceDragMode}
                  heatmapData={heatmapData}
                  heatmapCountData={heatmapCountData}
                />
              </View>
            </View>
          )}
          
          {isDateOnly && dateLabels.length > 0 && (
            <View className="date-only-section">
              <Text className="section-title">🟩 全部候选日期</Text>
              <View className="date-grid">
                {/* 🚨 核心修复：遍历所有生成的 dateLabels，而不是只有人投过的 candidateSlots */}
                {dateLabels.map((dateStr) => {
                  const isSelected = selectedKeys.has(dateStr);
                  
                  // 🚨 查一下这个具体日期有几个人投了
                  const slotData = candidateSlots.find(c => c.slot.date === dateStr);
                  const availableCount = slotData ? slotData.availableCount : 0;

                  return (
                    <View
                      key={dateStr}
                      className={`date-grid-cell ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        const next = new Set(selectedKeys);
                        if (next.has(dateStr)) next.delete(dateStr);
                        else next.add(dateStr);
                        setSelectedKeys(next);
                      }}
                    >
                      <View className="date-text">
                        {formatDate(dateStr, 'MM/DD')}
                        <Text className="week-text">({weekNames[new Date(dateStr.replace(/-/g, '/')).getDay()]})</Text>
                      </View>
                      <Text className="count-text">{availableCount} 人有空</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* 只有在有选中项且计算出统计数据时，才渲染整个底部容器 */}
          {selectedKeys.size > 0 && aggregatedStats && (
            <View className="confirm-section safe-bottom">
              <View className="dock-header">
                <View className="dock-header-left">
                  <Text className="dock-title">
                    已选: {aggregatedStats.count} {isDateOnly ? '个日期' : '个时段'}
                  </Text>
                </View>
                {/* 并排显示“查看详情”和“✕”关闭按钮 */}
                <View className="dock-detail-link-wrapper">
                  <Text className="dock-detail-link" onClick={() => {
                    const multiSlotKeys = Array.from(selectedKeys).sort().join(',');
                    Taro.navigateTo({
                      url: `/pages/event/slot-detail/index?id=${event?.id}&slot=${encodeURIComponent(multiSlotKeys)}`
                    });
                  }}>查看明细 &gt;</Text>
                  <View className="dock-close" onClick={() => setSelectedKeys(new Set())}>
                    <Text className="dock-close-icon">✕</Text>
                  </View>
                </View>
              </View>

              {/* ✅ 总结信息 */}
              <View className="dock-summary-bar">
                <Text className="summary-text">共 {aggregatedStats.availableUsers.length} 人在所有选中{isDateOnly ? '日期' : '时段'}均有空</Text>
                {aggregatedStats.unavailableUsers.length === 0 && (
                  <Text className="perfect-hint">🎉 全员均可参与！</Text>
                )}
              </View>

              {/* ❌ 仅显示没空人员列表 */}
              {aggregatedStats.unavailableUsers.length > 0 && (
                <View className="dock-group">
                  <Text className="dock-group-title">以下 {aggregatedStats.unavailableUsers.length} 人在部分或全部{isDateOnly ? '日期' : '时段'}没空：</Text>
                  <ScrollView scrollX className="user-scroll" enableFlex>
                    <View className="user-list">
                      {aggregatedStats.unavailableUsers.map(name => {
                        const p = event.participants.find(x => x.nickName === name);
                        return (
                          <View key={name} className="user-item unavailable">
                            <View className="user-avatar">
                              {p?.avatarUrl ? <Image className="avatar-img" src={p.avatarUrl} mode="aspectFill" /> : <Text className="avatar-fallback">👤</Text>}
                            </View>
                            <Text className="user-name">{name}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* 🚨 权限隔离：普通参与者只能看，只有管理员能点确认 */}
              {canManage ? (
                <Button
                  className="btn-primary confirm-btn"
                  onClick={handleConfirm}
                  disabled={confirming}
                  loading={confirming}
                >
                  确认选择以上{isDateOnly ? '日期' : '时段'}
                </Button>
              ) : (
                <Button
                  className="btn-primary confirm-btn"
                  disabled
                  style={{ background: '#cccccc', color: '#ffffff' }}
                >
                  仅发起人和管理员可确认时间
                </Button>
              )}
            </View>
          )}
        </>
      ) : (
        <View className="empty-state">
          <Text className="empty-icon">📝</Text>
          <Text className="empty-text">还没有人填写时间</Text>
          <Text className="empty-tip">分享给更多人参与吧！</Text>
          <Button 
            className="share-btn" 
            openType="share"
            onClick={() => {}}
          >
            邀请好友
          </Button>
        </View>
      )}

      {/* 决策面板纯文案分步引导 */}
      {showDecisionGuide && (
        <View className="guide-modal-overlay">
          <View className="guide-modal-content">
            <View className="guide-header">
              <Text className="guide-step-indicator">{decisionGuideStep}/2</Text>
            </View>

            {decisionGuideStep === 1 ? (
              <View className="guide-body">
                <View className="guide-title">⏳ 第一步：调整预计时长</View>
                <View className="guide-text-block">
                  <View className="guide-desc" style={{ marginBottom: '8px' }}>
                    推荐结果会随 <Text style={{ fontWeight: 'bold', color: '#333' }}>事件时长</Text> 实时更新。
                  </View>
                  <View className="guide-desc">
                    请先在页面顶部选择本次活动预计需要多长的时间哦～
                  </View>
                </View>
                <Button className="btn-primary guide-btn" onClick={nextDecisionStep}>
                  下一步
                </Button>
              </View>
            ) : (
              <View className="guide-body">
                <View className="guide-title">✨ 第二步：锁定或自定义</View>
                <View className="guide-text-block">
                  <View className="guide-desc" style={{ marginBottom: '12px', display: 'flex' }}>
                    <Text style={{ marginRight: '6px', color: '#07c160' }}>•</Text>
                    <Text>
                      <Text style={{ fontWeight: 'bold', color: '#333' }}>一键锁定</Text>：直接采纳下方“人最齐”的推荐。
                    </Text>
                  </View>
                  <View className="guide-desc" style={{ display: 'flex' }}>
                    <Text style={{ marginRight: '6px', color: '#07c160' }}>•</Text>
                    <Text>
                      <Text style={{ fontWeight: 'bold', color: '#333' }}>自由查缺</Text>：在热力图 <Text style={{ fontWeight: 'bold', color: '#333' }}>滑动多选</Text>，点击方格还能揪出 <Text style={{ fontWeight: 'bold', color: '#333' }}>到底谁没空</Text>。
                    </Text>
                  </View>
                </View>
                <Button className="btn-primary guide-btn" onClick={closeDecisionGuide}>
                  开始决策
                </Button>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}