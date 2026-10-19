const mongoose = require('mongoose');

/**
 * 前端埋点原始事件。
 *
 * 只存结构化字段，不存任何用户输入内容（活动标题、昵称等一律不落库）。
 * 保留 180 天，靠 TTL 索引自动过期，不需要额外的清理脚本。
 */
const TelemetryEventSchema = new mongoose.Schema(
  {
    // 客户端上报的时间戳（毫秒）
    ts: { type: Number, required: true },
    // 服务端落库时间，TTL 以它为准
    createdAt: { type: Date, default: Date.now, index: { expires: '180d' } },
    event: { type: String, required: true },   // page_view / create_submit / ...
    page: { type: String, default: '' },       // 页面路径标识
    openid: { type: String, default: '' },     // 用户身份
    sessionId: { type: String, default: '' },  // 30 分钟无操作切分
    version: { type: String, default: '' },    // 小程序版本
    props: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { versionKey: false }
);

TelemetryEventSchema.index({ ts: -1 });
TelemetryEventSchema.index({ event: 1, ts: -1 });
TelemetryEventSchema.index({ openid: 1, ts: -1 });

module.exports = mongoose.model('TelemetryEvent', TelemetryEventSchema);
