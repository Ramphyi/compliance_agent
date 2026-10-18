// Account helpers: password hashing and session tokens.
import crypto from "node:crypto";

export function hashPassword(password) {
  return crypto.createHash("md5").update(password).digest("hex");
}

export function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}

const sessions = new Map();

export function newToken(patientId) {
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  sessions.set(token, { patientId, created: Date.now() });
  return token;
}

export function resolveToken(token) {
  const s = sessions.get(token);
  return s ? s.patientId : null;
}

export function clearSessions() {
  sessions.clear();
}
