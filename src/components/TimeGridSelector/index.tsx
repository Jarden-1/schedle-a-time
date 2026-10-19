import Taro from '@tarojs/taro';
import { View, ScrollView, Text } from '@tarojs/components';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSlotKey } from '@/utils';

import './index.scss';

type GridCell = { slotKey: string; row: number; col: number; };
type DragMode = 'select' | 'erase';

/**
 * 拖选时的边缘自动滚动。
 *
 * 原生滚动是「内容跟着手指走」，拖选时方向正好相反：想选下面的格子，
 * 屏幕却往上翻出上面已经看过的部分。所以手指拖到屏幕上下边缘并停住时，
 * 由我们主动滚动页面 —— 贴下边缘 → scrollTop 增大（内容上移，下面格子出来），
 * 贴上边缘反之。速度按离边缘的远近线性衰减，不会失控。
 */
const EDGE_ZONE = 80;      // 距离边缘多少像素内触发
const EDGE_TICK_MS = 50;   // 每 50ms 滚一次
const EDGE_STEP_PX = 10;   // 贴边时的单次步长

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
  selectedTone?: 'green' | 'red';
  hintedKeys?: Set<string>;
  showHeaderDate?: boolean;
  /**
   * 当前页面滚动距离（由宿主页面用 usePageScroll 维护的 ref）。
   *
   * 长按拖选时页面会跟着手指滚动，如果不把这个偏移算进去，
   * 「手指位置 → 格子」的换算会随着滚动越来越偏，
   * 表现为选中区域一路狂飙、根本跟不上手指。
   */
  scrollTopRef?: { current: number };
};

type GridRowProps = {
  rowIndex: number;
  wrapperId: string;
  cellKeys: (string | null)[];
  selectedMask: string;
  hintedMask: string;
  heatmapData?: Record<string, number>;
  heatmapCountData?: Record<string, number>;
  rowDivider: boolean;
  readonlyMode: boolean;
  selectedTone: 'green' | 'red';
};

/**
 * 单行渲染组件。
 *
 * 拖选时每移动一格都会更新选中集合，如果整张表重渲染，几百上千个格子会一起
 * 走一遍 setData，低端机上直接掉帧。这里把「选中状态」压成位串传入，
 * React.memo 靠字符串比较即可跳过没有变化的行。
 */
