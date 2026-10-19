/**
 * 回归测试：不需要 MongoDB / 网络 / 微信环境。
 *
 * 做法是把外部依赖替换成内存替身，然后直接调用 server.js 里注册的路由处理器，
 * 用来锁住代码审查报告里那些「权限、状态、校验」类缺陷不再复发。
 *
 * 运行：node scripts/regression-test.js
 */
const assert = require('assert');
const Module = require('module');

// ==========================================
// 1. 内存数据库替身
// ==========================================
const events = new Map();
const preferences = new Map();

class Doc {
  constructor(data) {
    Object.assign(this, JSON.parse(JSON.stringify(data || {})));
    this.participants = (this.participants || []).map(p => ({ ...p }));
  }

  toObject() {
    return JSON.parse(JSON.stringify(this));
  }

  markModified() {}

  async save() {
    events.set(this.id, this.toObject());
    return this;
  }
}

const hydrate = (raw) => (raw ? new Doc(raw) : null);

const statusMatches = (doc, filter) => {
  const statusFilter = filter.status;
  if (statusFilter === undefined) return true;
  if (typeof statusFilter === 'string') return doc.status === statusFilter;
  if (statusFilter && Array.isArray(statusFilter.$in)) return statusFilter.$in.includes(doc.status);
  return true;
};

const findParticipantIndex = (doc, filter) => {
  const participantId = filter['participants.participantId'];
  const openid = filter['participants.openid'];
  const nickName = filter['participants.nickName'];
  const hasFilter = participantId !== undefined || openid !== undefined || nickName !== undefined;
  if (!hasFilter) return -1;
  return (doc.participants || []).findIndex((participant) => {
    if (participantId !== undefined && participant.participantId !== participantId) return false;
    if (openid !== undefined && (participant.openid || '') !== openid) return false;
    if (nickName !== undefined && participant.nickName !== nickName) return false;
    return true;
  });
};

const applySet = (doc, set) => {
  const rest = { ...(set || {}) };
  delete rest['participants.$'];
  Object.assign(doc, rest);
};

const EventModel = {
  findOne: async (filter) => hydrate(events.get(filter.id)),
  find: () => ({
    sort: async () => Array.from(events.values()).map(hydrate)
  }),
  findOneAndUpdate: async (filter, update) => {
    const raw = events.get(filter.id);
    if (!raw || !statusMatches(raw, filter)) return null;
    const doc = new Doc(raw);
    if (!update.$set && !update.$push) {
      applySet(doc, update);
    } else {
      applySet(doc, update.$set);
      if (update.$push && update.$push.participants) {
        doc.participants = [...(doc.participants || []), { ...update.$push.participants }];
      }
    }
    events.set(doc.id, doc.toObject());
    return hydrate(events.get(doc.id));
  },
  findOneAndDelete: async (filter) => {
    const raw = events.get(filter.id);
    if (!raw) return null;
    events.delete(filter.id);
    return hydrate(raw);
  },
  updateOne: async (filter, update) => {
    const raw = events.get(filter.id);
    if (!raw || !statusMatches(raw, filter)) return { matchedCount: 0, modifiedCount: 0 };
    const doc = new Doc(raw);
    const participantIndex = findParticipantIndex(doc, filter);

    if (participantIndex >= 0) {
      if (update.$set && update.$set['participants.$']) {
        doc.participants[participantIndex] = { ...update.$set['participants.$'] };
      }
    } else if (update.$push && update.$push.participants) {
      doc.participants = [...(doc.participants || []), { ...update.$push.participants }];
    } else if (findParticipantIndex(doc, filter) < 0 && Object.keys(filter).some(k => k.startsWith('participants.'))) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    applySet(doc, update.$set);
    events.set(doc.id, doc.toObject());
    return { matchedCount: 1, modifiedCount: 1 };
  },
  updateMany: async () => ({ matchedCount: 0, modifiedCount: 0 })
};

const UserPreferenceModel = {
  findOne: async (filter) => preferences.get(filter.openid) || null,
  findOneAndUpdate: async (filter, update) => {
    const merged = { ...(preferences.get(filter.openid) || {}), ...update };
    preferences.set(filter.openid, merged);
    return merged;
  }
};

