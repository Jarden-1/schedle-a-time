// 事件状态
export enum EventStatus {
  ACTIVE = 'active',
  CONFIRMED = 'confirmed',
  CLOSED = 'closed'
}

// 时间模式
export enum TimeMode {
  DATE_ONLY = 'date_only',
  TIME_SLOT = 'time_slot'
}

// 时间粒度
export enum TimeGranularity {
  MINUTE_30 = 30,
  HOUR_1 = 60
}

// 用户
export interface User {
  id: string;
  /**
   * 微信侧身份标识（自建后端登录后返回）
   */
  openid?: string;
  nickName: string;
  /**
   * 用户头像：HTTP/HTTPS 可访问的图片 URL（可直接用于 <Image src>）
   */
  avatarUrl?: string;
  /**
   * @deprecated 历史字段，仅用于兼容旧数据/旧返回
   */
  avatarFileId?: string;
}

// 时间段
export interface TimeSlot {
  date: string;
  startTime: string;
  endTime: string;
}

// 参与者的可用时间
export interface ParticipantAvailability {
  participantId?: string;
  userId: string;
  nickName: string;
  eventDisplayName?: string;
  avatarUrl?: string; // 新增：用户头像
  openid?: string;    // 新增：用户唯一标识
  availableSlots: string[];
  /** 是否提交过（允许提交空数组，表示「已填写但全部没空」） */
  hasSubmitted?: boolean;
  submittedAt: string;
}

// 事件
export interface Event {
  id: string;
  title: string;
  description?: string;
  creatorId: string;
  creatorNickName: string;

  allowInvite: boolean; // 允许参与者邀请
  isDecisionPublic: boolean; // 决策面板是否公开
  adminIds?: string[]; // 管理员 ID 数组
  vipIds?: string[]; // 重点嘉宾的 openid 集合

  timeMode: TimeMode;
  dateRange: {
    start: string;
    end: string;
  };
  timeRange?: {
    start: string;
    end: string;
  };
  granularity: TimeGranularity;
  status: EventStatus;
  participants: ParticipantAvailability[];
  confirmedSlots?: TimeSlot[];
  confirmedSlot?: TimeSlot | null;
  createdAt: string;
  updatedAt: string;
  /** 已填写人数（服务端下发，避免前端推算泄露他人数据） */
  submittedCount?: number;
  /** 当前浏览者是否可管理该活动 */
  viewerCanManage?: boolean;
  /** 服务端是否因「决策不公开」裁剪了他人时间 */
  decisionRedacted?: boolean;
}

// 候选时间统计
export interface CandidateSlot {
  slot: TimeSlot;
  availableCount: number;
  totalCount: number;
  /** 稳定身份（participantId/openid），用于求交集与统计 */
  availableIds: string[];
  unavailableIds: string[];
  /** 仅用于展示的显示名，长度与 availableIds 一一对应 */
  availableUsers: string[];
  unavailableUsers: string[];
  matchRate: number;
}

// 创建事件表单
export interface CreateEventForm {
  title: string;
  description?: string;
  timeMode: TimeMode;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  granularity: TimeGranularity;
  allowInvite: boolean;
  isDecisionPublic: boolean;
  creatorNickName: string;
}

export interface WeeklyUnavailableSettings {
  weeklyUnavailableSlots: string[];
  autoApplyWeeklyUnavailable: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
  actionText?: string;
  actionPath?: string;
}
