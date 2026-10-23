# ◆ Acai — compliance audit agent

Acai audits a codebase against regulations and standards, with a person deciding every step.

You point it at a repository. It works out what the product is, for example a web SaaS, embedded firmware, an automotive ECU, medical software or an AI system. It asks the compliance questions that decide which rules apply, such as where you sell, to whom, what data you handle and the safety level. It then maps the code to the applicable frameworks and lists the problems. A reviewer confirms, rejects, modifies or sends each finding back for re-investigation. Acai fixes the confirmed findings on a separate branch, compiles and tests every fix, and waits for the reviewer to accept or revert it. The audit trail is hash-chained.

It is self-hosted and local-first: no SaaS and no database. All state is plain JSON in `<repo>/.acai/`; a shared server keeps its accounts in one file as well.

```
understand ─▶ ask / preset ─▶ scope ─▶ audit ─▶ human review ─▶ fix + verify ─▶ accept / revert ─▶ report ─▶ re-audit
               (questionnaire)  (48 frameworks)  (detectors +   (confirm, reject,  (branch, build,   (decisions carry over)
                                                  agent)         modify, re-check)  tests, recheck)
```

## Four ways to run it

| Surface | Use it for | Who does the reasoning |
| --- | --- | --- |
| **CLI agent:** `acai audit` | An interactive terminal session from start to finish | Acai's own agent (Claude, or an on-premise model) |
| **MCP server:** `acai mcp` | Inside Claude Code, Codex, Cursor, VS Code agent mode, Gemini CLI, Claude Desktop, ChatGPT, Claude.ai or any MCP client ([docs/MCP.md](docs/MCP.md)) | **The host agent and its harness**: its model, file tools, web search and terminal |
| **Dashboard and service:** `acai serve` or Docker | A team review UI and internal deployment across many repositories | Acai's agent, or MCP hosts connected over HTTP |
| **VS Code extension** | Findings in the Problems panel and a tree view, the dashboard in a panel, and MCP registration for Copilot agent mode | Either of the above |

With no model configured, Acai still runs its 41 deterministic detectors and 30 evidence checks against the registry, and an MCP host can do the reasoning.

### The two main modes

1. **Automatic, per repository.** Add a webhook (GitHub, GitLab, or a signed call from any CI). On every push Acai updates its copy, audits it and tells you what to do; in automatic mode its agent explains each finding. On every pull request it scans the new code in a separate worktree and reports what the change adds or fixes: in the dashboard and, with `GITHUB_TOKEN`, as a commit status and one pull request comment with instructions for a coding agent.
2. **From your coding agent.** Connect Claude Code, Codex, Copilot, Cursor or any MCP client. Acai identifies the problems and hands them over as tasks (`acai_tasks`): where, why, what to change and when it is done. The agent fixes them; Acai builds, tests and commits each fix on a branch for you to accept. Without MCP, `acai tasks --out TASKS.md` or *Findings → Hand off to a coding agent* gives the same brief to paste into any agent.

## Quick start

Requires Node.js 22.12 or later, and git.

```sh
npm ci
npm run build                      # builds dist/acai (CLI + server + MCP + dashboard + registry)
node dist/acai/acai.mjs audit examples/apps/telehealth-api --static
```

With a model as the agent:

```sh
export ANTHROPIC_API_KEY=...       # Claude, default model claude-opus-5-5
# or: export OPENAI_API_KEY=...    # OpenAI, default model gpt-5.5
npx tsx scripts/provider-smoke.ts  # cheap check that the model and tool loop work
node dist/acai/acai.mjs audit /path/to/your/repo
```

Dashboard on <http://127.0.0.1:4317>:

```sh
node dist/acai/acai.mjs serve /path/to/repo-a /path/to/repo-b
```

During development you can run the TypeScript directly with `npm run acai -- <command>`.

### Inside Claude Code, Codex, ChatGPT and other agents (MCP)

```sh
claude mcp add acai -- node /abs/path/dist/acai/acai.mjs mcp . --dashboard
```

Then ask: *"Audit this app for compliance with Acai."* The `audit` prompt and the `acai://playbook` resource tell the host the workflow (see [skills/acai-audit/SKILL.md](skills/acai-audit/SKILL.md)). The host reads the code with its own tools, records findings, and relays your decisions. It must pass `user_confirmed: true`, which the tool descriptions reserve for decisions you made explicitly. It makes fixes with its own edit tools. Acai runs the build and tests, re-runs the detector, and commits on a fix branch. You can also review in the dashboard; `acai_wait_for_review` picks those decisions up.

`node dist/acai/acai.mjs connect <client>` prints the setup for Codex, Cursor, VS Code, Gemini CLI, Windsurf, Claude Desktop, ChatGPT, Claude.ai and the OpenAI and Claude APIs. Clients without access to your files, such as ChatGPT and Claude.ai, read and edit the code through Acai's confined file tools. They connect to `acai serve` over HTTPS and sign in with OAuth. See [docs/MCP.md](docs/MCP.md).

