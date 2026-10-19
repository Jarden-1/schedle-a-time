require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const Event = require('./models/Event');
const UserPreference = require('./models/UserPreference');

const app = express();

// 反向代理后面要拿到真实 IP，限流才有意义
app.set('trust proxy', 1);

// 🚨 CORS 收紧：小程序原生请求不带 Origin，不受影响；
// 需要浏览器跨域调试时用 CORS_ORIGINS=https://a.com,https://b.com 或 *=放开
const parseCorsOrigins = () => {
  const raw = (process.env.CORS_ORIGINS || '').trim();
  if (raw === '*') return '*';
  return raw.split(',').map(item => item.trim()).filter(Boolean);
};
const allowedOrigins = parseCorsOrigins();
app.use(cors({
  origin(origin, callback) {
    // 无 Origin：小程序 / 服务端调用，直接放行
    if (!origin) return callback(null, true);
    if (allowedOrigins === '*') return callback(null, true);
    if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json());

// 🚨 轻量限流：防止 /login、/upload 被脚本刷爆（Nginx 层再做一层更稳）
const createRateLimiter = ({ windowMs, max, name }) => {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip || 'unknown'}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, error: '请求过于频繁，请稍后再试' });
    }
    return next();
  };
};
const readLimit = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};
const loginLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: readLimit(process.env.LOGIN_RATE_LIMIT, 60),
  name: 'login'
});
const uploadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: readLimit(process.env.UPLOAD_RATE_LIMIT, 20),
  name: 'upload'
});

// 1. 静态文件夹配置
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// 上传资源单独加固：禁止 MIME 嗅探、禁止脚本执行，避免被当作可执行网页托管
app.use('/uploads', express.static(uploadDir, {
  index: false,
  dotfiles: 'deny',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}));

// 2. 🚨 防御升级：Multer 配置，加入 2MB 大小限制和类型校验
//    真正的格式判定交给文件头（magic bytes），不信任客户端声明的 mimetype 与文件名。
const IMAGE_SIGNATURES = [
  {
    ext: '.png',
    matches: (buf) => buf.length > 8
      && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  },
  {
    ext: '.jpg',
    matches: (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  },
  {
    ext: '.gif',
    matches: (buf) => buf.length > 6
      && (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a')
  },
  {
    ext: '.webp',
    matches: (buf) => buf.length > 12
      && buf.slice(0, 4).toString('ascii') === 'RIFF'
      && buf.slice(8, 12).toString('ascii') === 'WEBP'
  }
];

const detectImageExtension = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const matched = IMAGE_SIGNATURES.find((signature) => signature.matches(buffer));
  return matched ? matched.ext : null;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 最大 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('非法文件类型！只允许上传图片。'), false);
  }
});

// 3. 🚨 防御升级：JWT 鉴权门卫中间件 (保护核心接口)
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未授权，缺少 Token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // 将解析出的 openid 挂载到请求体
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token 无效或已过期' });
  }
};

const generateParticipantId = () => {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
};

// ==========================================
// 🔐 权限模型
// ==========================================
const isEventCreator = (event, openid) => !!(event && openid && event.creatorId === openid);

const findParticipantByOpenid = (event, openid) => {
  if (!event || !openid || !Array.isArray(event.participants)) return undefined;
  return event.participants.find(participant => participant && participant.openid === openid);
};

// 管理员身份要求「在 adminIds 里」且「仍然是成员」。
// 这样即使历史数据残留了 adminIds，被移除的管理员也会立刻失去权限。
const isEventAdmin = (event, openid) => {
  if (!event || !openid) return false;
  if (!Array.isArray(event.adminIds) || !event.adminIds.includes(openid)) return false;
  return !!findParticipantByOpenid(event, openid);
};

const canManageEvent = (event, openid) => {
  if (!event || !openid) return false;
  return isEventCreator(event, openid) || isEventAdmin(event, openid);
};

const requireEventManager = async (req, res) => {
  const event = await Event.findOne({ id: req.params.id });
  if (!event) {
    res.status(404).json({ success: false, error: '未找到' });
    return null;
  }
  if (!canManageEvent(event, req.user.openid)) {
    res.status(403).json({ success: false, error: '无权操作该事件' });
    return null;
  }
  return event;
};

// 成员操作授权矩阵：前端界面的权限承诺必须由服务端强制执行
const authorizeMemberAction = ({ event, actorOpenid, action, targetParticipant, targetOpenid }) => {
  const creator = isEventCreator(event, actorOpenid);
  const admin = isEventAdmin(event, actorOpenid);
  if (!creator && !admin) return '无权操作该事件';

  const resolvedOpenid = targetOpenid || targetParticipant?.openid || '';
  const targetIsCreator = !!(resolvedOpenid && resolvedOpenid === event.creatorId);
  const targetIsAdmin = !!(resolvedOpenid && Array.isArray(event.adminIds) && event.adminIds.includes(resolvedOpenid));
  const targetIsSelf = !!(actorOpenid && resolvedOpenid === actorOpenid);

  switch (action) {
    case 'SET_ADMIN':
    case 'REMOVE_ADMIN':
      if (!creator) return '只有发起人可以设置或取消管理员';
      if (!resolvedOpenid) return '该成员没有 openid，无法调整管理员身份';
      if (targetIsCreator) return '不能调整发起人的管理员身份';
      return null;
    case 'KICK_MEMBER':
      if (targetIsCreator) return '不能移除发起人';
      if (targetIsSelf) return '不能移除自己';
      if (!creator && targetIsAdmin) return '管理员不能移除其他管理员';
      return null;
    case 'RENAME_MEMBER':
      if (targetIsCreator && !creator) return '只有发起人可以修改发起人的显示名称';
      if (admin && !creator && targetIsAdmin && !targetIsSelf) return '管理员不能修改其他管理员的显示名称';
      return null;
    case 'SET_VIP':
    case 'REMOVE_VIP':
      if (!resolvedOpenid) return '该成员没有 openid，无法设置重点嘉宾';
      if (admin && !creator && targetIsCreator) return '管理员不能修改发起人的重点嘉宾标记';
      return null;
    default:
      return '无效的成员操作';
  }
};

