import Taro from '@tarojs/taro';
import { BASE_URL } from '@/constants/env';
import { APP_VERSION, TRACK } from '@/constants/app';

type PropValue = string | number | boolean | null | undefined;
type TrackProps = Record<string, PropValue>;
type ErrorContext = {
  page?: string;
  path?: string;
  level?: 'error' | 'warn';
  meta?: TrackProps;
};

const MAX_EVENTS = 10;
const FLUSH_INTERVAL = 5000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const STORAGE_FIRST_SEEN = 'telemetryFirstSeenAt';

let eventQueue: any[] = [];
let errorQueue: any[] = [];
let flushTimer: any = null;
let flushing = false;
let currentPage = '';
let sessionId = '';
let lastActiveAt = 0;

const now = () => Date.now();

const createSessionId = () => `s_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const ensureSession = () => {
  if (!sessionId || now() - lastActiveAt > SESSION_IDLE_MS) {
    sessionId = createSessionId();
    // 每个新会话记一次，用于算会话数/人均会话
    const firstSeen = safeGet(STORAGE_FIRST_SEEN);
    if (!firstSeen) safeSet(STORAGE_FIRST_SEEN, now());
    pushEvent(TRACK.APP_LAUNCH, { firstSeen: firstSeen || now() }, true);
  }
  lastActiveAt = now();
  return sessionId;
};

function safeGet(key: string) {
  try { return Taro.getStorageSync(key) || ''; } catch { return ''; }
}

function safeSet(key: string, value: any) {
  try { Taro.setStorageSync(key, value); } catch { /* ignore */ }
}

const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL);
};

function pushEvent(event: string, props?: TrackProps, skipSession = false) {
  try {
    if (!skipSession) ensureSession();
    eventQueue.push({
      ts: now(),
      event,
      page: currentPage,
      sessionId,
      version: APP_VERSION,
      props: props || {}
    });
    if (eventQueue.length >= MAX_EVENTS) {
      flush();
    } else {
      scheduleFlush();
    }
  } catch {
    /* 埋点永不抛错 */
  }
}

export const flush = () => {
  if (flushing) return;
  if (eventQueue.length === 0 && errorQueue.length === 0) return;

  const events = eventQueue.splice(0, eventQueue.length);
  const errors = errorQueue.splice(0, errorQueue.length);
  flushing = true;

  Taro.request({
    url: `${BASE_URL}/telemetry`,
    method: 'POST',
    timeout: 8000,
    header: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeGet('token')}`
    },
    data: { events, errors }
  })
    .catch(() => { /* 上报失败静默丢弃，不打扰用户 */ })
    .finally(() => { flushing = false; });
};

/** 通用事件上报 */
export const track = (event: string, props?: TrackProps) => pushEvent(event, props);

/** 页面浏览：进入页面时调用 */
export const trackPageView = (page: string) => {
  currentPage = page;
  pushEvent(TRACK.PAGE_VIEW, { page });
};

/** 页面离开：带上停留时长（毫秒） */
export const trackPageLeave = (page: string, durationMs: number) => {
  pushEvent(TRACK.PAGE_LEAVE, { page, duration: Math.max(0, Math.round(durationMs)) });
};

/** 错误上报 */
export const trackError = (error: any, context: ErrorContext = {}) => {
  try {
    const message = error instanceof Error
      ? error.message
      : (typeof error === 'string' ? error : (error?.errMsg || JSON.stringify(error)));
    errorQueue.push({
      level: context.level || 'error',
      message: String(message || 'unknown').slice(0, 500),
      stack: error instanceof Error ? (error.stack || '').slice(0, 2000) : '',
      page: context.page || currentPage,
      path: context.path || '',
      version: APP_VERSION,
      meta: context.meta || {}
    });
    if (errorQueue.length >= 3) flush();
    else scheduleFlush();
  } catch {
    /* ignore */
  }
};

/** 在 app 启动时调用一次 */
export const initTelemetry = () => {
  try {
    // 全局错误
    (Taro as any).onError?.((res: any) => {
      trackError(res?.message || 'app_error', { meta: { stack: res?.stack } });
    });
    (Taro as any).onUnhandledRejection?.((res: any) => {
      trackError(res?.reason, { meta: { type: 'unhandledRejection' } });
    });
    (Taro as any).onAppHide?.(() => { flush(); });
  } catch {
    /* ignore */
  }
  ensureSession();
};
