// Appointment booking and symptom notes.
import crypto from "node:crypto";

import { query } from "../db/sql.js";

export function book(patientId, body) {
  const { clinician, startsAt, reason } = body;
  if (!startsAt) {
    const err = new Error("startsAt is required");
    err.status = 400;
    throw err;
  }
  const id = crypto.randomUUID();
  query(
    `INSERT INTO appointments (id, patient_id, clinician, starts_at, reason) ` +
      `VALUES ('${id}', '${patientId}', '${clinician || "unassigned"}', '${startsAt}', '${reason || ""}')`,
  );
  console.log(`[book] patient=${patientId} reason="${reason || ""}" at ${startsAt}`);
  return { id, patientId, clinician: clinician || "unassigned", startsAt };
}

export function list(patientId) {
  return query(`SELECT * FROM appointments WHERE patient_id = '${patientId}'`);
}

export function addNote(patientId, body) {
  const { appointmentId, symptoms } = body;
  const id = crypto.randomUUID();
  query(
    `INSERT INTO notes (id, patient_id, appointment_id, symptoms) ` +
      `VALUES ('${id}', '${patientId}', '${appointmentId || ""}', '${symptoms || ""}')`,
  );
  console.log(`[note] patient=${patientId} symptoms="${symptoms || ""}"`);
  return { id, appointmentId: appointmentId || null };
}

export function listNotes(patientId) {
  return query(`SELECT * FROM notes WHERE patient_id = '${patientId}'`);
}
