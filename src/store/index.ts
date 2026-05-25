import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { Announcement, Event, User, CreateEventForm, EventStatus, WeeklyUnavailableSettings } from '@/types';
import { generateId, hasCompleteUserProfile, normalizeUser } from '@/utils';
import { requestAPI, UPLOAD_URL } from '@/services/api';

interface Slot {
  date: string;
  startTime: string;
  endTime: string;
}

export type EventLoadErrorType = 'auth' | 'not_found' | 'network' | 'server' | 'unknown';

export interface EventLoadError {
  type: EventLoadErrorType;
  statusCode?: number;
  message: string;
}

interface AppState {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  loginWithWeChat: () => Promise<User | null>;
  events: Event[];
  setEvents: (events: Event[]) => void;
  addEvent: (event: Event) => void;
  updateEvent: (event: Event) => void;
  currentEvent: Event | null;
  setCurrentEvent: (event: Event | null) => void;
  userNickName: string;
  setUserNickName: (name: string) => void;
  fetchEvents: () => Promise<void>;
  getEventById: (eventId: string) => Promise<Event | null>;
  eventLoadError: EventLoadError | null;
  createEventAPI: (form: CreateEventForm) => Promise<Event | null | 'NEED_LOGIN'>;
  updateEventAPI: (eventId: string, updates: Partial<Event>) => Promise<boolean>;
  deleteEventAPI: (eventId: string) => Promise<boolean>;
  updateAvailabilityAPI: (eventId: string, nickName: string, availableSlots: string[], isProxy?: boolean) => Promise<boolean>;
  confirmTimeAPI: (eventId: string, slots: Slot | Slot[]) => Promise<boolean>;
  manageMemberAPI: (eventId: string, targetOpenid: string | undefined, targetNickName: string, action: 'SET_ADMIN' | 'REMOVE_ADMIN' | 'KICK_MEMBER' | 'SET_VIP' | 'REMOVE_VIP' | 'RENAME_MEMBER', targetParticipantId?: string, targetDisplayName?: string) => Promise<boolean>;

  // 🚨 新增：全局更新用户资料 API 定义
  updateUserProfileAPI: (nickName?: string, avatarUrl?: string) => Promise<boolean>;
  weeklyUnavailableSlots: string[];
  autoApplyWeeklyUnavailable: boolean;
  fetchWeeklyUnavailableAPI: () => Promise<WeeklyUnavailableSettings | null>;
  updateWeeklyUnavailableAPI: (weeklyUnavailableSlots: string[], autoApplyWeeklyUnavailable: boolean) => Promise<boolean>;
  latestAnnouncement: Announcement | null;
  hasUnreadAnnouncement: boolean;
  hasProfileTabAnnouncementDot: boolean;
  fetchLatestAnnouncementAPI: () => Promise<Announcement | null>;
  markAnnouncementRead: (announcementId?: string) => void;
  dismissProfileTabAnnouncementDot: (announcementId?: string) => void;

  // 👇 新增这一行，告诉 TypeScript store 里有这个东西
  UPLOAD_URL: string;

  loading: boolean;
  error: string | null;
  tabIndex: number;
  setTabIndex: (index: number) => void;
}

const normalizeEventLoadError = (error: any): EventLoadError => {
  const statusCode = error?.statusCode;
  if (statusCode === 401) {
    return { type: 'auth', statusCode, message: '请先登录后参与这个活动' };
  }
  if (statusCode === 404) {
    return { type: 'not_found', statusCode, message: '活动不存在或已删除' };
  }
  if (typeof statusCode === 'number' && statusCode >= 500) {
    return { type: 'server', statusCode, message: '服务器暂时不可用，请稍后重试' };
  }
  if (error?.errMsg || error?.message?.includes('request')) {
    return { type: 'network', message: '网络连接失败，请检查网络后重试' };
  }
  return { type: 'unknown', statusCode, message: error?.message || '活动加载失败，请重试' };
};

