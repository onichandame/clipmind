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

test('session cookie parser extracts and decodes only the session cookie', async () => {
  const { getSessionTokenFromCookie, SESSION_COOKIE } = await loadAuthMiddleware();
  assert.equal(getSessionTokenFromCookie(`other=1; ${SESSION_COOKIE}=abc-123; theme=dark`), 'abc-123');
  assert.equal(getSessionTokenFromCookie(`${SESSION_COOKIE}=abc%20123`), 'abc 123');
  assert.equal(getSessionTokenFromCookie('other=1'), undefined);
  assert.equal(getSessionTokenFromCookie(`${SESSION_COOKIE}=%E0%A4%A`), undefined);
});

test('logout rejects disallowed origin without clearing cookie', async () => {
  const { default: authRoute } = await import('../routes/auth');
  const res = await authRoute.request('/logout', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', Cookie: 'clipmind_session=abc' },
  });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('logout clears cookie for allowed origin even without active session', async () => {
  const { default: authRoute } = await import('../routes/auth');
  const res = await authRoute.request('/logout', {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Set-Cookie') ?? '', /clipmind_session=.*Max-Age=0/);
});
