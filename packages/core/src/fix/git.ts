import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

export class GitError extends Error {}

export function git(root: string, args: string[], opts: { allowFail?: boolean; input?: string } = {}) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      input: opts.input,
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch (e) {
    if (opts.allowFail) {
      const err = e as { stdout?: string };
      return err.stdout ?? "";
    }
    const err = e as { stderr?: string; message: string };
    throw new GitError(`git ${args.join(" ")} failed: ${(err.stderr || err.message).trim()}`);
  }
}

export function isGitRepo(root: string) {
  try {
    return git(root, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

export function head(root: string) {
  return git(root, ["rev-parse", "HEAD"]).trim();
}

export function currentBranch(root: string) {
  return git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

/** Paths with uncommitted changes, ignoring Acai's own state directory. */
export function changedPaths(root: string, stateDirRel = ".acai"): string[] {
  const out = git(root, ["status", "--porcelain", "--untracked-files=all", "-z"]);
  const paths: string[] = [];
  const parts = out.split("\0").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code.startsWith("R") || code.startsWith("C")) i++; // skip rename source
    if (path === stateDirRel || path.startsWith(stateDirRel + "/")) continue;
    paths.push(path);
  }
  return paths;
}

export function ensureBranch(root: string, name: string) {
  if (currentBranch(root) === name) return;
  const exists = git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], { allowFail: true }).trim();
  git(root, exists ? ["checkout", name] : ["checkout", "-b", name]);
}

/** Unified diff of the working tree against `base` for the given paths, including new files. */
export function diffSince(root: string, base: string, paths: string[]): string {
  if (!paths.length) return "";
  const tracked = git(root, ["diff", base, "--", ...paths], { allowFail: true });
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "--", ...paths], { allowFail: true })
    .split("\n")
    .filter(Boolean);
  let extra = "";
  for (const p of untracked) extra += git(root, ["diff", "--no-index", "--", "/dev/null", p], { allowFail: true });
  return (tracked + extra).slice(0, 400_000);
}

export function commitPaths(root: string, paths: string[], message: string) {
  git(root, ["add", "--", ...paths]);
  git(root, ["-c", "user.name=Acai", "-c", "user.email=acai@localhost", "commit", "--no-verify", "-q", "-F", "-", "--", ...paths], { input: message });
  return head(root);
}

/** Throw away uncommitted changes to these paths (tracked: checkout, untracked: delete). */
export function restorePaths(root: string, base: string, paths: string[]) {
  if (!paths.length) return;
  const untracked = new Set(
    git(root, ["ls-files", "--others", "--exclude-standard", "--", ...paths], { allowFail: true }).split("\n").filter(Boolean),
  );
  const tracked = paths.filter((p) => !untracked.has(p));
  if (tracked.length) git(root, ["checkout", base, "--", ...tracked], { allowFail: true });
  for (const p of untracked) rmSync(join(root, p), { force: true });
}

export function revertCommit(root: string, commit: string) {
  git(root, ["-c", "user.name=Acai", "-c", "user.email=acai@localhost", "revert", "--no-edit", commit]);
  return head(root);
}
