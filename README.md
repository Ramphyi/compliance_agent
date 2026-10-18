# ◆ Assay — compliance audit agent

Assay audits a codebase against regulations and standards, with a person deciding every step.

You point it at a repository. It works out what the product is, for example a web SaaS, embedded firmware, an automotive ECU, medical software or an AI system. It asks the compliance questions that decide which rules apply, such as where you sell, to whom, what data you handle and the safety level. It then maps the code to the applicable frameworks and lists the problems. A reviewer confirms, rejects, modifies or sends each finding back for re-investigation. Assay fixes the confirmed findings on a separate branch, compiles and tests every fix, and waits for the reviewer to accept or revert it. The audit trail is hash-chained.

It is self-hosted and local-first: no SaaS, no accounts and no database. All state is plain JSON in `<repo>/.assay/`.

```
understand ─▶ ask / preset ─▶ scope ─▶ audit ─▶ human review ─▶ fix + verify ─▶ accept / revert ─▶ report ─▶ re-audit
               (questionnaire)  (48 frameworks)  (detectors +   (confirm, reject,  (branch, build,   (decisions carry over)
                                                  agent)         modify, re-check)  tests, recheck)
```

## Four ways to run it

| Surface | Use it for | Who does the reasoning |
| --- | --- | --- |
| **CLI agent:** `assay audit` | An interactive terminal session from start to finish | Assay's own agent (Claude, or an on-premise model) |
| **MCP server:** `assay mcp` | Inside Claude Code, Cursor, VS Code agent mode or any MCP client | **The host agent and its harness**: its model, file tools, web search and terminal |
| **Dashboard and service:** `assay serve` or Docker | A team review UI and internal deployment across many repositories | Assay's agent, or MCP hosts connected over HTTP |
| **VS Code extension** | Findings in the Problems panel and a tree view, the dashboard in a panel, and MCP registration for Copilot agent mode | Either of the above |

With no model configured, Assay still runs its 41 deterministic detectors and 30 evidence checks against the registry, and an MCP host can do the reasoning.

## Quick start

Requires Node.js 22.12 or later, and git.

```sh
npm ci
npm run build                      # builds dist/assay (CLI + server + MCP + dashboard + registry)
node dist/assay/assay.mjs audit examples/apps/telehealth-api --static
```

With a model as the agent:

```sh
export ANTHROPIC_API_KEY=...       # Claude, default model claude-opus-5-5
# or: export OPENAI_API_KEY=...    # OpenAI, default model gpt-5.5
npx tsx scripts/provider-smoke.ts  # cheap check that the model and tool loop work
node dist/assay/assay.mjs audit /path/to/your/repo
```

Dashboard on <http://127.0.0.1:4317>:

```sh
node dist/assay/assay.mjs serve /path/to/repo-a /path/to/repo-b
```

During development you can run the TypeScript directly with `npm run assay -- <command>`.

### Inside Claude Code (MCP)

```sh
claude mcp add assay -- node /abs/path/dist/assay/assay.mjs mcp . --dashboard
```

Then ask: *"Audit this app for compliance with Assay."* The `audit` prompt and the `assay://playbook` resource tell the host the workflow (see [skills/assay-audit/SKILL.md](skills/assay-audit/SKILL.md)). The host reads the code with its own tools, records findings, and relays your decisions. It must pass `user_confirmed: true`, which the tool descriptions reserve for decisions you made explicitly. It makes fixes with its own edit tools. Assay runs the build and tests, re-runs the detector, and commits on a fix branch. You can also review in the dashboard; `assay_wait_for_review` picks those decisions up.

For HTTP MCP, for example against a shared server, use `{"mcpServers":{"assay":{"type":"http","url":"https://assay.internal/mcp","headers":{"Authorization":"Bearer <token>"}}}}`.

### VS Code

```sh
npm run build:vscode               # produces dist/assay-vscode.vsix
code --install-extension dist/assay-vscode.vsix
```

## The workflow in detail

