import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DB } from "./db.js";
import type { Config } from "./config.js";
import { ownedProject, runAssessment, releaseGate } from "./engine.js";
import { evidenceSchema } from "./validation.js";
import { id, audit } from "./security.js";
import { sources } from "./catalog.js";
export function mcpHandler(db: DB, config: Config) {
  return async (req: Request, res: Response) => {
    const server = new McpServer({ name: "clearance", version: "0.1.0" });
    const uid = req.userId!;
    const result = (value: unknown) => ({
      content: [
        { type: "text" as const, text: JSON.stringify(value, null, 2) },
      ],
    });
    const allowed = (scope: string) =>
      !req.scopes || req.scopes.includes(scope);
    if (allowed("read")) {
      server.registerTool(
        "list_projects",
        {
          description:
            "List only the authenticated owner’s software projects. Read-only.",
          inputSchema: {},
        },
        async () =>
          result(
            (
              await db.query(
                "SELECT * FROM projects WHERE owner_id=$1 ORDER BY created_at DESC",
                [uid],
              )
            ).rows,
          ),
      );
      server.registerTool(
        "get_assessment",
        {
          description:
            "Read the latest evidence-coverage assessment. Not a legal certification.",
          inputSchema: { projectId: z.string() },
        },
        async ({ projectId }) => {
          await ownedProject(db, uid, projectId);
          return result(
            (
              await db.query(
                "SELECT * FROM runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
                [projectId],
              )
            ).rows[0] || null,
          );
        },
      );
      server.registerTool(
        "check_release_gate",
        {
          description:
            "Fail closed on missing, stale or incomplete assessments and high-priority evidence gaps.",
          inputSchema: { projectId: z.string() },
        },
        async ({ projectId }) => result(await releaseGate(db, uid, projectId)),
      );
      server.registerResource(
        "compliance-skill",
        "clearance://skills/assessment",
        { mimeType: "text/markdown" },
        async (uri) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: "text/markdown",
              text: await readFile(
                resolve("skills/compliance-assessment/SKILL.md"),
                "utf8",
              ),
            },
          ],
        }),
      );
      server.registerResource(
        "regulatory-sources",
        "clearance://sources",
        { mimeType: "application/json" },
        async (uri) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(sources),
            },
          ],
        }),
      );
    }
    if (allowed("assess"))
      server.registerTool(
        "run_assessment",
        {
          description:
            "Run an assessment for an owned project. May use external research only when both server and project opt in. Mutates assessment history.",
          inputSchema: { projectId: z.string() },
        },
        async ({ projectId }) =>
          result(await runAssessment(db, config, uid, projectId)),
      );
    if (allowed("evidence"))
      server.registerTool(
        "submit_evidence",
        {
          description:
            "Submit evidence for human review. This tool cannot approve evidence.",
          inputSchema: { projectId: z.string(), ...evidenceSchema.shape },
        },
        async ({ projectId, ...data }) => {
          await ownedProject(db, uid, projectId);
          const evidenceId = id();
          await db.query(
            "INSERT INTO evidence (id,project_id,control_id,title,content) VALUES ($1,$2,$3,$4,$5)",
            [evidenceId, projectId, data.controlId, data.title, data.content],
          );
          await audit(db, uid, "evidence.submitted.mcp", evidenceId);
          return result({ id: evidenceId, status: "submitted" });
        },
      );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}
