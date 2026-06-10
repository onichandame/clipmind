import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.DATABASE_URL = 'mysql://user:pass@localhost:3306/clipmind_test';
process.env.ALIYUN_ACCESS_KEY_ID = 'test-ak';
process.env.ALIYUN_ACCESS_KEY_SECRET = 'test-sk';
process.env.ALIYUN_OSS_REGION = 'oss-cn-test';
process.env.ALIYUN_OSS_BUCKET = 'clipmind-test';
process.env.ALIYUN_ASR_APPKEY = 'test-asr';
process.env.PUBLIC_WEBHOOK_DOMAIN = 'https://example.com';
process.env.OPENAI_API_KEY = 'test-openai';
process.env.OPENAI_BASE_URL = 'https://example.com/v1';
process.env.QDRANT_URL = 'https://qdrant.example.com';
process.env.WEBHOOK_HMAC_SECRET = '0123456789abcdef0123456789abcdef';

async function loadAuthMiddleware() {
  return import('./auth');
}

test('auth origin allows configured browser origins', async () => {
  const { hasAllowedAuthOrigin } = await loadAuthMiddleware();
  assert.equal(hasAllowedAuthOrigin('http://localhost:5173', undefined), true);
  assert.equal(hasAllowedAuthOrigin('http://tauri.localhost', undefined), true);
  assert.equal(hasAllowedAuthOrigin('https://tauri.localhost', undefined), true);
  assert.equal(hasAllowedAuthOrigin('tauri://localhost', undefined), true);
});

test('auth origin rejects unconfigured and missing browser origins', async () => {
  const { hasAllowedAuthOrigin } = await loadAuthMiddleware();
  assert.equal(hasAllowedAuthOrigin('https://evil.example', undefined), false);
  assert.equal(hasAllowedAuthOrigin(undefined, undefined), false);
});

test('auth origin allows no-Origin desktop requests with desktop header only', async () => {
  const { hasAllowedAuthOrigin } = await loadAuthMiddleware();
  assert.equal(hasAllowedAuthOrigin(undefined, '1'), true);
  assert.equal(hasAllowedAuthOrigin(undefined, '0'), false);
});

test('authorization parser extracts bearer token only', async () => {
  const { getSessionTokenFromAuthorization } = await loadAuthMiddleware();
  assert.equal(getSessionTokenFromAuthorization('Bearer abc-123'), 'abc-123');
  assert.equal(getSessionTokenFromAuthorization('bearer abc-123'), 'abc-123');
  assert.equal(getSessionTokenFromAuthorization('Basic abc-123'), undefined);
  assert.equal(getSessionTokenFromAuthorization('Bearer'), undefined);
  assert.equal(getSessionTokenFromAuthorization('Bearer abc extra'), undefined);
});

test('logout rejects disallowed origin', async () => {
  const { default: authRoute } = await import('../routes/auth');
  const res = await authRoute.request('/logout', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', Authorization: 'Bearer abc' },
  });
  assert.equal(res.status, 403);
});

test('logout succeeds for allowed origin even without active session', async () => {
  const { default: authRoute } = await import('../routes/auth');
  const res = await authRoute.request('/logout', {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(res.status, 200);
});
