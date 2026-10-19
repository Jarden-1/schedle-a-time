import Taro from '@tarojs/taro';
import { trackError } from '@/services/telemetry';

/**
 * 全局错误处理器。
 *
 * 在 app 模块加载时（React 渲染之前）就注册，这样连首屏渲染崩溃、
 * 白屏这种场景也能把错误弹出来，而不是只剩一片空白。
 */
let installed = false;

const showFatal = (title: string, message: string) => {
  try {
    Taro.showModal({
      title,
      content: String(message || 'unknown').slice(0, 400),
      showCancel: false,
      confirmText: '知道了'
    });
  } catch {
    /* 弹窗失败就只上报 */
  }
};

export const installGlobalHandlers = () => {
  if (installed) return;
  installed = true;

  try {
    Taro.onError((res: any) => {
      const message = String(res?.message || res?.errMsg || 'unknown error');
      trackError(message, { meta: { stack: String(res?.stack || '').slice(0, 500) } });
      showFatal('JS 运行错误', message);
    });
  } catch {
    /* ignore */
  }

  try {
    Taro.onUnhandledRejection((res: any) => {
      const reason = res?.reason;
      const message = reason instanceof Error ? reason.message : String(reason || 'unhandled rejection');
      trackError(reason, { meta: { type: 'unhandledRejection' } });
      showFatal('未处理的 Promise 错误', message);
    });
  } catch {
    /* ignore */
  }
};
