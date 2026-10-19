import Taro from '@tarojs/taro';
import { User } from '@/types';
import { normalizeUser } from '@/utils/user';
import { trackError } from '@/services/telemetry';

import { BASE_URL, UPLOAD_URL } from '@/constants/env';

export { BASE_URL, UPLOAD_URL };

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

let authRefreshPromise: Promise<User | null> | null = null;

export const requestRawAPI = async (endpoint: string, method: ApiMethod = 'GET', data: any = {}) => {
  const token = Taro.getStorageSync('token') || '';
  const res = await Taro.request({
    url: `${BASE_URL}${endpoint}`,
    method,
    data,
    header: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const errorMsg = (res.data as any)?.error || `请求失败 (${res.statusCode})`;
    const apiError = new Error(errorMsg);
    (apiError as any).statusCode = res.statusCode;
    throw apiError;
  }
  return res.data;
};

const refreshAuthSession = async (): Promise<User | null> => {
  if (process.env.TARO_ENV !== 'weapp') return null;

  if (!authRefreshPromise) {
    authRefreshPromise = (async () => {
      const { code } = await Taro.login();
      if (!code) throw new Error('获取微信登录凭证失败');

      const result = await requestRawAPI('/login', 'POST', { code });
      if (!result?.success || !result?.data?.openid || !result?.data?.token) {
        throw new Error('登录态刷新失败');
      }

      const { openid, token } = result.data;
      Taro.setStorageSync('token', token);

      const existingUser = Taro.getStorageSync('currentUser') || {};
      const user = normalizeUser({
        ...existingUser,
        id: openid,
        openid
      });
      if (user) Taro.setStorageSync('currentUser', user);
      return user;
    })().finally(() => {
      authRefreshPromise = null;
    });
  }

  return authRefreshPromise;
};

export const requestAPI = async (endpoint: string, method: ApiMethod = 'GET', data: any = {}) => {
  try {
    return await requestRawAPI(endpoint, method, data);
  } catch (error: any) {
    if (error?.statusCode === 401 && endpoint !== '/login') {
      Taro.removeStorageSync('token');
      try {
        const refreshedUser = await refreshAuthSession();
        if (refreshedUser?.openid && Taro.getStorageSync('token')) {
          return await requestRawAPI(endpoint, method, data);
        }
      } catch (refreshError) {
        console.error('Refresh auth session error:', refreshError);
      }
    }

    console.error(`Request ${endpoint} error:`, error);
    // 接口失败（5xx / 网络 / 非 401）上报，401 属于正常登录态过期不记为错误
    if (error?.statusCode !== 401) {
      trackError(error, { path: endpoint, meta: { method, status: error?.statusCode } });
    }
    throw error;
  }
};
