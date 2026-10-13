# Clearance

A React + Node.js compliance workspace with PostgreSQL persistence, explicit agent activity, MCP tools, scoped integration keys, and CI/CD evidence gates. Orange, navy and warm neutral UI; responsive landing page and product workspace. Fonts are served locally.

## Run the interactive preview

Requires Node.js 22.12+ and npm.

```powershell
cd D:\Coding\Compliance_platform_and_agents\compliance_agent
npm ci
npm run dev
```

Open **http://localhost:5173** and choose **Explore the workspace**. Each demo visitor gets an isolated owner and sample product. The demo uses `pg-mem`; everything resets when the API restarts. It does not send mail, call a model, or fake successful integrations. No API credentials are needed for the demo.

## What works

- Marketing site: 13 distinct routes with product details, SaaS/AI/mobile/embedded workflows, MCP and CI documentation, security, illustrative pricing, field notes and linked research. Includes an interactive release example and hypothetical time-savings calculator.
- Product onboarding: industry, SaaS/mobile/embedded/AI type, purpose, countries, audience, sensitive data and external-research consent.
- Deterministic control mapping: selected GDPR, UK privacy, EU AI Act, ISO/IEC 42001 and 27001 readiness, EU consumer terms, accessibility, DORA, MDR, CRA, HIPAA, COPPA, CCPA, Apple and Google Play scope checks.
- Assessments: timestamped discovery, mapping, evidence-review, research and release-review events; history and downloadable JSON reports.
- Evidence vault: text/file import, control mapping, explicit owner approval/rejection; optional local repository inventory script.
- Memos experiment: a reproducible assessment of a pinned open-source repository, using the real MCP SDK and CI command. Open `/field-notes/memos` and choose **Open the Memos example** to review the same scenario in an isolated workspace, with no pre-approved evidence.
- Custom policies: create/delete product requirements and include them in the assessment and release gate.
- Authentication: email/password with scrypt, Brevo confirmation and reset mail, Google OAuth with state/nonce/PKCE, optional Twilio Verify SMS/WhatsApp second factor.
- MCP: actual stateless Streamable HTTP server, scoped bearer keys, five tools and two resources.
- CI/CD: a fail-closed command-line gate; rejects missing, incomplete, changed-input or older-than-seven-days reports, and high-priority controls without owner-approved evidence.
- Official-source monitor: explicit opt-in, fixed HTTPS source catalog, bounded fetches and page-change fingerprints. Page change is not a legal interpretation.
- OpenAI Responses web research: opt-in at both deployment and project level, official domains, citations, failure visibility, `store: false`. Only the declared profile and candidate control titles/URLs are sent; evidence text is excluded.

## Reproduce the open-source experiment

```powershell
git clone https://github.com/usememos/memos.git .local/memos
git -C .local/memos checkout 8120a6cee03003ee7968b49b2109f816fa4d96a4
npm run experiment:memos -- .local/memos
```

The script reads metadata from the pinned repository, starts an isolated Clearance API with `pg-mem`, connects using the MCP client SDK, submits evidence, checks the approval boundary, invokes the actual CI command and revokes its key. It never executes Memos code or sends data to external providers. The resulting `docs/experiments/memos.json` is an engineering workflow record, not a certification of Memos. A blocked release gate is expected because the evidence has not been approved.

The local inventory now finds nested JavaScript manifests and Go modules/tests. It skips symlinks, secret directories and generated dependencies; limits traversal to five directory levels, 5,000 files and 10,000 entries; and reads at most 32 manifests under 500,000 bytes each. Truncation is explicit in its output.

## Connect real services

Copy `.env.example` to `.env` and fill in values locally. Never commit credentials. Revoke any API key previously shared in chat and create a replacement.

