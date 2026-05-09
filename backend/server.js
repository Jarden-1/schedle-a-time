require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const Event = require('./models/Event');

const app = express();
app.use(cors());
app.use(express.json());

// 1. 静态文件夹配置
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(uploadDir));

// 2. 🚨 防御升级：Multer 配置，加入 2MB 大小限制和类型校验
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '_' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.png';
    cb(null, uniqueSuffix + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 最大 2MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
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

const canManageEvent = (event, openid) => {
  if (!event || !openid) return false;
  if (event.creatorId === openid) return true;
  return Array.isArray(event.adminIds) && event.adminIds.includes(openid);
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
    submittedAt: participant.submittedAt || new Date().toISOString()
  };
};

const isValidDateString = (value) => {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
};

const isValidTimeString = (value) => {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
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
    }
  }

  const timeMode = payload.timeMode;
  const needsTimeRange = timeMode === 'time_slot' || timeMode === 'TIME_SLOT' || (!has('timeMode') && has('timeRange'));
  if (needsTimeRange && (!partial || has('timeRange'))) {
    if (!payload.timeRange || !isValidTimeString(payload.timeRange.start) || !isValidTimeString(payload.timeRange.end)) {
      errors.push('时间范围不合法');
    } else if (payload.timeRange.start >= payload.timeRange.end) {
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

const validateConfirmedSlots = (slots) => {
  const errors = [];
  if (!Array.isArray(slots) || slots.length === 0) {
    return ['缺少确认时间'];
  }
  if (slots.length > 200) {
    errors.push('确认时间数量过多');
  }
  slots.forEach((slot, index) => {
    if (!isValidDateString(slot.date)) {
      errors.push(`第${index + 1}个确认日期不合法`);
    }
    if ((slot.startTime || slot.endTime) && (!isValidTimeString(slot.startTime) || !isValidTimeString(slot.endTime) || slot.startTime >= slot.endTime)) {
      errors.push(`第${index + 1}个确认时间不合法`);
    }
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

// ==========================================
// 🛠️ 辅助函数：微信服务通知
// ==========================================
// 1. 获取微信 AccessToken
const getWxAccessToken = async () => {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${process.env.WX_APPID}&secret=${process.env.WX_APPSECRET}`;
  const res = await axios.get(url);
  if (res.data && res.data.access_token) return res.data.access_token;
  throw new Error('获取 access_token 失败');
};

// 2. 发送订阅消息给指定用户 (🚨 完美适配真实确认时间和跨度包围逻辑)
const sendSubscribeMessage = async (openid, event) => {
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
    console.log(`✅ 已向 ${openid} 发送确认通知, 微信返回结果:`, res.data);
  } catch (err) {
    console.error(`❌ 向 ${openid} 发送通知失败:`, err.response?.data || err.message);
  }
};


// ==========================================
// 🌟 公开接口 (无需 Token)
// ==========================================
app.post('/api/login', async (req, res) => {
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

// ==========================================
// 1. 上传图片
app.post('/api/upload', verifyToken, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过2MB' : err.message || '上传失败';
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) return res.status(400).json({ success: false, error: '无文件' });
    res.json({ success: true, url: `${process.env.BASE_URL}/uploads/${req.file.filename}` });
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
    const creatorParticipant = normalizeParticipant(
      {
        ...(Array.isArray(body.participants) ? body.participants[0] : {}),
        openid,
        userId: openid,
        nickName: body.creatorNickName || body.participants?.[0]?.nickName || '',
        avatarUrl: body.participants?.[0]?.avatarUrl || '',
        submittedAt: now
      },
      openid
    );
    const newEvent = new Event({
      ...body,
      creatorId: openid,
      adminIds: [],
      vipIds: [],
      participants: [creatorParticipant],
      status: body.status || 'ACTIVE',
      createdAt: body.createdAt || now,
      updatedAt: now
    });
    await newEvent.save();
    res.json({ success: true, data: newEvent });
  } catch (error) {
    console.error('创建事件失败:', error);
    res.status(500).json({ success: false, error: '创建失败' });
  }
});

// 3. 获取列表
app.get('/api/events', verifyToken, async (req, res) => {
  try {
    const openid = req.user.openid;
    const events = await Event.find({
      $or: [
        { creatorId: openid },
        { 'participants.openid': openid }
      ]
    }).sort({ createdAt: -1 });
    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, error: '获取失败' });
  }
});

// 4. 获取详情
app.get('/api/events/:id', verifyToken, async (req, res) => {
  try {
    const event = await Event.findOne({ id: req.params.id });
    if (!event) return res.status(404).json({ success: false, error: '未找到' });
    res.json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, error: '获取失败' });
  }
});

// 5. 修改事件基础信息 (PUT)
app.put('/api/events/:id', verifyToken, async (req, res) => {
  try {
    const existing = await requireEventManager(req, res);
    if (!existing) return;
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
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    });
    const inputErrors = validateEventInput(updates, true);
    if (inputErrors.length > 0) {
      return res.status(400).json({ success: false, error: inputErrors[0], details: inputErrors });
    }
    updates.updatedAt = new Date().toISOString();
    if (Array.isArray(updates.confirmedSlots)) {
      updates.confirmedSlot = packLegacyConfirmedSlot(updates.confirmedSlots);
    } else if (updates.confirmedSlot && !updates.confirmedSlots) {
      updates.confirmedSlots = normalizeConfirmedSlots({ confirmedSlot: updates.confirmedSlot });
    }
    const event = await Event.findOneAndUpdate({ id: req.params.id }, updates, { returnDocument: 'after' });
    res.json({ success: true, data: event });
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
    const { nickName, avatarUrl, availableSlots, isProxy } = req.body;
    const openid = isProxy ? '' : req.user.openid;
    const event = await Event.findOne({ id });
    if (!event) return res.status(404).json({ success: false, error: '未找到' });

    if (isProxy && !canManageEvent(event, req.user.openid)) {
      return res.status(403).json({ success: false, error: '无权代填该事件' });
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

    if (existingIndex >= 0) {
      const existing = event.participants[existingIndex];
      event.participants[existingIndex] = {
        ...existing,
        participantId: existing.participantId || existing.openid || generateParticipantId(),
        avatarUrl: avatarUrl || existing.avatarUrl,
        openid: openid || existing.openid,
        nickName: nickName || existing.nickName,
        availableSlots,
        submittedAt: new Date().toISOString()
      };
    } else {
      event.participants.push({
        participantId: openid || generateParticipantId(),
        userId: openid || nickName,
        openid: openid || '',
        nickName,
        avatarUrl: avatarUrl || '', availableSlots, submittedAt: new Date().toISOString()
      });
    }
    event.updatedAt = new Date().toISOString();
    event.markModified('participants');
    await event.save();
    res.json({ success: true });
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
    const confirmedSlots = normalizeConfirmedSlots(req.body);
    const slotErrors = validateConfirmedSlots(confirmedSlots);
    if (slotErrors.length > 0) {
      return res.status(400).json({ success: false, error: slotErrors[0], details: slotErrors });
    }
    const confirmedSlot = packLegacyConfirmedSlot(confirmedSlots);
    const event = await Event.findOneAndUpdate(
      { id: req.params.id },
      { status: 'CONFIRMED', confirmedSlots, confirmedSlot, updatedAt: new Date().toISOString() },
      { returnDocument: 'after' }
    );

    // 1. 优先把成功响应返回给前端，保证界面不卡顿
    res.json({ success: true, data: event });

    // 2. 异步向所有有 openid 且有空的人发送微信通知
    if (event && event.participants) {
      const targetUsers = event.participants.filter(p => p.openid && p.availableSlots && p.availableSlots.length > 0);
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
    const { targetOpenid, targetParticipantId, targetNickName, targetDisplayName, action } = req.body;
    const event = await requireEventManager(req, res);
    if (!event) return;

    // 确保数组不为 undefined
    if (!event.adminIds) event.adminIds = [];
    if (!event.vipIds) event.vipIds = [];

    const target = event.participants.find(p => {
      if (targetOpenid && p.openid === targetOpenid) return true;
      if (targetParticipantId && p.participantId === targetParticipantId) return true;
      return !targetOpenid && !targetParticipantId && targetNickName && p.nickName === targetNickName;
    });

    if (!target && action !== 'REMOVE_ADMIN' && action !== 'REMOVE_VIP') {
      return res.status(404).json({ success: false, error: '未找到该成员' });
    }

    const resolvedOpenid = targetOpenid || target?.openid || '';

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
    } else if (action === 'SET_ADMIN' && resolvedOpenid) {
      if (!event.adminIds.includes(resolvedOpenid)) event.adminIds.push(resolvedOpenid);
    } else if (action === 'REMOVE_ADMIN' && resolvedOpenid) {
      event.adminIds = event.adminIds.filter(id => id !== resolvedOpenid);
    }
    // 👇 补齐：设为重点嘉宾与取消
    else if (action === 'SET_VIP' && resolvedOpenid) {
      if (!event.vipIds.includes(resolvedOpenid)) event.vipIds.push(resolvedOpenid);
    } else if (action === 'REMOVE_VIP' && resolvedOpenid) {
      event.vipIds = event.vipIds.filter(id => id !== resolvedOpenid);
    } else {
      return res.status(400).json({ success: false, error: '无效的成员操作' });
    }

    event.updatedAt = new Date().toISOString();
    event.markModified('participants');
    await event.save();
    res.json({ success: true });
  } catch (error) {
    console.error('成员管理失败:', error);
    res.status(500).json({ success: false, error: '操作失败' });
  }
});

// 9. 全局更新用户资料
app.post('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const { nickName, avatarUrl } = req.body;
    const openid = req.user.openid;

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

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB 数据库连接成功！安全防御已开启！');
    app.listen(process.env.PORT || 3000, () => {
      console.log(`🚀 API 引擎已就绪: ${process.env.BASE_URL}`);
    });
  })
  .catch(err => console.error('❌ MongoDB 连接失败:', err.message));
