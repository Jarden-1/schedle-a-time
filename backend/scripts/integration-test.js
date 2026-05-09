require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const ownerOpenid = `__test_owner_${Date.now()}`;
const otherOpenid = `__test_other_${Date.now()}`;
const eventId = `__smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const ownerToken = jwt.sign({ openid: ownerOpenid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const otherToken = jwt.sign({ openid: otherOpenid }, process.env.JWT_SECRET, { expiresIn: '10m' });

const request = (method, path, token, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  const req = http.request(`${baseUrl}${path}`, { method, headers }, (res) => {
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

    const confirmRes = await expectStatus('POST', `/api/events/${eventId}/confirm`, ownerToken, {
      confirmedSlots: [
        { date: '2026-05-09', startTime: '09:00', endTime: '09:30' },
        { date: '2026-05-09', startTime: '09:30', endTime: '10:00' }
      ]
    }, 200);
    if (!Array.isArray(confirmRes.data?.data?.confirmedSlots) || confirmRes.data.data.confirmedSlots.length !== 2) {
      throw new Error('confirmedSlots array was not persisted');
    }

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
