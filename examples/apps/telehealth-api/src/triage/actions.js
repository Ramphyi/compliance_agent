// Follow-up actions the triage assistant can trigger. The model returns an
// action name and the matching handler is looked up and called.
import crypto from "node:crypto";

import { query } from "../db/sql.js";

const actions = {
  self_care(patientId, result) {
    return { kind: "self_care", advice: result.reason || result.summary };
  },
  book_routine(patientId, result) {
    return schedule(patientId, result, "routine", 72);
  },
  book_urgent(patientId, result) {
    return schedule(patientId, result, "urgent", 2);
  },
};

function schedule(patientId, result, kind, withinHours) {
  const id = crypto.randomUUID();
  const startsAt = new Date(Date.now() + withinHours * 3600 * 1000).toISOString();
  // The reason text comes from the model's JSON reply.
  query(
    `INSERT INTO appointments (id, patient_id, clinician, starts_at, reason) ` +
      `VALUES ('${id}', '${patientId}', 'triage-${kind}', '${startsAt}', '${result.reason || ""}')`,
  );
  return { kind: "booked", priority: kind, appointmentId: id, startsAt };
}

// Dispatch on the action name the model chose.
export function runAction(patientId, actionName, result) {
  const handler = actions[actionName];
  if (typeof handler !== "function") {
    return { kind: "none", note: `unknown action ${actionName}` };
  }
  return handler(patientId, result);
}
