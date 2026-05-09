const http = require('http');

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';

const request = (method, path) => new Promise((resolve, reject) => {
  const req = http.request(`${baseUrl}${path}`, { method }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ statusCode: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

const expectStatus = async (method, path, expected) => {
  const res = await request(method, path);
  if (res.statusCode !== expected) {
    throw new Error(`${method} ${path} expected ${expected}, got ${res.statusCode}: ${res.body}`);
  }
  console.log(`ok ${method} ${path} -> ${expected}`);
};

(async () => {
  await expectStatus('GET', '/api/events', 401);
  await expectStatus('POST', '/api/upload', 401);
  await expectStatus('POST', '/api/login', 400);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
