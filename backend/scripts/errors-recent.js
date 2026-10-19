/**
 * 查看最近的错误记录。
 *
 * 用法：
 *   npm run errors:recent
 *   npm run errors:recent -- --limit 50
 *   npm run errors:recent -- --source miniapp
 *   npm run errors:recent -- --since 24
 */
require('dotenv').config();
const mongoose = require('mongoose');
const ErrorLog = require('../models/ErrorLog');

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
};

const pad = (n) => String(n).padStart(2, '0');
const formatTime = (date) => (
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
  + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
);

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const limit = Math.min(Number(args.limit) || 30, 200);
  const sinceHours = Number(args.since) || 168;

  const query = { createdAt: { $gte: new Date(Date.now() - sinceHours * 3600 * 1000) } };
  if (args.source) query.source = String(args.source);

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const total = await ErrorLog.countDocuments(query);
    const items = await ErrorLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();

    console.log(`最近 ${sinceHours} 小时错误：共 ${total} 条，显示最新 ${items.length} 条\n`);
    console.log('时间'.padEnd(20), '来源'.padEnd(9), '页面/接口'.padEnd(24), '信息');

    items.forEach((item) => {
      const where = item.page || item.path || '-';
      const message = String(item.message || '').replace(/\s+/g, ' ').slice(0, 80);
      console.log(
        formatTime(new Date(item.createdAt)).padEnd(20),
        String(item.source || '-').padEnd(9),
        where.slice(0, 24).padEnd(24),
        message
      );
    });

    if (items.length === 0) {
      console.log('（暂无错误）');
    }
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error('查询失败:', error.message);
  process.exit(1);
});
