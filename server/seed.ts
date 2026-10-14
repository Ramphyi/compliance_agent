import type { DB } from "./db.js";
import type { Config } from "./config.js";
import { id } from "./security.js";
import { runAssessment } from "./engine.js";
import memosReport from "../docs/experiments/memos.json";
export async function seedEmptyDemo(db: DB) {
  const uid = id();
  await db.query(
    "INSERT INTO users (id,email,name,verified) VALUES ($1,$2,$3,true)",
    [uid, `demo+${uid}@clearance.local`, "Local project owner"],
  );
  return uid;
}
export async function seedMemosDemo(db: DB, config: Config) {
  const userId = id(),
    projectId = id(),
    ruleId = id();
  await db.query(
    "INSERT INTO users (id,email,name,verified) VALUES ($1,$2,$3,true)",
    [userId, `demo+${userId}@clearance.local`, "Example reviewer"],
  );
  await db.query(
    "INSERT INTO projects (id,owner_id,profile) VALUES ($1,$2,$3)",
    [
      projectId,
      userId,
      JSON.stringify({
        ...memosReport.profile,
        discovery: memosReport.discovery,
      }),
    ],
  );
  await db.query(
    "INSERT INTO rules (id,project_id,title,description,severity) VALUES ($1,$2,$3,$4,$5)",
    [
      ruleId,
      projectId,
      "Review repository inventory and deployment scope",
      "An owner must review the pinned inventory and confirm which optional integrations are enabled before using it in the production release review.",
      "high",
    ],
  );
  await db.query(
    "INSERT INTO evidence (id,project_id,control_id,title,content,status) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      id(),
      projectId,
      ruleId,
      "Pinned Memos repository metadata",
      JSON.stringify(
        {
          source: memosReport.source,
          inventory: memosReport.inventory,
          limitations: memosReport.limitations,
        },
        null,
        2,
      ),
      "submitted",
    ],
  );
  await runAssessment(db, { ...config, externalAi: false }, userId, projectId);
  return userId;
}
export async function seedDemo(db: DB, config: Config) {
  const userId = id(),
    projectId = id();
  await db.query(
    "INSERT INTO users (id,email,name,verified) VALUES ($1,$2,$3,true)",
    [userId, `demo+${userId}@clearance.local`, "Alex Morgan"],
  );
  await db.query(
    "INSERT INTO projects (id,owner_id,profile) VALUES ($1,$2,$3)",
    [
      projectId,
      userId,
      JSON.stringify({
        name: "Acme Workspace",
        description:
          "A SaaS collaboration platform for European businesses, with AI-assisted document summarization and customer account management.",
        industry: "Technology",
        softwareType: "saas",
        countries: ["EU"],
        audience: "Businesses",
        dataTypes: ["Personal data"],
        usesAi: true,
        externalAi: false,
      }),
    ],
  );
  const records = [
    [
      "privacy-notice",
      "Privacy notice · v2.1",
      "Sample evidence: privacy notice describing data categories, processing purposes, retention and rights contacts. This is illustrative demo material.",
      "approved",
    ],
    [
      "access-control",
      "Access review · Q3",
      "Sample evidence: quarterly role review and multi-factor authentication checklist. This is illustrative demo material.",
      "approved",
    ],
    [
      "incident-plan",
      "Incident response playbook",
      "Sample evidence: response ownership, escalation paths and exercise results. This is illustrative demo material.",
      "approved",
    ],
    [
      "data-map",
      "Processing inventory",
      "Sample evidence: inventory of processing activities and processor agreements. This is illustrative demo material.",
      "approved",
    ],
    [
      "ai-governance",
      "AI governance policy draft",
      "Sample evidence: proposed oversight owners and model-review responsibilities. This is illustrative demo material.",
      "submitted",
    ],
  ];
  for (const [control, title, content, status] of records)
    await db.query(
      "INSERT INTO evidence (id,project_id,control_id,title,content,status) VALUES ($1,$2,$3,$4,$5,$6)",
      [id(), projectId, control, title, content, status],
    );
  await runAssessment(db, { ...config, externalAi: false }, userId, projectId);
  return userId;
}