| Service        | Configuration                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| PostgreSQL     | `DATABASE_URL`, `DB_DRIVER=postgres`                                                                              |
| Brevo          | `BREVO_API_KEY`, `MAIL_FROM` using a verified sender/domain                                                       |
| Google         | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; register `${API_URL}/api/auth/google/callback` exactly                |
| SMS / WhatsApp | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`; enable the requested channels with Twilio |
| OpenAI         | A replacement `OPENAI_API_KEY`, a web-search-capable `OPENAI_MODEL`, `ALLOW_EXTERNAL_AI=true`, and project opt-in |
| Source checks  | `ALLOW_REGULATORY_FETCH=true`                                                                                     |

For persistent local development, set `APP_URL=http://localhost:5173`, `API_URL=http://localhost:4000`, `DEMO_MODE=false`, `DB_DRIVER=postgres` and your database URL. Run `npm run dev:postgres` and `npm run dev:web` in separate terminals. The API applies the initial idempotent schema on startup; `npm run db:migrate` also applies it.

Confirmation and reset links use URL fragments so raw tokens are not in server access-log URLs. Links expire after 30 minutes and are single use. MFA challenges expire after five minutes and have an attempt limit. A reset invalidates sessions, pending challenges and API keys. Existing email accounts are not silently linked to Google accounts. To enable MFA on a Google-only account, sign in again within ten minutes of enrollment.

## Docker / on-premise

```powershell
Copy-Item .env.example .env
# Edit .env: set production HTTPS APP_URL/API_URL and POSTGRES_PASSWORD.
docker compose up --build -d
```

Use a strong URL-safe `POSTGRES_PASSWORD` (e.g. random hex). Keep `APP_URL` and `API_URL` on the same public HTTPS origin for the bundled web/API deployment. Terminate TLS at a trusted reverse proxy forwarding to `127.0.0.1:4000`; preserve the public Host header. Set `TRUST_PROXY=1` only for exactly one trusted proxy hop; default is zero. Do not expose the application port directly. Configure proxy timeouts of at least 120 seconds for optional research.

The production image runs as a non-root user, drops capabilities, uses a read-only root filesystem and serves the compiled React assets. PostgreSQL is on an internal network with a named volume and no host port. Production refuses demo/memory mode and non-HTTPS public URLs. Fonts and assets do not require third-party browser requests. No telemetry is included.

For offline/on-prem operation leave both egress flags false. The Compose app still has an egress network to support configured identity/mail/model providers; enforce actual offline policy with your host firewall/network policy or remove that network. Google, Brevo, Twilio and OpenAI inherently need their respective external services. Local password login and local assessments can operate without model access once accounts are provisioned and confirmed. There is no automatic outbound research or source polling.

Back up the `pgdata` volume/database with your operational tooling and test restoration. Storage encryption, TLS certificates, backup retention, audit-log retention and secrets management are infrastructure responsibilities. The current release targets a **single API instance**: rate limits and assessment exclusion are process-local. Add shared limits, durable workers and database-backed job locks before horizontal scaling. Audit records are owner-scoped and not advertised as tamper-proof.

## MCP

Create a key in **Integrations**. It is displayed once, SHA-256 hashed in storage, revocable, and valid for 90 days. Select only required scopes. The UI supplies a config for clients supporting remote Streamable HTTP with static bearer headers:

```json
{
  "mcpServers": {
    "clearance": {
      "url": "https://your-clearance-host/mcp",
      "headers": { "Authorization": "Bearer YOUR_CLEARANCE_API_KEY" }
    }
  }
}
```

Some clients use different config field names or require OAuth discovery; static-header MCP clients are the supported integration for this release. This server does not implement an MCP OAuth authorization server or outbound MCP discovery.

| Tool                 | Scope      | Behavior                                 |
| -------------------- | ---------- | ---------------------------------------- |
| `list_projects`      | `read`     | Owned products only                      |
| `get_assessment`     | `read`     | Latest run, findings and events          |
| `check_release_gate` | `read`     | Current fail-closed gate result          |
| `run_assessment`     | `assess`   | New assessment; respects research opt-in |
| `submit_evidence`    | `evidence` | Submit for human review; cannot approve  |

