'use strict';

// The Claude panel's saved conversations, one list per vault:
//   { current: id | null, chats: [{ id, title, updated, sessionId, started, messages }] }
// Each chat is its own Claude Code session, which lives in the vault's folder.

const MAX_CHATS = 50;
const MAX_MESSAGES = 200;
const TITLE_LENGTH = 60;

const newChat = () => ({ id: null, title: '', updated: 0, sessionId: null, started: false, messages: [] });

// First line of the first question, short enough for the list.
function chatTitle(messages) {
  const first = messages.find((m) => m.role === 'user')?.text ?? '';
  const line = first.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line || 'Conversa';
}

function cleanChat(raw) {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string');
  if (!messages.length) return null;
  // An answer cut by closing the app.
  for (const m of messages) if (m.role === 'assistant' && !m.text && !m.error) m.error = 'Interrompido.';
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : chatTitle(messages),
    updated: Number(raw.updated) || 0,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    started: Boolean(raw.started),
    messages,
  };
}

// Saved list -> a valid one, newest first. A pre-1.7 single conversation ({ sessionId, messages })
// joins the list as its current chat.
function loadChats(raw, legacy) {
  const chats = (Array.isArray(raw?.chats) ? raw.chats : []).map(cleanChat).filter(Boolean);
  const old = legacy ? cleanChat({ ...legacy, id: 'legacy', updated: legacy.updated ?? Date.now() }) : null;
  if (old && !chats.some((c) => c.id === old.id)) chats.push(old);
  chats.sort((a, b) => b.updated - a.updated);
  const wanted = old ? old.id : raw?.current;
  return { current: chats.some((c) => c.id === wanted) ? wanted : null, chats };
}

// What goes to disk: chats with messages, the newest MAX_CHATS, without streaming state.
function serializeChats(current, chats) {
  const kept = chats
    .filter((c) => c.id && c.messages.length)
    .sort((a, b) => b.updated - a.updated)
    .slice(0, MAX_CHATS)
    .map((c) => ({ ...c, messages: c.messages.slice(-MAX_MESSAGES).map(({ pending, activity, ...m }) => m) }));
  return { current: kept.some((c) => c.id === current) ? current : null, chats: kept };
}

module.exports = { newChat, chatTitle, loadChats, serializeChats, MAX_CHATS };