// ==========================================
// 🧩 数据整形与校验
// ==========================================
const toPlainParticipant = (participant) => {
  const plain = (participant && typeof participant.toObject === 'function')
    ? participant.toObject()
    : { ...(participant || {}) };
  const availableSlots = Array.isArray(plain.availableSlots) ? plain.availableSlots : [];
  return {
    participantId: plain.participantId || '',
    userId: plain.userId || '',
    openid: plain.openid || '',
    nickName: plain.nickName || '',
    eventDisplayName: plain.eventDisplayName || '',
    avatarUrl: plain.avatarUrl || '',
    availableSlots,
    hasSubmitted: typeof plain.hasSubmitted === 'boolean' ? plain.hasSubmitted : availableSlots.length > 0,
    submittedAt: plain.submittedAt || ''
  };
};

const normalizeParticipant = (participant, fallbackOpenid) => {
  const openid = participant.openid || fallbackOpenid || '';
  const participantId = participant.participantId || openid || generateParticipantId();
  return {
    participantId,
    userId: participant.userId || openid || participantId,
    openid,
    nickName: participant.nickName || '',
    eventDisplayName: participant.eventDisplayName || '',
    avatarUrl: participant.avatarUrl || '',
    availableSlots: Array.isArray(participant.availableSlots) ? participant.availableSlots : [],
    hasSubmitted: participant.hasSubmitted === true,
    submittedAt: participant.submittedAt || new Date().toISOString()
  };
};

// 决策数据隔离：只有管理员，或活动开启了「决策公开」，才返回他人填写的具体时段
const projectParticipant = (participant, viewerOpenid, fullAccess, includeSlots = true) => {
  const plain = toPlainParticipant(participant);
  const isSelf = !!viewerOpenid && plain.openid === viewerOpenid;
  const view = {
    participantId: plain.participantId,
    userId: plain.userId,
    openid: plain.openid,
    nickName: plain.nickName,
    eventDisplayName: plain.eventDisplayName,
    avatarUrl: plain.avatarUrl,
    submittedAt: plain.submittedAt,
    hasSubmitted: plain.hasSubmitted
  };
  // 列表页不需要每个人的具体时间，省掉这坨数据能显著减小响应体
  if (includeSlots) {
    view.availableSlots = (fullAccess || isSelf) ? plain.availableSlots : [];
  }
  return view;
};

const projectEventForViewer = (event, viewerOpenid, options = {}) => {
  const includeSlots = options.includeSlots !== false;
  const plain = (event && typeof event.toObject === 'function') ? event.toObject() : { ...(event || {}) };
  const canManage = canManageEvent(plain, viewerOpenid);
  // 旧版前端靠 availableSlots.length 统计「N 人已填写」，裁剪会让它显示成 1。
  // 新前端发布前，可以用 REDACT_DECISION=false 临时恢复旧行为。
  const redactionEnabled = process.env.REDACT_DECISION !== 'false';
  const fullAccess = canManage || plain.isDecisionPublic === true || !redactionEnabled;
  const participants = (plain.participants || []).map(
    p => projectParticipant(p, viewerOpenid, fullAccess, includeSlots)
  );
  return {
    ...plain,
    participants,
    submittedCount: participants.filter(p => p.hasSubmitted).length,
    viewerCanManage: canManage,
    decisionRedacted: !fullAccess
  };
};

const DATE_SPAN_LIMIT_DAYS = 366;

const isValidDateString = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const dateToDayNumber = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
};

const countDaysInclusive = (start, end) => dateToDayNumber(end) - dateToDayNumber(start) + 1;

const isValidTimeString = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

// 结束时间允许 24:00（当天结束），否则最后一个时间格会被截掉
const isValidEndTimeString = (value) => value === '24:00' || isValidTimeString(value);

