import { z } from "zod";
import type { DB } from "./db.js";
import type { Config } from "./config.js";
import { ownedProject } from "./engine.js";
import { id, audit, HttpError } from "./security.js";
import { readRepository, repositoryRequest } from "./repository.js";
import {
  analyzeSource,
  eligibleSource,
  redactSecrets,
  SCAN_FILE_BYTES,
  SCAN_MAX_BYTES,
  SCAN_MAX_FILES,
  type SourceFile,
  type CodeAnalysis,
} from "../shared/code-analysis.js";
import { enrichAnalysis, aiReady } from "./ai.js";
import type { Discovery } from "../shared/discovery.js";

export const remoteScanSchema = z.object({
  repository: z.string().url().max(300),
  accessToken: z.string().max(512).default(""),
  useAi: z.boolean().default(false),
});
export const localScanSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().max(300),
        content: z.string().max(SCAN_FILE_BYTES),
      }),
    )
    .min(1)
    .max(SCAN_MAX_FILES),
  totalFiles: z.number().int().min(1).max(100000),
  excludedFiles: z.number().int().min(0).max(100000),
  limitedFiles: z.number().int().min(0).max(100000),
  useAi: z.boolean().default(false),
});
const active = new Map<string, string>();
export async function latestScan(db: DB, uid: string, pid: string) {
  const project = await ownedProject(db, uid, pid);
  const row = (
    await db.query(
      "SELECT * FROM code_scans WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
      [pid],
    )
  ).rows[0];
  if (row?.status === "running" && ![...active.values()].includes(row.id)) {
    await db.query("UPDATE code_scans SET status=$1,error=$2 WHERE id=$3", [
      "failed",
      "The server restarted during this scan. Retry the scan.",
      row.id,
    ]);
    row.status = "failed";
    row.error = "The server restarted during this scan. Retry the scan.";
  }
  if (row?.report)
    row.stale =
      project.profile.discovery?.snapshot?.generatedAt !== row.report.scannedAt;
  return row || null;
}
export async function startScan(
  db: DB,
  config: Config,
  uid: string,
  pid: string,
  input: unknown,
  local = false,
) {
  const project = await ownedProject(db, uid, pid);
  if (active.has(pid))
    throw new HttpError(
      409,
      "A code scan is already running for this project.",
    );
  if (active.size >= 2)
    throw new HttpError(
      429,
      "Two code scans are already running. Try again shortly.",
    );
  const data = local
    ? localScanSchema.parse(input)
    : remoteScanSchema.parse(input);
  if (!local && config.repositoryFetch === false)
    throw new HttpError(
      503,
      "Repository downloads are disabled on this server. Use a local source upload or enable ALLOW_REPOSITORY_FETCH.",
    );
  if (!local)
    repositoryRequest(
      (data as z.infer<typeof remoteScanSchema>).repository,
      (data as z.infer<typeof remoteScanSchema>).accessToken,
    );
  if (data.useAi && !aiReady(config))
    throw new HttpError(
      503,
      "AI is not configured. Run a source scan without AI, or configure OPENAI_API_KEY and ALLOW_EXTERNAL_AI on the server.",
    );
  if (local) {
    const payload = data as z.infer<typeof localScanSchema>;
    if (
      payload.totalFiles !==
      payload.files.length + payload.excludedFiles + payload.limitedFiles
    )
      throw new HttpError(
        400,
        "Coverage counts must match the uploaded source inventory.",
      );
    if (
      payload.files.some((f) => !eligibleSource(f.path)) ||
      new Set(payload.files.map((f) => f.path)).size !== payload.files.length
    )
      throw new HttpError(
        400,
        "The source upload contains excluded, duplicate or invalid paths.",
      );
    if (
      payload.files.some(
        (f) =>
          Buffer.byteLength(f.content) > SCAN_FILE_BYTES ||
          f.content.includes("\0"),
      )
    )
      throw new HttpError(
        400,
        "Source files must be text within the per-file size limit.",
      );
    if (
      payload.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0) >
      SCAN_MAX_BYTES
    )
      throw new HttpError(
        413,
        "Source upload exceeds the 6 MB analysis limit.",
      );
  }
  const sid = id();
  active.set(pid, sid);
  try {
    await db.query(
      "INSERT INTO code_scans (id,project_id,status,events) VALUES ($1,$2,$3,$4)",
      [sid, pid, "running", "[]"],
    );
  } catch (error) {
    active.delete(pid);
    throw error;
  }
  const events: { at: string; detail: string }[] = [];
  const progress = async (detail: string) => {
    events.push({ at: new Date().toISOString(), detail });
    await db.query("UPDATE code_scans SET events=$1 WHERE id=$2", [
      JSON.stringify(events),
      sid,
    ]);
  };
  const execute = async () => {
    let files: SourceFile[] = [];
    try {
      const localData = data as z.infer<typeof localScanSchema>,
        remoteData = data as z.infer<typeof remoteScanSchema>;
      const collected = local
        ? {
            files: localData.files.map((f) => ({
              ...f,
              content: redactSecrets(f.content),
            })),
            coverage: {
              totalFiles: localData.totalFiles,
              excludedFiles: localData.excludedFiles,
              limitedFiles: localData.limitedFiles,
            },
          }
        : await readRepository(
            remoteData.repository,
            remoteData.accessToken,
            progress,
          );
      files = collected.files;
      if (!local) remoteData.accessToken = "";
      if (!files.length)
        throw new HttpError(
          422,
          "No supported source files were found within the scan limits.",
        );
      await progress(
        `Analyzing ${files.length} source files for modules, data flows, access checks and AI integrations.`,
      );
      let report = analyzeSource(files, collected.coverage);
      if (data.useAi) {
        await progress(
          "Asking OpenAI to synthesize the redacted source excerpts.",
        );
        report = await enrichAnalysis(config, report, files);
      } else
        report.warnings.push(
          "AI synthesis was not used. Drafts are produced by the local source analyzer.",
        );
      const current = await ownedProject(db, uid, pid);
      if (
        JSON.stringify(current.profile.discovery) !==
        JSON.stringify(project.profile.discovery)
      )
        throw new HttpError(
          409,
          "Project inputs changed during the scan. Retry against the current project.",
        );
      const paths = files.map((f) => f.path),
        select = (re: RegExp) => paths.filter((p) => re.test(p)).slice(0, 30);
      const connection: Discovery = local
        ? { provider: "local", repository: "", answers: {} }
        : {
            provider: remoteData.repository.includes("://github.com/")
              ? "github"
              : "bitbucket",
            repository: remoteData.repository,
            answers: {},
          };
      const previous = current.profile.discovery;
      current.profile.discovery = {
        ...connection,
        answers:
          previous?.provider === connection.provider &&
          previous.repository === connection.repository
            ? previous.answers
            : {},
        importedAt: new Date().toISOString(),
        snapshot: {
          filesInspected: files.length,
          technologyHints: report.technologyHints,
          generatedAt: report.scannedAt,
          truncated: report.limitedFiles > 0,
          ...(report.revision ? { revision: report.revision } : {}),
          artifacts: {
            privacy: select(/privacy/i),
            security: select(/security|threat/i),
            licenses: select(/license|licence/i),
            tests: select(/test|spec/i),
            pipelines: select(
              /\.github\/workflows|bitbucket-pipelines|gitlab-ci/i,
            ),
            mobile: select(/AndroidManifest|Info\.plist/),
            embedded: select(/platformio|CMakeLists/),
          },
        },
      };
      await db.query("UPDATE projects SET profile=$1 WHERE id=$2", [
        JSON.stringify(current.profile),
        pid,
      ]);
      await progress(
        "Analysis saved. Draft answers are ready for review; no controls were automatically approved.",
      );
      await db.query("UPDATE code_scans SET status=$1,report=$2 WHERE id=$3", [
        "completed",
        JSON.stringify(report),
        sid,
      ]);
      await audit(db, uid, "project.source_scanned", pid);
    } catch (error) {
      const message =
        error instanceof HttpError
          ? error.message
          : "Source analysis failed. Check repository access or AI provider configuration, then retry.";
      await db.query("UPDATE code_scans SET status=$1,error=$2 WHERE id=$3", [
        "failed",
        message,
        sid,
      ]);
    } finally {
      files.length = 0;
      if (!local) (data as z.infer<typeof remoteScanSchema>).accessToken = "";
      active.delete(pid);
    }
  };
  void execute().catch(() => active.delete(pid));
  return { id: sid, status: "running" };
}
