import type { DB } from "./db.js";
import { ownedProject } from "./engine.js";
import { audit, HttpError } from "./security.js";
import {
  snapshotSchema,
  answersSchema,
  connectionSchema,
} from "./validation.js";
import { projectQuestions, unansweredQuestions } from "../shared/discovery.js";

export async function getDiscovery(db: DB, uid: string, pid: string) {
  const project = await ownedProject(db, uid, pid);
  return {
    project,
    questions: projectQuestions(project.profile),
    unanswered: unansweredQuestions(project.profile).map((q) => q.id),
    connection: project.profile.discovery ?? null,
  };
}
export async function connectProject(
  db: DB,
  uid: string,
  pid: string,
  input: unknown,
) {
  const project = await ownedProject(db, uid, pid);
  const connection = connectionSchema.parse(input);
  // A different code source must not inherit the previous source's answers or snapshot.
  const previous = project.profile.discovery;
  project.profile.discovery =
    previous?.provider === connection.provider &&
    previous.repository === connection.repository
      ? { ...previous, ...connection }
      : { ...connection, answers: {} };
  await db.query("UPDATE projects SET profile=$1 WHERE id=$2", [
    JSON.stringify(project.profile),
    pid,
  ]);
  await audit(db, uid, "project.connection.saved", pid);
  return getDiscovery(db, uid, pid);
}
export async function submitSnapshot(
  db: DB,
  uid: string,
  pid: string,
  input: unknown,
) {
  const project = await ownedProject(db, uid, pid);
  const snapshot = snapshotSchema.parse(input);
  project.profile.discovery = {
    ...(project.profile.discovery ?? {
      provider: "agent",
      repository: "",
      answers: {},
    }),
    snapshot,
    importedAt: new Date().toISOString(),
  };
  await db.query("UPDATE projects SET profile=$1 WHERE id=$2", [
    JSON.stringify(project.profile),
    pid,
  ]);
  await audit(db, uid, "project.snapshot.submitted", pid);
  return {
    projectId: pid,
    unanswered: unansweredQuestions(project.profile).map((q) => q.id),
  };
}
export async function saveAnswers(
  db: DB,
  uid: string,
  pid: string,
  input: unknown,
) {
  const project = await ownedProject(db, uid, pid);
  if (!project.profile.discovery)
    throw new HttpError(409, "Connect a code source first.");
  const answers = answersSchema.parse(input);
  const valid = new Set(projectQuestions(project.profile).map((q) => q.id));
  if (Object.keys(answers).some((key) => !valid.has(key)))
    throw new HttpError(
      400,
      "An answer refers to a question outside the current project scope.",
    );
  project.profile.discovery.answers = {
    ...project.profile.discovery.answers,
    ...answers,
  };
  await db.query("UPDATE projects SET profile=$1 WHERE id=$2", [
    JSON.stringify(project.profile),
    pid,
  ]);
  await audit(db, uid, "project.answers.saved", pid);
  return {
    projectId: pid,
    unanswered: unansweredQuestions(project.profile).map((q) => q.id),
  };
}
