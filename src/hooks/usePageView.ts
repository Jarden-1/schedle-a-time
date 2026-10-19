import { useRef } from 'react';
import { useDidShow, useDidHide } from '@tarojs/taro';
import { trackPageView, trackPageLeave } from '@/services/telemetry';

/**
 * 页面浏览埋点：进入页面记 page_view，离开记 page_leave（带停留时长）。
 *
 * 用法：在页面组件顶层调用 usePageView('event_select')。
 */
export const usePageView = (page: string) => {
  const enterAtRef = useRef(0);

  useDidShow(() => {
    enterAtRef.current = Date.now();
    trackPageView(page);
  });

  useDidHide(() => {
    if (!enterAtRef.current) return;
    const duration = Date.now() - enterAtRef.current;
    enterAtRef.current = 0;
    trackPageLeave(page, duration);
  });
};
