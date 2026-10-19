import Taro from '@tarojs/taro';
import { View, Text, Button, Input as TaroInput, Textarea as TaroTextarea, Picker, Radio, RadioGroup, Label, Switch, Image } from '@tarojs/components';
import { useState } from 'react';
import { CreateEventForm, TimeMode, TimeGranularity } from '@/types';
import { snapTime, generateDateSlots, generateTimeSlots } from '@/utils';
import { useAppStore } from '@/store';
import { uploadAvatarToServer } from '@/services/avatar';
import { buildUserProfile } from '@/utils';
import './index.scss';

const Input = TaroInput;
const Textarea = TaroTextarea;

export default function CreateEvent() {
  const { createEventAPI, updateAvailabilityAPI, userNickName, setUserNickName, loading, loginWithWeChat, setCurrentUser } = useAppStore();

  // 🚨 新增：控制弹窗和临时头像的状态
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [tempAvatar, setTempAvatar] = useState('');

  const [isAutoFill, setIsAutoFill] = useState(true);

  const [form, setForm] = useState<CreateEventForm>({
    title: '',
    description: '',
    timeMode: TimeMode.TIME_SLOT,
    startDate: getToday(),
    endDate: getToday(7),
    startTime: '09:00',
    endTime: '18:00',
    granularity: TimeGranularity.MINUTE_30,
    allowInvite: true,
    isDecisionPublic: false,
    creatorNickName: userNickName || ''
  });

  function getToday(addDays = 0): string {
    const date = new Date();
    date.setDate(date.getDate() + addDays);
    // 🚨 必须用本地年月日，toISOString() 取的是 UTC 日期，
    // 东八区 00:00–07:59 之间会把「今天」算成昨天
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 🚨 核心逻辑抽离：真正向后端发请求的动作
  const submitEventData = async (payloadToSubmit: any = null) => {
    const finalPayload = payloadToSubmit || form;
    try {
      const result = await createEventAPI(finalPayload);

      // 🚨 拦截未登录状态，原地弹出头像授权窗口
      if (result === 'NEED_LOGIN') {
        setShowAvatarModal(true);
        return;
      }

      if (!result) {
        Taro.showToast({ title: '创建失败，请重试', icon: 'none' });
        return;
      }

      // 🚨 新增：自动填报逻辑
      if (isAutoFill && updateAvailabilityAPI) {
        try {
          let allSlots: string[] = [];
          if (finalPayload.timeMode === TimeMode.DATE_ONLY) {
            allSlots = generateDateSlots(finalPayload.startDate, finalPayload.endDate);
          } else {
            allSlots = generateTimeSlots(
              finalPayload.startDate,
              finalPayload.endDate,
              finalPayload.startTime,
              finalPayload.endTime,
              finalPayload.granularity
            );
          }
          // 静默提交发起人的可用时间 (isProxyMode = false)
          await updateAvailabilityAPI(result.id, finalPayload.creatorNickName, allSlots, false);
        } catch (err) {
          console.error('自动填报失败，但不影响创建', err);
        }
      }

      Taro.showToast({
        title: '创建成功',
        icon: 'success'
      });

      setTimeout(() => {
        if (isAutoFill) {
          // 已经填报，直接去详情页分享
          Taro.redirectTo({ url: `/pages/event/detail/index?id=${result.id}` });
        } else {
          // 未填报，去选择页让发起人手动涂抹
          Taro.redirectTo({ url: `/pages/event/select/index?id=${result.id}` });
        }
      }, 1000);
    } catch (error) {
      Taro.showToast({ title: '创建失败，请重试', icon: 'none' });
    }
  };

  const handleSubmit = () => {
    if (!form.title.trim()) {
      Taro.showToast({ title: '请输入事件标题', icon: 'none' });
      return;
    }
    if (!form.creatorNickName.trim()) {
      Taro.showToast({ title: '请输入您的昵称', icon: 'none' });
      return;
    }
    if (form.startDate > form.endDate) {
      Taro.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }

    setUserNickName(form.creatorNickName);

    let payloadForm = { ...form };
    if (form.timeMode === TimeMode.TIME_SLOT) {
      if (!form.startTime || !form.endTime) {
        Taro.showToast({ title: '请选择具体时段', icon: 'none' });
        return;
      }

      const snappedStart = snapTime(form.startTime, form.granularity, 'start');
      const snappedEnd = snapTime(form.endTime, form.granularity, 'end');

      if (snappedStart !== form.startTime || snappedEnd !== form.endTime) {
        Taro.showToast({ title: '已自动按时间粒度对齐', icon: 'none', duration: 2000 });
        payloadForm.startTime = snappedStart;
        payloadForm.endTime = snappedEnd;
        setForm(payloadForm);
      }

      // 🚨 拒绝「零可选格子」的活动：避免创建出来谁都没法选
      const previewSlots = generateTimeSlots(
        payloadForm.startDate,
        payloadForm.endDate,
        payloadForm.startTime || '00:00',
        payloadForm.endTime || '00:00',
        payloadForm.granularity
      );
      if (previewSlots.length === 0) {
        Taro.showToast({ title: '时间范围不足一个粒度，请调整时段', icon: 'none' });
        return;
      }
    }

    // 调用真正发请求的函数
    submitEventData(payloadForm);
  };

  // 🚨 新增：在当前页处理头像选择、上传、登录并自动接续创建流程！
  const handleChooseAvatar = async (e: any) => {
    const avatarPath = e.detail.avatarUrl;
    setTempAvatar(avatarPath);
    
    try {
      Taro.showLoading({ title: '正在登录...' });

      let userOpenid = '';
      const { fileId } = await uploadAvatarToServer(avatarPath, async () => {
        const userRes = await loginWithWeChat();
        if (!userRes?.openid) throw new Error('登录失败');
        userOpenid = userRes.openid;
      });

      setCurrentUser(buildUserProfile(userOpenid, form.creatorNickName, fileId));

      Taro.hideLoading();
      setShowAvatarModal(false);
      Taro.showToast({ title: '授权成功，正在创建...', icon: 'none' });

      // 授权成功后继续创建（不再使用固定 setTimeout 延迟）
      await submitEventData();

    } catch (err: any) {
      Taro.hideLoading();
      Taro.showToast({ title: err?.message || '操作失败', icon: 'none' });
    }
  };

  return (
    <View className="create-page">
      <View className="form-section">
        {/* ... 保留原有中间所有的表单结构，这里未做改动 ... */}
        <View className="form-group">
          <Text className="form-label">事件标题 <Text className="required">*</Text></Text>
          <Input
            className="form-input"
            placeholder="例如：周末聚餐、团队会议"
            value={form.title}
            onInput={(e: any) => setForm({ ...form, title: e.detail.value })}
            maxlength={50}
          />
        </View>

        <View className="form-group">
          <Text className="form-label">补充说明</Text>
          <Textarea
            className="form-textarea"
            placeholder="可选：添加一些补充信息"
            value={form.description}
            onInput={(e: any) => setForm({ ...form, description: e.detail.value })}
            maxlength={200}
          />
        </View>

        <View className="form-group">
          <Text className="form-label">时间模式</Text>
          <RadioGroup
            className="radio-group"
            onChange={(e) => setForm({ ...form, timeMode: e.detail.value as TimeMode })}
          >
            <Label className="radio-label">
              <Radio value={String(TimeMode.DATE_ONLY)} checked={form.timeMode === TimeMode.DATE_ONLY} />
              <Text className="radio-text">仅日期（适合全天活动）</Text>
            </Label>
            <Label className="radio-label">
              <Radio value={String(TimeMode.TIME_SLOT)} checked={form.timeMode === TimeMode.TIME_SLOT} />
              <Text className="radio-text">精确时段（适合会议、聚餐）</Text>
            </Label>
          </RadioGroup>
        </View>

        <View className="form-group">
          <View className="form-label">日期范围 <Text className="required">*</Text>
            <View className="label-desc">在哪些天中选择（例如：下周一到周五）</View>
          </View>
          <View className="date-range">
            <Picker mode="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.detail.value })}>
              <View className="date-picker"><Text className="date-text">{form.startDate}</Text></View>
            </Picker>
            <Text className="date-separator">至</Text>
            <Picker mode="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.detail.value })}>
              <View className="date-picker"><Text className="date-text">{form.endDate}</Text></View>
            </Picker>
          </View>
        </View>

        {form.timeMode === TimeMode.TIME_SLOT && (
          <View className="form-group">
            <View className="form-label">每日可用时段
              <View className="label-desc">每天从几点到几点（例如：早9点到晚6点）</View>
            </View>
            <View className="time-range">
              <Picker mode="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.detail.value })}>
                <View className="time-picker"><Text className="time-text">{form.startTime}</Text></View>
              </Picker>
              <Text className="time-separator">至</Text>
              <Picker mode="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.detail.value })}>
                <View className="time-picker"><Text className="time-text">{form.endTime}</Text></View>
              </Picker>
            </View>
          </View>
        )}

        {form.timeMode === TimeMode.TIME_SLOT && (
          <View className="form-group">
            <Text className="form-label">时间粒度</Text>
            <RadioGroup
              className="radio-group"
              onChange={(e) => setForm({ ...form, granularity: Number(e.detail.value) as TimeGranularity })}
            >
              <Label className="radio-label">
                <Radio value={String(TimeGranularity.MINUTE_30)} checked={form.granularity === TimeGranularity.MINUTE_30} />
                <Text className="radio-text">30分钟</Text>
              </Label>
              <Label className="radio-label">
                <Radio value={String(TimeGranularity.HOUR_1)} checked={form.granularity === TimeGranularity.HOUR_1} />
                <Text className="radio-text">1小时</Text>
              </Label>
            </RadioGroup>
          </View>
        )}

        <View className="form-group">
          <Text className="form-label">您的昵称 <Text className="required">*</Text></Text>
          <Input
            className="form-input"
            type="nickname"
            placeholder="参与者将看到此昵称"
            value={form.creatorNickName}
            onInput={(e: any) => setForm({ ...form, creatorNickName: e.detail.value })}
            maxlength={20}
          />

          <View className="setting-group">
            <View className="setting-item">
              <View className="setting-title">
                <Text>将选定时间默认标记为"我有空"</Text>
                <View>
                  {/* @ts-ignore */}
                  <Switch checked={isAutoFill} onChange={(e: any) => setIsAutoFill(e.detail.value ?? e.detail.checked)} />
                </View>
              </View>
              <View className="setting-desc">
                <Text className="setting-desc-icon">i</Text>
                <Text>开启后，系统将自动把您选定的时间范围作为您的空闲时间提交。</Text>
              </View>
            </View>

            <View className="setting-item">
              <View className="setting-title">
                <Text>决策面板是否公开</Text>
                <View>
                  {/* @ts-ignore */}
                  <Switch checked={form.isDecisionPublic} onChange={(e: any) => setForm({ ...form, isDecisionPublic: e.detail.value ?? e.detail.checked })} />
                </View>
              </View>
              <View className="setting-desc">
                <Text className="setting-desc-icon">i</Text>
                <Text>事件参与者是否可以看到其他人选择的时间。</Text>
              </View>
            </View>

            <View className="setting-item">
              <View className="setting-title">
                <Text>允许参与者邀请</Text>
                <View>
                  {/* @ts-ignore */}
                  <Switch checked={form.allowInvite} onChange={(e: any) => setForm({ ...form, allowInvite: e.detail.value ?? e.detail.checked })} />
                </View>
              </View>
              <View className="setting-desc">
                <Text className="setting-desc-icon">i</Text>
                <Text>事件参与者是否可以邀请其他人加入该事件。</Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      <View className="submit-section">
        <Button className="btn-primary submit-btn" onClick={handleSubmit} loading={loading} disabled={loading}>
          创建事件
        </Button>
      </View>

      {/* 🚨 新增：自定义悬浮弹窗 - 获取头像 */}
      {showAvatarModal && (
        <View className="custom-modal-overlay">
          <View className="custom-modal-content">
            <View className="modal-title">最后一步：补充头像</View>
            <View className="modal-desc">我们需要您的头像，让其他参与者认出你</View>
            
            <Button
              className="modal-avatar-btn"
              openType="chooseAvatar"
              onChooseAvatar={handleChooseAvatar}
            >
              {tempAvatar ? (
                <Image src={tempAvatar} className="avatar-img" mode="aspectFill" />
              ) : (
                <Text className="avatar-placeholder">点击选择</Text>
              )}
            </Button>
            
            <Button className="modal-close-btn" onClick={() => setShowAvatarModal(false)}>取消</Button>
          </View>
        </View>
      )}
    </View>
  );
}