class StubEventModel {
  constructor(data = {}) {
    Object.assign(this, new Doc(data));
  }

  toObject() {
    return JSON.parse(JSON.stringify(this));
  }

  markModified() {}

  async save() {
    events.set(this.id, JSON.parse(JSON.stringify(this)));
    return this;
  }
}

Object.assign(StubEventModel, EventModel);

// ==========================================
// 2. Express / 依赖替身
// ==========================================
const routes = new Map();
const register = (method) => (routePath, ...handlers) => {
  routes.set(`${method} ${routePath}`, handlers);
};
const app = {
  use() {},
  get: register('GET'),
  post: register('POST'),
  put: register('PUT'),
  delete: register('DELETE'),
  listen() {}
};

const expressStub = () => app;
expressStub.json = () => (req, res, next) => next();
expressStub.static = () => (req, res, next) => next();

const mongooseStub = {
  connect: async () => {},
  Schema: class Schema {
    constructor(definition) {
      Object.assign(this, definition);
    }
  },
  model: () => StubEventModel
};

let uploadBuffer = Buffer.alloc(0);
const multerStub = () => ({
  single: () => (req, res, callback) => {
    req.file = { buffer: uploadBuffer, mimetype: req.headers['x-test-mimetype'] || 'image/png', originalname: 'payload.html' };
    callback(null);
  }
});
multerStub.memoryStorage = () => ({ engine: 'memory' });

const JWT_USERS = {};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'express') return expressStub;
  if (request === 'mongoose') return mongooseStub;
  if (request === 'multer') return multerStub;
  if (request === 'axios') return { get: async () => ({ data: {} }), post: async () => ({ data: {} }) };
  if (request === 'jsonwebtoken') return { sign: () => 'token', verify: () => ({ openid: 'x' }) };
  if (request === 'dotenv') return { config() {} };
  if (request === 'cors') return () => (req, res, next) => next();
  if (request === './models/Event') return StubEventModel;
  if (request === './models/UserPreference') return UserPreferenceModel;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.JWT_SECRET = 'test-secret';
process.env.BASE_URL = 'http://localhost:3000';
process.env.MONGODB_URI = 'mongodb://stub';

require('../server');

// ==========================================
// 3. 调用路由
// ==========================================
const invoke = async (method, routePath, { body = {}, openid = '', params = {}, headers = {} } = {}) => {
  const handlers = routes.get(`${method} ${routePath}`);
  assert.ok(handlers, `路由不存在: ${method} ${routePath}`);
  const handler = handlers[handlers.length - 1];
  const req = { body, params, headers, query: {}, user: { openid } };
  const res = {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; }
  };
  await handler(req, res);
  return res;
};

const seedEvent = (overrides = {}) => {
  const event = {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    title: '测试活动',
    description: '',
    creatorId: 'creator',
    creatorNickName: '发起人',
    timeMode: 'time_slot',
    dateRange: { start: '2026-11-01', end: '2026-11-01' },
    timeRange: { start: '09:00', end: '10:00' },
    granularity: 30,
    allowInvite: true,
    isDecisionPublic: false,
    status: 'ACTIVE',
    adminIds: [],
    vipIds: [],
    participants: [
      { participantId: 'p_creator', userId: 'creator', openid: 'creator', nickName: '发起人', availableSlots: ['2026-11-01_09:00-09:30'], hasSubmitted: true },
      { participantId: 'p_alice', userId: 'alice', openid: 'alice', nickName: '爱丽丝', availableSlots: ['2026-11-01_09:00-09:30'], hasSubmitted: true },
      { participantId: 'p_bob', userId: 'bob', openid: 'bob', nickName: '鲍勃', availableSlots: ['2026-11-01_09:30-10:00'], hasSubmitted: true }
    ],
    confirmedSlots: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  };
  events.set(event.id, event);
  return event;
};

const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.error(`❌ ${name}\n   ${error.message}`);
  }
};

