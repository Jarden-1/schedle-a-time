import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { Event, User, CreateEventForm, EventStatus } from '@/types';
import { generateId } from '@/utils';

// ==========================================
// 🚨 核心配置：你的自建服务器地址
// ==========================================
// 本地开发用 localhost，部署到火山云后换成 https://你的域名/api
export const BASE_URL = 'https://api.zhanghaoyang.cn/api';

// 与 BASE_URL 同源的上传地址（收口配置，避免散落硬编码）
export const UPLOAD_URL = `${BASE_URL}/upload`;

// 封装原生的 Taro.request，替代旧的 callCloudFunction
const requestAPI = async (endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', data: any = {}) => {
  try {
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
    if (res.statusCode === 401) {
      Taro.removeStorageSync('token');
      throw new Error('登录已过期，请重新登录');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const errorMsg = (res.data as any)?.error || `请求失败 (${res.statusCode})`;
      throw new Error(errorMsg);
    }
    return res.data; // 返回 { success, data, error } 格式
  } catch (error) {
    console.error(`Request ${endpoint} error:`, error);
    throw error;
  }
};

interface Slot {
  date: string;
  startTime: string;
  endTime: string;
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
  createEventAPI: (form: CreateEventForm) => Promise<Event | null | 'NEED_LOGIN'>;
  updateEventAPI: (eventId: string, updates: Partial<Event>) => Promise<boolean>;
  deleteEventAPI: (eventId: string) => Promise<boolean>;
  updateAvailabilityAPI: (eventId: string, nickName: string, availableSlots: string[], isProxy?: boolean) => Promise<boolean>;
  confirmTimeAPI: (eventId: string, slots: Slot | Slot[]) => Promise<boolean>;
  manageMemberAPI: (eventId: string, targetOpenid: string | undefined, targetNickName: string, action: 'SET_ADMIN' | 'REMOVE_ADMIN' | 'KICK_MEMBER' | 'SET_VIP' | 'REMOVE_VIP', targetParticipantId?: string) => Promise<boolean>;

  // 🚨 新增：全局更新用户资料 API 定义
  updateUserProfileAPI: (nickName?: string, avatarUrl?: string) => Promise<boolean>;

  // 👇 新增这一行，告诉 TypeScript store 里有这个东西
  UPLOAD_URL: string;

  loading: boolean;
  error: string | null;
  tabIndex: number;
  setTabIndex: (index: number) => void;
}

const normalizeUser = (user: any): User | null => {
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
    if (!current || !current.avatarUrl || !current.nickName) {
      set({ loading: false });
      return 'NEED_LOGIN';
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

    try {
      // 🚨 真实向后端发起请求
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
    } catch (error) {
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

  manageMemberAPI: async (eventId, targetOpenid, targetNickName, action, targetParticipantId) => {
    set({ loading: true });
    try {
      const result = await requestAPI(`/events/${eventId}/members`, 'POST', {
        targetOpenid,
        targetParticipantId,
        targetNickName,
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

  getEventById: async (eventId: string) => {
    set({ loading: true });
    try {
      const result = await requestAPI(`/events/${eventId}`, 'GET');

      if (result?.success && result.data) {
        const eventData = result.data as Event;
        set((state) => ({
          events: state.events.some(e => e.id === eventId)
            ? state.events.map(e => e.id === eventId ? eventData : e)
            : [...state.events, eventData],
          currentEvent: eventData,
          loading: false
        }));
        return eventData;
      }

      const { events } = get();
      const localEvent = events.find(e => e.id === eventId);
      if (localEvent) {
        set({ currentEvent: localEvent, loading: false });
        return localEvent;
      }
      set({ loading: false });
      return null;
    } catch (error) {
      console.error('Get event error:', error);
      const { events } = get();
      const localEvent = events.find(e => e.id === eventId);
      set({ currentEvent: localEvent || null, loading: false });
      return localEvent || null;
    }
  }
}));
