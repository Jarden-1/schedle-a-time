import Taro, { useLoad } from '@tarojs/taro';
import { View, Text, Button, ScrollView, Image, Slider } from '@tarojs/components';
import { useState, useMemo } from 'react';
import { Event, CandidateSlot, TimeMode } from '@/types';
import { useAppStore } from '@/store';
import { formatDate, formatTime, parseSlotKey, findBestSlidingWindows, findBestDateWindows, generateTimeSlots, generateDateSlots, getParticipantDisplayName, getParticipantKey } from '@/utils';
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
  const [targetDuration, setTargetDuration] = useState<number | null>(null);

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
  const [targetDays, setTargetDays] = useState<number | null>(null);
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const isDateOnly = event?.timeMode === TimeMode.DATE_ONLY || (event?.timeMode as any) === 'DATE_ONLY';

  const { confirmTimeAPI, getEventById, currentUser } = useAppStore();

  const formatDurationLabel = (minutes: number) => {
    if (minutes < 60) return `${minutes}分钟`;
    if (minutes % 60 === 0) return `${minutes / 60}小时`;
    return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
  };

  useLoad(async (options) => {
    const { id } = options;

    // 优先从云端获取最新数据
    const cloudEvent = await getEventById(id);
    if (cloudEvent) {
      setEvent(cloudEvent);
    } else {
      // 只有「网络类」错误才允许回退到本地缓存；404 说明活动已被删除
      const { eventLoadError: loadError, events: cachedEvents } = useAppStore.getState();
      if (loadError?.type !== 'not_found' && loadError?.type !== 'auth') {
        const localEvent = cachedEvents.find(e => e.id === id);
        if (localEvent) setEvent(localEvent);
      }
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

  // 🚨 统一用 participantId / openid 作为身份标识，显示名只用于展示
  const participantEntries = useMemo(() => {
    return (event?.participants || [])
      .map(participant => ({
        id: getParticipantKey(participant),
        name: getParticipantDisplayName(participant),
        participant
      }))
      .filter(entry => entry.id);
  }, [event]);

  const participantIds = useMemo(() => participantEntries.map(entry => entry.id), [participantEntries]);

  const nameById = useMemo(
    () => new Map<string, string>(participantEntries.map(entry => [entry.id, entry.name] as [string, string])),
    [participantEntries]
  );

  const participantById = useMemo(
    () => new Map<string, any>(participantEntries.map(entry => [entry.id, entry.participant] as [string, any])),
    [participantEntries]
  );

  const candidateSlots = useMemo((): CandidateSlot[] => {
    if (!event || participantEntries.length === 0) return [];

    const slotMap = new Map<string, string[]>();
    participantEntries.forEach(({ id, participant }) => {
      const slots = Array.isArray(participant.availableSlots) ? participant.availableSlots : [];
      slots.forEach((slot: string) => {
        if (!slotMap.has(slot)) slotMap.set(slot, []);
        const owners = slotMap.get(slot)!;
        if (!owners.includes(id)) owners.push(id);
      });
    });

    const totalCount = participantIds.length;
    const candidates: CandidateSlot[] = Array.from(slotMap.entries()).map(([slotKey, availableIds]) => {
      const { date, startTime, endTime } = parseSlotKey(slotKey);
      const unavailableIds = participantIds.filter(id => !availableIds.includes(id));
      return {
        slot: { date, startTime, endTime },
        availableCount: availableIds.length,
        totalCount,
        availableIds,
        unavailableIds,
        availableUsers: availableIds.map(id => nameById.get(id) || id),
        unavailableUsers: unavailableIds.map(id => nameById.get(id) || id),
        matchRate: totalCount > 0 ? availableIds.length / totalCount : 0
      };
    });

    return candidates.sort((a, b) => b.matchRate - a.matchRate || b.availableCount - a.availableCount);
  }, [event, participantEntries, participantIds, nameById]);

  const vipKeys = useMemo(() => {
    if (!event || !Array.isArray(event.vipIds)) return [] as string[];
    return participantEntries
      .filter(entry => entry.participant?.openid && event.vipIds?.includes(entry.participant.openid))
      .map(entry => entry.id);
  }, [event, participantEntries]);

  const summarizeNames = (names: string[], limit = 2) => {
    if (names.length === 0) return '无';
    const head = names.slice(0, limit).join('、');
    return names.length > limit ? `${head} 等 ${names.length} 人` : head;
  };

  const cleanReason = (reason?: string) => {
    return (reason || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').trim();
  };

  const getDecisionSummary = (availableIds: string[], reason?: string) => {
    const availableSet = new Set(availableIds);
    const unavailableIds = participantIds.filter(id => !availableSet.has(id));
    const unavailableUsers = unavailableIds.map(id => nameById.get(id) || id);
    const vipAvailableCount = vipKeys.filter(id => availableSet.has(id)).length;
    const vipUnavailableIds = vipKeys.filter(id => !availableSet.has(id));
    const vipUnavailableUsers = vipUnavailableIds.map(id => nameById.get(id) || id);
    const reasonParts: string[] = [];

    if (vipKeys.length > 0) {
      reasonParts.push(vipUnavailableUsers.length === 0 ? '重点嘉宾全员可参加' : `${summarizeNames(vipUnavailableUsers, 1)}等重点嘉宾没空`);
    }
    reasonParts.push(unavailableUsers.length === 0 ? '全员都有空' : `仅 ${unavailableUsers.length} 人没空`);

    const cleanedReason = cleanReason(reason);
    if (cleanedReason && !reasonParts.includes(cleanedReason)) {
      reasonParts.push(cleanedReason);
    }

    return {
      unavailableUsers,
      unavailableIds,
      vipAvailableCount,
      vipUnavailableUsers,
      vipUnavailableIds,
      vipText: vipKeys.length > 0 ? `重点嘉宾 ${vipAvailableCount}/${vipKeys.length} 可参加` : '未设置重点嘉宾',
      reasonText: reasonParts.slice(0, 2).join('，'),
      unavailableText: summarizeNames(unavailableUsers, 2),
      vipUnavailableText: summarizeNames(vipUnavailableUsers, 1)
    };
  };

  // 1. 提取去重后的时间行标签和日期列标签 (🚨 生成全局全量网格)
  const { rowLabels, dateLabels, slotKeys } = useMemo(() => {
    if (!event) return { rowLabels: [], dateLabels: [], slotKeys: [] };

    const allKeys: string[] = [];
    if (isDateOnly) {
      // 🚨 用 dayjs 生成日期，避免 toISOString() 在东八区凌晨退回前一天
      allKeys.push(...generateDateSlots(event.dateRange.start, event.dateRange.end));
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

  const maxTargetDays = Math.max(1, dateLabels.length);
  const durationSliderTicks = useMemo(() => (
    isDateOnly
      ? Array.from({ length: maxTargetDays }, (_, index) => index + 1)
      : Array.from({ length: 16 }, (_, index) => 30 + index * 30)
  ), [isDateOnly, maxTargetDays]);

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

    let availableIds = [...participantIds];
    keysArr.forEach(key => {
      const slotData = candidateSlots.find(c => {
        const k = isDateOnly ? c.slot.date : `${c.slot.date}_${c.slot.startTime}-${c.slot.endTime}`;
        return k === key;
      });
      const idsInThisSlot = slotData ? slotData.availableIds : [];
      // 核心求交集算法（按稳定 ID，不按姓名）
      availableIds = availableIds.filter(id => idsInThisSlot.includes(id));
    });

    const availableSet = new Set(availableIds);
    const unavailableIds = participantIds.filter(id => !availableSet.has(id));
    const vipAvailableIds = vipKeys.filter(id => availableSet.has(id));
    const vipUnavailableIds = vipKeys.filter(id => !availableSet.has(id));

    return {
      availableIds,
      unavailableIds,
      vipAvailableIds,
      vipUnavailableIds,
      availableUsers: availableIds.map(id => nameById.get(id) || id),
      unavailableUsers: unavailableIds.map(id => nameById.get(id) || id),
      vipAvailableUsers: vipAvailableIds.map(id => nameById.get(id) || id),
      vipUnavailableUsers: vipUnavailableIds.map(id => nameById.get(id) || id),
      count: keysArr.length,
      firstSlotDisplay: keysArr[0]
    };
  }, [selectedKeys, candidateSlots, participantIds, nameById, vipKeys, isDateOnly]);

  const handleTop5Click = (slotKeys: string[]) => {
    setSelectedKeys(new Set(slotKeys));
  };

  const bestWindows = useMemo(() => {
    if (!event) return [];
    if (isDateOnly && !targetDays) return [];
    if (!isDateOnly && !targetDuration) return [];
    if (isDateOnly) {
      return findBestDateWindows(candidateSlots, targetDays || 1, event.participants || [], event.vipIds || []);
    } else {
      return findBestSlidingWindows(candidateSlots, targetDuration || 60, event.granularity || 30, event.participants || [], event.vipIds || []);
    }
  }, [candidateSlots, targetDuration, targetDays, event, isDateOnly]);

  const hasRecommendationTarget = isDateOnly ? !!targetDays : !!targetDuration;

  // 精选 Top 3，更多探索交给热力图
  const topMergedSlots = useMemo(() => bestWindows.slice(0, 3), [bestWindows]);

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

  // 🚨 决策数据门禁：关闭「决策面板公开」后，只有发起人/管理员能看
  const decisionAllowed = canManage || event.isDecisionPublic === true || event.decisionRedacted === false;
  if (!decisionAllowed) {
    return (
      <View className="decision-page">
        <View className="error-state">
          <Text className="error-text">决策面板未公开</Text>
          <Text className="empty-desc">发起人关闭了「决策面板公开」，只有管理员可以查看大家的时间安排。</Text>
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
            <Text className="stat-item">🎯 最佳匹配：{Math.round(candidateSlots[0]?.matchRate * 100)}%</Text>
          )}
        </View>
      </View>

      {candidateSlots.length > 0 ? (
        <>
          <View className="duration-filter">
            <View className="duration-header">
              <View className="filter-title-row">
                <Text className="filter-label">{isDateOnly ? '推荐前先选择预计天数' : '推荐前先选择预计时长'}</Text>
                <Text className={`filter-value ${hasRecommendationTarget ? 'active' : ''}`}>
                  {isDateOnly
                    ? (targetDays ? `${targetDays}天` : '拖动选择')
                    : (targetDuration ? formatDurationLabel(targetDuration) : '拖动选择')}
                </Text>
              </View>
              <Text className="filter-desc">
                {isDateOnly ? '系统会按活动天数推荐人最齐的日期组合' : '系统会按活动时长推荐人最齐的连续时段'}
              </Text>
            </View>
            <View className="duration-slider-wrap">
              <Slider
                className="duration-slider"
                min={isDateOnly ? 1 : 30}
                max={isDateOnly ? maxTargetDays : 480}
                step={isDateOnly ? 1 : 30}
                value={isDateOnly ? (targetDays || 1) : (targetDuration || 30)}
                activeColor="#07c160"
                backgroundColor="#e5e7eb"
                blockColor="#07c160"
                blockSize={18}
                onChange={(e) => {
                  const value = Number(e.detail.value);
                  if (isDateOnly) setTargetDays(value);
                  else setTargetDuration(value);
                }}
                onChanging={(e) => {
                  const value = Number(e.detail.value);
                  if (isDateOnly) setTargetDays(value);
                  else setTargetDuration(value);
                }}
              />
              <View className="slider-ticks">
                {durationSliderTicks.map((tick) => (
                  <View key={tick} className="slider-tick" />
                ))}
              </View>
              <View className="slider-scale">
                <Text>{isDateOnly ? '1天' : '30分钟'}</Text>
                <Text>{isDateOnly ? `${maxTargetDays}天` : '8小时'}</Text>
              </View>
            </View>
          </View>

          <View className="top3-section">
            <Text className="section-title">
              {hasRecommendationTarget
                ? (isDateOnly ? '🏆 推荐日期 Top 3' : '🏆 推荐时段 Top 3')
                : '🏆 推荐方案'}
            </Text>

            {!hasRecommendationTarget ? (
              <View className="recommend-empty">
                <Text className="empty-title">{isDateOnly ? '先选择预计活动天数' : '先选择预计活动时长'}</Text>
                <Text className="empty-desc">选择后，系统会推荐重点嘉宾优先、缺席人数更少的方案。</Text>
              </View>
            ) : topMergedSlots.length > 0 ? (
              <>
                {/* 🚨 新增：提取第一个推荐结果的 downgradeHint，作为全局横幅展示 */}
                {topMergedSlots[0]?.downgradeHint && (
                  <View className="global-downgrade-banner">
                    <Text className="warn-text">⚠️ {topMergedSlots[0].downgradeHint}</Text>
                  </View>
                )}

                {topMergedSlots.map((slot, index) => {
                  // 🚨 核心修复：判断该卡片包含的所有 slotKey 是否都在 selectedKeys 中
                  const isSelected = slot.slotKeys.length > 0 && slot.slotKeys.every((k: string) => selectedKeys.has(k));
                  const summary = getDecisionSummary(slot.availableIds || slot.availableUsers || [], slot.recommendReason);

                  return (
                    <View
                      key={`merged-${slot.date}-${slot.startTime || slot.startDate}`}
                      className={`top3-card rank-${index + 1} ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleTop5Click(slot.slotKeys)}
                    >
                      <View className="recommend-card-top">
                        <View className="rank-badge">Top {index + 1}</View>
                        <View className="match-rate">
                          <Text className="rate-text">{Math.round(slot.matchRate * 100)}%</Text>
                          <Text className="count-text">{slot.availableCount}/{slot.totalCount} 人</Text>
                        </View>
                      </View>

                      <View className="slot-info">
                        <Text className="date">
                          {isDateOnly && slot.startDate !== slot.endDate
                            ? `${formatDate(slot.startDate, 'MM/DD')}(${weekNames[new Date(slot.startDate.replace(/-/g, '/')).getDay()]}) - ${formatDate(slot.endDate, 'MM/DD')}(${weekNames[new Date(slot.endDate.replace(/-/g, '/')).getDay()]})`
                            : `${formatDate(slot.date, 'MM/DD')}(${weekNames[new Date(slot.date.replace(/-/g, '/')).getDay()]})`
                          }
                        </Text>
                        {!isDateOnly && <Text className="time">{formatTime(slot.startTime)} - {formatTime(slot.endTime)}</Text>}
                        {slot.slotKeys.length > 1 && (
                          <Text className="merged-hint">{isDateOnly ? `连续 ${slot.slotKeys.length} 天` : `连续 ${slot.slotKeys.length} 个时段`}</Text>
                        )}
                      </View>

                      <View className={`vip-line ${summary.vipUnavailableUsers.length > 0 ? 'warn' : ''}`}>
                        <Text>{summary.vipText}</Text>
                        {summary.vipUnavailableUsers.length > 0 ? <Text className="vip-absent">缺席：{summary.vipUnavailableText}</Text> : null}
                      </View>

                      <View className="reason-line">
                        <Text className="reason-label">推荐原因</Text>
                        <Text className="reason-text">{summary.reasonText}</Text>
                      </View>

                      <View className="absent-line">
                        <Text className="reason-label">没空</Text>
                        <Text className="absent-text">{summary.unavailableUsers.length === 0 ? '无' : summary.unavailableText}</Text>
                      </View>

                      {/* 🚨 新增：右上角选中角标 */}
                      {isSelected && <View className="selected-icon">✓</View>}
                    </View>
                  );
                })}
              </>
            ) : (
              <View className="recommend-empty">
                <Text className="empty-title">暂时没有匹配方案</Text>
                <Text className="empty-desc">可以缩短预计时长，或在热力图中手动选择更合适的时间。</Text>
              </View>
            )}
          </View>

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

              {vipKeys.length > 0 && (
                <View className={`dock-vip-bar ${aggregatedStats.vipUnavailableUsers.length > 0 ? 'warn' : ''}`}>
                  <Text className="dock-vip-text">
                    重点嘉宾 {aggregatedStats.vipAvailableUsers.length}/{vipKeys.length} 可参加
                  </Text>
                  {aggregatedStats.vipUnavailableUsers.length > 0 && (
                    <Text className="dock-vip-missing">
                      没空：{summarizeNames(aggregatedStats.vipUnavailableUsers, 2)}
                    </Text>
                  )}
                </View>
              )}

              {/* ❌ 仅显示没空人员列表 */}
              {aggregatedStats.unavailableUsers.length > 0 && (
                <View className="dock-group">
                  <Text className="dock-group-title">以下 {aggregatedStats.unavailableUsers.length} 人在部分或全部{isDateOnly ? '日期' : '时段'}没空：</Text>
                  <ScrollView scrollX className="user-scroll" enableFlex>
                    <View className="user-list">
                      {aggregatedStats.unavailableIds.map(id => {
                        const p = participantById.get(id);
                        const name = nameById.get(id) || id;
                        return (
                          <View key={id} className="user-item unavailable">
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
                <View className="guide-title">⏳ 第一步：选择预计时长</View>
                <View className="guide-text-block">
                  <View className="guide-desc" style={{ marginBottom: '8px' }}>
                    推荐结果会随 <Text style={{ fontWeight: 'bold', color: '#333' }}>预计时长</Text> 实时更新。
                  </View>
                  <View className="guide-desc">
                    请先选择本次活动大概需要多长时间，系统再给出推荐方案。
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
