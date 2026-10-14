import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { controls, sources } from "./catalog.js";
import { unansweredQuestions } from "../shared/discovery.js";
import { id, audit, HttpError, hash } from "./security.js";
import type { DB } from "./db.js";
import type { Config } from "./config.js";
import type {
  Project,
  Evidence,
  Rule,
  Run,
  RunEvent,
  Finding,
} from "../shared/types.js";
export async function ownedProject(
  db: DB,
  userId: string,
  projectId: string,
): Promise<Project> {
  const { rows } = await db.query(
    "SELECT * FROM projects WHERE id=$1 AND owner_id=$2",
    [projectId, userId],
  );
  if (!rows[0]) throw new HttpError(404, "Project not found.");
  return rows[0];
}
export function evaluate(
  project: Project,
  evidence: Evidence[],
  rules: Rule[],
): Finding[] {
  const applicable = controls
    .filter((c) => c.applies(project.profile))
    .map(({ applies, ...c }) => c);
  const custom = rules.map((r) => ({
    id: r.id,
    title: r.title,
    framework: "Custom policy",
    category: "Internal",
    severity: r.severity,
    description: r.description,
    action:
      "Submit supporting evidence and have it reviewed against this policy.",
    source: "",
  }));
  const setup: Finding[] = unansweredQuestions(project.profile).map((q) => ({
    id: `question:${q.id}`,
    title: q.title,
    framework: "Project questions",
    category: "Project setup",
    severity: "high",
    description: q.why,
    action: `Answer this in Project questions. ${q.hint}`,
    source: "",
    status: "missing",
    evidenceIds: [],
  }));
  if (project.profile.discovery && !project.profile.discovery.snapshot)
    setup.push({
      id: "code-snapshot",
      title: "Connect a code snapshot",
      framework: "Project questions",
      category: "Project setup",
      severity: "high",
      description:
        "The code source is saved, but no repository metadata has been imported.",
      action:
        "Open Connect code and import a folder inventory or send one through MCP.",
      source: "",
      status: "missing",
      evidenceIds: [],
    });
  return [
    ...setup,
    ...[...applicable, ...custom].map((c) => {
      const matches = evidence.filter((e) => e.control_id === c.id);
      return {
        ...c,
        status: matches.some((e) => e.status === "approved")
          ? "covered"
          : matches.some((e) => e.status === "submitted")
            ? "review"
            : "missing",
        evidenceIds: matches.map((e) => e.id),
      };
    }),
  ] as Finding[];
}
const active = new Set<string>();
export const inputDigest = (
  project: Project,
  evidence: Evidence[],
  rules: Rule[],
) =>
  hash(
    JSON.stringify({
      profile: project.profile,
      evidence: [...evidence].sort((a, b) => a.id.localeCompare(b.id)),
      rules: [...rules].sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
export async function runAssessment(
  db: DB,
  config: Config,
  userId: string,
  projectId: string,
): Promise<Run> {
  const project = await ownedProject(db, userId, projectId);
  if (active.has(projectId))
    throw new HttpError(
      409,
      "An assessment is already running for this project.",
    );
  active.add(projectId);
  const runId = id();
  const events: RunEvent[] = [];
  const add = async (agent: string, title: string, detail: string) => {
    events.push({ agent, title, detail, at: new Date().toISOString() });
    await db.query("UPDATE runs SET events=$1 WHERE id=$2", [
      JSON.stringify(events),
      runId,
    ]);
  };
  try {
    await db.query(
      "INSERT INTO runs (id,project_id,status) VALUES ($1,$2,$3)",
      [runId, projectId, "running"],
    );
    await add(
      "Discovery",
      "Product context mapped",
      `${project.profile.softwareType} · ${project.profile.industry} · ${project.profile.countries.join(", ")}. ${project.profile.discovery?.snapshot ? `Repository metadata imported: ${project.profile.discovery.snapshot.filesInspected} files, ${project.profile.discovery.snapshot.technologyHints.join(", ")}. ${unansweredQuestions(project.profile).length} project questions unanswered. No source execution or semantic code audit was performed.` : "Scope comes from your declared profile; no code snapshot imported."}`,
    );
    const evidence = (
      await db.query("SELECT * FROM evidence WHERE project_id=$1", [projectId])
    ).rows;
    const rules = (
      await db.query("SELECT * FROM rules WHERE project_id=$1", [projectId])
    ).rows;
    const findings = evaluate(project, evidence, rules);
    await add(
      "Regulatory analyst",
      "Candidate obligations identified",
      `${findings.length} checks mapped from the maintained starter catalog and ${rules.length} custom policies. Unlisted industries and jurisdictions need specialist review.`,
    );
    await add(
      "Evidence reviewer",
      "Evidence coverage checked",
      `${evidence.length} records matched to controls. Submitted text is never treated as proof of compliance; owner approval is required.`,
    );
    let research: Run["research"] = null;
    if (
      config.externalAi &&
      project.profile.externalAi &&
      process.env.OPENAI_API_KEY
    ) {
      await add(
        "Research analyst",
        "Researching official sources",
        "Sending declared product context to OpenAI. Evidence contents and repository code are excluded.",
      );
      try {
        const skill = await readFile(
          resolve("skills/regulatory-research/SKILL.md"),
          "utf8",
        );
        const client = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
          timeout: 60000,
          maxRetries: 1,
        });
        const response = await client.responses.create({
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          store: false,
          instructions: skill,
          input: JSON.stringify({
            date: new Date().toISOString().slice(0, 10),
            profile: Object.fromEntries(
              Object.entries(project.profile).filter(
                ([key]) => key !== "discovery",
              ),
            ),
            candidateControls: findings.map((f) => ({
              title: f.title,
              source: f.source,
            })),
          }),
          tools: [
            {
              type: "web_search",
              filters: {
                allowed_domains: [
                  ...new Set(
                    sources.map((source) => new URL(source.url).hostname),
                  ),
                ],
              },
            },
          ],
          max_output_tokens: 2400,
        });
        const citations: { title: string; url: string }[] = [];
        for (const item of response.output)
          if (item.type === "message")
            for (const content of item.content)
              if (content.type === "output_text")
                for (const annotation of content.annotations)
                  if (
                    annotation.type === "url_citation" &&
                    annotation.url.startsWith("https://")
                  )
                    citations.push({
                      title: annotation.title,
                      url: annotation.url,
                    });
        research = { text: response.output_text, citations };
        await add(
          "Research analyst",
          "Research note attached",
          `${citations.length} citations returned. Research is advisory and does not approve controls or alter the release gate.`,
        );
      } catch {
        await add(
          "Research analyst",
          "External research unavailable",
          "Provider request failed; assessment uses the starter catalog only. Retry research later.",
        );
      }
    } else
      await add(
        "Research analyst",
        "Local assessment mode",
        "Live web research was not used. Enable server egress, configure OpenAI, and opt this project in to use external research.",
      );
    const score = findings.length
      ? Math.round(
          (findings.filter((f) => f.status === "covered").length /
            findings.length) *
            100,
        )
      : 0;
    await add(
      "Release reviewer",
      "Assessment ready for review",
      `${score}% of mapped checks have owner-approved evidence. This is evidence coverage, not a legal compliance score or certification.`,
    );
    await db.query(
      "UPDATE runs SET status=$1,score=$2,findings=$3,research=$4,input_digest=$5 WHERE id=$6",
      [
        "completed",
        score,
        JSON.stringify(findings),
        research ? JSON.stringify(research) : null,
        inputDigest(project, evidence, rules),
        runId,
      ],
    );
    await audit(db, userId, "assessment.completed", runId);
    return (await db.query("SELECT * FROM runs WHERE id=$1", [runId])).rows[0];
  } catch (error) {
    await db.query("UPDATE runs SET status=$1 WHERE id=$2", ["failed", runId]);
    throw error;
  } finally {
    active.delete(projectId);
  }
}
export async function releaseGate(db: DB, userId: string, projectId: string) {
  const project = await ownedProject(db, userId, projectId);
  const latest = (
    await db.query(
      "SELECT * FROM runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
      [projectId],
    )
  ).rows[0] as Run & { input_digest?: string };
  if (!latest || latest.status !== "completed")
    return {
      passed: false,
      reason: "A completed assessment is required.",
      blockers: [],
    };
  if (Date.now() - new Date(latest.created_at).getTime() > 7 * 86400000)
    return {
      passed: false,
      reason: "Assessment is older than seven days. Run a fresh assessment.",
      blockers: [],
    };
  const evidence = (
    await db.query("SELECT * FROM evidence WHERE project_id=$1", [projectId])
  ).rows;
  const rules = (
    await db.query("SELECT * FROM rules WHERE project_id=$1", [projectId])
  ).rows;
  if (latest.input_digest !== inputDigest(project, evidence, rules))
    return {
      passed: false,
      reason: "Inputs changed since the assessment. Run a fresh assessment.",
      blockers: [],
    };
  const blockers = latest.findings.filter(
    (f) => f.severity === "high" && f.status !== "covered",
  );
  return {
    passed: blockers.length === 0,
    reason: blockers.length
      ? "High-priority controls need approved evidence."
      : "No high-priority evidence gaps in the mapped controls. Legal review remains separate.",
    blockers,
    runId: latest.id,
  };
}
export async function refreshSources(db: DB, config: Config, userId: string) {
  if (!config.regulatoryFetch)
    throw new HttpError(
      503,
      "Source refresh is disabled. Set ALLOW_REGULATORY_FETCH=true to allow official-source requests.",
    );
  // Three bounded workers avoid turning a slow source into a minutes-long request.
  const results: { id: string; status: string }[] = [];
  let nextSource = 0;
  const worker = async () => {
    while (nextSource < sources.length) {
      const source = sources[nextSource++];
      try {
        // Only static, trusted HTTPS URLs; redirects are deliberately not followed.
        const response = await fetch(source.url, {
          redirect: "error",
          signal: AbortSignal.timeout(12000),
          headers: { "User-Agent": "ClearanceSourceMonitor/0.1" },
        });
        if (!response.ok || !response.body)
          throw new Error("Source unavailable");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) {
            await reader.cancel();
            throw new Error("Source too large");
          }
          chunks.push(value);
        }
        const digest = hash(Buffer.concat(chunks).toString("utf8"));
        const previous = (
          await db.query(
            "SELECT digest FROM source_checks WHERE source_id=$1 AND user_id=$2 ORDER BY checked_at DESC LIMIT 1",
            [source.id, userId],
          )
        ).rows[0];
        const changed = !!previous && previous.digest !== digest;
        await db.query(
          "INSERT INTO source_checks (id,user_id,source_id,digest,changed) VALUES ($1,$2,$3,$4,$5)",
          [id(), userId, source.id, digest, changed],
        );
        results.push({
          id: source.id,
          status: changed
            ? "page_changed"
            : previous
              ? "unchanged"
              : "baseline_recorded",
        });
      } catch {
        results.push({ id: source.id, status: "unavailable" });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await audit(db, userId, "sources.refreshed", "official-catalog");
  return results;
}
