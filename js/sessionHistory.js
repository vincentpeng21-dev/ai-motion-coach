// sessionHistory.js — localStorage-based session history
// Saves one entry per successful analysis (≥1 rep), newest first.
// Max 20 entries to keep storage bounded.

const STORAGE_KEY = "aimc_sessions";
const MAX_SESSIONS = 20;

export function getSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSession(data) {
  const sessions = getSessions();
  const entry = { id: Date.now(), timestamp: new Date().toISOString(), aiCommentary: "", ...data };
  sessions.unshift(entry);
  if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  return entry;
}

export function updateSessionCommentary(id, text) {
  const sessions = getSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx !== -1) {
    sessions[idx].aiCommentary = text;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
}
