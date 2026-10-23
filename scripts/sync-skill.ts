// Writes skills/acai-audit/SKILL.md from the MCP playbook so both stay identical.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLAYBOOK } from "../packages/cli/src/playbook";

const front = `---
name: acai-audit
description: Run a compliance and security audit of the current repository with the Acai MCP server (regulations, ISO and industry standards, human review of every finding, verified fixes). Use when the user asks to audit the app or code for compliance, GDPR, EU AI Act, CRA, ISO 26262, ISO 21434, IEC 62304, ISO 27001, MISRA, OWASP, or asks what regulations apply.
---

`;
writeFileSync(join(import.meta.dirname, "..", "skills/acai-audit/SKILL.md"), front + PLAYBOOK);
console.log("skills/acai-audit/SKILL.md updated");
