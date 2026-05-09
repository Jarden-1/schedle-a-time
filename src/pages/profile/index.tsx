import Taro, { useDidShow } from '@tarojs/taro';
import { View, Text, Button, Image, Input } from '@tarojs/components';
import { useState, useMemo, useCallback, useRef } from 'react';
import { useAppStore } from '@/store';
import './index.scss';

export default function Profile() {
  // 🚨 1. 提取我们刚在 store 写的绝杀武器 updateUserProfileAPI
  const { userNickName, setUserNickName, events, currentUser, setCurrentUser, setTabIndex, loginWithWeChat, fetchEvents, updateUserProfileAPI, UPLOAD_URL } = useAppStore();

  useDidShow(() => {
    setTabIndex(1);
    // 🚨 核心修复：每次切到“我的”页面，强制从全局拉取最新数据，解决删除了数字不掉的 Bug！
    fetchEvents();
  });

  const [showNicknameModal, setShowNicknameModal] = useState(false);

  const [avatarPreview, setAvatarPreview] = useState('');
  const [avatarFileId, setAvatarFileId] = useState('');
  const [nickNameDraft, setNickNameDraft] = useState('');

  const [saving, setSaving] = useState(false);
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const avatarUploadPromiseRef = useRef<Promise<{ fileId: string; previewUrl: string }> | null>(null);

  const isProfileIncomplete = useMemo(() => {
    const nickOk = !!(userNickName || currentUser?.nickName);
    const avatarOk = !!currentUser?.avatarUrl;
    return !(nickOk && avatarOk);
  }, [currentUser?.avatarUrl, currentUser?.nickName, userNickName]);

  const uploadAvatarToCloud = useCallback(
    async (tempPath: string) => {
      if (!Taro.getStorageSync('token')) {
        const userRes = await loginWithWeChat();
        if (!userRes?.openid) throw new Error('登录失败');
      }

      // 🚨 第 1 道防线：Taro 原生压缩图片，极大降低服务器压力
      const compressRes = await Taro.compressImage({
        src: tempPath,
        quality: 30
      });
      const compressedPath = compressRes.tempFilePath;

      // 🚨 第 2 道防线：发往本地/自建 Node.js 服务器
      const uploadRes = await Taro.uploadFile({
        url: UPLOAD_URL, // 与 BASE_URL 同源的上传地址
        filePath: compressedPath,
        name: 'file',
        header: {
          Authorization: `Bearer ${Taro.getStorageSync('token') || ''}`
        }
      });

      const data = JSON.parse(uploadRes.data);
      if (!data.success || !data.url) throw new Error('上传服务器失败');

      return { fileId: data.url, previewUrl: data.url };
    },
    [loginWithWeChat, UPLOAD_URL]
  );

  const resetPendingProfile = useCallback(() => {
    setAvatarPreview('');
    setAvatarFileId('');
    setNickNameDraft('');
    avatarUploadPromiseRef.current = null;
    setUploadingAvatar(false);
    setChoosingAvatar(false);
  }, []);

  const handleChooseAvatar = useCallback(
    async (e: any) => {
      if (choosingAvatar || saving) return;

      const tempPath = e?.detail?.avatarUrl;
      if (!tempPath) return;

      // 先用临时路径做预览反馈
      setAvatarPreview(tempPath);
      setAvatarFileId('');
      setShowNicknameModal(true);

      setChoosingAvatar(true);
      setUploadingAvatar(true);

      const p = uploadAvatarToCloud(tempPath);
      avatarUploadPromiseRef.current = p;

      try {
        const { fileId, previewUrl } = await p;
        setAvatarFileId(fileId);
        setAvatarPreview(previewUrl);
      } catch (err: any) {
        setShowNicknameModal(false);
        resetPendingProfile();
        Taro.showToast({ title: err?.message || '头像处理失败', icon: 'none' });
      } finally {
        setUploadingAvatar(false);
        setChoosingAvatar(false);
      }
    },
    [choosingAvatar, resetPendingProfile, saving, uploadAvatarToCloud]
  );

  const completeLogin = useCallback(
    async (rawNick: string) => {
      const nick = rawNick.trim();
      if (!nick) {
        Taro.showToast({ title: '请点击输入框获取昵称', icon: 'none' });
        return;
      }
      if (saving) return;

      setSaving(true);
      try {
        // 1. 等待头像上传完成
        let finalFileId = avatarFileId;
        if (!finalFileId) {
          const uploadPromise = avatarUploadPromiseRef.current;
          if (uploadPromise) {
            const r = await uploadPromise;
            finalFileId = r.fileId;
          }
        }

        // 如果没有选择新头像，使用当前头像
        if (!finalFileId && currentUser?.avatarUrl) {
          finalFileId = currentUser.avatarUrl;
        }

        if (!finalFileId) {
          throw new Error('请先选择头像');
        }

        // 🚨 2. 核心大换血：直接调用咱们自己后端的微信静默登录，拿取 OpenID！
        const userRes = await loginWithWeChat();
        if (!userRes?.openid) {
          throw new Error('连接服务器登录失败，请检查网络');
        }

        // 3. 把拿到 openid 和 头像、昵称，一起存入本地全局状态
        setCurrentUser({
          id: userRes.openid,
          openid: userRes.openid,
          nickName: nick,
          avatarUrl: finalFileId, // 头像是后端上传返回的 URL
          avatarFileId: finalFileId
        });
        setUserNickName(nick);

        setShowNicknameModal(false);
        resetPendingProfile();

        // 🚨 增加核心排查日志：打印最终拿到的头像链接
        console.log('🚨 [调试探头] 最终存入的头像链接是:', finalFileId);

        // 🚨 4. 闭环绝杀：同步将新头像和新昵称发给云端，更新该用户参与过的所有历史活动！
        await updateUserProfileAPI(nick, finalFileId);

        // 恢复正常的提示语
        Taro.showToast({ title: '登录成功', icon: 'success' });
      } catch (err: any) {
        Taro.showToast({ title: err?.message || '登录失败', icon: 'none' });
      } finally {
        setSaving(false);
      }
    },
    [avatarFileId, loginWithWeChat, resetPendingProfile, saving, setCurrentUser, setUserNickName, updateUserProfileAPI]
  );

  const handleModalCancel = useCallback(() => {
    if (saving) return;
    setShowNicknameModal(false);
    resetPendingProfile();
  }, [resetPendingProfile, saving]);

  const handleLogout = () => {
    Taro.showModal({
      title: '确认退出登录',
      content: '退出后将需要重新授权头像和昵称，是否继续？',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          // 秒退：清空 Zustand 内存态，让 UI 立刻回到未登录（去完善）
          setCurrentUser(null);
          setUserNickName('');

          // 同时清理落盘态（避免下次进入又被 hydrate）
          Taro.removeStorageSync('currentUser');
          Taro.removeStorageSync('userNickName');
          // 2.3 修复：退出登录时同步清理 token
          Taro.removeStorageSync('token');

          Taro.showToast({ title: '已退出登录', icon: 'success' });
        }
      }
    });
  };

  const handleEditProfile = useCallback(() => {
    setChoosingAvatar(false);
    setNickNameDraft(currentUser?.nickName || '');
    setShowNicknameModal(true);
  }, [currentUser?.nickName]);


  const myEvents = events.filter((e) => {
    if (currentUser?.openid && e.creatorId) return e.creatorId === currentUser.openid;
    return !!userNickName && e.creatorNickName === userNickName;
  });

  const joinedEvents = events.filter((e) => {
    // 1. 判断是否在参与者列表中
    const isParticipant = !!userNickName && e.participants.some((p) => p.nickName === userNickName);

    // 2. 🚨 核心排重：绝对不能是自己发起的！
    const isNotCreator = currentUser?.openid
      ? e.creatorId !== currentUser.openid
      : e.creatorNickName !== userNickName;

    return isParticipant && isNotCreator;
  });

  const displayNickName = userNickName || currentUser?.nickName || '未设置昵称';
  const displayAvatarUrl = currentUser?.avatarUrl || '';
  const stepAvatarSrc = avatarPreview || currentUser?.avatarUrl || '';


  return (
    <View className="profile-page">
      <View className="user-card" onClick={handleEditProfile}>
        <View className="avatar">
          {displayAvatarUrl ? (
            <Image className="avatar-img" src={displayAvatarUrl} mode="aspectFill" />
          ) : (
            <Image className="avatar-img" src="/icon/my-unselected.png" mode="aspectFill" />
          )}
        </View>

        <View className="user-info">
          <Text className="nickname">{isProfileIncomplete ? '未登录' : displayNickName}</Text>
          <Text className="user-id">{isProfileIncomplete ? '点击此处授权登录获取完整体验' : '微信用户'}</Text>
        </View>
      </View>

      {showNicknameModal ? (
        <View className="nickname-modal-mask">
          <View className="nickname-modal" catchMove>
            <Text className="nickname-modal-title">设置昵称</Text>
            <Text className="nickname-modal-desc">请点击输入框一键获取微信昵称</Text>

            <Button
              className="nickname-modal-avatar-btn"
              openType="chooseAvatar"
              onChooseAvatar={handleChooseAvatar as any}
              disabled={saving || choosingAvatar}
              hoverClass="none"
            >
              <View className="nickname-modal-avatar">
                {stepAvatarSrc ? (
                  <Image className="nickname-modal-avatar-img" src={stepAvatarSrc} mode="aspectFill" />
                ) : (
                  <Image className="nickname-modal-avatar-img" src="/icon/my-unselected.png" mode="aspectFill" />
                )}
              </View>
              <Text className="nickname-modal-avatar-text">修改头像</Text>
            </Button>

            <Input
              className="nickname-modal-input"
              type="nickname"
              placeholder="点击输入框获取昵称"
              value={nickNameDraft}
              disabled={saving}
              onInput={(e: any) => setNickNameDraft(e.detail.value)}
              onConfirm={(e: any) => completeLogin(e?.detail?.value ?? nickNameDraft)}
            />

            <View className="nickname-modal-actions">
              <Button className="nickname-modal-cancel" onClick={handleModalCancel} disabled={saving}>
                取消
              </Button>
              <Button
                className="nickname-modal-confirm"
                onClick={() => completeLogin(nickNameDraft)}
                loading={saving}
                disabled={saving}
              >
                确认登录
              </Button>
            </View>
          </View>
        </View>
      ) : null}

      <View className="stats-card">
        <View
          className="stat-item"
          onClick={() => {
            Taro.setStorageSync('indexActiveTab', 'created');
            Taro.switchTab({ url: '/pages/index/index' });
          }}
        >
          <Text className="stat-number">{myEvents.length}</Text>
          <Text className="stat-label">我发起的</Text>
        </View>
        <View className="stat-divider" />
        <View
          className="stat-item"
          onClick={() => {
            Taro.setStorageSync('indexActiveTab', 'joined');
            Taro.switchTab({ url: '/pages/index/index' });
          }}
        >
          <Text className="stat-number">{joinedEvents.length}</Text>
          <Text className="stat-label">我参与的</Text>
        </View>
      </View>

      <View className="menu-list">
        <Button openType="feedback" className="native-feedback-btn" hoverClass="none">
          <View className="menu-item">
            <Text className="menu-text">💡 意见反馈</Text>
            <Text className="menu-arrow">〉</Text>
          </View>
        </Button>
      </View>

      <View className="danger-zone">
        {isProfileIncomplete ? (
          <Button className="btn-primary login-btn" onClick={handleEditProfile}>
            授权登录
          </Button>
        ) : (
          <Button className="btn-danger" onClick={handleLogout}>
            退出登录
          </Button>
        )}
      </View>

      <View className="footer">
        <Text className="version">约时间工具 v1.0.0</Text>
      </View>
    </View>
  );
}
