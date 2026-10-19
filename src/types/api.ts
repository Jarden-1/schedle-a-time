import { Event, WeeklyUnavailableSettings } from '@/types';

/** 通用响应信封 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: string;
  details?: string[];
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface EventListResult {
  success: boolean;
  data: Event[];
  pagination?: Pagination;
}

export interface EventDetailResult {
  success: boolean;
  data: Event;
}

export interface LoginResult {
  success: boolean;
  data: { openid: string; token: string; debug?: boolean };
  error?: string;
}

export interface AvailabilityResult {
  success: boolean;
  data?: { hasSubmitted: boolean; availableSlots: string[] };
  error?: string;
}

export interface ConfirmResult {
  success: boolean;
  data?: Event;
  error?: string;
}

export interface UpdateEventResult {
  success: boolean;
  data?: Event;
  /** 修改时间范围后被清理掉的过期投票 */
  pruned?: { participants: number; slots: number };
  error?: string;
}

export interface WeeklyUnavailableResult {
  success: boolean;
  data?: WeeklyUnavailableSettings;
  error?: string;
}

export interface MemberActionResult {
  success: boolean;
  data?: { left?: boolean } | Event;
  error?: string;
}

export interface TelemetryResult {
  success: boolean;
  accepted?: number;
}

export interface ApiError extends Error {
  statusCode?: number;
}