const timeToMinutes = (value) => {
  const [hours, minutes] = String(value || '0:0').split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

const minutesToTime = (minutes) => {
  const safe = Math.max(0, Math.min(Math.round(minutes), 24 * 60));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};

const isDateWithinRange = (date, dateRange) => {
  if (!isValidDateString(date) || !dateRange || !isValidDateString(dateRange.start) || !isValidDateString(dateRange.end)) {
    return false;
  }
  return date >= dateRange.start && date <= dateRange.end;
};

const generateDateSlotKeys = (start, end) => {
  if (!isValidDateString(start) || !isValidDateString(end) || start > end) return [];
  const keys = [];
  const endDay = dateToDayNumber(end);
  for (let day = dateToDayNumber(start); day <= endDay; day++) {
    keys.push(new Date(day * 86400000).toISOString().slice(0, 10));
  }
  return keys;
};

// 「合法格子」白名单：创建、修改、提交、确认都复用同一份定义
const generateEventSlotKeys = (event) => {
  if (!event || !event.dateRange || !event.dateRange.start || !event.dateRange.end) return [];
  const dates = generateDateSlotKeys(event.dateRange.start, event.dateRange.end);
  if (dates.length === 0) return [];

  const timeMode = String(event.timeMode || '').toLowerCase();
  if (timeMode === 'date_only') return dates;

  const granularity = Number(event.granularity);
  if (!Number.isFinite(granularity) || granularity <= 0) return [];
  const startMinutes = timeToMinutes(event.timeRange && event.timeRange.start ? event.timeRange.start : '09:00');
  const endMinutes = timeToMinutes(event.timeRange && event.timeRange.end ? event.timeRange.end : '18:00');
  if (endMinutes <= startMinutes) return [];

  const keys = [];
  dates.forEach((date) => {
    for (let cursor = startMinutes; cursor + granularity <= endMinutes; cursor += granularity) {
      keys.push(`${date}_${minutesToTime(cursor)}-${minutesToTime(cursor + granularity)}`);
    }
  });
  return keys;
};

const isValidWeekTimeString = (value, allowEndOfDay = false) => {
  if (allowEndOfDay && value === '24:00') return true;
  return isValidTimeString(value);
};

const isValidWeeklySlotKey = (value) => {
  if (typeof value !== 'string') return false;
  const match = value.match(/^([0-6])_([0-2]\d:[0-5]\d)-([0-2]\d:[0-5]\d)$/);
  if (!match) return false;
  const [, , startTime, endTime] = match;
  return isValidWeekTimeString(startTime) &&
    isValidWeekTimeString(endTime, true) &&
    timeToMinutes(startTime) < timeToMinutes(endTime);
};

const validateEventInput = (payload, partial = false) => {
  const errors = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);

  if (!partial || has('title')) {
    if (typeof payload.title !== 'string' || payload.title.trim().length === 0 || payload.title.length > 80) {
      errors.push('事件标题不能为空且不能超过80个字符');
    }
  }

  if (has('description') && typeof payload.description === 'string' && payload.description.length > 500) {
    errors.push('事件说明不能超过500个字符');
  }

  if (!partial || has('timeMode')) {
    if (!['date_only', 'time_slot', 'DATE_ONLY', 'TIME_SLOT'].includes(payload.timeMode)) {
      errors.push('timeMode 不合法');
    }
  }

  if (!partial || has('dateRange')) {
    if (!payload.dateRange || !isValidDateString(payload.dateRange.start) || !isValidDateString(payload.dateRange.end)) {
      errors.push('日期范围不合法');
    } else if (payload.dateRange.start > payload.dateRange.end) {
      errors.push('开始日期不能晚于结束日期');
    } else if (countDaysInclusive(payload.dateRange.start, payload.dateRange.end) > DATE_SPAN_LIMIT_DAYS) {
      errors.push(`日期范围不能超过${DATE_SPAN_LIMIT_DAYS}天`);
    }
  }

  const timeMode = payload.timeMode;
  const needsTimeRange = timeMode === 'time_slot' || timeMode === 'TIME_SLOT' || (!has('timeMode') && has('timeRange'));
  if (needsTimeRange && (!partial || has('timeRange'))) {
    if (!payload.timeRange || !isValidTimeString(payload.timeRange.start) || !isValidEndTimeString(payload.timeRange.end)) {
      errors.push('时间范围不合法');
    } else if (timeToMinutes(payload.timeRange.start) >= timeToMinutes(payload.timeRange.end)) {
      errors.push('开始时间必须早于结束时间');
    }
  }

  if (!partial || has('granularity')) {
    if (![30, 60].includes(Number(payload.granularity))) {
      errors.push('时间粒度不合法');
    }
  }

  if (has('allowInvite') && typeof payload.allowInvite !== 'boolean') {
    errors.push('allowInvite 必须是布尔值');
  }
  if (has('isDecisionPublic') && typeof payload.isDecisionPublic !== 'boolean') {
    errors.push('isDecisionPublic 必须是布尔值');
  }
  if (has('status') && !['ACTIVE', 'CONFIRMED', 'CLOSED', 'active', 'confirmed', 'closed'].includes(payload.status)) {
    errors.push('事件状态不合法');
  }

  return errors;
};

const normalizeConfirmedSlots = (body) => {
  if (Array.isArray(body.confirmedSlots)) {
    return body.confirmedSlots
      .filter(slot => slot && slot.date)
      .map(slot => ({
        date: String(slot.date),
        startTime: slot.startTime ? String(slot.startTime) : '',
        endTime: slot.endTime ? String(slot.endTime) : ''
      }));
  }

  const legacy = body.confirmedSlot;
  if (!legacy || !legacy.date) return [];

  const dates = String(legacy.date).split(',').map(v => v.trim()).filter(Boolean);
  const startTimes = legacy.startTime ? String(legacy.startTime).split(',').map(v => v.trim()) : [];
  const endTimes = legacy.endTime ? String(legacy.endTime).split(',').map(v => v.trim()) : [];

  return dates.map((date, index) => ({
    date,
    startTime: startTimes[index] || '',
    endTime: endTimes[index] || ''
  }));
};

// 确认时间必须落在活动当前允许的网格内：日期在范围内、时间命中合法格子、且不重复
const validateConfirmedSlots = (slots, event) => {
  const errors = [];
  if (!Array.isArray(slots) || slots.length === 0) {
    return ['缺少确认时间'];
  }
  if (slots.length > 200) {
    errors.push('确认时间数量过多');
  }

  const validKeys = event ? new Set(generateEventSlotKeys(event)) : null;
  const isDateOnly = String((event && event.timeMode) || '').toLowerCase() === 'date_only';
  const seen = new Set();

  slots.forEach((slot, index) => {
    const label = `第${index + 1}个确认`;

    if (!isValidDateString(slot.date)) {
      errors.push(`${label}日期不合法`);
      return;
    }
    if (event && !isDateWithinRange(slot.date, event.dateRange)) {
      errors.push(`${label}日期不在活动范围内`);
      return;
    }

    if (isDateOnly) {
      if (validKeys && !validKeys.has(slot.date)) {
        errors.push(`${label}日期不可选`);
        return;
      }
      if (seen.has(slot.date)) errors.push(`${label}日期重复`);
      seen.add(slot.date);
      return;
    }

    if (!isValidTimeString(slot.startTime) || !isValidEndTimeString(slot.endTime)
      || timeToMinutes(slot.startTime) >= timeToMinutes(slot.endTime)) {
      errors.push(`${label}时间不合法`);
      return;
    }

    const key = `${slot.date}_${slot.startTime}-${slot.endTime}`;
    if (validKeys && !validKeys.has(key)) {
      errors.push(`${label}时间不在活动可选范围内`);
      return;
    }
    if (seen.has(key)) errors.push(`${label}时间重复`);
    seen.add(key);
  });

  return errors;
};

const packLegacyConfirmedSlot = (slots) => {
  return {
    date: slots.map(slot => slot.date).join(','),
    startTime: slots.map(slot => slot.startTime || '').join(','),
    endTime: slots.map(slot => slot.endTime || '').join(',')
  };
};

const getConfirmedSlotsForEvent = (event) => {
  if (Array.isArray(event.confirmedSlots) && event.confirmedSlots.length > 0) {
    return event.confirmedSlots;
  }
  return normalizeConfirmedSlots({ confirmedSlot: event.confirmedSlot });
};

