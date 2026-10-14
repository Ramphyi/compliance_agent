import { inspectRepository } from "./repository-inventory.mjs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function collectSnapshot(directory) {
  const report = await inspectRepository(directory);
  const artifacts = Object.fromEntries(
    Object.entries(report.artifacts).map(([key, paths]) => [
      key,
      paths.slice(0, 30),
    ]),
  );
  let revision;
  try {
    revision = execFileSync(
      "git",
      ["-C", resolve(directory), "rev-parse", "HEAD"],
      {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    ).trim();
  } catch {
    /* A local folder does not need Git. */
  }
  return {
    filesInspected: report.filesInspected,
    technologyHints: report.technologyHints,
    artifacts,
    generatedAt: report.generatedAt,
    truncated:
      report.truncated ||
      Object.values(report.artifacts).some((paths) => paths.length > 30),
    ...(revision && /^[a-f0-9]{40,64}$/i.test(revision) ? { revision } : {}),
  };
}
export async function sendSnapshot(snapshot, env = process.env) {
  const url = new URL(env.CLEARANCE_URL || "http://127.0.0.1:4000");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Use HTTPS, or HTTP on localhost, without URL credentials.",
    );
  if (!env.CLEARANCE_PROJECT_ID || !env.CLEARANCE_API_KEY)
    throw new Error(
      "Set CLEARANCE_PROJECT_ID and CLEARANCE_API_KEY before syncing.",
    );
  const response = await fetch(
    new URL(
      `/api/projects/${encodeURIComponent(env.CLEARANCE_PROJECT_ID)}/snapshot`,
      url,
    ),
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.CLEARANCE_API_KEY}`,
      },
      body: JSON.stringify(snapshot),
    },
  );
  if (!response.ok)
    throw new Error(
      `Snapshot upload failed (HTTP ${response.status}). Check the project and evidence scope.`,
    );
  return await response.json();
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2),
      directory = args.find((arg) => arg !== "--send");
    if (!directory)
      throw new Error(
        "Usage: node scripts/connect-project.mjs <checkout-folder> [--send]",
      );
    const snapshot = await collectSnapshot(directory);
    if (args.includes("--send")) {
      const result = await sendSnapshot(snapshot);
      console.log(
        `Code snapshot saved. ${result.unanswered.length} questions need answers. Open your project to continue.`,
      );
    } else console.log(JSON.stringify(snapshot, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
