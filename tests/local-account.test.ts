import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../server/db.js";
import { loadLocalAccount } from "../server/local-account.js";
import { passwordHash, passwordMatches } from "../server/security.js";
import type { Config } from "../server/config.js";

it("restores an explicit local login only in memory demo mode, without replacing existing accounts", async () => {
  const config: Config = {
    production: false,
    demo: true,
    memory: true,
    port: 0,
    appUrl: "http://localhost:5173",
    apiUrl: "http://localhost:4000",
    externalAi: false,
    regulatoryFetch: false,
  };
  const folder = await mkdtemp(join(tmpdir(), "clearance-account-"));
  const file = join(folder, "account.json");
  const db = await createDb(config);
  try {
    await writeFile(
      file,
      JSON.stringify({
        email: "owner@clearance.local",
        name: "Local owner",
        passwordHash: await passwordHash("test-only-account-passphrase"),
      }),
    );
    for (const denied of [
      { ...config, production: true },
      { ...config, demo: false },
      { ...config, memory: false },
    ])
      await loadLocalAccount(db, denied, file);
    expect((await db.query("SELECT * FROM users")).rows).toHaveLength(0);
    await loadLocalAccount(db, config, file);
    const user = (await db.query("SELECT * FROM users")).rows[0];
    expect(user.verified).toBe(true);
    expect(
      await passwordMatches("test-only-account-passphrase", user.password_hash),
    ).toBe(true);
    await loadLocalAccount(db, config, file);
    expect((await db.query("SELECT * FROM users")).rows).toHaveLength(1);
    expect((await db.query("SELECT * FROM users")).rows[0].id).toBe(user.id);
  } finally {
    await db.end();
    if (folder.startsWith(join(tmpdir(), "clearance-account-")))
      await rm(folder, { recursive: true, force: true });
  }
});
