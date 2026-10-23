import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findRegistryRoot, frameworkTemplate, loadRegistry, removeFramework, saveFramework, validateFramework } from "../packages/core/src/index";
import { Projects } from "../packages/cli/src/projects";
import { startServer } from "../packages/cli/src/server";
import { exampleRepo } from "./helpers";

const builtIn = (id: string) => parse(readFileSync(join(findRegistryRoot(), "frameworks", `${id}.yaml`), "utf8"));

/** A newer revision of a built-in framework: same id, new version, one control fewer. */
const revisedIso = () => {
  const doc = builtIn("iso-iec-27001");
  return { ...doc, version: "ISO/IEC 27001:2022 (internal revision 2026-10)", controls: doc.controls.slice(1) };
};

describe("server frameworks: new standards and updated built-in ones", () => {
  const home = mkdtempSync(join(tmpdir(), "acai-fw-"));
  const env = { ...process.env };
  beforeAll(() => {
    process.env.ACAI_HOME = home;
    for (const k of ["ACAI_TOKENS", "ACAI_ADMIN_TOKEN", "ACAI_FRAMEWORKS_DIR"]) delete process.env[k];
  });
  afterAll(() => {
    process.env = env;
    rmSync(home, { recursive: true, force: true });
  });

  it("a later layer replaces a built-in framework with the same id", () => {
    const dir = mkdtempSync(join(tmpdir(), "acai-layer-"));
    try {
      writeFileSync(join(dir, "iso-iec-27001.yaml"), stringify(revisedIso()));
      const before = loadRegistry().registry.frameworks.find((f) => f.id === "iso-iec-27001")!;
      const { registry, errors, warnings } = loadRegistry(undefined, [{ dir, origin: "custom" }]);
      const after = registry.frameworks.find((f) => f.id === "iso-iec-27001")!;
      expect(errors).toEqual([]);
      expect(after.origin).toBe("custom");
      expect(after.version).toContain("internal revision");
      expect(after.replaces).toEqual({ origin: "built-in", version: before.version });
      expect(after.controls.length).toBe(before.controls.length - 1);
      expect(registry.controls.has(before.controls[0].id)).toBe(false);
      expect(registry.frameworks.filter((f) => f.id === "iso-iec-27001")).toHaveLength(1);
      expect(warnings.some((w) => w.message.includes('replaces the built-in framework "iso-iec-27001"'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a broken update is skipped and the built-in version stays", () => {
    const dir = mkdtempSync(join(tmpdir(), "acai-layer-"));
    try {
      writeFileSync(join(dir, "gdpr.yaml"), stringify({ ...builtIn("gdpr"), kind: "law" }));
      const { registry, errors } = loadRegistry(undefined, [{ dir, origin: "custom" }]);
      expect(errors.some((e) => e.file.endsWith("gdpr.yaml"))).toBe(true);
      expect(registry.frameworks.find((f) => f.id === "gdpr")?.origin).toBe("built-in");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates, saves and removes through the shared functions", () => {
    const template = frameworkTemplate();
    expect(validateFramework(template).ok).toBe(true);

    const bad = validateFramework(template.replace("applicability: { always: true }", "applicability: { fact: productTypes, in: [spaceship] }"));
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain('no option "spaceship"');
    expect(() => saveFramework("id: [")).toThrow(/not valid/);

    const added = saveFramework(template.replace("id: example-standard", "id: acme-secure-coding"));
    expect(added.framework?.id).toBe("acme-secure-coding");
    expect(added.replaces).toBeUndefined();
    expect(added.file).toBe(join(home, "frameworks", "acme-secure-coding.yaml"));

    const updated = saveFramework(stringify(revisedIso()));
    expect(updated.replaces?.origin).toBe("built-in");
    expect(removeFramework("iso-iec-27001").restored?.version).toContain("2022");
    expect(() => removeFramework("gdpr")).toThrow(/cannot be removed/);
    expect(() => removeFramework("../auth")).toThrow(/Invalid framework id/);
    removeFramework("acme-secure-coding");
  });

  it("administrators manage them over HTTP and open projects pick them up at once", async () => {
    const repo = exampleRepo("telehealth-api");
    const projects = new Projects({ persist: false });
    const p = projects.add(repo.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    const post = (path: string, body: unknown) =>
      fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Acai-Request": "1" }, body: JSON.stringify(body) });
    try {
      const list: any = await (await fetch(`${url}/api/admin/frameworks`)).json();
      expect(list.writable).toBe(true);
      expect(list.frameworks.every((f: any) => f.origin === "built-in")).toBe(true);

      const source: any = await (await fetch(`${url}/api/admin/frameworks/iso-iec-27001/source`)).json();
      expect(source.origin).toBe("built-in");
      const yaml = stringify({ ...parse(source.yaml), version: "ISO/IEC 27001:2022 (internal revision 2026-10)" });

      const check: any = await (await post("/api/admin/frameworks/validate", { yaml })).json();
      expect(check).toMatchObject({ ok: true, replaces: { origin: "built-in" } });

      const refused = await post("/api/admin/frameworks", { yaml: yaml.replace("kind: standard", "kind: law") });
      expect(refused.status).toBe(422);
      expect(((await refused.json()) as any).check.ok).toBe(false);

      expect((await post("/api/admin/frameworks", { yaml })).status).toBe(200);
      const scope: any = await (await fetch(`${url}/api/projects/${p.id}/scope`)).json();
      const row = scope.find((r: any) => r.frameworkId === "iso-iec-27001");
      expect(row).toMatchObject({ origin: "custom", version: expect.stringContaining("internal revision") });
      const registry: any = await (await fetch(`${url}/api/registry`)).json();
      expect(registry.frameworks.some((f: any) => "file" in f)).toBe(false);

      const del = await fetch(`${url}/api/admin/frameworks/iso-iec-27001`, { method: "DELETE", headers: { "X-Acai-Request": "1" } });
      expect(((await del.json()) as any).restored.version).toContain("2022");
      const back: any = await (await fetch(`${url}/api/projects/${p.id}/scope`)).json();
      expect(back.find((r: any) => r.frameworkId === "iso-iec-27001").origin).toBe("built-in");
    } finally {
      server.close();
      repo.cleanup();
    }
  });

  it("files dropped into the directory are applied without a restart", async () => {
    const repo = exampleRepo("telehealth-api");
    const projects = new Projects({ persist: false });
    const p = projects.add(repo.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    try {
      const ws = projects.get(p.id).ws;
      expect(ws.registry.frameworks.some((f) => f.id === "acme-dropped")).toBe(false);
      mkdirSync(join(home, "frameworks"), { recursive: true });
      writeFileSync(join(home, "frameworks", "acme-dropped.yaml"), frameworkTemplate().replace("id: example-standard", "id: acme-dropped"));
      await expect.poll(() => ws.registry.frameworks.some((f) => f.id === "acme-dropped"), { timeout: 5000 }).toBe(true);
      expect((await fetch(`${url}/api/meta`)).status).toBe(200);
    } finally {
      server.close();
      repo.cleanup();
      rmSync(join(home, "frameworks", "acme-dropped.yaml"), { force: true });
    }
  });
});