Resources: `clearance://skills/assessment` and `clearance://sources`. Instructions: `skills/compliance-assessment/SKILL.md`, `skills/regulatory-research/SKILL.md`, and `agents/AGENTS.md`. The app uses deterministic workflow roles with optional model-assisted research, not five independent models. API keys cannot approve evidence, manage keys or change account settings.

## Pipeline and repository integration

Copy `scripts/compliance-gate.mjs` and adapt `examples/compliance-gate.yml` in the repository you want to assess. Set `CLEARANCE_URL`, `CLEARANCE_PROJECT_ID` and a read-scoped `CLEARANCE_API_KEY` secret. Run a fresh assessment first, in the UI or with an `assess` key via `POST /api/projects/:id/assess`.

```powershell
npm run compliance:gate
```

Exit codes: `0` passed, `1` blocked, `2` configuration/network/server error. Errors always fail the pipeline. A passing evidence gate does not authorize deployment or certify legality.

Generate a **local, read-only metadata inventory**:

```powershell
node scripts/inspect-repository.mjs D:\path\to\your\product
```

This lists known technology hints and discovered policy/test/pipeline files, skips symlinks and sensitive/generated directories, never executes code, and does not upload anything. Review the output and import it as evidence if relevant. It is not a static security scanner and does not prove that tests pass. There is no repository hosting integration or automatic arbitrary-code execution.

## Validation

```powershell
npm run check
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev
```

The unit/integration suite can target a dedicated PostgreSQL test database via `TEST_DATABASE_URL`. **It truncates the tables in that database. Never point it at production.** CI runs both the in-memory suite and the real PostgreSQL suite. To use the isolated Docker test database:

```powershell
docker compose -p clearance-verification -f compose.test.yaml up -d db
$env:TEST_DATABASE_URL='postgresql://clearance:isolated-test-only@localhost:15432/clearance_test'
npm test
Remove-Item Env:\TEST_DATABASE_URL
docker compose -p clearance-verification -f compose.test.yaml down
```

`compose.test.yaml` also supports building the production image for a local Host-header smoke test; its `https://clearance.local` URLs are test identity only, not installed certificates. See `docs/VERIFICATION.md` for the validation performed on this workstation.

## Important product scope

This is a working initial release, not an assertion of complete legal coverage or a finished enterprise certification platform. Controls are candidate applicability and evidence-readiness checks. Owner approval is a recorded human judgment, not independent legal verification. Licensed ISO text is not included. Review with qualified legal/security specialists before relying on a deployment decision.

Pricing is a labeled proposed launch offer; there is no billing integration or plan enforcement. Organizations, invitations, role separation, SAML, recovery codes, account deletion/retention workflows and support-assisted MFA recovery are not implemented. Live Google sign-in, Brevo delivery, SMS/WhatsApp and paid OpenAI calls require deployment credentials; tests cover adapters with mocks, not actual vendor delivery. Real external sources may refuse automated requests; these checks are shown as unavailable instead of successful.

## Source references

- [OpenAI Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [MCP TypeScript server](https://ts.sdk.modelcontextprotocol.io/server)
- [Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Brevo transactional email](https://developers.brevo.com/docs/send-a-transactional-email)
- [Twilio Verify](https://www.twilio.com/docs/verify/api/verification)
- [ISO/IEC 42001](https://www.iso.org/standard/42001)
- [EU AI Act overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [IBM’s 2025 research used on the landing page](https://newsroom.ibm.com/2025-07-30-ibm-report-13-of-organizations-reported-breaches-of-ai-models-or-applications,-97-of-which-reported-lacking-proper-ai-access-controls)
- [EDPB breach notification guidance](https://www.edpb.europa.eu/sme/assess-the-risks/data-breaches_en)
