import { useState, useCallback } from 'react';
import Taro from '@tarojs/taro';

interface UseCloudFunctionOptions {
  showLoading?: boolean;
  showError?: boolean;
  successMsg?: string;
  errorMsg?: string;
}

export function useCloudFunction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callFunction = useCallback(async (
    name: string,
    data: any = {},
    options: UseCloudFunctionOptions = {}
  ) => {
    const {
      showLoading = true,
      showError = true,
      errorMsg
    } = options;

    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    // 云函数链路已不再使用（项目已迁移到自建 HTTP API）
    const errMsg = `云函数链路已移除：${name}`;

    if (showError) {
      Taro.showToast({ title: errorMsg || errMsg, icon: 'none' });
    }

    setError(errMsg);

    if (showLoading) {
      setLoading(false);
    }

    return { success: false, data: null, error: errMsg };
  }, []);

  return { callFunction, loading, error };
}

// 防抖 hooks
export function useDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
) {
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null);

  const debouncedFn = useCallback((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    const newTimer = setTimeout(() => fn(...args), delay);
    setTimer(newTimer);
  }, [fn, delay, timer]);

  return debouncedFn;
}

// 本地存储 hooks
export function useStorage<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const item = Taro.getStorageSync(key);
      return item !== undefined ? item : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setStoredValue = useCallback((newValue: T | ((val: T) => T)) => {
    try {
      const valueToStore = newValue instanceof Function ? newValue(value) : newValue;
      setValue(valueToStore);
      Taro.setStorageSync(key, valueToStore);
    } catch (error) {
      console.error('Storage error:', error);
    }
  }, [key, value]);

  const removeStoredValue = useCallback(() => {
    try {
      Taro.removeStorageSync(key);
      setValue(defaultValue);
    } catch (error) {
      console.error('Storage remove error:', error);
    }
  }, [key, defaultValue]);

  return [value, setStoredValue, removeStoredValue] as const;
}