### VS Code

```sh
npm run build:vscode               # produces dist/acai-vscode.vsix
code --install-extension dist/acai-vscode.vsix
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
   1. A person approves the build and test commands, because they execute project code. Acai detects them from `acai.json`, `package.json`, the Makefile, CMake, Cargo, Go, Gradle and other build files.
   2. Fixes go to `acai/fixes-<audit>`, one commit per finding, with `Acai-Finding` trailers.
   3. Every fix must build, pass the tests and make the detector stop matching. Otherwise Acai feeds the failure back to the agent for another attempt, up to the configured maximum, and then rolls the change back.
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

**Your own standards, on-premise.** Administrators can add frameworks that are not built in, or update a built-in one with a newer revision, as YAML on the running server: in **Admin → Frameworks** or with `acai frameworks add <file.yaml>`. They apply to every project at once, with no rebuild. See [registry/README.md](registry/README.md).

**Research.** With the Anthropic provider, `acai research` (or the dashboard) searches official sources for guardrails beyond the registry. An MCP host can do the same with its own web search through `acai_propose_rules`. A person accepts or rejects each proposed rule. Accepted rules become a project-local framework in `.acai/rules/`.

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

Acai's own agents (product analyst, auditor, re-investigator, fixer, researcher) can run on any of these providers. Choose one on the dashboard's **Model** page: pick the provider, paste a key, click **Load models** to get the provider's real model list, then **Save and use**. The change takes effect right away. You can also set it in the environment: `ACAI_PROVIDER=<id> ACAI_MODEL=<model>` plus that provider's key. `acai providers` lists them all.

| Provider (`ACAI_PROVIDER`) | Key | Notes |
| --- | --- | --- |
| `anthropic`: Claude | `ANTHROPIC_API_KEY` | Messages API. Default `claude-opus-5-5`, adaptive thinking, effort `high` (`ACAI_EFFORT`), refusal fallback, web search for research. |
| `openai`: GPT | `OPENAI_API_KEY` | Responses API with `store: false`. Default `gpt-5.5`, web search for research. |
| `gemini`, `openrouter`, `mistral`, `groq`, `deepseek`, `xai`, `together` | `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, … | Their OpenAI-compatible endpoints. OpenRouter gives access to most other models. No web research. |
| `azure-openai`: Azure OpenAI in Microsoft Foundry | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` | Responses API on your resource's v1 endpoint, for GPT deployments (and DeepSeek or Grok). The model is the deployment name. No web research. |
| `azure-foundry`: other Foundry models | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` | Chat Completions on the same endpoint, for Llama, Mistral, Phi and other deployments. |
| `azure-claude`: Claude in Microsoft Foundry | `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_RESOURCE` (or `ANTHROPIC_FOUNDRY_BASE_URL`) | Messages API on `https://<resource>.services.ai.azure.com/anthropic/`; default deployment `claude-opus-5-5`. Web research with the basic web search tool. Billed through Azure. |
| `ollama`, `lmstudio` | none | Models on your own machine, fully on-premise. In Docker they are reached through `host.docker.internal`. |
| `openai-compatible` with `ACAI_OPENAI_BASE_URL` | `ACAI_OPENAI_API_KEY` | Any other endpoint: vLLM, LiteLLM, an internal gateway. |
| none | | Detectors and evidence checks only. Agents connected over MCP can still do the reasoning with their own model. |

A key typed on the Model page is stored on the server in `~/.acai/model.json` (mode 600) and is never sent back to the browser. On a shared server only administrators (and members listed in `ACAI_APPROVERS`) may change the model, because it decides where code goes. `ACAI_MODEL_LOCKED=1` pins it to the environment.

**What leaves the machine:** only when you run agent features, Acai sends file excerpts the agent asks to read, with secrets redacted. `.env`, key and keystore files are never sent. Detectors, scoping, verification and reports run locally. Commands that verify fixes run with model and Acai credentials removed from their environment.

## Internal deployment

```sh
cp .env.example .env                       # set ACAI_ADMIN_TOKEN=$(openssl rand -hex 32)
mkdir repos && git clone <repo> repos/<name>
docker compose up -d --build               # dashboard and /mcp on 127.0.0.1:4317
docker compose --profile tls up -d         # optional: Caddy with HTTPS (set ACAI_DOMAIN, ACAI_TLS)
```

Sign in with `ACAI_ADMIN_TOKEN`, then add people under **Admin** or with `docker compose exec acai node /opt/acai/acai.mjs users add <name> --role member`. Every git repository in `./repos` becomes a project; add more later from the dashboard (`/workspace/<name>`). In `.env`, `ACAI_REPOS` points the container at another folder of repositories and `ACAI_HOST_PORT` changes the port. On macOS, Docker Desktop can only mount folders it shares (Settings → Resources → File sharing); `/Users` is shared by default, `/Applications` is not. Agents on your computer connect over HTTP with an API token, for example `claude mcp add --transport http acai http://127.0.0.1:4317/mcp --header "Authorization: Bearer $ACAI_TOKEN"`. Open the agent in the repository's folder on your computer; the container sees the same files.