const latestAnnouncement = {
  id: '2026-05-25-weekly-unavailable',
  title: '常规不可用时段上线',
  content: '现在可以在「我的」里维护每周常规不可用时段。参与活动选择时间时，可一键套用并避开这些时段，仍然支持按本次情况手动调整。',
  publishedAt: '2026-05-25T00:00:00.000Z',
  actionText: '去设置',
  actionPath: '/pages/profile/weekly-unavailable/index'
};

// ==========================================
// 🛠️ 辅助函数：微信服务通知
// ==========================================
// 1. 获取微信 AccessToken
// access_token 必须缓存：微信对获取频率有配额，且新 token 会使旧 token 失效。
// 一次确认要给 N 个参与者发通知，绝不能每次都去换 token。
let wxAccessTokenCache = { token: '', expiresAt: 0 };
let wxAccessTokenPending = null;

const refreshWxAccessToken = async () => {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${process.env.WX_APPID}&secret=${process.env.WX_APPSECRET}`;
  const res = await axios.get(url, { timeout: 8000 });
  const data = res.data || {};
  if (data.errcode || !data.access_token) {
    throw new Error(`获取 access_token 失败: ${data.errmsg || data.errcode || 'unknown'}`);
  }
  const expiresIn = Number(data.expires_in) || 7200;
  wxAccessTokenCache = {
    token: data.access_token,
    // 提前 5 分钟视为过期，避免边界情况
    expiresAt: Date.now() + Math.max(60, expiresIn - 300) * 1000
  };
  return wxAccessTokenCache.token;
};

const getWxAccessToken = async (forceRefresh = false) => {
  if (!forceRefresh && wxAccessTokenCache.token && wxAccessTokenCache.expiresAt > Date.now()) {
    return wxAccessTokenCache.token;
  }
  if (forceRefresh) {
    wxAccessTokenCache = { token: '', expiresAt: 0 };
  }
  if (!wxAccessTokenPending) {
    wxAccessTokenPending = refreshWxAccessToken()
      .finally(() => { wxAccessTokenPending = null; });
  }
  return wxAccessTokenPending;
};

// 2. 发送订阅消息给指定用户 (🚨 完美适配真实确认时间和跨度包围逻辑)
const sendSubscribeMessage = async (openid, event, retried = false) => {
  try {
    const accessToken = await getWxAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`;

    // 格式化时间以符合微信 date 字段的严格要求 (YYYY年MM月DD日 HH:mm)
    const formatWxDate = (d) => {
      try {
        if (!d || isNaN(d.getTime())) throw new Error('Invalid Date');
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}年${month}月${day}日 ${hours}:${minutes}`;
      } catch (e) {
        return '2026年01月01日 12:00'; // 极限兜底
      }
    };

    // 优先读取 confirmedSlots 数组，兼容旧 confirmedSlot 字符串结构
    let earliestStart = new Date();
    let latestEnd = new Date();
    let isMultiple = false;

    const confirmedSlots = getConfirmedSlotsForEvent(event);
    if (confirmedSlots.length > 0) {
      isMultiple = confirmedSlots.length > 1;
      let startDates = [];
      let endDates = [];

      for (const slot of confirmedSlots) {
        // iOS 和部分 JS 引擎对 YYYY-MM-DD 解析严格，替换为 / 更安全
        const dStr = String(slot.date).replace(/-/g, '/');

        let st = slot.startTime || '';
        let et = slot.endTime || '';

        // 如果是仅日期模式（或者前端没传具体时间），补全全天
        if (event.timeMode === 'date_only' || event.timeMode === 'DATE_ONLY' || !st) {
          st = '00:00';
          et = '23:59';
        }

        startDates.push(new Date(`${dStr} ${st}:00`));
        endDates.push(new Date(`${dStr} ${et}:00`));
      }

      // 按时间先后排序，提取绝对边界
      startDates.sort((a, b) => a - b);
      endDates.sort((a, b) => a - b);

      if (startDates.length > 0) earliestStart = startDates[0];
      if (endDates.length > 0) latestEnd = endDates[endDates.length - 1];
    }

    // 动态生成防呆备注 (最多20字符)
    const remarkHint = isMultiple ? '含多个不连续时段，请点击查看' : '时间已最终确认，请点击查看';

    const data = {
      touser: openid,
      template_id: 'WENxWVN5m0myVwQAeA99G9ryFIhFHu5hcQFb1BLaSJU',
      page: `pages/event/detail/index?id=${event.id}`,
      data: {
        thing12: { value: (event.creatorNickName || '管理员').substring(0, 20) }, // 发布者
        date2: { value: formatWxDate(earliestStart) }, // 真实的开始边界时间
        date8: { value: formatWxDate(latestEnd) },     // 真实的结束边界时间
        thing11: { value: remarkHint }                 // 动态备注
      }
    };

    const res = await axios.post(url, data);
    const payload = res.data || {};
    if (payload.errcode && payload.errcode !== 0) {
      // 40001/40014/42001：token 失效，刷新后重试一次
      if (!retried && [40001, 40014, 42001].includes(Number(payload.errcode))) {
        await getWxAccessToken(true);
        return sendSubscribeMessage(openid, event, true);
      }
      console.error(`❌ 向 ${openid} 发送通知失败: ${payload.errcode} ${payload.errmsg || ''}`);
      return;
    }
    console.log(`✅ 已向 ${openid} 发送确认通知`);
  } catch (err) {
    console.error(`❌ 向 ${openid} 发送通知失败:`, err.response?.data || err.message);
  }
};


// ==========================================
// 🌟 公开接口 (无需 Token)
// ==========================================
app.post('/api/login', loginLimiter, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, error: '缺少 code' });
  try {
    const wxApiUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${process.env.WX_APPID}&secret=${process.env.WX_APPSECRET}&js_code=${code}&grant_type=authorization_code`;
    const wxResponse = await axios.get(wxApiUrl, { timeout: 8000 });
    const { openid, errcode, errmsg } = wxResponse.data || {};
    if (errcode || !openid) {
      const message = errmsg || '获取 openid 失败';
      const status = [40029, 40163].includes(Number(errcode)) ? 400 : 502;
      return res.status(status).json({ success: false, error: message });
    }

    const token = jwt.sign({ openid }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, data: { openid, token } });
  } catch (error) {
    console.error('微信登录失败:', error.response?.data || error.message);
    res.status(502).json({ success: false, error: '微信登录服务暂时不可用' });
  }
});

