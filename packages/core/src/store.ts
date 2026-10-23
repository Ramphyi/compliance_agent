import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { Actor, Audit, JournalEntry, ProjectConfig, ResearchRule } from "./types";

export type StoreEvent =
  | { type: "project" }
  | { type: "audit"; auditId: string }
  | { type: "journal"; entry: JournalEntry }
  | { type: "job"; jobId: string };

/**
 * File-based state in <project>/.acai (or a custom directory). Plain JSON so it can be
 * reviewed, backed up or committed. Writes are atomic (temp file + rename) and
 * read-modify-write cycles hold a lock file, so the dashboard, MCP server and CLI can
 * work on the same project at the same time.
 */
export class Store {
  readonly dir: string;
  readonly events = new EventEmitter();

  constructor(readonly root: string, stateDir?: string) {
    this.dir = resolve(stateDir ?? join(root, ".acai"));
    this.events.setMaxListeners(100);
  }

  exists() {
    return existsSync(join(this.dir, "project.json"));
  }

  ensure() {
    mkdirSync(join(this.dir, "audits"), { recursive: true });
    mkdirSync(join(this.dir, "rules"), { recursive: true });
    const gi = join(this.dir, ".gitignore");
    if (!existsSync(gi)) writeFileSync(gi, "lock\n*.tmp\njobs/\n");
  }

  private path(...p: string[]) {
    return join(this.dir, ...p);
  }

  private readJson<T>(file: string): T | null {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  private writeJson(file: string, value: unknown) {
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
    renameSync(tmp, file);
  }

  /** Cross-process mutual exclusion via an exclusive lock file. Stale locks expire after 30 s. */
  withLock<T>(fn: () => T): T {
    this.ensure();
    const lock = this.path("lock");
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        closeSync(openSync(lock, "wx"));
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          if (Date.now() - statSync(lock).mtimeMs > 30_000) rmSync(lock, { force: true });
        } catch {
          /* lock vanished between calls */
        }
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lock}`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try {
      return fn();
    } finally {
      rmSync(lock, { force: true });
    }
  }

  readProject(): ProjectConfig | null {
    return this.readJson<ProjectConfig>(this.path("project.json"));
  }

  writeProject(p: ProjectConfig) {
    this.ensure();
    this.writeJson(this.path("project.json"), p);
    this.events.emit("change", { type: "project" } satisfies StoreEvent);
  }

  updateProject<T>(fn: (p: ProjectConfig) => T): T {
    return this.withLock(() => {
      const p = this.readProject();
      if (!p) throw new Error("Project is not initialised. Run `acai init` or start an audit first.");
      const out = fn(p);
      this.writeProject(p);
      return out;
    });
  }

  listAudits(): Audit[] {
    const dir = this.path("audits");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.readJson<Audit>(join(dir, f)))
      .filter((a): a is Audit => Boolean(a))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  readAudit(id: string): Audit | null {
    if (!/^[\w-]+$/.test(id)) return null;
    return this.readJson<Audit>(this.path("audits", `${id}.json`));
  }

  latestAudit(): Audit | null {
    return this.listAudits()[0] ?? null;
  }

  writeAudit(a: Audit) {
    this.ensure();
    a.updatedAt = new Date().toISOString();
    this.writeJson(this.path("audits", `${a.id}.json`), a);
    this.events.emit("change", { type: "audit", auditId: a.id } satisfies StoreEvent);
  }

  updateAudit<T>(id: string, fn: (a: Audit) => T): T {
    return this.withLock(() => {
      const a = this.readAudit(id);
      if (!a) throw new Error(`Audit ${id} not found`);
      const out = fn(a);
      this.writeAudit(a);
      return out;
    });
  }

  // ---- journal: append-only, hash-chained, so tampering with history is detectable ----

  private lastJournal(): JournalEntry | null {
    const file = this.path("journal.jsonl");
    if (!existsSync(file)) return null;
    const text = readFileSync(file, "utf8").trimEnd();
    const last = text.slice(text.lastIndexOf("\n") + 1);
    return last ? (JSON.parse(last) as JournalEntry) : null;
  }

  journal(actor: Actor, action: string, target?: string, data?: unknown): JournalEntry {
    const entry = this.withLock(() => {
      const prev = this.lastJournal();
      const base = {
        seq: (prev?.seq ?? 0) + 1,
        at: new Date().toISOString(),
        actor,
        action,
        target,
        data,
        prevHash: prev?.hash ?? "genesis",
      };
      const hash = createHash("sha256").update(JSON.stringify(base)).digest("hex");
      const e: JournalEntry = { ...base, hash };
      appendFileSync(this.path("journal.jsonl"), JSON.stringify(e) + "\n");
      return e;
    });
    this.events.emit("change", { type: "journal", entry } satisfies StoreEvent);
    return entry;
  }

  readJournal(limit = 500): JournalEntry[] {
    const file = this.path("journal.jsonl");
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l) as JournalEntry);
  }

  verifyJournal(): { ok: boolean; entries: number; brokenAt?: number } {
    const file = this.path("journal.jsonl");
    if (!existsSync(file)) return { ok: true, entries: 0 };
    let prev = "genesis";
    const lines = readFileSync(file, "utf8").trimEnd().split("\n").filter(Boolean);
    for (const line of lines) {
      const e = JSON.parse(line) as JournalEntry;
      const { hash, ...base } = e;
      const expect = createHash("sha256").update(JSON.stringify(base)).digest("hex");
      if (e.prevHash !== prev || hash !== expect) return { ok: false, entries: lines.length, brokenAt: e.seq };
      prev = hash;
    }
    return { ok: true, entries: lines.length };
  }

  // ---- researched rules awaiting human acceptance ----

  readResearch(): ResearchRule[] {
    return this.readJson<ResearchRule[]>(this.path("research.json")) ?? [];
  }

  updateResearch<T>(fn: (rules: ResearchRule[]) => T): T {
    return this.withLock(() => {
      const rules = this.readResearch();
      const out = fn(rules);
      this.writeJson(this.path("research.json"), rules);
      this.events.emit("change", { type: "project" } satisfies StoreEvent);
      return out;
    });
  }

  rulesDir() {
    return this.path("rules");
  }

  writeRaw(rel: string, content: string) {
    this.ensure();
    const file = this.path(rel);
    writeFileSync(file, content);
    return file;
  }
}
