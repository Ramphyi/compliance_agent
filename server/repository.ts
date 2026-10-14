import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { tmpdir, platform } from "node:os";
import { connectionSchema } from "./validation.js";
import { HttpError } from "./security.js";
import {
  eligibleSource,
  redactSecrets,
  SCAN_MAX_BYTES,
  SCAN_FILE_BYTES,
  SCAN_MAX_FILES,
  type SourceFile,
} from "../shared/code-analysis.js";

export function repositoryRequest(repository: string, accessToken = "") {
  const host = new URL(repository).hostname;
  const provider = host === "github.com" ? "github" : "bitbucket";
  const value = connectionSchema.parse({ provider, repository });
  if (/\s/.test(accessToken) || accessToken.length > 512)
    throw new HttpError(400, "Invalid repository access token.");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: platform() === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
  };
  // Environment configuration keeps the token out of argv, clone URLs, disk and error messages.
  const config = [
    ["http.followRedirects", "false"],
    ["credential.helper", ""],
    ["protocol.file.allow", "never"],
    ["protocol.ext.allow", "never"],
  ];
  if (accessToken)
    config.push([
      `http.https://${host}/.extraHeader`,
      `Authorization: ${provider === "github" ? "Basic " + Buffer.from("x-access-token:" + accessToken).toString("base64") : "Bearer " + accessToken}`,
    ]);
  env.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([key, val], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = val;
  });
  return { repository: value.repository.replace(/\/$/, ""), provider, env };
}
async function git(
  args: string[],
  env: NodeJS.ProcessEnv,
  limit = 4_000_000,
  timeout = 90000,
  monitor?: string,
): Promise<Buffer> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("git", args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let size = 0,
      done = false;
    const fail = () => {
      if (done) return;
      done = true;
      child.kill();
      clearTimeout(timer);
      clearInterval(watch);
      reject(
        new HttpError(
          502,
          "Repository read failed or exceeded its limits. Check the URL, read access and repository size.",
        ),
      );
    };
    const timer = setTimeout(fail, timeout);
    let checking = false;
    const watch = setInterval(async () => {
      if (!monitor || checking || done) return;
      checking = true;
      try {
        const entries = await readdir(monitor, {
          recursive: true,
          withFileTypes: true,
        });
        const { stat } = await import("node:fs/promises");
        let bytes = 0;
        for (const e of entries)
          if (e.isFile()) {
            bytes += (await stat(join(e.parentPath, e.name))).size;
            if (bytes > 200_000_000) {
              fail();
              break;
            }
          }
      } catch {
        /* Clone may not have created directories yet. */
      } finally {
        checking = false;
      }
    }, 1500);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) fail();
      else chunks.push(chunk);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(watch);
      if (done) return;
      if (code !== 0) {
        fail();
        return;
      }
      done = true;
      resolveOutput(Buffer.concat(chunks));
    });
  });
}
export async function readRepository(
  repository: string,
  accessToken: string,
  progress: (detail: string) => Promise<void>,
) {
  const request = repositoryRequest(repository, accessToken);
  const parent = await mkdtemp(join(tmpdir(), "clearance-source-"));
  const checkout = join(parent, "repository.git");
  try {
    await progress(
      "Cloning the default branch into an isolated temporary bare repository. No checkout, scripts or hooks are executed.",
    );
    await git(
      [
        "-c",
        "core.hooksPath=" + join(parent, "no-hooks"),
        "clone",
        "--bare",
        "--depth=1",
        "--",
        request.repository,
        checkout,
      ],
      request.env,
      10000,
      90000,
      parent,
    );
    const revision = (
      await git(["--git-dir=" + checkout, "rev-parse", "HEAD"], request.env)
    )
      .toString()
      .trim();
    const tree = (
      await git(
        ["--git-dir=" + checkout, "ls-tree", "-r", "-l", "-z", "HEAD"],
        request.env,
      )
    )
      .toString()
      .split("\0")
      .filter(Boolean);
    const files: SourceFile[] = [];
    let excludedFiles = 0,
      limitedFiles = 0,
      bytes = 0;
    const entries = tree
      .map((row) => {
        const tab = row.indexOf("\t");
        const [mode, type, oid, size] = row.slice(0, tab).trim().split(/\s+/);
        return {
          mode,
          type,
          oid,
          size: Number(size),
          path: row.slice(tab + 1),
        };
      })
      .sort(
        (a, b) =>
          Number(/^readme/i.test(b.path)) - Number(/^readme/i.test(a.path)) ||
          a.path.localeCompare(b.path),
      );
    await progress(
      `Enumerated ${entries.length} paths. Reading eligible source, configuration and documentation files.`,
    );
    for (const entry of entries) {
      if (
        !["100644", "100755"].includes(entry.mode) ||
        entry.type !== "blob" ||
        !eligibleSource(entry.path)
      ) {
        excludedFiles++;
        continue;
      }
      if (
        entry.size > SCAN_FILE_BYTES ||
        bytes + entry.size > SCAN_MAX_BYTES ||
        files.length >= SCAN_MAX_FILES
      ) {
        limitedFiles++;
        continue;
      }
      const content = await git(
        ["--git-dir=" + checkout, "cat-file", "blob", entry.oid],
        request.env,
        SCAN_FILE_BYTES,
        10000,
      );
      if (content.includes(0)) {
        excludedFiles++;
        continue;
      }
      bytes += content.length;
      files.push({
        path: entry.path,
        content: redactSecrets(content.toString("utf8")),
      });
      if (files.length % 100 === 0)
        await progress(
          `Read ${files.length} source files (${Math.round(bytes / 1024)} KB).`,
        );
    }
    return {
      files,
      coverage: {
        totalFiles: entries.length,
        excludedFiles,
        limitedFiles,
        revision,
      },
    };
  } finally {
    const absolute = resolve(parent),
      rel = relative(resolve(tmpdir()), absolute);
    if (
      !rel ||
      rel.startsWith(".." + sep) ||
      isAbsolute(rel) ||
      !rel.startsWith("clearance-source-")
    )
      throw new Error("Unexpected temporary scan directory");
    await rm(absolute, { recursive: true, force: true });
    for (const key of Object.keys(request.env)) delete request.env[key];
  }
}
