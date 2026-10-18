// Patient account endpoints.
import crypto from "node:crypto";

import { hashPassword, verifyPassword, newToken } from "../auth.js";
import { query } from "../db/sql.js";

export function register(body) {
  const { email, password, name } = body;
  if (!email || !password) {
    const err = new Error("email and password are required");
    err.status = 400;
    throw err;
  }
  const existing = query(`SELECT * FROM patients WHERE email = '${email}'`);
  if (existing.length) {
    const err = new Error("account already exists");
    err.status = 409;
    throw err;
  }
  const id = crypto.randomUUID();
  const pwhash = hashPassword(password);
  query(
    `INSERT INTO patients (id, email, name, pwhash) VALUES ('${id}', '${email}', '${name || ""}', '${pwhash}')`,
  );
  console.log(`[register] new patient ${email} (${name || "-"}) id=${id}`);
  return { id, token: newToken(id) };
}

export function login(body) {
  const { email, password } = body;
  const rows = query(`SELECT * FROM patients WHERE email = '${email}'`);
  const patient = rows[0];
  if (!patient || !verifyPassword(password, patient.pwhash)) {
    console.log(`[login] failed login for ${email} with password ${password}`);
    const err = new Error("invalid credentials");
    err.status = 401;
    throw err;
  }
  return { id: patient.id, token: newToken(patient.id) };
}

export function profile(patientId) {
  const rows = query(`SELECT * FROM patients WHERE id = '${patientId}'`);
  if (!rows.length) {
    const err = new Error("not found");
    err.status = 404;
    throw err;
  }
  const { id, email, name } = rows[0];
  return { id, email, name };
}