app.get('/api/announcement/latest', (req, res) => {
  res.json({ success: true, data: latestAnnouncement });
});

// ==========================================
// 1. 上传图片
app.post('/api/upload', verifyToken, uploadLimiter, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过2MB' : err.message || '上传失败';
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) return res.status(400).json({ success: false, error: '无文件' });

    // 第一道闸：只认文件头，声明 image/png 但实际是 HTML 的内容直接拒绝
    if (!detectImageExtension(req.file.buffer)) {
      return res.status(400).json({ success: false, error: '文件内容不是有效的图片' });
    }

    // 第二道闸：真正解码后重新编码，丢掉一切附加内容（EXIF/脚本/超限尺寸），
    // 输出格式固定为 JPEG，扩展名由服务端决定
    try {
      const processed = await sharp(req.file.buffer, { limitInputPixels: 30000000 })
        .rotate() // 按 EXIF 方向摆正，随后元数据会被丢弃
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();

      const filename = `${Date.now()}_${Math.round(Math.random() * 1e9)}.jpg`;
      fs.writeFile(path.join(uploadDir, filename), processed, (writeError) => {
        if (writeError) {
          console.error('保存上传文件失败:', writeError);
          return res.status(500).json({ success: false, error: '保存文件失败' });
        }
        res.json({ success: true, url: `${process.env.BASE_URL}/uploads/${filename}` });
      });
    } catch (decodeError) {
      console.error('图片解码失败:', decodeError.message);
      return res.status(400).json({ success: false, error: '图片无法解析，请更换一张图片' });
    }
  });
});

// 2. 创建事件
app.post('/api/events', verifyToken, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const openid = req.user.openid;
    const body = req.body || {};
    const inputErrors = validateEventInput(body);
    if (inputErrors.length > 0) {
      return res.status(400).json({ success: false, error: inputErrors[0], details: inputErrors });
    }

    // 时间范围必须能生成至少一个可选格子，避免创建出「零可选」活动
    if (generateEventSlotKeys(body).length === 0) {
      return res.status(400).json({ success: false, error: '时间范围不足一个时间粒度，无法生成可选的格子' });
    }

    const creatorParticipant = normalizeParticipant(
      {
        ...(Array.isArray(body.participants) ? body.participants[0] : {}),
        openid,
        userId: openid,
        nickName: body.creatorNickName || body.participants?.[0]?.nickName || '',
        avatarUrl: body.participants?.[0]?.avatarUrl || '',
        hasSubmitted: false,
        submittedAt: now
      },
      openid
    );
    // 只接收白名单字段：避免客户端注入 confirmedSlots / status / createdAt 等
    const newEvent = new Event({
      id: body.id,
      title: body.title,
      description: body.description || '',
      timeMode: body.timeMode,
      dateRange: { start: body.dateRange.start, end: body.dateRange.end },
      timeRange: body.timeRange ? { start: body.timeRange.start, end: body.timeRange.end } : undefined,
      granularity: Number(body.granularity),
      allowInvite: body.allowInvite !== false,
      isDecisionPublic: body.isDecisionPublic === true,
      creatorId: openid,
      creatorNickName: body.creatorNickName || creatorParticipant.nickName,
      adminIds: [],
      vipIds: [],
      participants: [creatorParticipant],
      status: 'ACTIVE',
      confirmedSlots: [],
      confirmedSlot: null,
      createdAt: now,
      updatedAt: now
    });
    await newEvent.save();
    res.json({ success: true, data: projectEventForViewer(newEvent, openid) });
  } catch (error) {
    console.error('创建事件失败:', error);
    res.status(500).json({ success: false, error: '创建失败' });
  }
});

// 3. 获取列表
app.get('/api/events', verifyToken, async (req, res) => {
  try {
    const openid = req.user.openid;

    const rawLimit = Number(req.query.limit);
    const rawOffset = Number(req.query.offset);
    // 不传 limit 时按上限返回，避免老版本小程序（不认识分页）被静默截断
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 200;
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

    const filter = {
      $or: [
        { creatorId: openid },
        { 'participants.openid': openid }
      ]
    };

    const [events, total] = await Promise.all([
      Event.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit),
      Event.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: events.map(event => projectEventForViewer(event, openid, { includeSlots: false })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + events.length < total
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: '获取失败' });
  }
});

// 4. 获取详情（按浏览者角色裁剪决策数据）
app.get('/api/events/:id', verifyToken, async (req, res) => {
  try {
    const event = await Event.findOne({ id: req.params.id });
    if (!event) return res.status(404).json({ success: false, error: '未找到' });
    res.json({ success: true, data: projectEventForViewer(event, req.user.openid) });
  } catch (error) {
    res.status(500).json({ success: false, error: '获取失败' });
  }
});

