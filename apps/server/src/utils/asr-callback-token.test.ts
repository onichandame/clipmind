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

async function loadTokenModule() {
  return import('./asr-callback-token');
}

test('ASR callback token verifies for the signed media file', async () => {
  const { signAsrCallbackToken, verifyAsrCallbackToken } = await loadTokenModule();
  const token = signAsrCallbackToken('media-1', 1000);
  assert.equal(verifyAsrCallbackToken(token, 'media-1', 1001), true);
});

test('ASR callback token rejects mismatched media file', async () => {
  const { signAsrCallbackToken, verifyAsrCallbackToken } = await loadTokenModule();
  const token = signAsrCallbackToken('media-1', 1000);
  assert.equal(verifyAsrCallbackToken(token, 'media-2', 1001), false);
});

test('ASR callback token rejects expired token', async () => {
  const { signAsrCallbackToken, verifyAsrCallbackToken } = await loadTokenModule();
  const token = signAsrCallbackToken('media-1', 1000);
  assert.equal(verifyAsrCallbackToken(token, 'media-1', 1000 + 24 * 60 * 60 + 1), false);
});
