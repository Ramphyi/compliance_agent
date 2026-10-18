import test from "node:test";
import assert from "node:assert/strict";

import { reset } from "../src/db/sql.js";
import { clearSessions } from "../src/auth.js";
import * as patients from "../src/routes/patients.js";
import * as appointments from "../src/routes/appointments.js";

function freshPatient() {
  reset();
  clearSessions();
  return patients.register({ email: "p@example.ro", password: "pw123456", name: "P" }).id;
}

test("booking an appointment stores it for the patient", () => {
  const pid = freshPatient();
  const appt = appointments.book(pid, { clinician: "Dr. Mara", startsAt: "2026-11-01T09:00:00Z", reason: "cough" });
  assert.ok(appt.id);
  const list = appointments.list(pid);
  assert.equal(list.length, 1);
  assert.equal(list[0].clinician, "Dr. Mara");
});

test("booking requires startsAt", () => {
  const pid = freshPatient();
  assert.throws(() => appointments.book(pid, { reason: "x" }), /startsAt/);
});

test("notes are stored and listed per patient", () => {
  const pid = freshPatient();
  appointments.addNote(pid, { symptoms: "headache since morning" });
  const notes = appointments.listNotes(pid);
  assert.equal(notes.length, 1);
  assert.match(notes[0].symptoms, /headache/);
});

test("one patient does not see another patient's appointments", () => {
  const a = freshPatient();
  appointments.book(a, { startsAt: "2026-11-01T09:00:00Z", reason: "a" });
  const b = patients.register({ email: "other@example.de", password: "pw999999" }).id;
  assert.equal(appointments.list(b).length, 0);
});
