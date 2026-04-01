import { getSystemInfoSync } from '@tarojs/taro';
import { View } from '@tarojs/components';
import { ReactNode, useEffect, useRef, useState } from 'react';
import './index.scss';

type SwipeActionItem = {
  text: string;
  type: 'warn' | 'danger';
  onClick: () => void;
};

type SwipeActionChange = {
  open: boolean;
  x: number;
};

type Props = {
  open: boolean;
  x: number;
  actionWidth: number;
  actions: SwipeActionItem[];
  onOpenChange: (next: SwipeActionChange) => void;
  onTouchStart?: () => void;
  children: ReactNode;
};

export default function SwipeAction(props: Props) {
  const { actionWidth, actions, children, open, x, onOpenChange, onTouchStart } = props;
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const isHorizontalRef = useRef<boolean | null>(null);

  const dprRef = useRef(1);
  useEffect(() => {
    // getSystemInfoSync 在各端（H5/小程序/ReactNative）都有实现
    const info = getSystemInfoSync?.();
    dprRef.current = info?.pixelRatio || 1;
  }, []);

  const alignToDevicePixel = (x: number) => {
    const dpr = dprRef.current || 1;
    // 对齐到“物理像素栅格”，避免右侧边缘出现 0.5px 等亚像素导致的底色漏出
    return Math.round(x * dpr) / dpr;
  };

  // 同步外部状态
  useEffect(() => {
    const targetX = open ? -actionWidth : x;
    setTranslateX(targetX);
    currentXRef.current = targetX;
  }, [open, actionWidth, x]);

  const handleTouchStart = (e: any) => {
    onTouchStart?.();
    const t = e.touches[0];
    startXRef.current = t.clientX;
    startYRef.current = t.clientY;
    isHorizontalRef.current = null; // 每次触摸重置滑动方向判定
    setIsDragging(true);
  };

  const handleTouchMove = (e: any) => {
    const t = e.touches[0];
    const dx = t.clientX - startXRef.current;
    const dy = t.clientY - startYRef.current;

    // 锁定滚动轴：如果是上下滑动，不触发左滑
    if (isHorizontalRef.current === null) {
      isHorizontalRef.current = Math.abs(dx) > Math.abs(dy);
    }
    if (!isHorizontalRef.current) return;

    let nextX = currentXRef.current + dx;

    // 🚀 核心物理算法：橡皮筋阻尼效果
    if (nextX > 0) {
      nextX = nextX * 0.15; // 往右拉到底时的强阻尼
    } else if (nextX < -actionWidth) {
      nextX = -actionWidth + (nextX + actionWidth) * 0.15; // 往左拉过头时的强阻尼
    }

    setTranslateX(nextX);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (isHorizontalRef.current === false) return; // 如果是上下滑动则无视

    // 判定是否跨过了一半的阈值
    const threshold = -actionWidth / 2;
    const shouldOpen = translateX < threshold;
    const finalX = shouldOpen ? -actionWidth : 0;

    setTranslateX(finalX);
    currentXRef.current = finalX;
    onOpenChange({ open: shouldOpen, x: finalX });
  };

  return (
    <View className="swipe-action-container">
      {/* 底层：操作按钮区域 */}
      <View
        className={`swipe-action-bg ${!open && Math.abs(translateX) === 0 ? 'is-closed' : ''}`}
        style={{ width: actionWidth }}
      >
        {actions.map((a) => (
          <View
            key={a.text}
            className={`swipe-action-btn swipe-action-btn--${a.type}`}
            onClick={(e) => {
              e.stopPropagation();
              a.onClick();
            }}
          >
            {a.text}
          </View>
        ))}
      </View>

      {/* 表层：真正的卡片内容 */}
      <View
        className={`swipe-action-fg ${translateX < 0 ? 'is-swiping' : ''}`}
        style={{
          // GPU 硬件加速
          transform: `translate3d(${alignToDevicePixel(translateX)}px, 0, 0)`,
          // 🚀 核心动画：拖拽时无延迟，松手时使用舒适的回弹曲线
          transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.1)'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {children}
      </View>
    </View>
  );
}