// 5. 修改事件基础信息 (PUT)
app.put('/api/events/:id', verifyToken, async (req, res) => {
  try {
    const existing = await requireEventManager(req, res);
    if (!existing) return;

    const body = req.body || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const allowedFields = [
      'title',
      'description',
      'dateRange',
      'timeRange',
      'granularity',
      'allowInvite',
      'isDecisionPublic',
      'status',
      'confirmedSlots',
      'confirmedSlot'
    ];
    const updates = {};
    allowedFields.forEach(field => {
      if (has(field)) updates[field] = body[field];
    });

    const inputErrors = validateEventInput(updates, true);
    if (inputErrors.length > 0) {
      return res.status(400).json({ success: false, error: inputErrors[0], details: inputErrors });
    }

    const currentStatus = String(existing.status || '').toUpperCase();
    const touchesGrid = ['dateRange', 'timeRange', 'granularity', 'timeMode'].some(field => has(field));

    // 已停止收集 / 已确认的活动不允许再改时间范围，否则推荐结果与活动范围会互相矛盾
    if (touchesGrid && currentStatus !== 'ACTIVE') {
      return res.status(409).json({ success: false, error: '活动已停止收集或已确认，不能修改时间范围' });
    }

    // 用「现有数据 + 本次修改」合并出最终事件，作为网格校验与裁剪的依据
    const base = typeof existing.toObject === 'function' ? existing.toObject() : { ...existing };
    const merged = { ...base, ...updates };
    if (has('timeRange') && updates.timeRange) {
      merged.timeRange = { start: updates.timeRange.start, end: updates.timeRange.end };
    }

    if (touchesGrid && generateEventSlotKeys(merged).length === 0) {
      return res.status(400).json({ success: false, error: '时间范围不足一个时间粒度，无法生成可选的格子' });
    }

    const requestedStatus = has('status') ? String(body.status).toUpperCase() : null;

    // 确认动作只能走 /confirm（那里会校验时间是否属于活动范围）
    if (requestedStatus === 'CONFIRMED') {
      return res.status(400).json({ success: false, error: '请通过确认时间接口完成确认' });
    }

    if (requestedStatus) {
      // 统一存大写，避免数据库里出现 'closed' / 'CLOSED' 两种写法
      updates.status = requestedStatus;
    }

    if (requestedStatus === 'ACTIVE') {
      // 撤销确认：清空确认时间并重新开放收集
      updates.confirmedSlots = [];
      updates.confirmedSlot = null;
    }

    // 显式提交确认时间时同样要校验，避免绕过 /confirm 写入越界时间
    if (has('confirmedSlots') || has('confirmedSlot')) {
      const confirmedSlots = normalizeConfirmedSlots(body);
      if (confirmedSlots.length === 0) {
        updates.confirmedSlots = [];
        updates.confirmedSlot = null;
      } else {
        const slotErrors = validateConfirmedSlots(confirmedSlots, merged);
        if (slotErrors.length > 0) {
          return res.status(400).json({ success: false, error: slotErrors[0], details: slotErrors });
        }
        updates.confirmedSlots = confirmedSlots;
        updates.confirmedSlot = packLegacyConfirmedSlot(confirmedSlots);
      }
    }

    // 修改时间范围后，清理不再合法的投票，避免旧时间继续进入推荐
    let prunedSlots = 0;
    let prunedParticipants = 0;
    if (touchesGrid) {
      const validKeys = new Set(generateEventSlotKeys(merged));
      updates.participants = (base.participants || []).map((participant) => {
        const plain = toPlainParticipant(participant);
        const kept = plain.availableSlots.filter(slot => validKeys.has(slot));
        if (kept.length !== plain.availableSlots.length) {
          prunedParticipants += 1;
          prunedSlots += plain.availableSlots.length - kept.length;
        }
        return {
          ...plain,
          availableSlots: kept,
          // 投票被裁剪干净后就不再算「已填写」，让成员重新填一次
          hasSubmitted: kept.length > 0 ? plain.hasSubmitted : false
        };
      });
    }

    updates.updatedAt = new Date().toISOString();

    // 带上原状态做乐观并发控制：期间状态被别处改掉就返回冲突，而不是覆盖
    const event = await Event.findOneAndUpdate(
      { id: req.params.id, status: existing.status },
      updates,
      { returnDocument: 'after' }
    );
    if (!event) {
      return res.status(409).json({ success: false, error: '活动状态已变化，请刷新后重试' });
    }

    res.json({
      success: true,
      data: projectEventForViewer(event, req.user.openid),
      pruned: { participants: prunedParticipants, slots: prunedSlots }
    });
  } catch (error) {
    console.error('更新事件失败:', error);
    res.status(500).json({ success: false, error: '更新失败' });
  }
});

// 彻底删除事件 (DELETE)
app.delete('/api/events/:id', verifyToken, async (req, res) => {
  try {
    const existing = await requireEventManager(req, res);
    if (!existing) return;
    const event = await Event.findOneAndDelete({ id: req.params.id });
    res.json({ success: true, data: event });
  } catch (error) {
    console.error('删除事件失败:', error);
    res.status(500).json({ success: false, error: '删除失败' });
  }
});

// 6. 更新人员时间
app.post('/api/events/:id/availability', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nickName, avatarUrl, availableSlots, isProxy } = req.body || {};
    const openid = isProxy ? '' : req.user.openid;
    const event = await Event.findOne({ id });
    if (!event) return res.status(404).json({ success: false, error: '未找到' });

    if (isProxy && !canManageEvent(event, req.user.openid)) {
      return res.status(403).json({ success: false, error: '无权代填该事件' });
    }

    // 只有 ACTIVE 才接受提交；停止收集/已确认的活动一律拒绝
    if (String(event.status || '').toUpperCase() !== 'ACTIVE') {
      return res.status(409).json({ success: false, error: '活动已停止收集或已确认，无法再提交时间' });
    }

    if (!Array.isArray(availableSlots)) {
      return res.status(400).json({ success: false, error: 'availableSlots 必须是数组' });
    }
    if (typeof nickName !== 'string' || nickName.trim().length === 0 || nickName.length > 50) {
      return res.status(400).json({ success: false, error: '昵称不合法' });
    }
    if (availableSlots.length > 3000 || availableSlots.some(slot => typeof slot !== 'string' || slot.length > 80)) {
      return res.status(400).json({ success: false, error: '可用时间数据不合法' });
    }

    const existingIndex = event.participants.findIndex(p => {
      if (openid) return p.openid === openid;
      return p.nickName === nickName && !p.openid;
    });

    // 「允许参与者邀请」关闭后，新成员不能只凭活动 ID 自行加入
    if (!isProxy && existingIndex < 0 && event.allowInvite === false) {
      return res.status(403).json({ success: false, error: '该活动已关闭邀请，无法加入' });
    }

    // 白名单校验：只接受活动当前网格内的格子，并去重
    const validKeys = new Set(generateEventSlotKeys(event));
    if (validKeys.size === 0) {
      return res.status(409).json({ success: false, error: '活动时间配置异常，暂时无法提交' });
    }
    const uniqueSlots = new Set();
    for (const slot of availableSlots) {
      if (!validKeys.has(slot)) {
        return res.status(400).json({ success: false, error: '提交的时间不在活动允许的范围内' });
      }
      uniqueSlots.add(slot);
    }
    const normalizedSlots = Array.from(uniqueSlots);

    const now = new Date().toISOString();
    let nextParticipant;
    if (existingIndex >= 0) {
      const existing = toPlainParticipant(event.participants[existingIndex]);
      nextParticipant = {
        participantId: existing.participantId || existing.openid || generateParticipantId(),
        userId: existing.userId || existing.openid || openid || nickName,
        openid: openid || existing.openid,
        nickName: nickName || existing.nickName,
        eventDisplayName: existing.eventDisplayName,
        avatarUrl: avatarUrl || existing.avatarUrl,
        availableSlots: normalizedSlots,
        hasSubmitted: true,
        submittedAt: now
      };
    } else {
      nextParticipant = {
        participantId: openid || generateParticipantId(),
        userId: openid || nickName,
        openid: openid || '',
        nickName,
        eventDisplayName: '',
        avatarUrl: avatarUrl || '',
        availableSlots: normalizedSlots,
        hasSubmitted: true,
        submittedAt: now
      };
    }

    // 写入时把状态一起放进条件里：与「停止收集 / 确认」并发时不会写入已锁定的活动
    const statusFilter = { id, status: { $in: ['ACTIVE', 'active'] } };
    let result;
    if (existingIndex >= 0) {
      const participantMatch = nextParticipant.participantId
        ? { 'participants.participantId': nextParticipant.participantId }
        : (openid
          ? { 'participants.openid': openid }
          : { 'participants.nickName': nickName, 'participants.openid': '' });
      result = await Event.updateOne(
        { ...statusFilter, ...participantMatch },
        { $set: { 'participants.$': nextParticipant, updatedAt: now } }
      );
    } else {
      result = await Event.updateOne(
        statusFilter,
        { $push: { participants: nextParticipant }, $set: { updatedAt: now } }
      );
    }

    if (!result || result.matchedCount === 0) {
      return res.status(409).json({ success: false, error: '活动已停止收集或已确认，无法再提交时间' });
    }

    res.json({ success: true, data: { hasSubmitted: true, availableSlots: normalizedSlots } });
  } catch (error) {
    console.error('更新时间失败:', error);
    res.status(500).json({ success: false, error: '更新失败' });
  }
});

