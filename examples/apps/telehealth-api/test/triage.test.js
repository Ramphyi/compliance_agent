import test from "node:test";
import assert from "node:assert/strict";

import { reset } from "../src/db/sql.js";
import { clearSessions } from "../src/auth.js";
import * as patients from "../src/routes/patients.js";
import * as appointments from "../src/routes/appointments.js";
import { buildRequest, callModel, triage } from "../src/triage/llm.js";
import { runAction } from "../src/triage/actions.js";

// A fake fetch so the tests never touch the network.
function fakeFetch(modelJson) {
  return async () => ({
    json: async () => ({ content: [{ text: JSON.stringify(modelJson) }] }),
  });
}

function freshPatient() {
  reset();
  clearSessions();
  return patients.register({ email: "t@example.ro", password: "pw123456" }).id;
}

test("buildRequest includes the symptom text and the default model", () => {
  const req = buildRequest("sore throat");
  assert.match(req.system, /sore throat/);
  assert.equal(req.model, "claude-opus-5-5");
});

test("callModel parses the model JSON", async () => {
  const result = await callModel("fever", fakeFetch({ severity: "low", action: "self_care", summary: "rest" }));
  assert.equal(result.severity, "low");
  assert.equal(result.action, "self_care");
});

test("self_care action returns advice and books nothing", () => {
  const pid = freshPatient();
  const out = runAction(pid, "self_care", { reason: "drink fluids" });
  assert.equal(out.kind, "self_care");
  assert.equal(appointments.list(pid).length, 0);
});

test("book_urgent action schedules a near-term appointment", () => {
  const pid = freshPatient();
  const out = runAction(pid, "book_urgent", { reason: "chest pain" });
  assert.equal(out.kind, "booked");
  assert.equal(out.priority, "urgent");
  const appts = appointments.list(pid);
  assert.equal(appts.length, 1);
  assert.match(appts[0].reason, /chest pain/);
});

test("unknown action name is a no-op", () => {
  const pid = freshPatient();
  const out = runAction(pid, "launch_rocket", {});
  assert.equal(out.kind, "none");
});

test("triage end to end with a fake model books from the model's action", async () => {
  const pid = freshPatient();
  const out = await triage(
    pid,
    "severe headache",
    fakeFetch({ severity: "high", action: "book_routine", summary: "see a doctor", reason: "persistent headache" }),
  );
  assert.equal(out.severity, "high");
  assert.equal(out.followUp.kind, "booked");
  assert.equal(appointments.list(pid).length, 1);
});
