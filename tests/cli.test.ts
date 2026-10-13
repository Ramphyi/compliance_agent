import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createDb, type DB } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedDemo } from "../server/seed.js";
import { runAssessment } from "../server/engine.js";
import { hash, id } from "../server/security.js";
import type { Config } from "../server/config.js";
import type { Server } from "node:http";
const config: Config = {
  production: false,
  port: 4000,
  appUrl: "http://localhost:5173",
  apiUrl: "http://localhost:4000",
  demo: true,
  memory: true,
  externalAi: false,
  regulatoryFetch: false,
};
let db: DB, server: Server, uid: string, pid: string, base: string;
const key = "clr_test_only_" + id();
const run = (env: Record<string, string>) =>
  new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(process.execPath, ["scripts/compliance-gate.mjs"], {
      windowsHide: true,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });
beforeEach(async () => {
  db = await createDb(config);
  uid = await seedDemo(db, config);
  pid = (await db.query("SELECT id FROM projects WHERE owner_id=$1", [uid]))
    .rows[0].id;
  await db.query(
    "INSERT INTO api_keys (id,user_id,name,token_hash,prefix,scopes,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [
      id(),
      uid,
      "CLI test",
      hash(key),
      "clr_test",
      '["read"]',
      new Date(Date.now() + 60000),
    ],
  );
  server = createApp(db, config).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await db.end();
});
describe("actual CI command-line behavior", () => {
  it("fails closed when credentials are absent or invalid", async () => {
    expect(
      (
        await run({
          CLEARANCE_URL: base,
          CLEARANCE_PROJECT_ID: pid,
          CLEARANCE_API_KEY: "",
        })
      ).code,
    ).toBe(2);
    expect(
      (
        await run({
          CLEARANCE_URL: base,
          CLEARANCE_PROJECT_ID: pid,
          CLEARANCE_API_KEY: "invalid",
        })
      ).code,
    ).toBe(2);
  });
  it("blocks evidence gaps and passes only a current approved high-priority baseline", async () => {
    const env = {
      CLEARANCE_URL: base,
      CLEARANCE_PROJECT_ID: pid,
      CLEARANCE_API_KEY: key,
    };
    expect((await run(env)).code).toBe(1);
    const findings = (
      await db.query("SELECT findings FROM runs WHERE project_id=$1", [pid])
    ).rows[0].findings;
    for (const f of findings.filter((f: any) => f.severity === "high"))
      await db.query(
        "INSERT INTO evidence (id,project_id,control_id,title,content,status) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          id(),
          pid,
          f.id,
          "Test reviewer approval",
          "An explicit test-only approval record for gate verification.",
          "approved",
        ],
      );
    await runAssessment(db, config, uid, pid);
    const passed = await run(env);
    expect(passed.code).toBe(0);
    expect(passed.output).toContain("PASS");
    expect(passed.output).not.toContain(key);
    await db.query(
      "INSERT INTO rules (id,project_id,title,description,severity) VALUES ($1,$2,$3,$4,$5)",
      [
        id(),
        pid,
        "New policy",
        "Changed policy must invalidate the prior gate.",
        "high",
      ],
    );
    expect((await run(env)).code).toBe(1);
  });
});