// 7. 确认时间 (🚨 修复 Bug 2：完美匹配订阅模板字段)
app.post('/api/events/:id/confirm', verifyToken, async (req, res) => {
  try {
    const existing = await requireEventManager(req, res);
    if (!existing) return;

    const currentStatus = String(existing.status || '').toUpperCase();
    if (currentStatus === 'CLOSED') {
      return res.status(409).json({ success: false, error: '活动已关闭，无法确认时间' });
    }

    const confirmedSlots = normalizeConfirmedSlots(req.body);
    // 确认的时间必须落在活动当前的合法网格内（日期 + 时段 + 粒度）
    const slotErrors = validateConfirmedSlots(confirmedSlots, existing);
    if (slotErrors.length > 0) {
      return res.status(400).json({ success: false, error: slotErrors[0], details: slotErrors });
    }
    const confirmedSlot = packLegacyConfirmedSlot(confirmedSlots);
    const event = await Event.findOneAndUpdate(
      { id: req.params.id, status: existing.status },
      { status: 'CONFIRMED', confirmedSlots, confirmedSlot, updatedAt: new Date().toISOString() },
      { returnDocument: 'after' }
    );
    if (!event) {
      return res.status(409).json({ success: false, error: '活动状态已变化，请刷新后重试' });
    }

    // 1. 优先把成功响应返回给前端，保证界面不卡顿
    res.json({ success: true, data: projectEventForViewer(event, req.user.openid) });

    // 2. 异步向所有有 openid 且提交过的人发送微信通知
    if (event && event.participants) {
      const targetUsers = event.participants.filter(p => p.openid && (
        p.hasSubmitted === true || (Array.isArray(p.availableSlots) && p.availableSlots.length > 0)
      ));
      targetUsers.forEach(user => {
        // 传入整个 event 对象，以提取发布者等信息
        sendSubscribeMessage(user.openid, event);
      });
    }
  } catch (error) {
    console.error('确认时间失败:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: '确认失败' });
    }
  }
});

