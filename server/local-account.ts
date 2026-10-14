import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { DB } from "./db.js";
import type { Config } from "./config.js";
import { id } from "./security.js";

// Explicit operator-created credentials for the ephemeral local preview only.
// No HTTP provisioning endpoint, default password, or production bypass.
export async function loadLocalAccount(
  db: DB,
  config: Config,
  file = resolve(".local/login-account.json"),
) {
  if (config.production || !config.demo || !config.memory) return;
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const account = z
    .object({
      email: z
        .string()
        .email()
        .refine((value) => value.endsWith("@clearance.local")),
      name: z.string().min(1).max(100),
      passwordHash: z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/),
    })
    .parse(JSON.parse(raw));
  if (
    (await db.query("SELECT id FROM users WHERE email=$1", [account.email]))
      .rows.length
  )
    return;
  await db.query(
    "INSERT INTO users (id,email,name,password_hash,verified) VALUES ($1,$2,$3,$4,true)",
    [id(), account.email, account.name, account.passwordHash],
  );
}
