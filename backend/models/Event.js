// 文件路径: models/Event.js
const mongoose = require('mongoose');

// 参与者子结构
const ParticipantSchema = new mongoose.Schema({
  userId: String,
  openid: String,
  nickName: String,
  avatarUrl: String,
  availableSlots: [String],
  submittedAt: String
}, { _id: false });

// 核心事件结构 (完美映射前端的 Event 类型)
const EventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // 我们自己生成的业务 ID
  title: String,
  description: String,
  creatorId: String,
  creatorNickName: String,
  timeMode: String,
  dateRange: { start: String, end: String },
  timeRange: { start: String, end: String },
  granularity: Number,
  allowInvite: Boolean,
  isDecisionPublic: Boolean,
  status: { type: String, default: 'ACTIVE' },
  adminIds: [String],
  vipIds: [String],
  participants: [ParticipantSchema],
  confirmedSlot: { date: String, startTime: String, endTime: String },
  createdAt: String,
  updatedAt: String
});

module.exports = mongoose.model('Event', EventSchema);