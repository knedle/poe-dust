const crypto = require('node:crypto');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

function login(password, adminPassword, ttlMs = SESSION_TTL_MS) {
  if (!adminPassword || password !== adminPassword) return null;
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + ttlMs);
  return token;
}

function logout(token) {
  sessions.delete(token);
}

function isValidSession(token) {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

module.exports = { SESSION_TTL_MS, login, logout, isValidSession, parseCookies };
