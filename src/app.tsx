import { useEffect } from 'react';
import { initTelemetry } from '@/services/telemetry';
import './app.scss';

interface AppProps {
  children: React.ReactNode;
}

function App({ children }: AppProps) {
  useEffect(() => {
    // 全局错误捕获 + 会话初始化，只执行一次
    initTelemetry();
  }, []);

  return children;
}

export default App;