const WEEKLY_UNAVAILABLE_ANNOUNCEMENT: Announcement = {
  id: '2026-05-25-weekly-unavailable',
  title: '常规不可用时段上线',
  content: '现在可以在「我的」里维护每周常规不可用时段。进入活动选择时间时，可以一键套用并避开这些时段；如果某次活动临时可参加，也可以手动改回。',
  publishedAt: '2026-05-25T00:00:00.000Z',
  actionText: '去设置常规时段',
  actionPath: '/pages/profile/weekly-unavailable/index'
};

const getFallbackAnnouncement = (): Announcement => {
  return Taro.getStorageSync('latestAnnouncement') || WEEKLY_UNAVAILABLE_ANNOUNCEMENT;
};

const resolveAnnouncementReadState = (announcement: Announcement | null) => {
  const readId = Taro.getStorageSync('lastReadAnnouncementId') || '';
  return !!announcement?.id && announcement.id !== readId;
};

const resolveProfileTabAnnouncementDotState = (announcement: Announcement | null) => {
  const seenId = Taro.getStorageSync('lastSeenProfileTabAnnouncementId') || '';
  return !!announcement?.id && announcement.id !== seenId;
};

export const useAppStore = create<AppState>((set, get) => ({

  // 👇 新增这一行，把文件顶部的常量暴露给 useAppStore() 
  UPLOAD_URL: UPLOAD_URL,

  tabIndex: 0,
  setTabIndex: (index) => set({ tabIndex: index }),

  currentUser: normalizeUser(Taro.getStorageSync('currentUser')) || null,
  setCurrentUser: (user) => {
    const normalized = normalizeUser(user);
    set({ currentUser: normalized });
    if (normalized) {
      Taro.setStorageSync('currentUser', normalized);
    } else {
      Taro.removeStorageSync('currentUser');
    }
  },

  // 🚨 核心改造 1：基于 code 向自己的服务器换取 openid
  loginWithWeChat: async () => {
    if (process.env.TARO_ENV !== 'weapp') return null;
    try {
      // 1. 获取微信临时登录凭证
      const { code } = await Taro.login();
      if (!code) throw new Error('获取微信登录凭证失败');

      // 2. 发给咱们自己的服务器
      const result = await requestAPI('/login', 'POST', { code });
      
      if (!result?.success || !result?.data) return null;

      const { openid, token } = result.data;

      // 3. 存储咱们自己的登录态 Token
      if (token) {
        Taro.setStorageSync('token', token);
      }

      // 获取本地可能已经存在的用户资料（头像昵称）合并
      const existingUser = Taro.getStorageSync('currentUser') || {};
      const user = normalizeUser({
        ...existingUser,
        id: openid,
        openid: openid
      });

      if (user) {
        get().setCurrentUser(user);
        if (user.nickName) {
          get().setUserNickName(user.nickName);
        }
      }

      return user;
    } catch (err) {
      console.error('自建服务器登录失败:', err);
      return null;
    }
  },

  events: [],
  setEvents: (events) => set({ events }),
  addEvent: (event) => set((state) => ({ events: [event, ...state.events] })),
  updateEvent: (event) => set((state) => ({
    events: state.events.map(e => e.id === event.id ? event : e)
  })),
  currentEvent: null,
  setCurrentEvent: (event) => set({ currentEvent: event }),
  userNickName: Taro.getStorageSync('userNickName') || '',
  setUserNickName: (name) => {
    set({ userNickName: name });
    Taro.setStorageSync('userNickName', name);
  },
  loading: false,
  error: null,
  eventLoadError: null,

  // 🚨 核心改造 2：全量请求自己的接口
  fetchEvents: async () => {
    set({ loading: true });
    try {
      const result = await requestAPI('/events', 'GET');
      if (result?.success && result.data) {
        const serverEvents = result.data;
        set({ events: serverEvents, loading: false });
        Taro.setStorageSync('events', serverEvents);
      } else {
        throw new Error('获取失败');
      }
    } catch (error) {
      console.error('Fetch events error:', error);
      const localEvents = Taro.getStorageSync('events') || [];
      set({ events: localEvents, loading: false });
    }
  },

  createEventAPI: async (form: CreateEventForm) => {
    set({ loading: true });

    const current = get().currentUser;

    // 🚨 核心拦截器：没有头像或昵称，返回需要登录的标识
    if (!current || !hasCompleteUserProfile(current)) {
      set({ loading: false });
      return 'NEED_LOGIN';
    }

    if (!Taro.getStorageSync('token')) {
      const refreshedUser = await get().loginWithWeChat();
      if (!refreshedUser?.openid) {
        set({ loading: false });
        return 'NEED_LOGIN';
      }
    }

    const newEvent: Event = {
      id: generateId(),
      title: form.title,
      description: form.description,
      creatorId: current.openid || current.id,
      creatorNickName: current.nickName,
      allowInvite: form.allowInvite,
      isDecisionPublic: form.isDecisionPublic,
      adminIds: [],
      vipIds: [],
      timeMode: form.timeMode,
      dateRange: { start: form.startDate, end: form.endDate },
      timeRange: form.startTime && form.endTime ? { start: form.startTime, end: form.endTime } : undefined,
      granularity: form.granularity,
      status: EventStatus.ACTIVE,
      participants: [{
        userId: current.openid || current.id,
        openid: current.openid,
        nickName: current.nickName,
        avatarUrl: current.avatarUrl, // 确保把真实头像带过去
        availableSlots: [],
        submittedAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const sendCreateRequest = async () => {
      const result = await requestAPI('/events', 'POST', newEvent);
      if (result?.success && result.data) {
        set((state) => ({
          events: [result.data, ...state.events],
          loading: false
        }));
        Taro.setStorageSync('events', get().events);
        return result.data as Event;
      }
      throw new Error('服务器端创建失败');
    };

    try {
      // 🚨 真实向后端发起请求
      return await sendCreateRequest();
    } catch (error: any) {
      if (error?.statusCode === 401) {
        const refreshedUser = await get().loginWithWeChat();
        if (refreshedUser?.openid) {
          try {
            return await sendCreateRequest();
          } catch (retryError) {
            console.error('Create event retry error:', retryError);
          }
        }
      }

      console.error('Create event error:', error);
      // 🚨 废除本地兜底！失败就是失败，直接阻断并弹窗提示！
      Taro.showToast({ title: '创建失败，请确保已登录', icon: 'error' });
      set({ loading: false });
      return null;
    }
  },

  updateEventAPI: async (eventId: string, updates: Partial<Event>) => {
    try {
      const result = await requestAPI(`/events/${eventId}`, 'PUT', updates);
      if (!result?.success || !result.data) return false;
      const updatedEvent = result.data as Event;
      set((state) => ({
        events: state.events.map((e) => e.id === eventId ? updatedEvent : e),
        currentEvent: state.currentEvent?.id === eventId ? updatedEvent : state.currentEvent
      }));
      Taro.setStorageSync('events', get().events);
      return true;
    } catch (error) {
      console.error('Update event error:', error);
      return false;
    }
  },

  deleteEventAPI: async (eventId: string) => {
    set({ loading: true });
    try {
      const result = await requestAPI(`/events/${eventId}`, 'DELETE');
      if (result && result.success) {
        set((state) => ({
          events: state.events.filter((e) => e.id !== eventId),
          loading: false
        }));
        Taro.setStorageSync('events', get().events);
        return true;
      }
      throw new Error('删除失败');
    } catch (error) {
      console.error('Delete event error:', error);
      set({ loading: false });
      return false;
    }
  },

  updateAvailabilityAPI: async (eventId: string, nickName: string, availableSlots: string[], isProxy?: boolean) => {
    set({ loading: true });
    try {
      const currentUser = get().currentUser;
      const avatarUrl = isProxy ? '' : (currentUser?.avatarUrl || '');
      const openid = isProxy ? '' : (currentUser?.openid || '');

      const result = await requestAPI(`/events/${eventId}/availability`, 'POST', {
        nickName,
        avatarUrl,
        openid,
        availableSlots,
        isProxy: isProxy === true
      });

      if (result && result.success) {
        await get().fetchEvents(); // 成功后刷新数据
        return true;
      }
      set({ loading: false });
      return false;
    } catch (error) {
      console.error('Update availability error:', error);
      set({ loading: false });
      return false;
    }
  },

  confirmTimeAPI: async (eventId: string, slots: Slot | Slot[]) => {
    set({ loading: true });
    try {
      const slotsArray = Array.isArray(slots) ? slots : [slots];

      const packedSlot = {
        date: slotsArray.map(s => s.date).join(','),
        startTime: slotsArray.map(s => s.startTime || '').join(','),
        endTime: slotsArray.map(s => s.endTime || '').join(',')
      };

      const result = await requestAPI(`/events/${eventId}/confirm`, 'POST', {
        confirmedSlots: slotsArray,
        confirmedSlot: packedSlot
      });

      if (result && result.success) {
        await get().fetchEvents();
        return true;
      }
      set({ loading: false });
      return false;
    } catch (error) {
      console.error('Confirm time error:', error);
      set({ loading: false });
      return false;
    }
  },

  manageMemberAPI: async (eventId, targetOpenid, targetNickName, action, targetParticipantId, targetDisplayName) => {
    set({ loading: true });
    try {
      const result = await requestAPI(`/events/${eventId}/members`, 'POST', {
        targetOpenid,
        targetParticipantId,
        targetNickName,
        targetDisplayName,
        action
      });

      if (!result?.success) {
        set({ loading: false });
        return false;
      }

      await get().getEventById(eventId);
      set({ loading: false });
      return true;
    } catch (error) {
      console.error('Manage member error:', error);
      set({ loading: false });
      return false;
    }
  },

  // 🚨 新增：全局更新用户资料的方法
  updateUserProfileAPI: async (nickName?: string, avatarUrl?: string) => {
    try {
      const result = await requestAPI('/user/profile', 'POST', { nickName, avatarUrl });
      if (result && result.success) {
        // 🚨 核心杀招：更新完云端后，静默刷新一下本地列表，让旧活动的头像昵称瞬间变身！
        get().fetchEvents();
        return true;
      }
      return false;
    } catch (error) {
      console.error('更新全局用户资料失败:', error);
      return false;
    }
  },

  weeklyUnavailableSlots: Taro.getStorageSync('weeklyUnavailableSlots') || [],
  autoApplyWeeklyUnavailable: Taro.getStorageSync('autoApplyWeeklyUnavailable') !== false,
  fetchWeeklyUnavailableAPI: async () => {
    try {
      const result = await requestAPI('/user/weekly-unavailable', 'GET');
      if (!result?.success || !result.data) return null;
      const settings = result.data as WeeklyUnavailableSettings;
      const slots = Array.isArray(settings.weeklyUnavailableSlots) ? settings.weeklyUnavailableSlots : [];
      const autoApply = settings.autoApplyWeeklyUnavailable !== false;
      set({
        weeklyUnavailableSlots: slots,
        autoApplyWeeklyUnavailable: autoApply
      });
      Taro.setStorageSync('weeklyUnavailableSlots', slots);
      Taro.setStorageSync('autoApplyWeeklyUnavailable', autoApply);
      return { weeklyUnavailableSlots: slots, autoApplyWeeklyUnavailable: autoApply };
    } catch (error) {
      console.error('Fetch weekly unavailable error:', error);
      return {
        weeklyUnavailableSlots: Taro.getStorageSync('weeklyUnavailableSlots') || [],
        autoApplyWeeklyUnavailable: Taro.getStorageSync('autoApplyWeeklyUnavailable') !== false
      };
    }
  },

  updateWeeklyUnavailableAPI: async (weeklyUnavailableSlots, autoApplyWeeklyUnavailable) => {
    try {
      const result = await requestAPI('/user/weekly-unavailable', 'PUT', {
        weeklyUnavailableSlots,
        autoApplyWeeklyUnavailable
      });
      if (!result?.success || !result.data) return false;
      const slots = Array.isArray(result.data.weeklyUnavailableSlots) ? result.data.weeklyUnavailableSlots : [];
      const autoApply = result.data.autoApplyWeeklyUnavailable !== false;
      set({
        weeklyUnavailableSlots: slots,
        autoApplyWeeklyUnavailable: autoApply
      });
      Taro.setStorageSync('weeklyUnavailableSlots', slots);
      Taro.setStorageSync('autoApplyWeeklyUnavailable', autoApply);
      return true;
    } catch (error) {
      console.error('Update weekly unavailable error:', error);
      set({
        weeklyUnavailableSlots,
        autoApplyWeeklyUnavailable
      });
      Taro.setStorageSync('weeklyUnavailableSlots', weeklyUnavailableSlots);
      Taro.setStorageSync('autoApplyWeeklyUnavailable', autoApplyWeeklyUnavailable);
      return true;
    }
  },

  latestAnnouncement: getFallbackAnnouncement(),
  hasUnreadAnnouncement: resolveAnnouncementReadState(getFallbackAnnouncement()),
  hasProfileTabAnnouncementDot: resolveProfileTabAnnouncementDotState(getFallbackAnnouncement()),
  fetchLatestAnnouncementAPI: async () => {
    try {
      const result = await requestAPI('/announcement/latest', 'GET');
      const announcement = result?.success && result.data
        ? result.data as Announcement
        : getFallbackAnnouncement();
      set({
        latestAnnouncement: announcement,
        hasUnreadAnnouncement: resolveAnnouncementReadState(announcement),
        hasProfileTabAnnouncementDot: resolveProfileTabAnnouncementDotState(announcement)
      });
      Taro.setStorageSync('latestAnnouncement', announcement);
      return announcement;
    } catch (error) {
      console.error('Fetch latest announcement error:', error);
      const announcement = getFallbackAnnouncement();
      set({
        latestAnnouncement: announcement,
        hasUnreadAnnouncement: resolveAnnouncementReadState(announcement),
        hasProfileTabAnnouncementDot: resolveProfileTabAnnouncementDotState(announcement)
      });
      Taro.setStorageSync('latestAnnouncement', announcement);
      return announcement;
    }
  },

  markAnnouncementRead: (announcementId?: string) => {
    const id = announcementId || get().latestAnnouncement?.id;
    if (!id) return;
    Taro.setStorageSync('lastReadAnnouncementId', id);
    Taro.setStorageSync('lastSeenProfileTabAnnouncementId', id);
    set({ hasUnreadAnnouncement: false, hasProfileTabAnnouncementDot: false });
  },

  dismissProfileTabAnnouncementDot: (announcementId?: string) => {
    const id = announcementId || get().latestAnnouncement?.id;
    if (!id) return;
    Taro.setStorageSync('lastSeenProfileTabAnnouncementId', id);
    set({ hasProfileTabAnnouncementDot: false });
  },

  getEventById: async (eventId: string) => {
    set({ loading: true, eventLoadError: null });
    try {
      const result = await requestAPI(`/events/${eventId}`, 'GET');

      if (result?.success && result.data) {
        const eventData = result.data as Event;
        set((state) => ({
          events: state.events.some(e => e.id === eventId)
            ? state.events.map(e => e.id === eventId ? eventData : e)
            : [...state.events, eventData],
          currentEvent: eventData,
          loading: false,
          eventLoadError: null
        }));
        return eventData;
      }

      const { events } = get();
      const localEvent = events.find(e => e.id === eventId);
      if (localEvent) {
        set({ currentEvent: localEvent, loading: false });
        return localEvent;
      }
      set({
        loading: false,
        eventLoadError: { type: 'not_found', message: '活动不存在或已删除' }
      });
      return null;
    } catch (error) {
      console.error('Get event error:', error);
      const loadError = normalizeEventLoadError(error);

      if (loadError.type === 'auth' || loadError.type === 'not_found') {
        set({ currentEvent: null, loading: false, eventLoadError: loadError });
        return null;
      }

      const { events } = get();
      const localEvent = events.find(e => e.id === eventId);
      set({ currentEvent: localEvent || null, loading: false, eventLoadError: localEvent ? null : loadError });
      return localEvent || null;
    }
  }
}));
