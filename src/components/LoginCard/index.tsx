import { useState, useCallback } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button, Image, Input } from '@tarojs/components';
import { useAppStore } from '@/store';

import './index.scss';

interface Props {
  initialNickName?: string;
  initialAvatarUrl?: string;
  title?: string;
  submitText?: string;
  showTitle?: boolean;
  showTips?: boolean;
  onSuccess: (user: any) => void;
  onCancel?: () => void;
}

export default function LoginCard({
  initialNickName = '',
  initialAvatarUrl = '',
  title = '完善资料并登录',
  submitText = '保存并登录',
  showTitle = true,
  showTips = true,
  onSuccess,
  onCancel
}: Props) {
  const { loginWithWeChat, updateUserProfileAPI, UPLOAD_URL } = useAppStore();

  const [nickName, setNickName] = useState(initialNickName);
  const [avatarFileId, setAvatarFileId] = useState<string>('');
  const [avatarPreview, setAvatarPreview] = useState<string>(initialAvatarUrl);
  const [saving, setSaving] = useState(false);

  const handleChooseAvatar = useCallback(
    async (e: any) => {
      // chooseAvatar 返回头像临时路径：e.detail.avatarUrl
      const tempPath = e?.detail?.avatarUrl;
      if (!tempPath) return;

      setAvatarPreview(tempPath);

      try {
        setSaving(true);

        // 尽量复用“自建服务器上传”链路（与 profile/create 保持一致）
        let filePath = tempPath;
        try {
          const compressRes = await Taro.compressImage({ src: tempPath, quality: 30 });
          if (compressRes?.tempFilePath) {
            filePath = compressRes.tempFilePath;
          }
        } catch {
          // 非 weapp 或压缩失败时直接用原图
        }

        const uploadRes = await Taro.uploadFile({
          url: UPLOAD_URL,
          filePath,
          name: 'file'
        });

        const data = JSON.parse((uploadRes as any).data || '{}');
        if (!data?.success || !data?.url) {
          throw new Error(data?.error || '上传失败');
        }

        const url = String(data.url);
        setAvatarFileId(url);
        setAvatarPreview(url);
      } catch (err: any) {
        Taro.showToast({ title: err.message || '头像处理失败', icon: 'none' });
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!nickName.trim()) {
      Taro.showToast({ title: '请先获取/填写昵称', icon: 'none' });
      return;
    }
    if (!avatarFileId) {
      Taro.showToast({ title: '请先选择头像', icon: 'none' });
      return;
    }

    setSaving(true);
    try {
      const userRes = await loginWithWeChat();
      if (!userRes?.openid) {
        throw new Error('登录失败');
      }

      const ok = await updateUserProfileAPI(nickName.trim(), avatarFileId);
      if (!ok) {
        throw new Error('保存失败');
      }

      onSuccess({
        id: userRes.openid,
        openid: userRes.openid,
        nickName: nickName.trim(),
        avatarUrl: avatarFileId,
        avatarFileId
      });
    } catch (err: any) {
      Taro.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      setSaving(false);
    }
  }, [avatarFileId, loginWithWeChat, nickName, onSuccess, updateUserProfileAPI]);
  return (
    <View className={`login-card ${showTitle ? '' : 'login-card--no-title'} ${showTips ? '' : 'login-card--no-tips'}`}>
      {showTitle && (
        <View className="login-title">
          <Text>{title}</Text>
        </View>
      )}

      <View className="form-item">
        <Text className="label">头像</Text>
        <View className="avatar-row">
          <View className="avatar-preview">
            {avatarPreview ? (
              <Image className="avatar-img" src={avatarPreview} mode="aspectFill" />
            ) : (
              <Text className="avatar-placeholder">未选择</Text>
            )}
          </View>
          <Button
            className="btn"
            openType="chooseAvatar"
            onChooseAvatar={handleChooseAvatar as any}
            disabled={saving}
          >
            选择头像
          </Button>
        </View>
      </View>

      <View className="form-item">
        <Text className="label">昵称</Text>
        <Input
          className="nickname-input"
          type="nickname"
          placeholder="点击输入框一键获取微信昵称"
          value={nickName}
          onInput={(e: any) => setNickName(e.detail.value)}
        />
      </View>

      <View className="actions">
        {onCancel && (
          <Button className="btn-secondary" onClick={onCancel} disabled={saving}>
            取消
          </Button>
        )}
        <Button className="btn-primary" onClick={handleSave} loading={saving} disabled={saving}>
          {submitText}
        </Button>
      </View>

      {showTips && (
        <View className="tips">
          <Text>根据微信规范：头像通过“选择头像”按钮获取，昵称通过昵称输入框获取。</Text>
        </View>
      )}
    </View>
  );
}
