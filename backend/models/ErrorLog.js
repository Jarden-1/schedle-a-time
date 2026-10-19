const mongoose = require('mongoose');

/**
 * 错误记录（后端 + 小程序端）。
 * 保留 30 天，靠 TTL 自动过期。
 */
const ErrorLogSchema = new mongoose.Schema(
  {
    createdAt: { type: Date, default: Date.now, index: { expires: '30d' } },
    source: { type: String, default: 'backend' }, // backend | miniapp
    level: { type: String, default: 'error' },    // error | warn
    message: { type: String, default: '' },
    stack: { type: String, default: '' },
    page: { type: String, default: '' },
    path: { type: String, default: '' },          // 接口路径 / 页面路径
    openid: { type: String, default: '' },
    version: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { versionKey: false }
);

ErrorLogSchema.index({ createdAt: -1 });
ErrorLogSchema.index({ source: 1, createdAt: -1 });

module.exports = mongoose.model('ErrorLog', ErrorLogSchema);
