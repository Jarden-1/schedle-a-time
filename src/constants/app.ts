/** 小程序版本号：每次发版时同步更新，埋点用它区分版本 */
export const APP_VERSION = '1.4.0';

/** 埋点事件名常量，避免手写字符串写错 */
export const TRACK = {
  APP_LAUNCH: 'app_launch',
  PAGE_VIEW: 'page_view',
  PAGE_LEAVE: 'page_leave',
  ERROR: 'error',

  LOGIN_START: 'login_start',
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAIL: 'login_fail',
  LOGIN_CARD_SHOWN: 'login_card_shown',

  EVENT_OPEN: 'event_open',
  EVENT_CREATE_SUBMIT: 'event_create_submit',
  EVENT_CREATE_SUCCESS: 'event_create_success',
  EVENT_CREATE_FAIL: 'event_create_fail',
  EVENT_CREATE_NEED_LOGIN: 'event_create_need_login',

  SELECT_SUBMIT: 'select_submit',
  SELECT_SUCCESS: 'select_success',
  SELECT_FAIL: 'select_fail',
  SELECT_APPLY_PRESET: 'select_apply_preset',

  DECISION_VIEW: 'decision_view',
  DECISION_CONFIRM_CLICK: 'decision_confirm_click',
  DECISION_CONFIRM_SUCCESS: 'decision_confirm_success',
  DECISION_CONFIRM_FAIL: 'decision_confirm_fail',
  DECISION_EMPTY_SHOWN: 'decision_empty_shown',

  EVENT_SHARE: 'event_share',
  EVENT_REVOKE_CONFIRM: 'event_revoke_confirm',
  EVENT_LEAVE: 'event_leave',
  MEMBER_ACTION: 'member_action',
  WEEKLY_SETTINGS_SAVE: 'weekly_settings_save',
  ANNOUNCEMENT_READ: 'announcement_read'
} as const;
