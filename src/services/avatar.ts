import Taro from '@tarojs/taro';
import { UPLOAD_URL } from './api';

export interface UploadedAvatar {
  fileId: string;
  previewUrl: string;
}

export const uploadAvatarToServer = async (
  tempPath: string,
  ensureToken: () => Promise<void>
): Promise<UploadedAvatar> => {
  await ensureToken();

  let filePath = tempPath;
  try {
    const compressRes = await Taro.compressImage({ src: tempPath, quality: 30 });
    if (compressRes?.tempFilePath) {
      filePath = compressRes.tempFilePath;
    }
  } catch {
    filePath = tempPath;
  }

  const uploadRes = await Taro.uploadFile({
    url: UPLOAD_URL,
    filePath,
    name: 'file',
    header: {
      Authorization: `Bearer ${Taro.getStorageSync('token') || ''}`
    }
  });

  const data = JSON.parse((uploadRes as any).data || '{}');
  if (!data?.success || !data?.url) {
    throw new Error(data?.error || '头像上传失败');
  }

  return { fileId: String(data.url), previewUrl: String(data.url) };
};
