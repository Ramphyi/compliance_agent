import pg from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "./config.js";
import { persistentLocalStore } from "./local-store.js";
export type DB = {
  query: (
    text: string,
    values?: any[],
  ) => Promise<{ rows: any[]; rowCount: number | null }>;
  end: () => Promise<void>;
};
export async function createDb(config: Config): Promise<DB> {
  let db: DB;
  if (config.memory) {
    const { newDb } = await import("pg-mem");
    const adapter = newDb().adapters.createPg();
    db = new adapter.Pool();
  } else
    db = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
  await db.query(await readFile(resolve("server/schema.sql"), "utf8"));
  if (config.localDataFile) {
    if (config.production || !config.memory || !config.demo)
      throw new Error(
        "Local workspace storage is only supported in development demo mode.",
      );
    return persistentLocalStore(db, config.localDataFile);
  }
  return db;
}
