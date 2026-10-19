import Taro from '@tarojs/taro';
import { requestRawAPI } from '@/services/api';
import { normalizeUser } from '@/utils/user';

/**
 * 调试身份切换。
 *
 * 目的：不用清缓存、不用换微信号，就能以「全新用户」或「另一个参与者」的身份
 * 打开小程序，验证首次使用流程。
 *
 * 安全：小程序端只是入口，真正的开关在服务端 ENABLE_DEBUG_IDENTITY。
 * 服务端没开时，这里会登录失败，不会产生任何越权。
 */

const FLAG_KEY = '__debug_identity_enabled';
const SNAPSHOT_KEY = '__debug_original_identity';

const LOCAL_KEYS = [
  'token',
  'currentUser',
  'userNickName',
  'events',
  'weeklyUnavailableSlots',
  'autoApplyWeeklyUnavailable',
  'latestAnnouncement',
  'lastReadAnnouncementId',
  'lastSeenProfileTabAnnouncementId',
  'guide_swipe_seen',
  'guide_time_grid_seen',
  'guide_decision_seen',
  'guide_vip_seen',
  'guide_preset_unavailable_seen',
  'indexActiveTab',
  'telemetryFirstSeenAt'
];

export const isDebugPanelEnabled = (): boolean => {
  try {
    return Taro.getStorageSync(FLAG_KEY) === '1';
  } catch {
    return false;
  }
};

export const setDebugPanelEnabled = (enabled: boolean) => {
  try {
    if (enabled) Taro.setStorageSync(FLAG_KEY, '1');
    else Taro.removeStorageSync(FLAG_KEY);
  } catch {
    /* ignore */
  }
};

const clearLocalState = () => {
  LOCAL_KEYS.forEach((key) => {
    try { Taro.removeStorageSync(key); } catch { /* ignore */ }
  });
};

const saveSnapshotIfNeeded = () => {
  try {
    const existing = Taro.getStorageSync(SNAPSHOT_KEY);
    if (existing && existing.token) return;
    const token = Taro.getStorageSync('token');
    if (!token) return;
    Taro.setStorageSync(SNAPSHOT_KEY, {
      token,
      user: Taro.getStorageSync('currentUser') || null,
      nickName: Taro.getStorageSync('userNickName') || ''
    });
  } catch {
    /* ignore */
  }
};

const relaunch = () => {
  Taro.reLaunch({ url: '/pages/index/index' });
};

/** 切换到任意 openid（传空则随机生成一个全新用户） */
export const switchToDebugIdentity = async (openid?: string) => {
  const target = (openid && openid.trim()) || `debug_${Date.now().toString(36)}`;
  saveSnapshotIfNeeded();

  const result = await requestRawAPI('/login', 'POST', { code: `__debug__:${target}` });
  if (!result?.success || !result?.data?.token) {
    throw new Error(result?.error || '调试登录失败，请确认服务端已开启 ENABLE_DEBUG_IDENTITY');
  }

  clearLocalState();
  Taro.setStorageSync('token', result.data.token);
  Taro.setStorageSync('currentUser', normalizeUser({
    id: result.data.openid,
    openid: result.data.openid,
    nickName: '',
    avatarUrl: ''
  }));
  Taro.setStorageSync(FLAG_KEY, '1');
  relaunch();
};

/** 回到自己的真实身份（快照优先，没有就用 wx.login 重新登录） */
export const switchToSelf = async () => {
  const snapshot = (() => {
    try { return Taro.getStorageSync(SNAPSHOT_KEY); } catch { return null; }
  })();

  if (snapshot?.token) {
    clearLocalState();
    Taro.setStorageSync('token', snapshot.token);
    if (snapshot.user) Taro.setStorageSync('currentUser', snapshot.user);
    if (snapshot.nickName) Taro.setStorageSync('userNickName', snapshot.nickName);
    Taro.setStorageSync(FLAG_KEY, '1');
    relaunch();
    return;
  }

  const { code } = await Taro.login();
  if (!code) throw new Error('获取微信登录凭证失败');
  const result = await requestRawAPI('/login', 'POST', { code });
  if (!result?.success || !result?.data?.token) {
    throw new Error(result?.error || '登录失败');
  }
  clearLocalState();
  Taro.setStorageSync('token', result.data.token);
  Taro.setStorageSync('currentUser', normalizeUser({
    id: result.data.openid,
    openid: result.data.openid,
    nickName: '',
    avatarUrl: ''
  }));
  Taro.setStorageSync(FLAG_KEY, '1');
  relaunch();
};