1. **Understand.** A bounded, symlink-safe scan classifies the product from code signals: embedded C and RTOS, CAN and UDS, AUTOSAR, OTA, BLE and Wi-Fi, web servers, mobile manifests, LLM and ML libraries, and health, payment, children's or location data. It drafts answers with their reasons and file references. With a model, the agent also reads the README and entry points and writes a description of the product's purpose.
2. **Ask.** The questionnaire covers [these questions](registry/questionnaire.yaml): product type, sector, languages, markets (EU, Romania, UK, US, California, UNECE…), audience, role, data categories, payment handling, AI use and EU AI Act risk areas, ASIL, SIL, medical class and IEC 62304 class, connectivity, updates, distribution, regulated-entity status and target certifications. You can also start from a [preset](registry/presets). Drafted answers stay *unconfirmed* until a person confirms them.
3. **Scope.** Each framework's applicability is a condition over those answers, evaluated in three values. A framework that depends on an unanswered fact shows as *undecided* with the missing facts, rather than being guessed. You can include or exclude any framework by hand.
4. **Audit.** Detectors report file and line. Missing evidence becomes "evidence gap" findings, such as a TARA, a safety case, a DPIA, an SBOM or a vulnerability-disclosure policy. With a model, the agent then investigates each in-scope control in eight batches, using each control's guidance. It records findings with evidence, annotates detector hits it disagrees with, and marks controls it verified. Prompts treat repository content as data, never as instructions.
5. **Review** (human in the loop). For each finding you can:
   - **Confirm** it.
   - **Reject** it, with a reason: false positive, accepted risk, not applicable, duplicate or other.
   - **Modify** it: change the severity, text or fix instructions, and optionally confirm in the same step.
   - **Re-investigate** it: the agent looks again with your note and concludes *still valid*, *revised* or *withdraw*.
   - **Reopen** or **resolve** it.

   Agents cannot make these decisions; the state machine is in [review.ts](packages/core/src/review.ts).
6. **Fix and verify.** These steps need git and a clean working tree.
   1. A person approves the build and test commands, because they execute project code. Assay detects them from `assay.json`, `package.json`, the Makefile, CMake, Cargo, Go, Gradle and other build files.
   2. Fixes go to `assay/fixes-<audit>`, one commit per finding, with `Assay-Finding` trailers.
   3. Every fix must build, pass the tests and make the detector stop matching. Otherwise Assay feeds the failure back to the agent for another attempt, up to the configured maximum, and then rolls the change back.
   4. Missing documents are drafted with `[OWNER TO CONFIRM]` placeholders, never with invented facts.
   5. You **accept** the fix or **revert** it; reverting runs `git revert`.
7. **Report and repeat.** Reports come as Markdown, JSON or SARIF. Re-audits carry decisions over by fingerprint: rejected findings stay rejected, and a finding that was fixed and reappears is reopened.

## Rule registry

[registry/](registry) is plain YAML, validated by `npm run registry:validate`: 48 frameworks with 798 controls. Each control has a paraphrased requirement, guidance on what to check in code, the evidence that demonstrates it, linked detectors and artifacts, and crosswalks to other frameworks. Licensed standards (ISO, IEC, SAE, MISRA, PCI) are paraphrased with clause references and are never copied.

- **Privacy and consumer:** GDPR, UK GDPR + DPA 2018, ePrivacy, Romanian national rules (Law 190/2018, Law 506/2004, OUG 34/2014, ANPC), CCPA/CPRA, COPPA, Washington MHMDA, European Accessibility Act
- **AI:** EU AI Act (with the 2026 amendments), ISO/IEC 42001, NIST AI RMF + GenAI profile, OWASP Top 10 for LLM applications
- **Security:**
  - ISO/IEC 27001:2022, SOC 2, NIS2, DORA
  - OWASP ASVS 5.0, OWASP Top 10:2025, OWASP MASVS
  - NIST SSDF
  - HIPAA Security Rule
  - PCI DSS 4.0.1, PSD2 SCA
- **Products and IoT:** EU Cyber Resilience Act, ETSI EN 303 645, EN 18031 (RED), UK PSTI, NIST IR 8259/8425
- **Industrial:** IEC 62443-4-1 and 4-2, IEC 61508-3
- **Automotive:** ISO 26262, ISO/SAE 21434, UN R155, UN R156, ISO 24089, Automotive SPICE, ISO 21448 (SOTIF), MISRA C:2025, MISRA C++:2023, CERT C
- **Medical:** IEC 62304, ISO 14971, EU MDR (software), FDA premarket cybersecurity / 524B, IEC 81001-5-1
- **Platforms:** Apple App Review, Google Play policy

**Research.** With the Anthropic provider, `assay research` (or the dashboard) searches official sources for guardrails beyond the registry. An MCP host can do the same with its own web search through `assay_propose_rules`. A person accepts or rejects each proposed rule. Accepted rules become a project-local framework in `.assay/rules/`.

**Dates and versions** were checked against official sources in October 2026 where possible; each framework's `keyDates` and notes say what was verified. Re-check anything you rely on with counsel.

## Example applications

[examples/apps](examples/apps) has four small, realistic products with planted defects. The answer keys are in [examples/expected](examples/expected), outside the apps so neither the scanner nor the agent sees them.

| App | Product | Preset |
| --- | --- | --- |
| `smart-thermostat-fw` | C99 consumer IoT thermostat (Wi-Fi, BLE, MQTT, OTA), EU and UK | `consumer-iot-device` |
| `brake-ecu` | C99 ABS/brake ECU, ASIL B, CAN and UDS, Tier-1 supplier, EU and UNECE | `automotive-ecu-asil-b` |
| `telehealth-api` | Node.js telehealth API with LLM triage, health data, Romania and Germany | `telehealth-platform-eu` |
| `credit-scoring-ml` | Python credit-scoring service, a high-risk AI system under the EU AI Act | `ai-credit-scoring-eu` |

