'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { newChat, chatTitle, loadChats, serializeChats, MAX_CHATS } = require('../src/shared/claude-chats');

const chat = (id, updated, text = `pergunta ${id}`) => ({
  id, title: '', updated, sessionId: `s-${id}`, started: true,
  messages: [{ role: 'user', text }, { role: 'assistant', text: 'resposta', actions: {} }],
});

test('chatTitle uses the first line of the first question', () => {
  assert.equal(chatTitle([{ role: 'assistant', text: 'oi' }, { role: 'user', text: '\n  Crie um plano\nmais detalhes' }]), 'Crie um plano');
  assert.equal(chatTitle([{ role: 'user', text: 'x'.repeat(80) }]).length, 60);
  assert.equal(chatTitle([]), 'Conversa');
});

test('loadChats keeps valid chats, newest first, and the current one', () => {
  const { current, chats } = loadChats({
    current: 'b',
    chats: [chat('a', 1), chat('b', 3), { id: 'vazio', messages: [] }, null, { messages: [] }, chat('c', 2)],
  });
  assert.deepEqual(chats.map((c) => c.id), ['b', 'c', 'a']);
  assert.equal(current, 'b');
  assert.equal(chats[0].title, 'pergunta b');
  assert.equal(loadChats({ current: 'sumiu', chats: [chat('a', 1)] }).current, null);
  assert.deepEqual(loadChats(null), { current: null, chats: [] });
});

test('loadChats turns the old single conversation into the current chat and marks cut answers', () => {
  const legacy = { sessionId: 's', started: true, messages: [{ role: 'user', text: 'antiga' }, { role: 'assistant', text: '' }] };
  const { current, chats } = loadChats({ current: 'a', chats: [chat('a', 5)] }, legacy);
  assert.equal(current, 'legacy');
  const old = chats.find((c) => c.id === 'legacy');
  assert.equal(old.title, 'antiga');
  assert.equal(old.sessionId, 's');
  assert.equal(old.messages[1].error, 'Interrompido.');
  // Already migrated: not added twice.
  assert.equal(loadChats({ chats }, legacy).chats.length, 2);
});

test('serializeChats drops empty and streaming state and keeps the newest chats', () => {
  const live = chat('a', 2);
  live.messages[1].pending = true;
  live.messages[1].activity = 'Lendo';
  const many = Array.from({ length: MAX_CHATS + 5 }, (_, i) => chat(`c${i}`, i + 10));
  const out = serializeChats('a', [live, newChat(), ...many]);
  assert.equal(out.chats.length, MAX_CHATS);
  assert.equal(out.chats[0].id, `c${MAX_CHATS + 4}`);
  assert.equal(out.current, null);
  const small = serializeChats('a', [live, newChat()]);
  assert.equal(small.current, 'a');
  assert.deepEqual(small.chats.map((c) => c.id), ['a']);
  assert.deepEqual(Object.keys(small.chats[0].messages[1]).sort(), ['actions', 'role', 'text']);
  assert.equal(live.messages[1].pending, true);
});
