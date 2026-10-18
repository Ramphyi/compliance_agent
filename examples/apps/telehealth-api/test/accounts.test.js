import test from "node:test";
import assert from "node:assert/strict";

import { reset } from "../src/db/sql.js";
import { clearSessions, resolveToken, hashPassword } from "../src/auth.js";
import * as patients from "../src/routes/patients.js";

test("register then login returns a usable token", () => {
  reset();
  clearSessions();
  const reg = patients.register({ email: "ana@example.ro", password: "pw123456", name: "Ana" });
  assert.ok(reg.id);
  assert.equal(resolveToken(reg.token), reg.id);

  const login = patients.login({ email: "ana@example.ro", password: "pw123456" });
  assert.equal(login.id, reg.id);
  assert.equal(resolveToken(login.token), reg.id);
});

test("duplicate registration is rejected", () => {
  reset();
  clearSessions();
  patients.register({ email: "dup@example.de", password: "secret99" });
  assert.throws(() => patients.register({ email: "dup@example.de", password: "x" }), /already exists/);
});

test("wrong password is rejected", () => {
  reset();
  clearSessions();
  patients.register({ email: "ben@example.de", password: "goodpass1" });
  assert.throws(() => patients.login({ email: "ben@example.de", password: "nope" }), /invalid/);
});

test("profile returns no password hash", () => {
  reset();
  clearSessions();
  const reg = patients.register({ email: "cara@example.ro", password: "pw1234aa", name: "Cara" });
  const p = patients.profile(reg.id);
  assert.deepEqual(Object.keys(p).sort(), ["email", "id", "name"]);
  assert.equal(p.email, "cara@example.ro");
});

test("password hashing is deterministic", () => {
  assert.equal(hashPassword("abc"), hashPassword("abc"));
});