// 8. 成员管理 (🚨 修复 Bug 1：补齐 VIP 逻辑)
app.post('/api/events/:id/members', verifyToken, async (req, res) => {
  try {
    const { targetOpenid, targetParticipantId, targetNickName, targetDisplayName, action } = req.body || {};
    const event = await Event.findOne({ id: req.params.id });
    if (!event) return res.status(404).json({ success: false, error: '未找到' });

    // 确保数组不为 undefined
    if (!event.adminIds) event.adminIds = [];
    if (!event.vipIds) event.vipIds = [];

    const callerOpenid = req.user.openid;

    // 找到目标成员
    const findTarget = () => event.participants.find(p => {
      if (targetParticipantId && p.participantId === targetParticipantId) return true;
      if (targetOpenid && p.openid === targetOpenid) return true;
      return !targetOpenid && !targetParticipantId && !!targetNickName && p.nickName === targetNickName;
    });

    const target = findTarget();
    const resolvedOpenid = targetOpenid || target?.openid || '';

    // 「自己退出活动」：这是普通参与者的能力，不受管理员权限限制。
    // 同时兼容旧版小程序——旧版退出走的也是 KICK_MEMBER（目标是自己）。
    const wantsLeave = action === 'LEAVE_EVENT';
    const kicksSelf = action === 'KICK_MEMBER'
      && !!callerOpenid
      && resolvedOpenid === callerOpenid;

    if (wantsLeave || kicksSelf) {
      if (isEventCreator(event, callerOpenid)) {
        return res.status(403).json({ success: false, error: '发起人不能退出活动，请删除活动或先转移发起人' });
      }

      // 只按调用者自己的 openid 删除，绝不使用客户端传来的目标
      const selfParticipant = event.participants.find(p => p.openid && p.openid === callerOpenid);
      if (!selfParticipant) {
        return res.status(404).json({ success: false, error: '你不在该活动的成员列表中' });
      }

      event.participants = event.participants.filter(p => !(p.openid && p.openid === callerOpenid));
      event.adminIds = event.adminIds.filter(id => id !== callerOpenid);
      event.vipIds = event.vipIds.filter(id => id !== callerOpenid);
      event.updatedAt = new Date().toISOString();
      event.markModified('participants');
      await event.save();
      return res.json({ success: true, data: { left: true } });
    }

    if (!target && action !== 'REMOVE_ADMIN' && action !== 'REMOVE_VIP') {
      return res.status(404).json({ success: false, error: '未找到该成员' });
    }

    if (!canManageEvent(event, callerOpenid)) {
      return res.status(403).json({ success: false, error: '无权操作该事件' });
    }

    // 服务端强制执行角色层级，和前端界面的权限承诺保持一致
    const authError = authorizeMemberAction({
      event,
      actorOpenid: callerOpenid,
      action,
      targetParticipant: target,
      targetOpenid: resolvedOpenid
    });
    if (authError) {
      const status = authError === '无效的成员操作' ? 400 : 403;
      return res.status(status).json({ success: false, error: authError });
    }

    if (action === 'RENAME_MEMBER') {
      const nextName = typeof targetDisplayName === 'string' ? targetDisplayName.trim() : '';
      if (nextName.length > 20) {
        return res.status(400).json({ success: false, error: '显示名称不能超过20个字' });
      }
      target.eventDisplayName = nextName;
    } else if (action === 'KICK_MEMBER') {
      event.participants = event.participants.filter(p => {
        if (resolvedOpenid) return p.openid !== resolvedOpenid;
        if (targetParticipantId) return p.participantId !== targetParticipantId;
        return p.nickName !== targetNickName;
      });
      // 移除成员时同步回收角色，避免「被移除的管理员仍然有权限」
      if (resolvedOpenid) {
        event.adminIds = event.adminIds.filter(id => id !== resolvedOpenid);
        event.vipIds = event.vipIds.filter(id => id !== resolvedOpenid);
      }
    } else if (action === 'SET_ADMIN') {
      if (!event.adminIds.includes(resolvedOpenid)) event.adminIds.push(resolvedOpenid);
    } else if (action === 'REMOVE_ADMIN') {
      event.adminIds = event.adminIds.filter(id => id !== resolvedOpenid);
    }
    // 👇 补齐：设为重点嘉宾与取消
    else if (action === 'SET_VIP') {
      if (!event.vipIds.includes(resolvedOpenid)) event.vipIds.push(resolvedOpenid);
    } else if (action === 'REMOVE_VIP') {
      event.vipIds = event.vipIds.filter(id => id !== resolvedOpenid);
    } else {
      return res.status(400).json({ success: false, error: '无效的成员操作' });
    }

    event.updatedAt = new Date().toISOString();
    event.markModified('participants');
    await event.save();
    res.json({ success: true, data: projectEventForViewer(event, req.user.openid) });
  } catch (error) {
    console.error('成员管理失败:', error);
    res.status(500).json({ success: false, error: '操作失败' });
  }
});

// 9. 全局更新用户资料
app.post('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const { nickName, avatarUrl } = req.body || {};
    const openid = req.user.openid;

    if (nickName !== undefined) {
      if (typeof nickName !== 'string' || nickName.trim().length === 0 || nickName.trim().length > 20) {
        return res.status(400).json({ success: false, error: '昵称不能为空且不能超过20个字' });
      }
    }
    if (avatarUrl !== undefined) {
      if (typeof avatarUrl !== 'string' || avatarUrl.length > 500
        || !/^https?:\/\//i.test(avatarUrl)) {
        return res.status(400).json({ success: false, error: '头像地址不合法' });
      }
    }

    if (nickName) {
      await Event.updateMany(
        { creatorId: openid },
        { $set: { creatorNickName: nickName } }
      );
    }

    const updateFields = {};
    if (nickName) updateFields["participants.$[elem].nickName"] = nickName;
    if (avatarUrl) updateFields["participants.$[elem].avatarUrl"] = avatarUrl;

    if (Object.keys(updateFields).length > 0) {
      await Event.updateMany(
        { "participants.openid": openid },
        { $set: updateFields },
        { arrayFilters: [{ "elem.openid": openid }] }
      );
    }

    res.json({ success: true, message: '全局资料已同步更新' });
  } catch (error) {
    console.error('更新用户资料失败:', error);
    res.status(500).json({ success: false, error: '全局资料更新失败' });
  }
});

app.get('/api/user/weekly-unavailable', verifyToken, async (req, res) => {
  try {
    const preference = await UserPreference.findOne({ openid: req.user.openid });
    res.json({
      success: true,
      data: {
        weeklyUnavailableSlots: preference?.weeklyUnavailableSlots || [],
        autoApplyWeeklyUnavailable: preference?.autoApplyWeeklyUnavailable === true
      }
    });
  } catch (error) {
    console.error('获取常规不可用时段失败:', error);
    res.status(500).json({ success: false, error: '获取常规不可用时段失败' });
  }
});

app.put('/api/user/weekly-unavailable', verifyToken, async (req, res) => {
  try {
    const weeklyUnavailableSlots = Array.isArray(req.body?.weeklyUnavailableSlots)
      ? Array.from(new Set(req.body.weeklyUnavailableSlots))
      : [];
    const autoApplyWeeklyUnavailable = req.body?.autoApplyWeeklyUnavailable === true;

    if (weeklyUnavailableSlots.length > 336 || weeklyUnavailableSlots.some(slot => !isValidWeeklySlotKey(slot))) {
      return res.status(400).json({ success: false, error: '常规不可用时段数据不合法' });
    }

    const preference = await UserPreference.findOneAndUpdate(
      { openid: req.user.openid },
      {
        weeklyUnavailableSlots,
        autoApplyWeeklyUnavailable,
        updatedAt: new Date().toISOString()
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      data: {
        weeklyUnavailableSlots: preference.weeklyUnavailableSlots,
        autoApplyWeeklyUnavailable: preference.autoApplyWeeklyUnavailable
      }
    });
  } catch (error) {
    console.error('保存常规不可用时段失败:', error);
    res.status(500).json({ success: false, error: '保存常规不可用时段失败' });
  }
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB 数据库连接成功！安全防御已开启！');
    app.listen(process.env.PORT || 3000, () => {
      console.log(`🚀 API 引擎已就绪: ${process.env.BASE_URL}`);
    });
  })
  .catch(err => console.error('❌ MongoDB 连接失败:', err.message));
