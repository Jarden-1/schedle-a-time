import Taro, { useLoad } from '@tarojs/taro';
import { View, Text, Button, Switch } from '@tarojs/components';
import { useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import TimeGridSelector from '@/components/TimeGridSelector';
import Loading from '@/components/Loading';
import EmptyState from '@/components/EmptyState';
import {
  WEEK_REFERENCE_DATES,
  generateWeeklyGridSlotKeys,
  gridKeyToWeeklyKey,
  parseSlotKey,
  weeklyKeyToGridKey
} from '@/utils';
import './index.scss';

export default function WeeklyUnavailablePage() {
  const {
    currentUser,
    weeklyUnavailableSlots,
    autoApplyWeeklyUnavailable,
    fetchWeeklyUnavailableAPI,
    updateWeeklyUnavailableAPI
  } = useAppStore();

  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [autoApply, setAutoApply] = useState(autoApplyWeeklyUnavailable);
  const [forceDragMode, setForceDragMode] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const slotKeys = useMemo(() => generateWeeklyGridSlotKeys(), []);
  const dateLabels = WEEK_REFERENCE_DATES;
  const rowLabels = useMemo(() => {
    const set = new Set<string>();
    slotKeys.forEach((key) => set.add(parseSlotKey(key).startTime));
    return Array.from(set).sort();
  }, [slotKeys]);

  const hydrateSelection = (slots: string[], nextAutoApply: boolean) => {
    setSelectedSlots(new Set(slots.map(weeklyKeyToGridKey).filter(Boolean)));
    setAutoApply(nextAutoApply);
  };

  useLoad(async () => {
    hydrateSelection(weeklyUnavailableSlots, autoApplyWeeklyUnavailable);
    const settings = await fetchWeeklyUnavailableAPI();
    if (settings) {
      hydrateSelection(settings.weeklyUnavailableSlots, settings.autoApplyWeeklyUnavailable);
    }
    setInitialLoading(false);
  });

  const handleSelectWorkdayBusy = () => {
    const next = new Set(selectedSlots);
    slotKeys.forEach((key) => {
      const { date, startTime, endTime } = parseSlotKey(key);
      const [year, month, day] = date.split('-').map(Number);
      const weekday = new Date(year, month - 1, day).getDay();
      if (weekday >= 1 && weekday <= 5 && startTime >= '09:00' && endTime <= '18:00') {
        next.add(key);
      }
    });
    setSelectedSlots(next);
  };

  const handleSave = async () => {
    setSaving(true);
    Taro.showLoading({ title: '保存中...' });
    try {
      const weeklyKeys = Array.from(selectedSlots)
        .map(gridKeyToWeeklyKey)
        .filter(Boolean)
        .sort();
      const ok = await updateWeeklyUnavailableAPI(weeklyKeys, autoApply);
      Taro.hideLoading();
      Taro.showToast({ title: ok ? '已保存' : '保存失败', icon: ok ? 'success' : 'none' });
    } finally {
      Taro.hideLoading();
      setSaving(false);
    }
  };

  if (initialLoading) {
    return (
      <View className="weekly-unavailable-page">
        <Loading fullScreen text="加载中..." />
      </View>
    );
  }

  if (!currentUser?.openid) {
    return (
      <View className="weekly-unavailable-page">
        <EmptyState
          icon="🕒"
          title="请先登录"
          description="登录后即可保存自己的每周常规不可用时段。"
          actionText="返回我的"
          onAction={() => Taro.navigateBack()}
        />
      </View>
    );
  }

  return (
    <View className="weekly-unavailable-page">
      <View className="header-card">
        <Text className="title">每周常规不可用时段</Text>
        <Text className="desc">红色格子表示你每周通常不可用。当前展示 08:00-24:00，参与活动时可自动避开，仍可按本次情况手动改回。</Text>
      </View>

      <View className="settings-card">
        <View className="setting-row">
          <View className="setting-copy">
            <Text className="setting-title">参与活动时自动套用</Text>
            <Text className="setting-desc">默认关闭，由你手动选择空闲时间；开启后自动选中常规不可用时段以外的时间。</Text>
          </View>
          <Switch checked={autoApply} onChange={(e: any) => setAutoApply(e.detail.value ?? e.detail.checked)} />
        </View>
      </View>

      <View className="toolbar">
        <View className="toolbar-left">
          <Text className="selected-count">已标记 {selectedSlots.size} 个半小时</Text>
        </View>
        <View className="toolbar-actions">
          <Text className="toolbar-btn" onClick={handleSelectWorkdayBusy}>工作日白天</Text>
          <Text className="toolbar-btn" onClick={() => setSelectedSlots(new Set())}>清空</Text>
          <Text className={`toolbar-btn ${forceDragMode ? 'active' : ''}`} onClick={() => setForceDragMode((v) => !v)}>
            {forceDragMode ? '关闭连选' : '开启连选'}
          </Text>
        </View>
      </View>

      <View className="grid-wrap">
        <TimeGridSelector
          slotKeys={slotKeys}
          selected={selectedSlots}
          onChange={setSelectedSlots}
          rowLabels={rowLabels}
          dateLabels={dateLabels}
          forceDragMode={forceDragMode}
          selectedTone="red"
          showHeaderDate={false}
        />
      </View>

      <View className="footer">
        <Button className="save-btn" onClick={handleSave} loading={saving} disabled={saving}>
          保存不可用时段
        </Button>
      </View>
    </View>
  );
}
