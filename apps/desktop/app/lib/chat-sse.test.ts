import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseFrames, upsertMessage } from './chat-sse';

test('parses complete SSE frames and keeps partial frame as rest', () => {
  const parsed = parseSseFrames('event: snapshot\ndata: {"ok":true}\n\nevent: stream\ndata: {');
  assert.deepEqual(parsed.events, [{ event: 'snapshot', data: '{"ok":true}' }]);
  assert.equal(parsed.rest, 'event: stream\ndata: {');
});

test('defaults event name to message when event field is absent', () => {
  const parsed = parseSseFrames('data: hello\n\n');
  assert.deepEqual(parsed.events, [{ event: 'message', data: 'hello' }]);
  assert.equal(parsed.rest, '');
});

test('joins multi-line SSE data payloads', () => {
  const parsed = parseSseFrames('event: stream\ndata: line1\ndata: line2\n\n');
  assert.deepEqual(parsed.events, [{ event: 'stream', data: 'line1\nline2' }]);
});

test('ignores frames without data', () => {
  const parsed = parseSseFrames('event: heartbeat\n\n');
  assert.deepEqual(parsed.events, []);
});

test('upsert appends unseen messages', () => {
  const user = { id: 'u1', role: 'user' };
  const assistant = { id: 'a1', role: 'assistant' };
  assert.deepEqual(upsertMessage([user], assistant), [user, assistant]);
});

test('upsert replaces streaming message with done message by stable id', () => {
  const stream = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hel' }] };
  const done = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] };
  assert.deepEqual(upsertMessage([stream], done), [done]);
});
