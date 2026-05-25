import Taro from '@tarojs/taro';
import { Event, User } from '@/types';

export const isProxyRoute = (options: any): boolean => {
  const { isProxy, proxy } = options || {};
  return isProxy === '1' || isProxy === 'true' || proxy === '1' || proxy === 'true';
};

export const getSubmitNickName = (params: {
  isProxyMode: boolean;
  nickname: string;
  currentUser?: User | null;
}): string => {
  if (params.isProxyMode) return params.nickname.trim();
  return (params.currentUser?.nickName || Taro.getStorageSync('userNickName') || '').trim();
};

export const findParticipantForSelection = (
  event: Event,
  params: { isProxyMode: boolean; nickname: string; currentUser?: User | null }
) => {
  if (params.isProxyMode) {
    return event.participants.find((p) => p.nickName === params.nickname);
  }

  return event.participants.find((p) => (
    p.openid === params.currentUser?.openid || p.nickName === params.nickname
  ));
};
