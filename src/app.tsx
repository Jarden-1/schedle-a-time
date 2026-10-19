import React, { useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import { initTelemetry, trackError } from '@/services/telemetry';
import { installGlobalHandlers } from '@/services/globalHandlers';
import './app.scss';

interface AppProps {
  children: React.ReactNode;
}

// 模块加载时就注册，保证首屏渲染崩溃（白屏）也能被捕获并弹出来
installGlobalHandlers();

interface BoundaryState {
  error: Error | null;
}

/**
 * 全局错误边界。
 *
 * 以前页面渲染抛错时小程序直接白屏，什么都看不到。现在把错误信息显示在
 * 屏幕上（同时上报到埋点），既能自测定位，也避免用户面对一片空白。
 */
class AppErrorBoundary extends React.Component<AppProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    trackError(error, {
      meta: {
        boundary: 'app',
        componentStack: String(info?.componentStack || '').slice(0, 300)
      }
    });
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <View className="app-error-panel">
          <Text className="app-error-title">页面出错了</Text>
          <Text className="app-error-message">{String(error.message || error)}</Text>
          <Text className="app-error-tip">把这段信息发给开发者即可定位问题</Text>
        </View>
      );
    }
    return this.props.children as any;
  }
}

function App({ children }: AppProps) {
  useEffect(() => {
    // 全局错误捕获 + 会话初始化，只执行一次
    initTelemetry();
  }, []);

  return <AppErrorBoundary>{children}</AppErrorBoundary>;
}

export default App;
