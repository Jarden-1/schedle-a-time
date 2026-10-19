/**
 * 部署后的一次性数据迁移。
 *
 * 1. 把所有用户的「参与活动时自动套用常规不可用时段」重置为关闭。
 *    旧版本里这个开关缺省是「开」，而且老数据已经存成了 true，
 *    只改代码默认值不会影响已存在的用户。
 *
 * 2. 给历史参与者补 hasSubmitted 字段。
 *    旧版本没有这个字段，导致「提交了空时间」的成员在详情页显示成未填写。
 *    规则：已经填了具体时段的 → 已填写；
 *          非发起人但存在 submittedAt 的（只可能是提交过）→ 已填写；
 *          发起人且没有任何时段 → 保持未填写。
 *
 * 运行：npm run migrate:after-deploy
 * 可以重复执行，结果幂等。
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Event = require('../models/Event');
const UserPreference = require('../models/UserPreference');

const resetAutoApply = async () => {
  const result = await UserPreference.updateMany(
    {},
    { $set: { autoApplyWeeklyUnavailable: false, updatedAt: new Date().toISOString() } }
  );
  console.log(`[1/2] 已重置「自动套用」开关：匹配 ${result.matchedCount} 条，修改 ${result.modifiedCount} 条`);
};

const backfillHasSubmitted = async () => {
  let scanned = 0;
  let updatedEvents = 0;
  let updatedParticipants = 0;

  const cursor = Event.find().cursor();
  for await (const event of cursor) {
    scanned += 1;
    const participants = Array.isArray(event.participants) ? event.participants : [];
    let dirty = false;

    const nextParticipants = participants.map((participant) => {
      const plain = typeof participant.toObject === 'function' ? participant.toObject() : { ...participant };
      if (typeof plain.hasSubmitted === 'boolean') return plain;

      const slots = Array.isArray(plain.availableSlots) ? plain.availableSlots : [];
      const isCreator = !!plain.openid && plain.openid === event.creatorId;
      // 发起人的 submittedAt 在创建时就写好了，只有晚于 createdAt 才说明是后来真的提交过
      const creatorSubmittedLater = !!plain.submittedAt && !!event.createdAt
        && String(plain.submittedAt) > String(event.createdAt);
      const inferred = slots.length > 0
        || (!isCreator && !!plain.submittedAt)
        || (isCreator && creatorSubmittedLater);

      // 字段缺失时一律显式写成布尔值，避免前端还要做兜底推断
      dirty = true;
      updatedParticipants += 1;
      return { ...plain, hasSubmitted: inferred };
    });

    if (dirty) {
      event.participants = nextParticipants;
      event.markModified('participants');
      await event.save();
      updatedEvents += 1;
    }
  }

  console.log(`[2/2] 已补齐 hasSubmitted：扫描 ${scanned} 个活动，更新 ${updatedEvents} 个活动 / ${updatedParticipants} 名参与者`);
};

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('缺少 MONGODB_URI，请先配置 backend/.env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    await resetAutoApply();
    await backfillHasSubmitted();
    console.log('✅ 迁移完成');
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error('❌ 迁移失败:', error.message);
  process.exit(1);
});
