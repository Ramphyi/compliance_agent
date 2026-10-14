import { beforeEach, afterEach, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { createDb, type DB } from "../server/db.js";
import { createApp } from "../server/app.js";
import { id, passwordHash, hash } from "../server/security.js";
import {
  connectionToken,
  saveConnectionToken,
  connectionStatus,
} from "../server/connections.js";
import {
  repositoryRequest,
  gitFailure,
  readRepository,
} from "../server/repository.js";
import { startScan, latestScan } from "../server/scans.js";
import type { Config } from "../server/config.js";
vi.mock("../server/repository.js", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  readRepository: vi.fn(),
}));
let db: DB, directory: string, config: Config, uid: string;
const origin = "http://localhost:5173";
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "clearance-persistence-"));
  config = {
    production: false,
    port: 0,
    appUrl: origin,
    apiUrl: "http://localhost:4000",
    demo: true,
    memory: true,
    externalAi: false,
    regulatoryFetch: false,
    repositoryFetch: true,
    localDataFile: join(directory, "workspace.json"),
  };
  db = await createDb(config);
  uid = id();
  await db.query(
    "INSERT INTO users (id,email,name,password_hash,verified) VALUES ($1,$2,$3,$4,true)",
    [
      uid,
      "owner@example.com",
      "Owner",
      await passwordHash("a strong local testing password"),
    ],
  );
  vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "");
  vi.mocked(readRepository)
    .mockReset()
    .mockImplementation(async () => ({
      files: [
        {
          path: "README.md",
          content:
            "A collaboration platform for business teams to share documents and control access.",
        },
      ],
      coverage: {
        totalFiles: 1,
        excludedFiles: 0,
        limitedFiles: 0,
        revision: "a".repeat(40),
      },
    }));
});
afterEach(async () => {
  await db.end();
  vi.unstubAllEnvs();
  const rel = relative(resolve(tmpdir()), resolve(directory));
  if (rel.startsWith("clearance-persistence-") && !rel.includes(".."))
    await rm(resolve(directory), { recursive: true, force: true });
});
async function login() {
  const result = await request(createApp(db, config))
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({
      email: "owner@example.com",
      password: "a strong local testing password",
    })
    .expect(200);
  return result.headers["set-cookie"][0].split(";")[0];
}
async function restart() {
  await db.end();
  db = await createDb(config);
  return createApp(db, config);
}
it("keeps the same cookie valid across database restarts, persists project state and permanently revokes logout", async () => {
  const cookie = await login(),
    app = createApp(db, config);
  const created = await request(app)
    .post("/api/projects")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({
      name: "Durable app",
      description: "A software service for EU business teams.",
      industry: "Technology",
      softwareType: "saas",
      countries: ["EU"],
      audience: "Businesses",
      dataTypes: ["Personal data"],
      usesAi: false,
      externalAi: false,
    })
    .expect(201);
  const restarted = await restart();
  await request(restarted)
    .get("/api/auth/me")
    .set("Cookie", cookie)
    .expect(200);
  expect(
    (
      await request(restarted)
        .get("/api/projects")
        .set("Cookie", cookie)
        .expect(200)
    ).body[0].id,
  ).toBe(created.body.id);
  await request(restarted)
    .post("/api/auth/logout")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .expect(200);
  await request(await restart())
    .get("/api/auth/me")
    .set("Cookie", cookie)
    .expect(401);
});
it("renews active sessions, preserves recent-login age and respects expiry after restart", async () => {
  const cookie = await login(),
    raw = cookie.split("=")[1],
    created = new Date(Date.now() - 2 * 86400000);
  await db.query(
    "UPDATE sessions SET created_at=$1,expires_at=$2 WHERE token_hash=$3",
    [created, new Date(Date.now() + 86400000), hash(raw)],
  );
  const result = await request(await restart())
    .get("/api/auth/me")
    .set("Cookie", cookie)
    .expect(200);
  expect(result.headers["set-cookie"][0]).toContain("HttpOnly");
  expect(result.headers["set-cookie"][0]).toContain("SameSite=Lax");
  const session = (
    await db.query("SELECT * FROM sessions WHERE token_hash=$1", [hash(raw)])
  ).rows[0];
  expect(+new Date(session.created_at)).toBe(+created);
  expect(+new Date(session.expires_at)).toBeGreaterThan(
    Date.now() + 6 * 86400000,
  );
  await db.query("UPDATE sessions SET expires_at=$1 WHERE token_hash=$2", [
    new Date(Date.now() - 1000),
    hash(raw),
  ]);
  await request(await restart())
    .get("/api/auth/me")
    .set("Cookie", cookie)
    .expect(401);
});
it("encrypts profile credentials, survives restart, never returns tokens and supports replacement/removal", async () => {
  const cookie = await login(),
    secret = "private-repository-test-credential",
    app = createApp(db, config);
  await request(app)
    .put("/api/account/connections/github")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ token: secret })
    .expect(200);
  const status = await request(app)
    .get("/api/account/connections")
    .set("Cookie", cookie)
    .expect(200);
  expect(JSON.stringify(status.body)).not.toContain(secret);
  expect(status.body[0].connected).toBe(true);
  expect(await readFile(config.localDataFile!, "utf8")).not.toContain(secret);
  await restart();
  expect(await connectionToken(db, config, uid, "github")).toBe(secret);
  await expect(
    connectionToken(db, config, "another-owner", "github"),
  ).rejects.toMatchObject({ status: 400 });
  await saveConnectionToken(db, config, uid, "github", {
    token: "replacement-test-credential",
  });
  expect(await connectionToken(db, config, uid, "github")).toBe(
    "replacement-test-credential",
  );
  await request(createApp(db, config))
    .delete("/api/account/connections/github")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .expect(200);
  await restart();
  expect((await connectionStatus(db, uid))[0].connected).toBe(false);
});
it("rejects cross-origin and bearer-key access to account connections", async () => {
  const cookie = await login(),
    app = createApp(db, config);
  await request(app)
    .put("/api/account/connections/github")
    .set("Origin", "https://evil.test")
    .set("Cookie", cookie)
    .send({ token: "test-token" })
    .expect(403);
  const key = (
    await request(app)
      .post("/api/keys")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ name: "Agent", scopes: ["read", "assess", "evidence"] })
      .expect(201)
  ).body.key;
  await request(app)
    .get("/api/account/connections")
    .set("Authorization", `Bearer ${key}`)
    .expect(403);
  await request(app)
    .put("/api/account/connections/github")
    .set("Authorization", `Bearer ${key}`)
    .send({ token: "test-token" })
    .expect(403);
});
it("uses no saved credential for public .git URLs and uses only the owner profile for private access", async () => {
  await saveConnectionToken(db, config, uid, "github", {
    token: "private-test-token",
  });
  const pid = id();
  await db.query(
    "INSERT INTO projects (id,owner_id,profile) VALUES ($1,$2,$3)",
    [
      pid,
      uid,
      JSON.stringify({
        name: "Example",
        description: "An example application for testing.",
        industry: "Technology",
        softwareType: "saas",
        countries: ["EU"],
        audience: "Businesses",
        dataTypes: ["Personal data"],
        usesAi: false,
        externalAi: false,
      }),
    ],
  );
  const wait = async () => {
    for (let i = 0; i < 100; i++) {
      const scan = await latestScan(db, uid, pid);
      if (scan.status !== "running") {
        expect(scan.status).toBe("completed");
        return;
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    throw Error("scan timeout");
  };
  await startScan(db, config, uid, pid, {
    repository: "https://github.com/Ramphyi/reverse_office.git",
  });
  await wait();
  expect(vi.mocked(readRepository).mock.calls[0].slice(0, 2)).toEqual([
    "https://github.com/Ramphyi/reverse_office",
    "",
  ]);
  await startScan(db, config, uid, pid, {
    repository: "https://github.com/Ramphyi/reverse_office.git",
    useSavedConnection: true,
  });
  await wait();
  expect(vi.mocked(readRepository).mock.calls[1][1]).toBe("private-test-token");
  expect(JSON.stringify(await latestScan(db, uid, pid))).not.toContain(
    "private-test-token",
  );
});
it("protects persisted state from a second writer and fails closed when a saved token cannot be decrypted", async () => {
  await expect(createDb(config)).rejects.toThrow("already open");
  await saveConnectionToken(db, config, uid, "github", {
    token: "test-credential",
  });
  vi.stubEnv(
    "INTEGRATION_ENCRYPTION_KEY",
    Buffer.alloc(32, 9).toString("base64"),
  );
  await expect(
    connectionToken(db, config, uid, "github"),
  ).rejects.toMatchObject({ status: 503 });
});
it("normalizes public clone URLs and classifies Git failures without reflecting secret-bearing stderr", () => {
  expect(
    repositoryRequest("https://github.com/Ramphyi/reverse_office.git")
      .repository,
  ).toBe("https://github.com/Ramphyi/reverse_office");
  expect(
    gitFailure("Authentication failed TOKEN_SHOULD_STAY_PRIVATE").status,
  ).toBe(422);
  expect(
    gitFailure("Could not resolve host TOKEN_SHOULD_STAY_PRIVATE").message,
  ).toContain("could not be reached");
  expect(gitFailure("certificate failure").message).toContain("certificate");
  expect(gitFailure("TOKEN_SHOULD_STAY_PRIVATE").message).not.toContain(
    "TOKEN_SHOULD",
  );
});
it("does not replace an authenticated account when opening a landing-page demo", async () => {
  const cookie = await login(),
    app = createApp(db, config);
  const result = await request(app)
    .post("/api/demo")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ example: "memos" })
    .expect(200);
  expect(result.body.reusedSession).toBe(true);
  expect(result.headers["set-cookie"]).toBeUndefined();
  expect(
    (await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200))
      .body.user.id,
  ).toBe(uid);
});
