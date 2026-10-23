import { describe, expect, it } from "vitest";
import { evaluate, loadRegistry } from "../packages/core/src/index";
import { ALL_CHECKS } from "../packages/core/src/checks/rules";
import { ARTIFACTS } from "../packages/core/src/checks/artifacts";
import { ARTIFACT_IDS, CHECK_IDS } from "../packages/core/src/registry/ids";

describe("registry", () => {
  const { registry, errors } = loadRegistry();

  it("loads without validation errors", () => {
    expect(errors).toEqual([]);
    expect(registry.frameworks.length).toBeGreaterThanOrEqual(40);
    expect(registry.presets.length).toBeGreaterThanOrEqual(10);
  });

  it("every framework has an official URL, a summary and several controls", () => {
    for (const f of registry.frameworks) {
      expect(f.url, f.id).toMatch(/^https:\/\//);
      expect(f.summary.length, f.id).toBeGreaterThan(40);
      expect(f.controls.length, f.id).toBeGreaterThanOrEqual(5);
    }
  });

  it("every detector and artifact id has an implementation", () => {
    expect(new Set(ALL_CHECKS.map((c) => c.id))).toEqual(new Set(CHECK_IDS));
    expect(new Set(ARTIFACTS.map((a) => a.id))).toEqual(new Set(ARTIFACT_IDS));
  });

  it("most detectors are referenced by at least one control", () => {
    const used = new Set([...registry.controls.values()].flatMap((c) => c.checks));
    const unused = CHECK_IDS.filter((id) => !used.has(id));
    expect(unused.length).toBeLessThanOrEqual(3);
  });

  it("covers the product families the user asked for", () => {
    const ids = new Set(registry.frameworks.map((f) => f.id));
    for (const id of ["gdpr", "eu-ai-act", "eu-cra", "etsi-en-303-645", "iso-26262", "iso-sae-21434", "unece-r155", "iec-62304", "iso-iec-27001", "misra-c", "pci-dss"])
      expect(ids.has(id), id).toBe(true);
  });
});

describe("three-valued conditions", () => {
  const c = { all: [{ fact: "markets", in: ["EU"] }, { fact: "dataCategories", in: ["personal"] }] };
  it("is unknown while a fact is unanswered, and reports which", () => {
    const missing = new Set<string>();
    expect(evaluate(c, { markets: ["EU"] }, missing)).toBeNull();
    expect([...missing]).toEqual(["dataCategories"]);
  });
  it("short-circuits: one false makes `all` false even with unknowns", () => {
    expect(evaluate(c, { markets: ["US"] })).toBe(false);
  });
  it("evaluates any/not", () => {
    expect(evaluate({ any: [{ fact: "a", in: ["x"] }, { fact: "b", equals: "y" }] }, { b: "y" })).toBe(true);
    expect(evaluate({ not: { fact: "aiUsage", in: ["none"] } }, { aiUsage: "none" })).toBe(false);
  });
});

describe("host-agent playbook", () => {
  it("the Claude Code skill matches the MCP playbook", async () => {
    const { PLAYBOOK } = await import("../packages/cli/src/playbook");
    const { readFileSync } = await import("node:fs");
    const skill = readFileSync(new URL("../skills/acai-audit/SKILL.md", import.meta.url), "utf8");
    expect(skill.endsWith(PLAYBOOK)).toBe(true);
  });
});
