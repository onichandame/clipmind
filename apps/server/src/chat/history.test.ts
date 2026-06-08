import test from 'node:test';
import assert from 'node:assert/strict';
import {
  insertOrReplaceAfterMessage,
  makeOutlineEditedReminderMessage,
  normalizeChatHistory,
  upsertChatMessage,
  visibleChatMessages,
} from './history';

test('normalizes invalid chat history without throwing', () => {
  assert.deepEqual(normalizeChatHistory(null), {
    version: 1,
    revision: 0,
    uiMessages: [],
    modelMessages: [],
  });
  assert.deepEqual(normalizeChatHistory({ revision: 'bad', uiMessages: {}, modelMessages: null }), {
    version: 1,
    revision: 0,
    uiMessages: [],
    modelMessages: [],
  });
});

test('preserves valid chat history arrays and numeric revision', () => {
  const uiMessages = [{ id: 'u1', role: 'user', parts: [] }];
  const modelMessages = [{ role: 'user', content: 'hello' }];
  assert.deepEqual(normalizeChatHistory({ revision: 3, uiMessages, modelMessages }), {
    version: 1,
    revision: 3,
    uiMessages,
    modelMessages,
  });
});

test('filters hidden reminder messages from visible chat snapshots', () => {
  const hidden = makeOutlineEditedReminderMessage('hidden-1');
  const visible = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] };
  assert.deepEqual(visibleChatMessages([hidden, visible]), [visible]);
});

test('outline reminder is server generated and hidden', () => {
  const reminder = makeOutlineEditedReminderMessage('r1');
  assert.equal(reminder.id, 'r1');
  assert.equal(reminder.role, 'system');
  assert.deepEqual(reminder.metadata, { hidden: true, kind: 'outline-reminder' });
  assert.match(reminder.parts[0].text, /^<system-reminder>/);
  assert.match(reminder.parts[0].text, /数据库中的最新大纲/);
});

test('upserts messages by stable id without duplicating stream and done events', () => {
  const first = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hel' }] };
  const final = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }] };
  assert.deepEqual(upsertChatMessage([first], final), [final]);
});

test('inserts assistant placeholder immediately after triggering user', () => {
  const userA = { id: 'uA', role: 'user', parts: [] };
  const userB = { id: 'uB', role: 'user', parts: [] };
  const assistantA = { id: 'aA', role: 'assistant', parts: [] };
  assert.deepEqual(
    insertOrReplaceAfterMessage([userA, userB], 'uA', assistantA).map((m) => m.id),
    ['uA', 'aA', 'uB'],
  );
});

test('replaces existing assistant placeholder in place', () => {
  const userA = { id: 'uA', role: 'user', parts: [] };
  const placeholder = { id: 'aA', role: 'assistant', parts: [] };
  const userB = { id: 'uB', role: 'user', parts: [] };
  const final = { id: 'aA', role: 'assistant', parts: [{ type: 'text', text: 'done' }] };
  assert.deepEqual(
    insertOrReplaceAfterMessage([userA, placeholder, userB], 'uA', final),
    [userA, final, userB],
  );
});

test('falls back to appending assistant when triggering user is missing', () => {
  const userA = { id: 'uA', role: 'user', parts: [] };
  const assistant = { id: 'a1', role: 'assistant', parts: [] };
  assert.deepEqual(insertOrReplaceAfterMessage([userA], 'missing', assistant), [userA, assistant]);
});
