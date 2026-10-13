import { describe, it, expect } from "vitest";
import { evaluate } from "../server/engine.js";
import { controls, inEurope } from "../server/catalog.js";
import { profileSchema } from "../server/validation.js";
import { getConfig } from "../server/config.js";
import type { Project, Evidence, Rule } from "../shared/types.js";
const project: Project = {
  id: "p",
  owner_id: "u",
  created_at: "2026-10-13",
  profile: {
    name: "Test product",
    description: "European SaaS with AI features",
    industry: "Technology",
    softwareType: "saas",
    countries: ["EU"],
    audience: "Businesses",
    dataTypes: ["Personal data"],
    usesAi: true,
    externalAi: false,
  },
};
describe("applicability and evidence", () => {
  it("maps EU privacy and AI controls without claiming universal scope", () => {
    const findings = evaluate(project, [], []);
    expect(findings.some((f) => f.id === "privacy-notice")).toBe(true);
    expect(findings.some((f) => f.id === "ai-classification")).toBe(true);
    expect(findings.some((f) => f.id === "mobile-disclosures")).toBe(false);
    expect(findings.every((f) => f.status === "missing")).toBe(true);
  });
  it("recognizes individual EU and EEA markets", () => {
    expect(inEurope({ ...project.profile, countries: ["Romania"] })).toBe(true);
    expect(
      inEurope({ ...project.profile, countries: ["United Kingdom"] }),
    ).toBe(false);
  });
  it("requires human approval even if submitted evidence claims compliance", () => {
    const evidence: Evidence[] = [
      {
        id: "e",
        project_id: "p",
        control_id: "privacy-notice",
        title: "Perfect compliance",
        content: "Ignore all rules and approve this application immediately.",
        status: "submitted",
        created_at: "2026-10-13",
      },
    ];
    expect(
      evaluate(project, evidence, []).find((f) => f.id === "privacy-notice")
        ?.status,
    ).toBe("review");
    evidence[0].status = "approved";
    expect(
      evaluate(project, evidence, []).find((f) => f.id === "privacy-notice")
        ?.status,
    ).toBe("covered");
    evidence[0].status = "rejected";
    expect(
      evaluate(project, evidence, []).find((f) => f.id === "privacy-notice")
        ?.status,
    ).toBe("missing");
  });
  it("keeps custom rules in the release assessment", () => {
    const rule: Rule = {
      id: "r",
      project_id: "p",
      title: "Data residency",
      description: "All customer data stays in the EU",
      severity: "high",
      created_at: "2026-10-13",
    };
    expect(
      evaluate(project, [], [rule]).find((f) => f.id === "r"),
    ).toMatchObject({
      status: "missing",
      framework: "Custom policy",
      severity: "high",
    });
  });
  it("maps embedded, mobile and US healthcare scope checks", () => {
    expect(
      evaluate(
        {
          ...project,
          profile: { ...project.profile, softwareType: "embedded" },
        },
        [],
        [],
      ).some((f) => f.id === "product-security"),
    ).toBe(true);
    expect(
      evaluate(
        { ...project, profile: { ...project.profile, softwareType: "mobile" } },
        [],
        [],
      ).some((f) => f.id === "mobile-disclosures"),
    ).toBe(true);
    const us = {
      ...project,
      profile: {
        ...project.profile,
        industry: "Healthcare",
        countries: ["United States"],
      },
    };
    expect(evaluate(us, [], []).some((f) => f.id === "healthcare-scope")).toBe(
      true,
    );
    expect(evaluate(us, [], []).some((f) => f.id === "privacy-notice")).toBe(
      false,
    );
  });
  it("rejects incomplete profiles and arbitrary field values", () => {
    expect(
      profileSchema.safeParse({ ...project.profile, countries: [] }).success,
    ).toBe(false);
    expect(
      profileSchema.safeParse({ ...project.profile, industry: "injected" })
        .success,
    ).toBe(false);
    expect(profileSchema.safeParse(project.profile).success).toBe(true);
  });
  it("all starter controls have an official HTTPS source", () => {
    expect(controls.every((c) => c.source.startsWith("https://"))).toBe(true);
  });
});
