import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const command = resolve("scripts/inspect-repository.mjs");
describe("local repository discovery", () => {
  it("discovers nested React, Go, test and license metadata without reading secrets or executing package scripts", async () => {
    const root = await mkdtemp(join(tmpdir(), "clearance-inventory-"));
    try {
      await mkdir(join(root, "web"));
      await mkdir(join(root, "server"));
      await mkdir(join(root, ".aws"));
      await mkdir(join(root, "node_modules"));
      await mkdir(join(root, ".github", "workflows"), { recursive: true });
      await writeFile(
        join(root, "web", "package.json"),
        JSON.stringify({
          dependencies: { react: "1.2.3" },
          scripts: { prepare: "never execute" },
        }),
      );
      await writeFile(
        join(root, "go.mod"),
        "module example.com/app\nrequire github.com/openai/openai-go/v3 v3.0.0",
      );
      await writeFile(join(root, "server", "auth_test.go"), "do not execute");
      await writeFile(join(root, "LICENSE"), "MIT");
      await writeFile(join(root, ".env"), "SUPER_SECRET=value");
      await writeFile(join(root, ".aws", "privacy-secret.txt"), "SECRET");
      await writeFile(
        join(root, "node_modules", "package.json"),
        '{"dependencies":{"next":"9"}}',
      );
      await writeFile(
        join(root, ".github", "workflows", "test.yml"),
        "test pipeline",
      );
      const { stdout } = await exec(process.execPath, [command, root]);
      const report = JSON.parse(stdout);
      expect(report.technologyHints).toEqual(["Go", "openai-go", "react"]);
      expect(report.manifests.map((m: any) => m.path)).toContain(
        "web/package.json",
      );
      expect(report.artifacts.tests).toEqual(["server/auth_test.go"]);
      expect(report.artifacts.licenses).toEqual(["LICENSE"]);
      expect(report.artifacts.pipelines).toEqual([
        ".github/workflows/test.yml",
      ]);
      expect(stdout).not.toMatch(
        /SUPER_SECRET|privacy-secret|1\.2\.3|never execute/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("skips linked directories and reports depth and malformed manifest limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "clearance-bounds-"));
    const outside = await mkdtemp(join(tmpdir(), "clearance-outside-"));
    try {
      await writeFile(
        join(outside, "package.json"),
        '{"dependencies":{"next":"1"}}',
      );
      await symlink(
        outside,
        join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await writeFile(join(root, "package.json"), "{invalid");
      await mkdir(join(root, "a", "b", "c", "d", "e", "f"), {
        recursive: true,
      });
      await writeFile(
        join(root, "a", "b", "c", "d", "e", "f", "package.json"),
        '{"dependencies":{"vue":"1"}}',
      );
      const { stdout } = await exec(process.execPath, [command, root]);
      const report = JSON.parse(stdout);
      expect(report.technologyHints).toEqual([]);
      expect(report.linksSkipped).toBe(1);
      expect(report.depthTruncated).toBe(true);
      expect(report.truncated).toBe(true);
      expect(report.warnings).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
