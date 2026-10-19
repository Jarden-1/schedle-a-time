/**
 * 导出埋点原始事件为 CSV。
 *
 * 用法：
 *   npm run analytics:export -- --from 2026-10-01 --to 2026-10-31
 *   npm run analytics:export -- --from 2026-10-01 --to 2026-10-31 --out ~/events.csv
 *   npm run analytics:export -- --from 2026-10-01 --to 2026-10-31 --event create_submit
 *
 * 说明：
 *   - 时间按服务器本地时区（东八区）计算
 *   - --to 包含当天最后一刻
 *   - props 会序列化成 JSON 放在最后一列
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const TelemetryEvent = require('../models/TelemetryEvent');

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

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
};

const escapeCsv = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const pad = (n) => String(n).padStart(2, '0');

const formatDateTime = (date) => (
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
  + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
);

const formatDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const from = parseDate(args.from);
  const to = parseDate(args.to, true);

  if (!from || !to) {
    console.error('用法: npm run analytics:export -- --from YYYY-MM-DD --to YYYY-MM-DD [--out 文件] [--event 事件名]');
    process.exit(1);
  }
  if (from > to) {
    console.error('开始日期不能晚于结束日期');
    process.exit(1);
  }

  const outPath = args.out
    ? path.resolve(String(args.out).replace(/^~/, process.env.HOME || ''))
    : path.resolve(process.cwd(), `analytics-${formatDay(from)}_${formatDay(to)}.csv`);

  const query = { ts: { $gte: from.getTime(), $lte: to.getTime() } };
  if (args.event && typeof args.event === 'string') {
    query.event = args.event;
  }

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    const total = await TelemetryEvent.countDocuments(query);
    console.log(`匹配 ${total} 条事件，开始导出 → ${outPath}`);

    const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });
    stream.write('日期,时间,事件,页面,用户,sessionId,版本,props\n');

    const cursor = TelemetryEvent.find(query).sort({ ts: 1 }).lean().cursor();
    let written = 0;

    for await (const doc of cursor) {
      const at = new Date(doc.ts || doc.createdAt);
      const row = [
        formatDay(at),
        `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`,
        doc.event,
        doc.page,
        doc.openid,
        doc.sessionId,
        doc.version,
        JSON.stringify(doc.props || {})
      ].map(escapeCsv).join(',');
      stream.write(`${row}\n`);
      written += 1;

      if (written % 5000 === 0) {
        console.log(`  已写入 ${written}/${total}`);
      }
    }

    await new Promise((resolve, reject) => {
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    console.log(`✅ 导出完成：${written} 条，${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
    console.log(`   时间范围：${formatDateTime(from)} ~ ${formatDateTime(to)}`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error('❌ 导出失败:', error.message);
  process.exit(1);
});
