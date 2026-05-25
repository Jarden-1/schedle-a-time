import { User } from '@/types';

export const normalizeUser = (user: any): User | null => {
  if (!user) return null;
  const avatarUrl = user?.avatarUrl || '';
  const avatarFileId = user?.avatarFileId || '';

  const finalAvatarUrl =
    typeof avatarUrl === 'string' && avatarUrl.trim() !== ''
      ? avatarUrl
      : typeof avatarFileId === 'string' && avatarFileId.trim() !== ''
        ? avatarFileId
        : '';

  return {
    ...user,
    avatarUrl: finalAvatarUrl,
    avatarFileId: avatarFileId || finalAvatarUrl
  } as User;
};

export const hasCompleteUserProfile = (user?: User | null, fallbackNickName = ''): boolean => {
  const nickName = user?.nickName || fallbackNickName;
  return !!(user?.openid && nickName.trim() && user?.avatarUrl);
};

export const buildUserProfile = (
  openid: string,
  nickName: string,
  avatarUrl: string
): User => ({
  id: openid,
  openid,
  nickName,
  avatarUrl,
  avatarFileId: avatarUrl
});