All four build and test with only `cc`, `make`, `node` and `python3`. `npx tsx scripts/eval-detectors.ts` measures detector recall against the answer keys: currently 100% (62/62) of the detector-findable defects. Design and process defects in the keys are for the agent and reviewers.

## Models and data handling

| Setting | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude via the Messages API. Default model `claude-opus-5-5`, adaptive thinking, effort `high` (`ASSAY_EFFORT`), streaming tool loop, server-side refusal fallback, web search for research. |
| `OPENAI_API_KEY` | OpenAI via the Responses API. Default model `gpt-5.5` (`ASSAY_MODEL`), reasoning effort `medium` (`ASSAY_EFFORT`), web search for research. Runs with `store: false`, so OpenAI keeps no conversation state. |
| `ASSAY_PROVIDER=openai-compatible` with `ASSAY_OPENAI_BASE_URL` and `ASSAY_MODEL` | A self-hosted model (vLLM, Ollama, LM Studio, an internal gateway), for fully on-premise operation. No web research. |
| neither | Detectors and evidence checks only. MCP hosts can still do the reasoning. |

Ollama, vLLM and LM Studio go through `openai-compatible`; OpenAI's own API uses the `openai` provider, which Assay picks automatically when only `OPENAI_API_KEY` is set.

**What leaves the machine:** only when you run agent features, Assay sends file excerpts the agent asks to read, with secrets redacted. `.env`, key and keystore files are never sent. Detectors, scoping, verification and reports run locally. Commands that verify fixes run with model and Assay credentials removed from their environment.

## Internal deployment

```sh
cp .env.example .env                       # set ASSAY_TOKENS=alice:<random>,bob:<random>, model settings
mkdir repos && git clone <repo> repos/<name>
docker compose up -d --build               # dashboard and /mcp on 127.0.0.1:4317
```

- **Authentication and network.** Without tokens the server binds to localhost only and rejects requests whose `Host` header isn't local, which blocks DNS rebinding. Listening on any other interface requires `ASSAY_TOKENS`: per-reviewer tokens, so every decision is attributed to a named person. `ASSAY_TOKEN` (one shared token) also works.
- **Requests.** Mutating API calls need the `X-Assay-Request` header, so a browser cannot send them cross-site.
- **Approvals and paths.** Approving build and test commands lets them run on the server, which is the point of fix verification, so it is equivalent to shell access. `ASSAY_APPROVERS=alice` limits who may approve. Adding projects by path from the dashboard requires `ASSAY_PROJECT_ROOTS`. The file viewer resolves symlinks and never serves credential files.
- **TLS.** Put a TLS reverse proxy in front of the server and set `ASSAY_TRUST_PROXY=1`.
- **Container hardening.** The container runs as a non-root user, with a read-only root filesystem and all capabilities dropped.
- **Adding repositories.** Mount repositories under `/workspace`, or set `ASSAY_ALLOW_CLONE=true` to add them by URL in the dashboard.
- **Persistence.** State lives in each repository's `.assay/`, which you can commit as an audit record. The project list lives in the `/data` volume.
- **Toolchains.** Fix verification runs project builds inside the container. The image includes git, make, gcc and python3; derive your own image for other toolchains.

## CI

```sh
node dist/assay/assay.mjs ci . --fail-on high --sarif assay.sarif
```

`assay ci` runs a detector audit with the profile and decisions committed in `.assay/`. It exits with code 1 while unresolved findings remain at or above the threshold, and writes SARIF for code-scanning upload.

## Repository layout

```
packages/core       engine: registry, scanner, classifier, detectors, scoping, review state machine,
                    store and journal, agent (Claude or OpenAI-compatible), fix and verify, reports
packages/cli        `assay` CLI, terminal HITL, HTTP API + SSE, MCP server (stdio and HTTP)
packages/dashboard  React review UI
packages/vscode     VS Code extension
registry/           questionnaire, frameworks, presets
examples/           example apps and answer keys
skills/assay-audit  the playbook for host agents (generated from packages/cli/src/playbook.ts)
tests/              vitest: registry, detectors, the full review→fix→verify flow, MCP, HTTP security, provider loop
```

```sh
npm run check        # registry validation, typecheck, tests, build
```

## Scope and limits

Assay maps code and repository evidence to requirements and records human decisions. It is not legal advice and not a certification. A "verified" control means a reviewer or the agent saw a compliant implementation; it is not a conformity assessment. Detectors are heuristics: expect some false positives (reject them with a reason, and the decision carries over) and gaps that only the agent investigation or a reviewer will find.
