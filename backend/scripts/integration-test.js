require('dotenv').config();
const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const ownerOpenid = `__test_owner_${Date.now()}`;
const otherOpenid = `__test_other_${Date.now()}`;
const thirdOpenid = `__test_third_${Date.now()}`;
const eventId = `__smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const ownerToken = jwt.sign({ openid: ownerOpenid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const otherToken = jwt.sign({ openid: otherOpenid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const thirdToken = jwt.sign({ openid: thirdOpenid }, process.env.JWT_SECRET, { expiresIn: '10m' });

const request = (method, path, token, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  const client = baseUrl.startsWith('https:') ? https : http;
  const req = client.request(`${baseUrl}${path}`, { method, headers }, (res) => {
    let raw = '';
    res.on('data', chunk => { raw += chunk; });
    res.on('end', () => {
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = raw;
      }
      resolve({ statusCode: res.statusCode, data, raw });
    });
  });
  req.on('error', reject);
  if (payload !== undefined) req.write(payload);
  req.end();
});

const expectStatus = async (method, path, token, body, expected) => {
  const res = await request(method, path, token, body);
  if (res.statusCode !== expected) {
    throw new Error(`${method} ${path} expected ${expected}, got ${res.statusCode}: ${res.raw}`);
  }
  console.log(`ok ${method} ${path} -> ${expected}`);
  return res;
};

const cleanup = async () => {
  await request('DELETE', `/api/events/${eventId}`, ownerToken);
};

(async () => {
  try {
    await expectStatus('POST', '/api/events', ownerToken, {
      id: eventId,
      title: 'Smoke Test Event',
      creatorNickName: 'Owner',
      timeMode: 'time_slot',
      dateRange: { start: '2026-05-09', end: '2026-05-09' },
      timeRange: { start: '09:00', end: '10:00' },
      granularity: 30,
      allowInvite: true,
      isDecisionPublic: false,
      participants: [{ nickName: 'Owner', avatarUrl: '' }]
    }, 200);

    const listOwner = await expectStatus('GET', '/api/events', ownerToken, undefined, 200);
    if (!Array.isArray(listOwner.data?.data) || !listOwner.data.data.some(event => event.id === eventId)) {
      throw new Error('owner list did not include created event');
    }

    const listOther = await expectStatus('GET', '/api/events', otherToken, undefined, 200);
    if (Array.isArray(listOther.data?.data) && listOther.data.data.some(event => event.id === eventId)) {
      throw new Error('isolated list leaked event to unrelated user');
    }

    await expectStatus('PUT', `/api/events/${eventId}`, otherToken, { title: 'Hacked' }, 403);
    await expectStatus('DELETE', `/api/events/${eventId}`, otherToken, undefined, 403);
    await expectStatus('POST', `/api/events/${eventId}/members`, otherToken, { action: 'KICK_MEMBER', targetNickName: 'Owner' }, 403);
    await expectStatus('POST', `/api/events/${eventId}/confirm`, otherToken, {
      confirmedSlots: [{ date: '2026-05-09', startTime: '09:00', endTime: '09:30' }]
    }, 403);

    const preferenceRes = await expectStatus('PUT', '/api/user/weekly-unavailable', ownerToken, {
      weeklyUnavailableSlots: ['1_09:00-09:30', '1_09:30-10:00'],
      autoApplyWeeklyUnavailable: true
    }, 200);
    if (preferenceRes.data?.data?.weeklyUnavailableSlots?.length !== 2) {
      throw new Error('weekly unavailable slots were not persisted');
    }

    const preferenceGetRes = await expectStatus('GET', '/api/user/weekly-unavailable', ownerToken, undefined, 200);
    if (preferenceGetRes.data?.data?.weeklyUnavailableSlots?.[0] !== '1_09:00-09:30') {
      throw new Error('weekly unavailable slots were not loaded');
    }

    await expectStatus('PUT', '/api/user/weekly-unavailable', ownerToken, {
      weeklyUnavailableSlots: ['9_99:00-99:30']
    }, 400);

    const renameRes = await expectStatus('POST', `/api/events/${eventId}/members`, ownerToken, {
      action: 'RENAME_MEMBER',
      targetOpenid: ownerOpenid,
      targetDisplayName: 'Owner Alias'
    }, 200);

    const detailAfterRename = await expectStatus('GET', `/api/events/${eventId}`, ownerToken, undefined, 200);
    const ownerParticipant = detailAfterRename.data?.data?.participants?.find(p => p.openid === ownerOpenid);
    if (ownerParticipant?.eventDisplayName !== 'Owner Alias') {
      throw new Error('eventDisplayName was not persisted');
    }

    await expectStatus('PUT', `/api/events/${eventId}`, ownerToken, { dateRange: { start: '2026-05-10', end: '2026-05-09' } }, 400);

    // ---------- 回归：提交校验 ----------
    await expectStatus('POST', `/api/events/${eventId}/availability`, otherToken, {
      nickName: 'Other',
      availableSlots: ['2026-05-09_09:00-09:30', '2026-05-09_09:00-09:30']
    }, 200);

    const dupRes = await expectStatus('GET', `/api/events/${eventId}`, ownerToken, undefined, 200);
    const otherParticipant = dupRes.data?.data?.participants?.find(p => p.openid === otherOpenid);
    if (!otherParticipant || otherParticipant.availableSlots.length !== 1) {
      throw new Error('duplicate slots were not deduplicated');
    }
    if (otherParticipant.hasSubmitted !== true) {
      throw new Error('hasSubmitted was not persisted');
    }

    // 不在活动网格内的时间必须被拒绝
    await expectStatus('POST', `/api/events/${eventId}/availability`, otherToken, {
      nickName: 'Other',
      availableSlots: ['2026-05-09_10:00-10:30']
    }, 400);

    // ---------- 回归：普通参与者退出活动 ----------
    await expectStatus('POST', `/api/events/${eventId}/availability`, thirdToken, {
      nickName: 'Third',
      availableSlots: ['2026-05-09_09:30-10:00']
    }, 200);

    await expectStatus('POST', `/api/events/${eventId}/members`, thirdToken, {
      action: 'LEAVE_EVENT'
    }, 200);

    const afterLeave = await expectStatus('GET', `/api/events/${eventId}`, ownerToken, undefined, 200);
    if (afterLeave.data?.data?.participants?.some(p => p.openid === thirdOpenid)) {
      throw new Error('LEAVE_EVENT did not remove the participant');
    }

    // 旧版小程序退出走的是「踢自己」，必须继续可用
    await expectStatus('POST', `/api/events/${eventId}/availability`, thirdToken, {
      nickName: 'Third',
      availableSlots: ['2026-05-09_09:30-10:00']
    }, 200);
    await expectStatus('POST', `/api/events/${eventId}/members`, thirdToken, {
      action: 'KICK_MEMBER',
      targetOpenid: thirdOpenid
    }, 200);

    // 越界的确认时间必须被拒绝
    await expectStatus('POST', `/api/events/${eventId}/confirm`, ownerToken, {
      confirmedSlots: [{ date: '2026-05-10', startTime: '09:00', endTime: '09:30' }]
    }, 400);

    // ---------- 回归：改范围后清理旧投票 ----------
    const pruneRes = await expectStatus('PUT', `/api/events/${eventId}`, ownerToken, {
      dateRange: { start: '2026-05-10', end: '2026-05-10' }
    }, 200);
    if ((pruneRes.data?.pruned?.slots || 0) < 1) {
      throw new Error('range change did not prune stale slots');
    }
    await expectStatus('PUT', `/api/events/${eventId}`, ownerToken, {
      dateRange: { start: '2026-05-09', end: '2026-05-09' }
    }, 200);

    // ---------- 回归：角色层级 ----------
    await expectStatus('POST', `/api/events/${eventId}/members`, ownerToken, {
      action: 'SET_ADMIN',
      targetOpenid: otherOpenid
    }, 200);
    await expectStatus('PUT', `/api/events/${eventId}`, otherToken, { title: 'Admin Renamed' }, 200);

    // 改名后再次提交，别名与身份字段不应丢失（历史实现用 ...existing 展开子文档会丢字段）
    await expectStatus('POST', `/api/events/${eventId}/members`, ownerToken, {
      action: 'RENAME_MEMBER',
      targetOpenid: otherOpenid,
      targetDisplayName: 'Other Alias'
    }, 200);
    await expectStatus('POST', `/api/events/${eventId}/availability`, otherToken, {
      nickName: 'Other',
      availableSlots: ['2026-05-09_09:00-09:30']
    }, 200);

    const afterResubmit = await expectStatus('GET', `/api/events/${eventId}`, ownerToken, undefined, 200);
    const renamed = afterResubmit.data?.data?.participants?.find(p => p.openid === otherOpenid);
    if (renamed?.eventDisplayName !== 'Other Alias') {
      throw new Error('eventDisplayName was lost after re-submitting availability');
    }
    if (renamed?.userId !== otherOpenid) {
      throw new Error('userId was lost after re-submitting availability');
    }

    // 普通管理员不能任免管理员
    await expectStatus('POST', `/api/events/${eventId}/members`, otherToken, {
      action: 'SET_ADMIN',
      targetOpenid: ownerOpenid
    }, 403);

    // 被移除的管理员立刻失去权限
    await expectStatus('POST', `/api/events/${eventId}/members`, ownerToken, {
      action: 'KICK_MEMBER',
      targetOpenid: otherOpenid
    }, 200);
    await expectStatus('PUT', `/api/events/${eventId}`, otherToken, { title: 'Hacked After Kick' }, 403);

    const confirmRes = await expectStatus('POST', `/api/events/${eventId}/confirm`, ownerToken, {
      confirmedSlots: [
        { date: '2026-05-09', startTime: '09:00', endTime: '09:30' },
        { date: '2026-05-09', startTime: '09:30', endTime: '10:00' }
      ]
    }, 200);
    if (!Array.isArray(confirmRes.data?.data?.confirmedSlots) || confirmRes.data.data.confirmedSlots.length !== 2) {
      throw new Error('confirmedSlots array was not persisted');
    }

    // ---------- 回归：确认后不再接受提交 / 不再允许改范围 ----------
    await expectStatus('POST', `/api/events/${eventId}/availability`, ownerToken, {
      nickName: 'Owner',
      availableSlots: ['2026-05-09_09:00-09:30']
    }, 409);
    await expectStatus('PUT', `/api/events/${eventId}`, ownerToken, {
      timeRange: { start: '09:30', end: '10:30' }
    }, 409);

    // ---------- 回归：撤销确认后重新开放 ----------
    await expectStatus('PUT', `/api/events/${eventId}`, ownerToken, {
      status: 'ACTIVE',
      confirmedSlot: null
    }, 200);

    const afterRevoke = await expectStatus('GET', `/api/events/${eventId}`, ownerToken, undefined, 200);
    if (String(afterRevoke.data?.data?.status || '').toUpperCase() !== 'ACTIVE') {
      throw new Error('revoke did not reopen the event');
    }
    if ((afterRevoke.data?.data?.confirmedSlots || []).length !== 0) {
      throw new Error('revoke did not clear confirmed slots');
    }
    await expectStatus('POST', `/api/events/${eventId}/availability`, ownerToken, {
      nickName: 'Owner',
      availableSlots: ['2026-05-09_09:00-09:30']
    }, 200);

    await cleanup();
    console.log('integration smoke test completed');
  } catch (err) {
    await cleanup();
    throw err;
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
