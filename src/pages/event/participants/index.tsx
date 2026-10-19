import Taro, { useLoad, useDidShow } from '@tarojs/taro';
import { View, Text, Image, Button } from '@tarojs/components';
import { useState, useCallback, useEffect } from 'react';
import { Event } from '@/types';
import { useAppStore } from '@/store';
import { getParticipantDisplayName } from '@/utils';
import Loading from '@/components/Loading';
import EmptyState from '@/components/EmptyState';
import './index.scss';
import { usePageView } from '@/hooks/usePageView';
import { track } from '@/services/telemetry';
import { TRACK } from '@/constants/app';

export default function EventParticipants() {
  usePageView('event_participants');
  const [event, setEvent] = useState<Event | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [showVipGuide, setShowVipGuide] = useState(false);
  const [guideTargetIndex, setGuideTargetIndex] = useState(-1);

  const { getEventById, manageMemberAPI, currentUser } = useAppStore();

  const loadEvent = useCallback(
    async (id: string) => {
      const cloudEvent = await getEventById(id);
      if (cloudEvent) {
        setEvent(cloudEvent);
      } else {
        // 只有网络类错误才回退缓存；404 说明活动已被删除
        const { eventLoadError: loadError, events: cachedEvents } = useAppStore.getState();
        if (loadError?.type !== 'not_found' && loadError?.type !== 'auth') {
          const localEvent = cachedEvents.find((e) => e.id === id);
          if (localEvent) setEvent(localEvent);
        }
      }
      setInitialLoading(false);
    },
    [getEventById]
  );

  useLoad(async (options) => {
    const { id } = options;
    if (id) {
      await loadEvent(id);
    } else {
      setInitialLoading(false);
    }
  });

  useDidShow(() => {
    const pages = Taro.getCurrentPages();
    const currentPage = pages[pages.length - 1];
    const id = currentPage.options?.id;
    if (id) loadEvent(id);
  });

  const myOpenid = currentUser?.openid;
  const isCreator = !!(myOpenid && event?.creatorId && event.creatorId === myOpenid);
  const isAdmin = event?.adminIds?.includes(myOpenid || '');
  const canManage = isCreator || isAdmin;

  useEffect(() => {
    if (!event || !canManage) return;
    // 检查是否已经看过引导
    if (Taro.getStorageSync('guide_vip_seen')) return;

    // 找到第一个非发起人的成员，作为挂载气泡的锚点
    const targetIdx = event.participants.findIndex((p: any) => p.openid !== event.creatorId);

    if (targetIdx !== -1) {
      setGuideTargetIndex(targetIdx);
      setShowVipGuide(true);
    }
  }, [event, canManage]);

  const handleProxyFill = useCallback(() => {
    if (!event) return;
    Taro.showModal({
      title: '代填空闲时间',
      content: '',
      editable: true,
      placeholderText: '请输入代填成员昵称',
      success: (res: any) => {
        if (res.confirm && res.content?.trim()) {
          let rawName = res.content.trim();
          if (rawName.endsWith('(代填)')) rawName = rawName.replace(/\(代填\)$/, '').trim();
          const proxyName = `${rawName} (代填)`;
          Taro.navigateTo({
            url: `/pages/event/select/index?id=${event.id}&nickname=${encodeURIComponent(proxyName)}&isProxy=1`
          });
        }
      }
    } as any);
  }, [event]);

  const handleMemberClick = useCallback(
    async (participant: any) => {
      if (!event) return;

      if (showVipGuide) {
        setShowVipGuide(false);
        Taro.setStorageSync('guide_vip_seen', true);
      }

      if (!canManage) return;

      const participantOpenid: string | undefined = participant?.openid;
      const isTargetCreator = !!(participantOpenid && participantOpenid === event.creatorId);

      const isTargetAdmin = !!(
        participantOpenid && Array.isArray(event.adminIds) && event.adminIds.includes(participantOpenid)
      );

      let itemList: string[] = [];
      itemList.push('修改显示名称');
      if (participant?.eventDisplayName) {
        itemList.push('恢复原昵称');
      }

      const isTargetVip = !!(
        participantOpenid && Array.isArray(event.vipIds) && event.vipIds.includes(participantOpenid)
      );

      if (isCreator && !isTargetCreator) {
        itemList = isTargetAdmin ? ['取消管理员'] : ['设为管理员'];
        itemList.unshift(...(participant?.eventDisplayName ? ['修改显示名称', '恢复原昵称'] : ['修改显示名称']));
        itemList.push(isTargetVip ? '取消重点嘉宾' : '设为重点嘉宾');
        itemList.push('移除该成员');
      } else if (isAdmin && !isTargetCreator) {
        if (!isTargetAdmin) {
          itemList.push(isTargetVip ? '取消重点嘉宾' : '设为重点嘉宾');
          itemList.push('移除该成员');
        }
      }

      if (itemList.length === 0) return;

      try {
        const res = await Taro.showActionSheet({ itemList });
        const action = itemList[res.tapIndex];

        let apiAction: 'SET_ADMIN' | 'REMOVE_ADMIN' | 'KICK_MEMBER' | 'SET_VIP' | 'REMOVE_VIP' | null = null;
        let successToast = '';
        let nextDisplayName: string | undefined;

        switch (action) {
          case '修改显示名称': {
            const modalRes: any = await Taro.showModal({
              title: '修改显示名称',
              editable: true,
              placeholderText: getParticipantDisplayName(participant),
              confirmText: '保存',
              cancelText: '取消'
            } as any);
            const displayName = modalRes?.content?.trim();
            if (!modalRes.confirm) return;
            if (!displayName) {
              Taro.showToast({ title: '名称不能为空', icon: 'none' });
              return;
            }
            if (displayName.length > 20) {
              Taro.showToast({ title: '名称不能超过20个字', icon: 'none' });
              return;
            }
            apiAction = 'RENAME_MEMBER' as any;
            nextDisplayName = displayName;
            successToast = '已修改显示名称';
            break;
          }
          case '恢复原昵称':
            apiAction = 'RENAME_MEMBER' as any;
            nextDisplayName = '';
            successToast = '已恢复原昵称';
            break;
          case '设为管理员':
            if (!participantOpenid) {
              Taro.showToast({ title: '该成员无 openid，无法设为管理员', icon: 'none' });
              return;
            }
            apiAction = 'SET_ADMIN';
            successToast = '已设置管理员';
            break;
          case '取消管理员':
            if (!participantOpenid) {
              Taro.showToast({ title: '该成员无 openid，无法取消管理员', icon: 'none' });
              return;
            }
            apiAction = 'REMOVE_ADMIN';
            successToast = '已取消管理员';
            break;
          case '设为重点嘉宾':
            if (!participantOpenid) {
              Taro.showToast({ title: '无 openid', icon: 'none' });
              return;
            }
            apiAction = 'SET_VIP';
            successToast = '已设为重点嘉宾';
            break;
          case '取消重点嘉宾':
            if (!participantOpenid) {
              Taro.showToast({ title: '无 openid', icon: 'none' });
              return;
            }
            apiAction = 'REMOVE_VIP';
            successToast = '已取消重点嘉宾';
            break;
          case '移除该成员':
            apiAction = 'KICK_MEMBER';
            successToast = '已移除成员';
            break;
          default:
            break;
        }

        if (!apiAction) return;

        track(TRACK.MEMBER_ACTION, { action: String(apiAction) });
        setActionLoading(true);
        Taro.showLoading({ title: '处理中' });
        try {
          const result = await manageMemberAPI(
            event.id,
            participantOpenid,
            participant.nickName,
            apiAction,
            participant.participantId,
            nextDisplayName
          );
          if (result.success) {
            Taro.showToast({ title: successToast, icon: 'success' });
            await loadEvent(event.id);
          } else {
            Taro.showToast({ title: result.error || '操作失败', icon: 'none' });
          }
        } catch {
          Taro.showToast({ title: '操作失败', icon: 'none' });
        } finally {
          Taro.hideLoading();
          setActionLoading(false);
        }
      } catch {
        // 用户取消不做处理
      }
    },
    [canManage, event, isAdmin, isCreator, loadEvent, manageMemberAPI, showVipGuide]
  );

  if (initialLoading) {
    return (
      <View className="participants-page">
        <Loading fullScreen text="加载中..." />
      </View>
    );
  }

  if (!event) {
    return (
      <View className="participants-page">
        <EmptyState
          icon="😕"
          title="事件不存在或已删除"
          description="请检查链接是否正确，或返回上一页"
          actionText="返回"
          onAction={() => Taro.navigateBack()}
        />
      </View>
    );
  }

  const submittedCount = typeof event.submittedCount === 'number'
    ? event.submittedCount
    : event.participants.filter((p: any) => p.hasSubmitted === true || (Array.isArray(p.availableSlots) && p.availableSlots.length > 0)).length;

  const closeGuide = () => {
    if (showVipGuide) {
      setShowVipGuide(false);
      Taro.setStorageSync('guide_vip_seen', true);
    }
  };

  return (
    <View className="participants-page">
      <View className="header-card">
        <Text className="title">{event.title}</Text>
        <Text className="subtitle">{submittedCount} 人已填写</Text>
        {canManage ? <Text className="hint">点击成员可管理</Text> : null}
      </View>

      {/* 🚨 新增：代填成员快捷入口 */}
      {canManage && (
        <View style={{ padding: '0 16px', marginBottom: '16px' } as any}>
          <Button
            onClick={handleProxyFill}
            style={{
              width: '100%',
              background: '#fff',
              color: '#07c160',
              border: '1px solid #07c160',
              borderRadius: '8px',
              padding: '4px 0',
              fontSize: '15px',
              fontWeight: '500'
            } as any}
          >
            ➕ 添加代填成员
          </Button>
        </View>
      )}

      <View className="list-card" onClick={closeGuide}>
        <View className="participants-list">
          {event.participants.map((p: any, idx: number) => {
            const openid = p?.openid;
            const isMemberCreator = !!(openid && openid === event.creatorId);
            const isMemberAdmin = !!(openid && Array.isArray(event.adminIds) && event.adminIds.includes(openid));
            const isMemberVip = !!(openid && Array.isArray(event.vipIds) && event.vipIds.includes(openid));
            const displayName = getParticipantDisplayName(
              p,
              isMemberCreator ? event.creatorNickName : '未命名'
            );

            return (
              <View
                key={`${openid || p?.nickName || idx}`}
                className="participant-item"
                onClick={() => handleMemberClick(p)}
                style={{ position: 'relative' }}
              >
                <View className="participant-avatar">
                  {p?.avatarUrl && p.avatarUrl.trim() !== '' ? (
                    <Image className="avatar-img" src={p.avatarUrl} mode="aspectFill" />
                  ) : (
                    <Text className="participant-avatar-text">👤</Text>
                  )}
                </View>

                <View className="participant-main">
                  <View className="participant-name-row">
                    {/* 🚨 终极修复：增加多个兜底显示，如果本人 nickName 丢失，强制取发起人昵称 */}
                    <Text className="participant-name">
                      {displayName}
                    </Text>
                    {isMemberCreator ? <Text className="tag tag-creator">👑 发起人</Text> : null}
                    {!isMemberCreator && isMemberAdmin ? <Text className="tag tag-admin">⭐ 管理员</Text> : null}
                    {isMemberVip ? <Text className="tag tag-vip">🌟 重点嘉宾</Text> : null}
                  </View>
                </View>

                {/* 🚨 新增：操作暗示图标 (三个点) */}
                {canManage && (
                  <View className="participant-action-hint">
                    <Text>管理 〉</Text>
                  </View>
                )}

                {/* 🚨 新增：VIP 功能首次气泡引导 */}
                {showVipGuide && guideTargetIndex === idx && (
                  <View className="vip-guide-tooltip">
                    <View className="tooltip-arrow"></View>
                    <Text>点击成员可修改显示名、设置重点嘉宾</Text>
                  </View>
                )}
              </View>
            );
          })}

          <View className="participants-summary">
            <Text className="participants-count">{submittedCount} 人已填写</Text>
            {canManage ? <Text className="participants-hint">（点击成员可管理）</Text> : null}
          </View>
        </View>
      </View>

      {actionLoading ? <View style={{ display: 'none' } as any} /> : null}
    </View>
  );
}
