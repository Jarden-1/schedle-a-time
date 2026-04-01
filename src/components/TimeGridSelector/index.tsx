import Taro from '@tarojs/taro';
import { View, ScrollView, Text } from '@tarojs/components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSlotKey } from '@/utils';

import './index.scss';

type GridCell = { slotKey: string; row: number; col: number; };
type DragMode = 'select' | 'erase';

type Props = {
  slotKeys: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  rowLabels: string[];
  dateLabels: string[];
  forceDragMode?: boolean;
  enabled?: boolean;
  readonlyMode?: boolean; // 如果为 true，彻底禁用拖拽和点击
  heatmapData?: Record<string, number>; // 传入每个 slotKey 的匹配率 (0 ~ 1)
  heatmapCountData?: Record<string, number>;
};

export default function TimeGridSelector(props: Props) {
  const {
    slotKeys,
    selected,
    onChange,
    rowLabels,
    dateLabels,
    enabled = true,
    forceDragMode = false,
    readonlyMode,
    heatmapData,
    heatmapCountData
  } = props;

  const wrapperId = useMemo(() => `time-grid-${Math.random().toString(36).slice(2)}`, []);
  const weekNames = useMemo(() => (['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const), []);

  const slotIndex = useMemo(() => {
    const byDate = new Map<string, number>();
    dateLabels.forEach((d, i) => byDate.set(d, i));
    const byTime = new Map<string, number>();
    rowLabels.forEach((t, i) => byTime.set(t, i));

    const map = new Map<string, GridCell>();
    for (const key of slotKeys) {
      const { date, startTime } = parseSlotKey(key);
      const col = byDate.get(date);
      const row = byTime.get(startTime);
      if (col == null || row == null) continue;
      map.set(key, { slotKey: key, row, col });
    }
    return map;
  }, [dateLabels, rowLabels, slotKeys]);

  const gridSize = useMemo(() => ({ rows: rowLabels.length, cols: dateLabels.length }), [rowLabels.length, dateLabels.length]);

  const dividerAfterRows = useMemo(() => {
    const s = new Set<number>();
    rowLabels.forEach((t, i) => {
      // 找出这一行对应的任意一个 slotKey
      const matchKey = slotKeys.find(key => key.includes(`_${t}-`));
      if (matchKey) {
        try {
          const { endTime } = parseSlotKey(matchKey);
          // 只要这行的结束时间是 12:00 或 18:00，就在它底部画粗线
          if (endTime === '12:00' || endTime === '18:00') {
            s.add(i);
          }
        } catch (e) { /* ignore */ }
      }
    });
    return s;
  }, [rowLabels, slotKeys]);

  const cellKeyByPos = useMemo(() => {
    const arr: (string | null)[][] = Array.from({ length: gridSize.rows }, () => Array.from({ length: gridSize.cols }, () => null));
    for (const cell of slotIndex.values()) arr[cell.row][cell.col] = cell.slotKey;
    return arr;
  }, [gridSize.cols, gridSize.rows, slotIndex]);

  const gridMetricsRef = useRef({ left: 0, top: 0, cellW: 0, cellH: 0 });

  const touchSessionRef = useRef({
    id: 0,
    startX: 0,
    startY: 0,
    moved: false,
    ended: false,
  });

  const longPressTimerRef = useRef<any>(null);
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };


  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ row: number; col: number } | null>(null);
  const dragModeRef = useRef<DragMode>('select');
  const lastPosRef = useRef<{ row: number; col: number } | null>(null);

  const baseSelectedRef = useRef<Set<string>>(new Set());
  const tempSelectedRef = useRef<Set<string>>(new Set());
  const committedSelectedRef = useRef<Set<string>>(new Set(selected));

  const [isDragging, setIsDragging] = useState(false);
  const [renderSelected, setRenderSelected] = useState<Set<string>>(selected);

  useEffect(() => {
    const next = new Set(selected);
    committedSelectedRef.current = next;
    setRenderSelected(next);
    baseSelectedRef.current = new Set(next);
    tempSelectedRef.current = new Set(next);
  }, [selected]);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));


  const measureGrid = useCallback(() => {
    return new Promise<void>((resolve) => {
      const query = Taro.createSelectorQuery();
      query.select(`#${wrapperId}-cell-0-0`).boundingClientRect();
      query.select(`#${wrapperId}-cell-0-1`).boundingClientRect();
      query.select(`#${wrapperId}-cell-1-0`).boundingClientRect();
      query.select(`#${wrapperId}`).boundingClientRect();

      query.exec((res) => {
        const [c00, c01, c10, wrap] = res;
        if (c00) {
          let cellW = c00.width;
          let cellH = c00.height;
          if (c01) cellW = c01.left - c00.left;
          else if (wrap) cellW = wrap.width / gridSize.cols;

          if (c10) cellH = c10.top - c00.top;
          else if (wrap) cellH = wrap.height / gridSize.rows;

          gridMetricsRef.current = { left: c00.left, top: c00.top, cellW, cellH };
        }
        resolve();
      });
    });
  }, [gridSize, wrapperId]);

  const pointToCell = useCallback((clientX: number, clientY: number) => {
    const { left, top, cellW, cellH } = gridMetricsRef.current;
    if (!cellW || !cellH) return null;

    const col = Math.floor((clientX - left) / cellW);
    const row = Math.floor((clientY - top) / cellH);

    return {
      row: clamp(row, 0, gridSize.rows - 1),
      col: clamp(col, 0, gridSize.cols - 1)
    };
  }, [gridSize]);

  const applyRect = useCallback((start: { row: number; col: number }, end: { row: number; col: number }) => {
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);

    const next = new Set(baseSelectedRef.current);
    const mode = dragModeRef.current;

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const key = cellKeyByPos[r]?.[c] ?? null;
        if (!key) continue;
        if (mode === 'select') next.add(key);
        else next.delete(key);
      }
    }
    tempSelectedRef.current = next;
    setRenderSelected(next);
  }, [cellKeyByPos]);

  const enterDragMode = useCallback((startPos: { row: number; col: number }, showHint: boolean) => {
    if (draggingRef.current) return;

    draggingRef.current = true;
    setIsDragging(true); // 🚨 新增：触发重新渲染，锁定滚动
    dragStartRef.current = startPos;
    lastPosRef.current = startPos;

    const key = cellKeyByPos[startPos.row]?.[startPos.col];
    dragModeRef.current = (key && baseSelectedRef.current.has(key)) ? 'erase' : 'select';

    if (showHint && !forceDragMode) {
      Taro.showToast({ title: '别松手，滑动即可多选', icon: 'none', duration: 1500 });
    }
    applyRect(startPos, startPos);
  }, [applyRect, cellKeyByPos, forceDragMode]);

  const commitSelection = useCallback((next: Set<string>) => {
    const committed = new Set(next);
    committedSelectedRef.current = committed;
    baseSelectedRef.current = new Set(committed);
    tempSelectedRef.current = new Set(committed);
    setRenderSelected(committed);
    onChange(committed);
  }, [onChange]);

  const handleSingleClick = useCallback((pos: { row: number; col: number }) => {
    if (readonlyMode) return;
    const key = cellKeyByPos[pos.row]?.[pos.col];
    if (!key) return;
    const next = new Set(committedSelectedRef.current);
    if (next.has(key)) next.delete(key);
    else next.add(key);

    commitSelection(next);
  }, [cellKeyByPos, commitSelection, readonlyMode]);

  const onTouchStart = useCallback((e: any) => {
    if (readonlyMode || !enabled) return;
    const t = e.touches[0];
    const sid = ++touchSessionRef.current.id;
    const session = touchSessionRef.current;

    session.startX = t.clientX;
    session.startY = t.clientY;
    session.moved = false;
    session.ended = false;

    baseSelectedRef.current = new Set(committedSelectedRef.current);
    tempSelectedRef.current = new Set(committedSelectedRef.current);
    clearLongPressTimer();

    // 预热一次测量，尽量让后续 pointToCell 有可用的 metrics
    measureGrid();

    // 🚀 核心恢复：0.35秒不移动即视为长按，触发震动并进入多选
    longPressTimerRef.current = setTimeout(() => {
      if (session.moved || session.ended || forceDragMode) return;
      measureGrid().then(() => {
        if (touchSessionRef.current.id !== sid) return;
        const pos = pointToCell(t.clientX, t.clientY);
        if (pos) {
          try { Taro.vibrateShort(); } catch { /* ignore */ }
          enterDragMode(pos, true);
        }
      });
    }, 350);
  }, [enabled, enterDragMode, forceDragMode, measureGrid, pointToCell, readonlyMode]);

  const onTouchMove = useCallback((e: any) => {
    if (readonlyMode || !enabled) return;
    const t = e.touches[0];
    const session = touchSessionRef.current;

    if (!draggingRef.current) {
      const dx = t.clientX - session.startX;
      const dy = t.clientY - session.startY;
      if (dx * dx + dy * dy <= 64) return;

      session.moved = true;
      clearLongPressTimer();

      if (!forceDragMode) return;

      const startPos = pointToCell(session.startX, session.startY);
      const currentPos = pointToCell(t.clientX, t.clientY);
      if (!startPos || !currentPos) return;

      enterDragMode(startPos, false);
      if (lastPosRef.current?.row === currentPos.row && lastPosRef.current?.col === currentPos.col) return;
      lastPosRef.current = currentPos;
      applyRect(startPos, currentPos);
      return;
    }

    const pos = pointToCell(t.clientX, t.clientY);
    if (!pos || !dragStartRef.current) return;
    if (lastPosRef.current?.row === pos.row && lastPosRef.current?.col === pos.col) return;

    // 🚨 新增：触觉补偿，划入新格子时触发极轻微的短震动
    try {
      Taro.vibrateShort({ type: 'light' } as any);
    } catch {
      /* 部分机型不支持带参数，兼容忽略 */
    }

    lastPosRef.current = pos;
    applyRect(dragStartRef.current, pos);
  }, [applyRect, enabled, enterDragMode, forceDragMode, pointToCell, readonlyMode]);

  const onTouchEnd = useCallback((e: any) => {
    if (readonlyMode || !enabled) return;
    const session = touchSessionRef.current;
    session.ended = true;
    clearLongPressTimer();

    if (draggingRef.current) {
      commitSelection(tempSelectedRef.current);
      draggingRef.current = false;
      setIsDragging(false);
      dragStartRef.current = null;
      lastPosRef.current = null;
      return;
    }

    if (!session.moved) {
      measureGrid().then(() => {
        const t = e.changedTouches ? e.changedTouches[0] : null;
        const clientX = t ? t.clientX : session.startX;
        const clientY = t ? t.clientY : session.startY;
        const pos = pointToCell(clientX, clientY);
        if (pos) handleSingleClick(pos);
      });
    }
  }, [commitSelection, enabled, handleSingleClick, readonlyMode, measureGrid, pointToCell]);

  return (
    // 🎯 修复 2：彻底移除外部动态包裹的 catchMove，完全交给底部的【多选】按钮去接管
    <View className="time-grid">
      <View className="time-grid-left">
        <View className="time-grid-corner" />
        <View className="time-grid-axis">
          {rowLabels.map((t, i) => {
            // 🚨 恢复：找出一个带有该 startTime 的 key，解析出 endTime
            const matchKey = slotKeys.find(key => key.includes(`_${t}-`));
            let endTime = '';
            if (matchKey) {
              try {
                endTime = parseSlotKey(matchKey).endTime;
              } catch (e) { /* ignore */ }
            }
            const displayText = endTime ? `${t}-${endTime}` : t;

            return (
              // 🚨 恢复：加入 dividerAfterRows 的判断，找回三界分割线
              <View key={t} className={`time-grid-axis-cell ${dividerAfterRows.has(i) ? 'divider-after' : ''}`}>
                <Text className="axis-text">{displayText}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <ScrollView
        className="time-grid-scroll"
        scrollX={!forceDragMode}
        scrollWithAnimation={!forceDragMode}
      >
        <View className="time-grid-scroll-inner">
          <View className="time-grid-header">
            {dateLabels.map((d) => {
              const [yy, mm, dd] = d.split('-');
              const monthDay = `${mm}/${dd}`;
              const week = weekNames[new Date(Number(yy), Number(mm) - 1, Number(dd)).getDay()];
              return (
                <View key={d} className="time-grid-header-cell">
                  <View className="time-grid-header-date">{monthDay}</View>
                  <View className="time-grid-header-week">{week}</View>
                </View>
              );
            })}
          </View>

          <View
            id={wrapperId}
            className="time-grid-wrapper"
            catchMove={forceDragMode}
            onTouchStart={onTouchStart as any}
            onTouchMove={onTouchMove as any}
            onTouchEnd={onTouchEnd as any}
            onTouchCancel={onTouchEnd as any}
          >
            {Array.from({ length: gridSize.rows }).map((_, r) => (
              <View key={r} className={`time-grid-row ${dividerAfterRows.has(r) ? 'divider-after' : ''}`}>
                {Array.from({ length: gridSize.cols }).map((__, c) => {
                  const key = cellKeyByPos[r]?.[c] ?? null;
                  const isSelected = key ? renderSelected.has(key) : false;

                  // 计算热力颜色
                  let cellStyle: any = {};
                  if (heatmapData && key && heatmapData[key] !== undefined) {
                    const ratio = heatmapData[key];
                    if (ratio > 0) {
                      // 根据比例设置透明度，基础色为微信绿 (7, 193, 96)
                      // 为了保证能看清，哪怕是最低比例也给一点底色(如 0.1)
                      const opacity = Math.max(0.1, ratio);
                      cellStyle = { backgroundColor: `rgba(7, 193, 96, ${opacity})` };
                    } else {
                      cellStyle = { backgroundColor: '#f9f9f9' }; // 没人选的格子显示浅灰
                    }
                  }

                  // 🚨 修复：选中态的外观必须追加到 style 中，避免被热力图内联背景覆盖
                  if (isSelected && !readonlyMode) {
                    cellStyle = {
                      ...cellStyle,
                      backgroundColor: 'rgba(7, 193, 96, 0.25)',
                      borderRightColor: 'rgba(7, 193, 96, 0.2)',
                      borderBottomColor: 'rgba(7, 193, 96, 0.2)',
                      boxShadow: 'inset 0 0 0 2px rgba(7, 193, 96, 0.8)'
                    };
                  }

                  // 获取当前格子的人数
                  const count = (heatmapCountData && key) ? heatmapCountData[key] : undefined;

                  return (
                    <View
                      id={`${wrapperId}-cell-${r}-${c}`}
                      key={`${r}-${c}`}
                      className={`time-grid-cell ${isSelected && !readonlyMode ? 'selected' : ''} ${count !== undefined && count > 0 ? 'has-count' : ''}`}
                      style={cellStyle}
                    >
                      {count !== undefined && count > 0 && (
                        <Text className="heatmap-count-text">{count}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}