(async () => {
  // ---------- P1-1 状态约束 ----------
  await test('P1-1 已关闭的活动拒绝提交时间', async () => {
    const event = seedEvent({ status: 'CLOSED' });
    const res = await invoke('POST', '/api/events/:id/availability', {
      openid: 'alice',
      params: { id: event.id },
      body: { nickName: '爱丽丝', availableSlots: ['2026-11-01_09:00-09:30'] }
    });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(events.get(event.id).participants[1].availableSlots.length, 1, '关闭后不应写入');
  });

  await test('P1-1 已确认的活动拒绝提交时间', async () => {
    const event = seedEvent({ status: 'CONFIRMED' });
    const res = await invoke('POST', '/api/events/:id/availability', {
      openid: 'alice',
      params: { id: event.id },
      body: { nickName: '爱丽丝', availableSlots: [] }
    });
    assert.strictEqual(res.statusCode, 409);
  });

  await test('P1-1 ACTIVE 活动正常提交', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/availability', {
      openid: 'alice',
      params: { id: event.id },
      body: { nickName: '爱丽丝', availableSlots: ['2026-11-01_09:30-10:00'] }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const saved = events.get(event.id).participants.find(p => p.openid === 'alice');
    assert.deepStrictEqual(saved.availableSlots, ['2026-11-01_09:30-10:00']);
    assert.strictEqual(saved.hasSubmitted, true);
  });

  // ---------- P2-9 允许提交空时间 ----------
  await test('P2-9 允许提交空数组表达「全部没空」', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/availability', {
      openid: 'alice',
      params: { id: event.id },
      body: { nickName: '爱丽丝', availableSlots: [] }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const saved = events.get(event.id).participants.find(p => p.openid === 'alice');
    assert.deepStrictEqual(saved.availableSlots, []);
    assert.strictEqual(saved.hasSubmitted, true, '空提交也要标记为已填写');
  });

  // ---------- P1-2 移除管理员后失去权限 ----------
  await test('P1-2 被移除的管理员立刻失去管理权限', async () => {
    const event = seedEvent({ adminIds: ['alice'] });
    const kick = await invoke('POST', '/api/events/:id/members', {
      openid: 'creator',
      params: { id: event.id },
      body: { action: 'KICK_MEMBER', targetOpenid: 'alice' }
    });
    assert.strictEqual(kick.statusCode, 200, JSON.stringify(kick.body));

    const after = events.get(event.id);
    assert.ok(!after.adminIds.includes('alice'), 'adminIds 应被清理');
    assert.ok(!after.vipIds.includes('alice'), 'vipIds 应被清理');

    const put = await invoke('PUT', '/api/events/:id', {
      openid: 'alice',
      params: { id: event.id },
      body: { title: '被移除的管理员改名' }
    });
    assert.strictEqual(put.statusCode, 403);
  });

  await test('P1-2 残留的 adminIds 也无法获得权限', async () => {
    const event = seedEvent({ adminIds: ['ghost'] });
    const put = await invoke('PUT', '/api/events/:id', {
      openid: 'ghost',
      params: { id: event.id },
      body: { title: '幽灵管理员' }
    });
    assert.strictEqual(put.statusCode, 403);
  });

  // ---------- P1-3 角色层级 ----------
  await test('P1-3 普通管理员不能任免管理员', async () => {
    const event = seedEvent({ adminIds: ['bob'] });
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'bob',
      params: { id: event.id },
      body: { action: 'SET_ADMIN', targetOpenid: 'alice' }
    });
    assert.strictEqual(res.statusCode, 403);
    assert.ok(!events.get(event.id).adminIds.includes('alice'));
  });

  await test('P1-3 普通管理员不能移除发起人成员记录', async () => {
    const event = seedEvent({ adminIds: ['bob'] });
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'bob',
      params: { id: event.id },
      body: { action: 'KICK_MEMBER', targetOpenid: 'creator' }
    });
    assert.strictEqual(res.statusCode, 403);
    assert.ok(events.get(event.id).participants.some(p => p.openid === 'creator'));
  });

  await test('P1-3 发起人可以任免管理员', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'creator',
      params: { id: event.id },
      body: { action: 'SET_ADMIN', targetOpenid: 'alice' }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(events.get(event.id).adminIds.includes('alice'));
  });

  // ---------- 退出活动 ----------
  await test('普通参与者可以退出活动（旧版用自踢 KICK_MEMBER 兼容）', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'alice',
      params: { id: event.id },
      body: { action: 'KICK_MEMBER', targetOpenid: 'alice' }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(!events.get(event.id).participants.some(p => p.openid === 'alice'));
  });

  await test('普通参与者可以退出活动（LEAVE_EVENT）', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'alice',
      params: { id: event.id },
      body: { action: 'LEAVE_EVENT' }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(!events.get(event.id).participants.some(p => p.openid === 'alice'));
  });

  await test('退出时同步回收管理员/嘉宾身份', async () => {
    const event = seedEvent({ adminIds: ['alice'], vipIds: ['alice'] });
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'alice',
      params: { id: event.id },
      body: { action: 'LEAVE_EVENT' }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const after = events.get(event.id);
    assert.deepStrictEqual(after.adminIds, []);
    assert.deepStrictEqual(after.vipIds, []);
  });

  await test('发起人不能退出活动', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'creator',
      params: { id: event.id },
      body: { action: 'LEAVE_EVENT' }
    });
    assert.strictEqual(res.statusCode, 403);
    assert.ok(events.get(event.id).participants.some(p => p.openid === 'creator'));
  });

  await test('非成员退出返回 404', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'stranger',
      params: { id: event.id },
      body: { action: 'LEAVE_EVENT' }
    });
    assert.strictEqual(res.statusCode, 404);
  });

  await test('普通成员不能借退出接口移除他人', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/members', {
      openid: 'alice',
      params: { id: event.id },
      body: { action: 'KICK_MEMBER', targetOpenid: 'bob' }
    });
    assert.strictEqual(res.statusCode, 403);
    assert.ok(events.get(event.id).participants.some(p => p.openid === 'bob'), 'bob 不应被移除');
  });

  // ---------- P1-5 范围变更与确认校验 ----------
  await test('P1-5 确认时间超出活动范围被拒绝', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/confirm', {
      openid: 'creator',
      params: { id: event.id },
      body: { confirmedSlots: [{ date: '2026-11-02', startTime: '09:00', endTime: '09:30' }] }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  await test('P1-5 确认时间不在合法粒度上被拒绝', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/confirm', {
      openid: 'creator',
      params: { id: event.id },
      body: { confirmedSlots: [{ date: '2026-11-01', startTime: '09:00', endTime: '09:45' }] }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  await test('P1-5 合法的确认时间成功', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/confirm', {
      openid: 'creator',
      params: { id: event.id },
      body: {
        confirmedSlots: [
          { date: '2026-11-01', startTime: '09:00', endTime: '09:30' },
          { date: '2026-11-01', startTime: '09:30', endTime: '10:00' }
        ]
      }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(events.get(event.id).status, 'CONFIRMED');
  });

  await test('P1-5 改范围后旧投票被裁剪', async () => {
    const event = seedEvent();
    const res = await invoke('PUT', '/api/events/:id', {
      openid: 'creator',
      params: { id: event.id },
      body: { dateRange: { start: '2026-11-02', end: '2026-11-02' } }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const after = events.get(event.id);
    after.participants.forEach((participant) => {
      assert.ok(
        participant.availableSlots.every(slot => slot.startsWith('2026-11-02')),
        `残留了旧日期: ${participant.availableSlots.join(',')}`
      );
    });
    assert.deepStrictEqual(res.body.pruned.slots, 3);
  });

  await test('P1-5 已确认的活动不能改时间范围', async () => {
    const event = seedEvent({ status: 'CONFIRMED' });
    const res = await invoke('PUT', '/api/events/:id', {
      openid: 'creator',
      params: { id: event.id },
      body: { timeRange: { start: '10:00', end: '11:00' } }
    });
    assert.strictEqual(res.statusCode, 409);
  });

  // ---------- P2-8 时间校验 ----------
  await test('P2-8 非法日历日期被拒绝', async () => {
    const res = await invoke('POST', '/api/events', {
      openid: 'creator',
      body: {
        id: 'evt_bad_date',
        title: '非法日期',
        creatorNickName: '发起人',
        timeMode: 'time_slot',
        dateRange: { start: '2027-99-99', end: '2027-99-99' },
        timeRange: { start: '09:00', end: '10:00' },
        granularity: 30
      }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  await test('P2-8 不在活动范围内的格子被拒绝', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/availability', {
      openid: 'alice',
      params: { id: event.id },
      body: { nickName: '爱丽丝', availableSlots: ['2026-11-01_10:00-10:30'] }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  await test('P2-8 重复格子被去重', async () => {
    const event = seedEvent();
    const res = await invoke('POST', '/api/events/:id/availability', {
      openid: 'alice',
      params: { id: event.id },
      body: { nickName: '爱丽丝', availableSlots: ['2026-11-01_09:00-09:30', '2026-11-01_09:00-09:30'] }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.data.availableSlots, ['2026-11-01_09:00-09:30']);
  });

  // ---------- P1-6 上传校验 ----------
  await test('P1-6 伪装成图片的 HTML 被拒绝', async () => {
    uploadBuffer = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    const res = await invoke('POST', '/api/upload', {
      openid: 'creator',
      headers: { 'x-test-mimetype': 'image/png' }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  await test('P1-6 SVG 被拒绝', async () => {
    uploadBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
    const res = await invoke('POST', '/api/upload', {
      openid: 'creator',
      headers: { 'x-test-mimetype': 'image/svg+xml' }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  // ---------- P2-11 日末截断 ----------
  await test('P2-11 23:00-24:00 能生成完整格子', async () => {
    const res = await invoke('POST', '/api/events', {
      openid: 'creator',
      body: {
        id: 'evt_end_of_day',
        title: '深夜活动',
        creatorNickName: '发起人',
        timeMode: 'time_slot',
        dateRange: { start: '2026-11-01', end: '2026-11-01' },
        timeRange: { start: '23:00', end: '24:00' },
        granularity: 30
      }
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  });

  await test('P2-11 零格子活动被拒绝', async () => {
    const res = await invoke('POST', '/api/events', {
      openid: 'creator',
      body: {
        id: 'evt_zero',
        title: '零格子',
        creatorNickName: '发起人',
        timeMode: 'time_slot',
        dateRange: { start: '2026-11-01', end: '2026-11-01' },
        timeRange: { start: '23:45', end: '23:59' },
        granularity: 30
      }
    });
    assert.strictEqual(res.statusCode, 400);
  });

  // ---------- P2-7 决策数据隔离 ----------
  await test('P2-7 决策不公开时他人看不到具体时间', async () => {
    const event = seedEvent({ isDecisionPublic: false });
    const res = await invoke('GET', '/api/events/:id', {
      openid: 'alice',
      params: { id: event.id }
    });
    assert.strictEqual(res.statusCode, 200);
    const others = res.body.data.participants.filter(p => p.openid !== 'alice');
    others.forEach((participant) => {
      assert.deepStrictEqual(participant.availableSlots, [], `${participant.openid} 的具体时间不应返回`);
    });
    const self = res.body.data.participants.find(p => p.openid === 'alice');
    assert.ok(self.availableSlots.length > 0, '本人应能看到自己的时间');
    assert.strictEqual(res.body.data.decisionRedacted, true);
    assert.ok(typeof res.body.data.submittedCount === 'number');
  });

  await test('P2-7 管理员始终能看到完整数据', async () => {
    const event = seedEvent({ isDecisionPublic: false });
    const res = await invoke('GET', '/api/events/:id', {
      openid: 'creator',
      params: { id: event.id }
    });
    const bob = res.body.data.participants.find(p => p.openid === 'bob');
    assert.ok(bob.availableSlots.length > 0);
    assert.strictEqual(res.body.data.decisionRedacted, false);
  });

  await test('P2-7 决策公开时参与者可见', async () => {
    const event = seedEvent({ isDecisionPublic: true });
    const res = await invoke('GET', '/api/events/:id', {
      openid: 'alice',
      params: { id: event.id }
    });
    const bob = res.body.data.participants.find(p => p.openid === 'bob');
    assert.ok(bob.availableSlots.length > 0);
  });

  const failed = results.filter(result => !result.ok);
  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length > 0) process.exit(1);
})();
