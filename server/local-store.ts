import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DB } from "./db.js";

const tables = [
  "users",
  "sessions",
  "auth_tokens",
  "projects",
  "evidence",
  "rules",
  "runs",
  "api_keys",
  "audit_log",
  "source_checks",
  "code_scans",
  "rule_drafts",
  "assistant_messages",
  "repository_connections",
];
// Development only. Production uses PostgreSQL. All mutations are serialized and
// atomically persisted before the request succeeds, including session revocation.
export async function persistentLocalStore(
  db: DB,
  filename: string,
): Promise<DB> {
  const file = resolve(filename);
  await mkdir(dirname(file), { recursive: true });
  const lock = file + ".lock";
  try {
    await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const pid = Number(await readFile(lock, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error(
        "Invalid local workspace lock. Inspect it before starting another server.",
      );
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (alive)
      throw new Error(
        "This local workspace is already open in another API process.",
      );
    await unlink(lock);
    await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  }
  try {
    let saved: any;
    try {
      saved = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (saved) {
      if (
        saved.version !== 1 ||
        !saved.tables ||
        tables.some((t) => !Array.isArray(saved.tables[t] || []))
      )
        throw new Error(
          "Invalid local workspace store. Restore a backup instead of resetting it.",
        );
      for (const table of tables)
        for (const row of saved.tables[table] || []) {
          const columns = Object.keys(row);
          if (columns.some((c) => !/^[a-z_]+$/.test(c)))
            throw new Error("Invalid workspace column");
          await db.query(
            `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
            columns.map((c) =>
              row[c] && typeof row[c] === "object"
                ? JSON.stringify(row[c])
                : row[c],
            ),
          );
        }
    }
    let queue: Promise<unknown> = Promise.resolve();
    const persist = async () => {
      const data: Record<string, unknown[]> = {};
      for (const table of tables)
        data[table] = (await db.query(`SELECT * FROM ${table}`)).rows;
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, tables: data }), {
        mode: 0o600,
      });
      await rename(temporary, file);
    };
    return {
      query(text, values) {
        const next = queue.then(async () => {
          const result = await db.query(text, values);
          if (!/^\s*SELECT\b/i.test(text)) await persist();
          return result;
        });
        queue = next.catch(() => {});
        return next;
      },
      async end() {
        await queue;
        try {
          await db.end();
        } finally {
          await unlink(lock);
        }
      },
    };
  } catch (e) {
    await unlink(lock);
    await db.end();
    throw e;
  }
}
