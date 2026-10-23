# Acai Compliance for VS Code

Acai audits your codebase against regulations and standards (GDPR, EU AI Act, Cyber Resilience Act, ISO 26262, ISO/SAE 21434, UN R155/R156, IEC 62304, ISO 27001, MISRA, OWASP and more), with you deciding every step. This extension brings it into the editor.

- **Findings in the editor:** open findings appear in the Problems panel and as squiggles at the exact lines, and in the Acai view grouped as *Needs decision*, *Confirmed*, *Fixes to review* and *Done*.
- **Human-in-the-loop actions:** confirm, reject (with a reason), re-investigate (with a note for the agent), accept or revert fixes. Use the tree inline buttons, the quick fixes on a diagnostic, or the dashboard.
- **The Acai dashboard** opens in a panel: profile questions, frameworks in scope, findings with code and history, verified fixes with diffs, control coverage, research and the audit trail.
- **MCP for agent mode:** the extension registers the Acai MCP server. In Copilot Chat agent mode, enable the Acai tools and ask *"Audit this project for compliance with Acai"*. Your agent does the reasoning with its own model, and Acai keeps the rules, review queue, verification and audit trail.

## Getting started

1. Open a folder and trust the workspace. The extension starts a local Acai server on a random loopback port.
2. Run **Acai: Run Audit (Detectors)**. This needs no model and runs locally.
3. Optionally run **Acai: Set Anthropic API Key** or **Acai: Set OpenAI API Key**, then **Acai: Run Agent Audit**. Alternatively, use Copilot agent mode through MCP.
4. Review the findings, then run **Acai: Fix Confirmed Findings**. Fixes are built and tested with the project's commands, which you approve once in the dashboard's Settings, and committed on a fix branch for you to accept or revert.

## Settings

| Setting | Meaning |
| --- | --- |
| `acai.provider` | `auto`, `anthropic`, `openai`, `openai-compatible` or `none` |
| `acai.model` | Model id. Empty means `claude-opus-5-5` for Anthropic and `gpt-5.5` for OpenAI. |
| `acai.openaiBaseUrl` | OpenAI-compatible endpoint for an on-premise model. User settings only. |
| `acai.stateDir` | Where audit state lives. The default is `<folder>/.acai`. |
| `acai.diagnostics` | Show findings in the Problems panel |
| `acai.reviewerName` | Name recorded with your decisions. The default is your OS user name. |

## Privacy

- **Local by default.** Detectors, scoping, verification and reports run on your machine.
- **When code leaves the machine.** Code excerpts go to the configured model only when you run agent features (agent audit, re-investigation, fixes, research), with secrets redacted. Credential files are never sent.
- **API key storage.** API keys are kept in VS Code's secret storage.
- **Local server only.** The local server listens on 127.0.0.1 only and rejects requests that don't come from a local host name.
