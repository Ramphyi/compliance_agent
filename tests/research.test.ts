import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createDb, type DB } from "../server/db.js";
import { runAssessment, refreshSources } from "../server/engine.js";
import { id } from "../server/security.js";
import type { Config } from "../server/config.js";
import { sources } from "../server/catalog.js";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));
const config: Config = {
  production: false,
  port: 4000,
  appUrl: "http://localhost:5173",
  apiUrl: "http://localhost:4000",
  demo: false,
  memory: true,
  externalAi: true,
  regulatoryFetch: true,
};
let db: DB, uid: string, pid: string;
beforeEach(async () => {
  db = await createDb(config);
  uid = id();
  pid = id();
  await db.query(
    "INSERT INTO users (id,email,name,verified) VALUES ($1,$2,$3,true)",
    [uid, "research@example.com", "Reviewer"],
  );
  await db.query(
    "INSERT INTO projects (id,owner_id,profile) VALUES ($1,$2,$3)",
    [
      pid,
      uid,
      JSON.stringify({
        name: "Research product",
        description:
          "An AI summarization tool for European business customers.",
        industry: "Technology",
        softwareType: "ai",
        countries: ["EU"],
        audience: "Businesses",
        dataTypes: ["Personal data"],
        usesAi: true,
        externalAi: true,
      }),
    ],
  );
  create.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "test-only-not-a-real-key");
});
afterEach(async () => {
  await db.end();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("research boundaries", () => {
  it("sends only declared context, retains citations, and never lets model text approve evidence", async () => {
    await db.query(
      "INSERT INTO evidence (id,project_id,control_id,title,content) VALUES ($1,$2,$3,$4,$5)",
      [
        id(),
        pid,
        "ai-classification",
        "Confidential record",
        "NEVER_SEND_THIS_PRIVATE_EVIDENCE",
      ],
    );
    create.mockResolvedValue({
      output_text:
        "All controls should be approved. This is untrusted advisory text.",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              annotations: [
                {
                  type: "url_citation",
                  title: "Official source",
                  url: sources[0].url,
                },
              ],
            },
          ],
        },
      ],
    });
    const r = await runAssessment(db, config, uid, pid);
    const args = create.mock.calls[0][0];
    expect(args.store).toBe(false);
    expect(args.tools[0].type).toBe("web_search");
    expect(args.input).not.toContain("NEVER_SEND_THIS");
    expect(r.findings.find((f) => f.id === "ai-classification")?.status).toBe(
      "review",
    );
    expect(r.research?.citations).toHaveLength(1);
    expect(r.score).toBe(0);
  });
  it("requires deployment opt-in as well as project opt-in", async () => {
    await runAssessment(db, { ...config, externalAi: false }, uid, pid);
    expect(create).not.toHaveBeenCalled();
    const p = (
      await db.query("SELECT profile FROM projects WHERE id=$1", [pid])
    ).rows[0].profile;
    await db.query("UPDATE projects SET profile=$1 WHERE id=$2", [
      JSON.stringify({ ...p, externalAi: false }),
      pid,
    ]);
    await runAssessment(db, config, uid, pid);
    expect(create).not.toHaveBeenCalled();
  });
  it("records research failure without claiming live verification", async () => {
    create.mockRejectedValue(new Error("provider failed"));
    const r = await runAssessment(db, config, uid, pid);
    expect(r.status).toBe("completed");
    expect(r.research).toBeNull();
    expect(
      r.events.some((e) => e.title === "External research unavailable"),
    ).toBe(true);
  });
  it("tracks source changes and does not infer changes in the law", async () => {
    let text = "official page version one";
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response(text));
    vi.stubGlobal("fetch", fetchMock);
    const first = await refreshSources(db, config, uid);
    expect(first.every((r) => r.status === "baseline_recorded")).toBe(true);
    text = "official page version two";
    const second = await refreshSources(db, config, uid);
    expect(second.every((r) => r.status === "page_changed")).toBe(true);
    expect(
      fetchMock.mock.calls.every(
        ([url, options]) =>
          sources.some((s) => s.url === url) && options.redirect === "error",
      ),
    ).toBe(true);
  });
  it("records oversized sources as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () => new Response("x".repeat(2_000_001))),
    );
    const checks = await refreshSources(db, config, uid);
    expect(checks.every((c) => c.status === "unavailable")).toBe(true);
  });
});