const TimeGridRow = memo(function TimeGridRow({
  rowIndex,
  wrapperId,
  cellKeys,
  selectedMask,
  hintedMask,
  heatmapData,
  heatmapCountData,
  rowDivider,
  readonlyMode,
  selectedTone
}: GridRowProps) {
  return (
    <View className={`time-grid-row ${rowDivider ? 'divider-after' : ''}`}>
      {cellKeys.map((key, col) => {
        const isSelected = selectedMask[col] === '1';
        const isHinted = hintedMask[col] === '1';

        let cellStyle: any = {};
        if (heatmapData && key && heatmapData[key] !== undefined) {
          const ratio = heatmapData[key];
          if (ratio > 0) {
            cellStyle = { backgroundColor: `rgba(7, 193, 96, ${Math.max(0.1, ratio)})` };
          } else {
            cellStyle = { backgroundColor: '#f9f9f9' };
          }
        }

        if (isHinted && !isSelected) {
          cellStyle = {
            ...cellStyle,
            backgroundColor: 'rgba(255, 77, 79, 0.12)',
            borderRightColor: 'rgba(255, 77, 79, 0.18)',
            borderBottomColor: 'rgba(255, 77, 79, 0.18)'
          };
        }

        if (isSelected && !readonlyMode) {
          const isRed = selectedTone === 'red';
          cellStyle = {
            ...cellStyle,
            backgroundColor: isRed ? 'rgba(255, 77, 79, 0.28)' : 'rgba(7, 193, 96, 0.25)',
            borderRightColor: isRed ? 'rgba(255, 77, 79, 0.25)' : 'rgba(7, 193, 96, 0.2)',
            borderBottomColor: isRed ? 'rgba(255, 77, 79, 0.25)' : 'rgba(7, 193, 96, 0.2)',
            boxShadow: isRed ? 'inset 0 0 0 2px rgba(255, 77, 79, 0.85)' : 'inset 0 0 0 2px rgba(7, 193, 96, 0.8)'
          };
        }

        const count = (heatmapCountData && key) ? heatmapCountData[key] : undefined;

        return (
          <View
            id={`${wrapperId}-cell-${rowIndex}-${col}`}
            key={col}
            className={`time-grid-cell ${isSelected && !readonlyMode ? `selected selected--${selectedTone}` : ''} ${isHinted ? 'hinted' : ''} ${count !== undefined && count > 0 ? 'has-count' : ''}`}
            style={cellStyle}
          >
            {count !== undefined && count > 0 && (
              <Text className="heatmap-count-text">{count}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
});

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
    heatmapCountData,
    selectedTone = 'green',
    hintedKeys,
    showHeaderDate = true,
    scrollTopRef
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

  const gridMetricsRef = useRef({ left: 0, top: 0, cellW: 0, cellH: 0, scrollTop: 0 });

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


  const edgeTimerRef = useRef<any>(null);
  const fingerYRef = useRef(0);
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
      // 同一次查询里取页面滚动位置，保证 rect 与 scrollTop 是同一时刻的
      query.selectViewport().scrollOffset();

      query.exec((res) => {
        const [c00, c01, c10, wrap, viewport] = res;
        if (c00) {
          let cellW = c00.width;
          let cellH = c00.height;
          if (c01) cellW = c01.left - c00.left;
          else if (wrap) cellW = wrap.width / gridSize.cols;

          if (c10) cellH = c10.top - c00.top;
          else if (wrap) cellH = wrap.height / gridSize.rows;

          gridMetricsRef.current = {
            left: c00.left,
            top: c00.top,
            cellW,
            cellH,
            scrollTop: viewport?.scrollTop || 0
          };
        }
        resolve();
      });
    });
  }, [gridSize, wrapperId]);

  const pointToCell = useCallback((clientX: number, clientY: number) => {
    const { left, top, cellW, cellH, scrollTop } = gridMetricsRef.current;
    if (!cellW || !cellH) return null;

    // 页面滚动后表格整体上移，按滚动差值把测量时的 top 换算到当前位置
    const currentScrollTop = scrollTopRef?.current ?? scrollTop;
    const correctedTop = top - (currentScrollTop - scrollTop);

    const col = Math.floor((clientX - left) / cellW);
    const row = Math.floor((clientY - correctedTop) / cellH);

    return {
      row: clamp(row, 0, gridSize.rows - 1),
      col: clamp(col, 0, gridSize.cols - 1)
    };
  }, [gridSize, scrollTopRef]);

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

  const stopEdgeScroll = useCallback(() => {
    if (edgeTimerRef.current) {
      clearInterval(edgeTimerRef.current);
      edgeTimerRef.current = null;
    }
  }, []);

  // 组件卸载时确保定时器被清掉
  useEffect(() => () => stopEdgeScroll(), [stopEdgeScroll]);

  const startEdgeScroll = useCallback(() => {
    if (edgeTimerRef.current) return;

    let windowHeight = 0;
    try { windowHeight = Taro.getSystemInfoSync().windowHeight || 0; } catch { windowHeight = 0; }
    if (!windowHeight) return;

    edgeTimerRef.current = setInterval(() => {
      const y = fingerYRef.current;
      let delta = 0;

      if (y < EDGE_ZONE) {
        // 贴近顶部：内容下移，露出上方格子
        delta = -(1 - y / EDGE_ZONE) * EDGE_STEP_PX;
      } else if (y > windowHeight - EDGE_ZONE) {
        // 贴近底部：内容上移，露出下方格子
        delta = (1 - (windowHeight - y) / EDGE_ZONE) * EDGE_STEP_PX;
      }

      if (Math.abs(delta) < 1) return;
      const next = Math.max(0, (scrollTopRef?.current ?? 0) + delta);
      Taro.pageScrollTo({ scrollTop: next, duration: 0 });
    }, EDGE_TICK_MS);
  }, [scrollTopRef]);

  const enterDragMode = useCallback((startPos: { row: number; col: number }, showHint: boolean) => {
    if (draggingRef.current) return;

    draggingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = startPos;
    lastPosRef.current = startPos;

    const key = cellKeyByPos[startPos.row]?.[startPos.col];
    dragModeRef.current = (key && baseSelectedRef.current.has(key)) ? 'erase' : 'select';

    if (showHint && !forceDragMode) {
      Taro.showToast({ title: '别松手，滑动即可多选', icon: 'none', duration: 1500 });
    }
    startEdgeScroll();
    applyRect(startPos, startPos);
  }, [applyRect, cellKeyByPos, forceDragMode, startEdgeScroll]);

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
    fingerYRef.current = t.clientY;
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
    fingerYRef.current = t.clientY;
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
      stopEdgeScroll();
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
  }, [commitSelection, enabled, handleSingleClick, readonlyMode, measureGrid, pointToCell, stopEdgeScroll]);

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
                  {showHeaderDate ? <View className="time-grid-header-date">{monthDay}</View> : null}
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
            {Array.from({ length: gridSize.rows }).map((_, r) => {
              const cellKeys = cellKeyByPos[r] || [];
              const selectedMask = cellKeys.map(k => (k && renderSelected.has(k) ? '1' : '0')).join('');
              const hintedMask = cellKeys.map(k => (k && hintedKeys?.has(k) ? '1' : '0')).join('');

              return (
                <TimeGridRow
                  key={r}
                  rowIndex={r}
                  wrapperId={wrapperId}
                  cellKeys={cellKeys}
                  selectedMask={selectedMask}
                  hintedMask={hintedMask}
                  heatmapData={heatmapData}
                  heatmapCountData={heatmapCountData}
                  rowDivider={dividerAfterRows.has(r)}
                  readonlyMode={!!readonlyMode}
                  selectedTone={selectedTone}
                />
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
