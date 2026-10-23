import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { acaiHome, Workspace } from "@acai/core";

export type ProjectEntry = { id: string; name: string; root: string; stateDir?: string; addedAt: string };

export { acaiHome };

const idFor = (root: string) => createHash("sha256").update(root).digest("hex").slice(0, 10);

/**
 * Projects known to this Acai instance. A single developer usually has one; an internal
 * deployment can register many repositories (local paths or clones under ACAI_HOME/repos).
 */
export class Projects {
  private file: string;
  private cache = new Map<string, Workspace>();

  constructor(private opts: { stateDir?: string; persist?: boolean } = {}) {
    this.file = join(acaiHome(), "projects.json");
  }

  private read(): ProjectEntry[] {
    if (this.opts.persist === false) return this.memory;
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as ProjectEntry[];
    } catch {
      return [];
    }
  }

  private memory: ProjectEntry[] = [];

  private write(list: ProjectEntry[]) {
    if (this.opts.persist === false) {
      this.memory = list;
      return;
    }
    mkdirSync(acaiHome(), { recursive: true });
    writeFileSync(this.file, JSON.stringify(list, null, 2));
  }

  list() {
    return this.read().filter((p) => existsSync(p.root));
  }

  add(path: string, name?: string): ProjectEntry {
    const root = resolve(path);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
    const list = this.read();
    const existing = list.find((p) => p.root === root);
    if (existing) return existing;
    const entry: ProjectEntry = { id: idFor(root), name: name ?? basename(root), root, stateDir: this.opts.stateDir, addedAt: new Date().toISOString() };
    this.write([...list, entry]);
    return entry;
  }

  remove(id: string) {
    this.write(this.read().filter((p) => p.id !== id));
    this.cache.delete(id);
  }

  /** Clone a repository into ACAI_HOME/repos (internal deployments). Disabled unless ACAI_ALLOW_CLONE=true. */
  clone(url: string, name?: string): ProjectEntry {
    if (process.env.ACAI_ALLOW_CLONE !== "true") throw new Error("Cloning is disabled. Set ACAI_ALLOW_CLONE=true on the server to enable it.");
    if (!/^(https:\/\/|git@|ssh:\/\/)[\w.@:/~-]+$/.test(url)) throw new Error("Only https, ssh or git@ repository URLs are accepted");
    const dir = join(acaiHome(), "repos", `${(name ?? basename(url).replace(/\.git$/, "")).replace(/[^\w.-]/g, "_")}-${idFor(url).slice(0, 6)}`);
    if (!existsSync(dir)) {
      mkdirSync(join(acaiHome(), "repos"), { recursive: true });
      execFileSync("git", ["clone", "--", url, dir], { stdio: "pipe", timeout: 600_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    }
    return this.add(dir, name);
  }

  /** Re-read the registry and project rules of every open project, after rule files changed on disk. */
  reloadRegistries() {
    for (const ws of this.cache.values()) ws.reloadRegistry();
  }

  get(idOrPath: string): { entry: ProjectEntry; ws: Workspace } {
    let entry = this.read().find((p) => p.id === idOrPath || p.root === resolve(idOrPath));
    if (!entry && existsSync(idOrPath)) entry = this.add(idOrPath);
    if (!entry) throw new Error(`Unknown project "${idOrPath}"`);
    let ws = this.cache.get(entry.id);
    if (!ws) {
      ws = Workspace.open(entry.root, { stateDir: entry.stateDir });
      this.cache.set(entry.id, ws);
    }
    return { entry, ws };
  }
}
