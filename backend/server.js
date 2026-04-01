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

    // 🚨 核心魔术：解析逗号压缩的 confirmedSlot，寻找时间边界
    let earliestStart = new Date();
    let latestEnd = new Date();
    let isMultiple = false;

    if (event.confirmedSlot && event.confirmedSlot.date) {
      const dates = event.confirmedSlot.date.split(',');
      const startTimes = event.confirmedSlot.startTime ? String(event.confirmedSlot.startTime).split(',') : [];
      const endTimes = event.confirmedSlot.endTime ? String(event.confirmedSlot.endTime).split(',') : [];
      
      isMultiple = dates.length > 1;
      let startDates = [];
      let endDates = [];

      for (let i = 0; i < dates.length; i++) {
        // iOS 和部分 JS 引擎对 YYYY-MM-DD 解析严格，替换为 / 更安全
        const dStr = dates[i].replace(/-/g, '/');
        
        let st = startTimes[i] || '';
        let et = endTimes[i] || '';

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
  const { code } = req.body;
  if (!code) return res.status(400).json({ success: false, error: '缺少 code' });
  try {
    const wxApiUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${process.env.WX_APPID}&secret=${process.env.WX_APPSECRET}&js_code=${code}&grant_type=authorization_code`;
    const wxResponse = await axios.get(wxApiUrl);
    const { openid, errcode, errmsg } = wxResponse.data;
    if (errcode || !openid) throw new Error(errmsg || '获取 openid 失败');

    const token = jwt.sign({ openid }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, data: { openid, token } });
  } catch (error) {
    console.error('微信登录失败:', error.message);
    res.status(500).json({ success: false, error: '登录认证失败' });
  }
});

// ==========================================
// 🌟 保护接口 (必须携带 Token)
// ==========================================
// 1. 上传图片 
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '无文件' });
  res.json({ success: true, url: `${process.env.BASE_URL}/uploads/${req.file.filename}` });
});

// 2. 创建事件
app.post('/api/events', verifyToken, async (req, res) => {
  try {
    const newEvent = new Event(req.body);
    await newEvent.save();
    res.json({ success: true, data: newEvent });
  } catch (error) {
    res.status(500).json({ success: false, error: '创建失败' });
  }
});

// 3. 获取列表
app.get('/api/events', verifyToken, async (req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 });
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
    const event = await Event.findOneAndUpdate({ id: req.params.id }, req.body, { new: true });
    if (!event) return res.status(404).json({ success: false, error: '未找到' });
    res.json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, error: '更新失败' });
  }
});

// 彻底删除事件 (DELETE)
app.delete('/api/events/:id', verifyToken, async (req, res) => {
  try {
    const event = await Event.findOneAndDelete({ id: req.params.id });
    if (!event) return res.status(404).json({ success: false, error: '未找到该事件' });
    res.json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, error: '删除失败' });
  }
});

// 6. 更新人员时间 
app.post('/api/events/:id/availability', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nickName, avatarUrl, openid, availableSlots } = req.body;
    const event = await Event.findOne({ id });
    if (!event) return res.status(404).json({ success: false, error: '未找到' });

    const existingIndex = event.participants.findIndex(p => 
      (openid && p.openid === openid) || (p.nickName === nickName)
    );

    if (existingIndex >= 0) {
      const existing = event.participants[existingIndex];
      event.participants[existingIndex] = {
        ...existing,
        avatarUrl: avatarUrl || existing.avatarUrl,
        openid: openid || existing.openid,
        nickName: nickName || existing.nickName, 
        availableSlots,
        submittedAt: new Date().toISOString()
      };
    } else {
      event.participants.push({
        userId: openid || nickName, openid: openid || '', nickName,
        avatarUrl: avatarUrl || '', availableSlots, submittedAt: new Date().toISOString()
      });
    }
    event.updatedAt = new Date().toISOString();
    event.markModified('participants');
    await event.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: '更新失败' });
  }
});

// 7. 确认时间 (🚨 修复 Bug 2：完美匹配订阅模板字段)
app.post('/api/events/:id/confirm', verifyToken, async (req, res) => {
  try {
    const event = await Event.findOneAndUpdate(
      { id: req.params.id },
      { status: 'CONFIRMED', confirmedSlot: req.body.confirmedSlot, updatedAt: new Date().toISOString() },
      { new: true }
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
    const { targetOpenid, targetNickName, action } = req.body;
    const event = await Event.findOne({ id: req.params.id });
    if (!event) return res.status(404).json({ success: false, error: '未找到' });

    // 确保数组不为 undefined
    if (!event.adminIds) event.adminIds = [];
    if (!event.vipIds) event.vipIds = [];

    if (action === 'KICK_MEMBER') {
      event.participants = event.participants.filter(p => p.nickName !== targetNickName);
    } else if (action === 'SET_ADMIN' && targetOpenid) {
      if (!event.adminIds.includes(targetOpenid)) event.adminIds.push(targetOpenid);
    } else if (action === 'REMOVE_ADMIN' && targetOpenid) {
      event.adminIds = event.adminIds.filter(id => id !== targetOpenid);
    } 
    // 👇 补齐：设为重点嘉宾与取消
    else if (action === 'SET_VIP' && targetOpenid) {
      if (!event.vipIds.includes(targetOpenid)) event.vipIds.push(targetOpenid);
    } else if (action === 'REMOVE_VIP' && targetOpenid) {
      event.vipIds = event.vipIds.filter(id => id !== targetOpenid);
    }
    
    event.updatedAt = new Date().toISOString();
    await event.save();
    res.json({ success: true });
  } catch (error) {
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