**[docs/DOCKER.md](docs/DOCKER.md)** is the step-by-step guide to running it with Docker: setup, the model (including Microsoft Foundry), connecting agents, everyday commands and troubleshooting. **[docs/DEPLOY.md](docs/DEPLOY.md)** covers TLS and reverse proxies, systemd and Kubernetes, backups, upgrades, air-gapped installs with a local model, and a hardening checklist.

- **Accounts.** Each person has an account with a role: `viewer` (read only), `member` (audits, reviews, fixes, MCP) or `admin` (also users, tokens, approvals, the model). They sign in with API tokens (`acai_…`); Acai stores only hashes, in `$ACAI_HOME/auth.json`. The dashboard exchanges a token for a session cookie. Revoking a token or disabling an account ends its sessions and OAuth grants. Manage accounts under **Admin**, with `acai users` and `acai tokens`, or through `/api/admin`. `ACAI_TOKENS=name:token,...` still works for read-only accounts from the environment.
- **Network.** Without accounts the server is a local single-user tool: it binds to localhost only and rejects requests whose `Host` header isn't local, which blocks DNS rebinding. Listening on any other interface requires an account (`ACAI_ADMIN_TOKEN` or `acai users add`).
- **Requests.** Mutating API calls need the `X-Acai-Request` header, so a browser cannot send them cross-site. Failed sign-ins are rate-limited per address and logged under **Admin → Events**.
- **Approvals and paths.** Approving build and test commands lets them run on the server, which is the point of fix verification, so it is equivalent to shell access. Administrators may approve; `ACAI_APPROVERS=alice` also allows named members. Adding projects by path from the dashboard requires `ACAI_PROJECT_ROOTS`. The file viewer resolves symlinks and never serves credential files.
- **TLS.** Put a TLS reverse proxy in front of the server (the Compose `tls` profile runs Caddy) and set `ACAI_TRUST_PROXY=1`.
- **Webhooks.** Set `ACAI_WEBHOOK_SECRET` and add `https://<host>/hooks/github` (or `/hooks/gitlab`, `/hooks/generic`) to the repository with that secret, for push and pull request events. A delivery is matched to a project by its `origin` remote. A push only fast-forwards the audited branch when the working tree is clean. `GITHUB_TOKEN` (statuses and pull request write access) posts results back to GitHub and lets the server fetch private repositories. Configure each project in *Settings → Automation*.
- **Remote MCP and OAuth.** Agents connect to `/mcp` with an API token. Set `ACAI_PUBLIC_URL` (the public HTTPS origin) to turn on OAuth, so ChatGPT and Claude.ai connectors can sign in: the person approves on a consent page with their API token. Viewers cannot use MCP. See [docs/MCP.md](docs/MCP.md).
- **Container hardening.** The container runs as a non-root user, with a read-only root filesystem and all capabilities dropped. `/healthz` answers health checks without sign-in.
- **Adding repositories.** Mount repositories under `/workspace`, or set `ACAI_ALLOW_CLONE=true` to add them by URL in the dashboard.
- **Persistence.** State lives in each repository's `.acai/`, which you can commit as an audit record. Accounts, the model settings and the project list live in the `/data` volume: back it up.
- **Toolchains.** Fix verification runs project builds inside the container. The image includes git, make, gcc and python3; derive your own image for other toolchains.

## CI

```sh
node dist/acai/acai.mjs ci . --fail-on high --sarif acai.sarif
```

`acai ci` runs a detector audit with the profile and decisions committed in `.acai/`. It exits with code 1 while unresolved findings remain at or above the threshold, and writes SARIF for code-scanning upload.

## Repository layout

```
packages/core       engine: registry, scanner, classifier, detectors, scoping, review state machine,
                    store and journal, agent (Claude or OpenAI-compatible), fix and verify, reports
packages/cli        `acai` CLI, terminal HITL, HTTP API + SSE, MCP server (stdio and HTTP)
packages/dashboard  React review UI
packages/vscode     VS Code extension
registry/           questionnaire, frameworks, presets
examples/           example apps and answer keys
skills/acai-audit  the playbook for host agents (generated from packages/cli/src/playbook.ts)
tests/              vitest: registry, detectors, the full review→fix→verify flow, MCP, HTTP security, provider loop
```

```sh
npm run check        # registry validation, typecheck, tests, build
```

## Scope and limits

Acai maps code and repository evidence to requirements and records human decisions. It is not legal advice and not a certification. A "verified" control means a reviewer or the agent saw a compliant implementation; it is not a conformity assessment. Detectors are heuristics: expect some false positives (reject them with a reason, and the decision carries over) and gaps that only the agent investigation or a reviewer will find.
