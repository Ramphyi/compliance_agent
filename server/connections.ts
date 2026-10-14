import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { HttpError, audit } from "./security.js";
export const providerSchema = z.enum(["github", "bitbucket"]);
const credentialSchema = z.object({
  token: z
    .string()
    .trim()
    .min(8)
    .max(512)
    .refine((t) => !/\s/.test(t), "Token must not contain whitespace."),
});
async function encryptionKey(config: Config) {
  if (process.env.INTEGRATION_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.INTEGRATION_ENCRYPTION_KEY, "base64");
    if (key.length !== 32)
      throw new HttpError(
        503,
        "The server integration encryption key must contain 32 random bytes encoded as base64.",
      );
    return key;
  }
  if (config.production || !config.localDataFile)
    throw new HttpError(
      503,
      "Configure INTEGRATION_ENCRYPTION_KEY on the server before saving repository access.",
    );
  const file = join(dirname(config.localDataFile), "integration.key");
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const key = await readFile(file);
  if (key.length !== 32)
    throw new HttpError(
      503,
      "The local integration key is invalid. Restore its backup.",
    );
  return key;
}
export async function connectionStatus(db: DB, uid: string) {
  const rows = (
    await db.query(
      "SELECT provider,updated_at FROM repository_connections WHERE user_id=$1",
      [uid],
    )
  ).rows;
  return ["github", "bitbucket"].map((provider) => ({
    provider,
    connected: rows.some((r) => r.provider === provider),
    updatedAt: rows.find((r) => r.provider === provider)?.updated_at || null,
  }));
}
export async function saveConnectionToken(
  db: DB,
  config: Config,
  uid: string,
  provider: unknown,
  body: unknown,
) {
  const name = providerSchema.parse(provider),
    { token } = credentialSchema.parse(body),
    key = await encryptionKey(config),
    nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${uid}:${name}`));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const ciphertext = [nonce, cipher.getAuthTag(), encrypted]
    .map((v) => v.toString("base64"))
    .join(".");
  await db.query(
    "INSERT INTO repository_connections (user_id,provider,ciphertext) VALUES ($1,$2,$3) ON CONFLICT (user_id,provider) DO UPDATE SET ciphertext=$3,updated_at=now()",
    [uid, name, ciphertext],
  );
  await audit(db, uid, "repository.connection_saved", name);
  return { ok: true };
}
export async function connectionToken(
  db: DB,
  config: Config,
  uid: string,
  provider: string,
) {
  const row = (
    await db.query(
      "SELECT ciphertext FROM repository_connections WHERE user_id=$1 AND provider=$2",
      [uid, provider],
    )
  ).rows[0];
  if (!row)
    throw new HttpError(
      400,
      `Connect ${provider === "github" ? "GitHub" : "Bitbucket"} in Account settings first, or choose public access.`,
    );
  const [nonce, tag, encrypted] = row.ciphertext
    .split(".")
    .map((v: string) => Buffer.from(v, "base64"));
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await encryptionKey(config),
      nonce,
    );
    decipher.setAAD(Buffer.from(`${uid}:${provider}`));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new HttpError(
      503,
      "Saved repository access could not be unlocked. Reconnect it in Account settings.",
    );
  }
}
