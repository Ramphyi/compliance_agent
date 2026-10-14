# Source analysis, project assistant and researched rules

Open **New project → Try the Reverse Office repository**, create the project, then choose **Clone and scan repository**. Or enter your own GitHub/Bitbucket URL. Private GitHub repositories use a fine-grained personal access token with Contents read permission; Bitbucket uses a repository access token with read permission. Credentials belong in **Settings → Your connected accounts**, not chat or the per-project scan form. They are encrypted with AES-256-GCM, bound to the owner/provider, and never returned by the API. Choose **Public repository** to scan without any token, even if the profile has a saved connection. Choose **Private repository** to reuse the saved credential. Tokens can be replaced or disconnected in the profile. This release supports default branches and explicit rescans, not OAuth repository browsing or webhook synchronization.

For local code choose **Choose source folder**, inspect the eligible redacted files and start the scan. Unlike the advanced metadata importer, this action sends source contents to the Clearance server. An interactive component map and source-signal cards let you explore files and references; the coverage ring counts files, not compliance. The report stores bounded excerpts, paths, signals, modules and suggested answers. Complete source contents are not persisted in the database.

After scanning, **Review prefilled questions** opens editable drafts with source references. Previously saved answers are preserved. Unknown deployment markets remain unanswered; defaults in the structured profile still need confirmation. Reading code is not proof that the software or its authorization controls pass tests. Source signals and assessment evidence are distinct.

**Ask Clearance** opens the project assistant. Drag its header or focus the header and use arrow keys. The window stays within the viewport and can be minimized. Messages and tool traces belong to the current project. Available actions explain the scan/findings, run an assessment and prepare a rule draft. It cannot approve evidence, apply a rule set, execute code or access repository credentials. Applying a draft is a separate button action.

**Custom rules → Build a rule set** accepts a natural-language description. With no AI provider it selects candidates from the maintained catalog and explicitly says no live search occurred. With live research enabled it uses OpenAI web search restricted to the configured official domains. Every accepted generated rule must cite an exact official URL returned by that search; uncited output is rejected. Results are dated candidates for review, never a promise to include every applicable law. Full licensed ISO text is not reproduced.

## Configuration and data boundaries

| Capability | Configuration | External data |
| --- | --- | --- |
| Local source analysis | Available without a model | Source uploaded to this Clearance server only |
| Repository scan | Git installed; `ALLOW_REPOSITORY_FETCH=true` in production | GitHub/Bitbucket receives the clone request and optional saved, scoped credential |
| AI source interpretation | `OPENAI_API_KEY`, `ALLOW_EXTERNAL_AI=true`, scan checkbox | Redacted bounded source excerpts and analysis metadata to OpenAI |
| AI project chat | Same server configuration, chat checkbox | Recent messages and selected project context/tool results to OpenAI |
| Current rule research | Same server configuration, live-research checkbox | Topic and declared product profile to OpenAI web search |

Model requests use `store: false`, the configured `OPENAI_MODEL` (default `gpt-4.1-mini`), a timeout and no automatic retries. Operator/provider data retention policies still apply. Secret filtering recognizes common patterns; it is not guaranteed to detect every confidential value. Review local source before upload and authorize remote repository access accordingly. Configure a **replacement** provider key locally; never reuse a credential exposed in chat.

Repository downloads use shallow bare clones, no checkout, no project hooks/scripts, no submodule traversal and no LFS downloads. Only fixed HTTPS GitHub/Bitbucket repository URLs are accepted, redirects are disabled and decrypted credentials are placed in scoped subprocess environment configuration, never command arguments, URLs, stored Git config or application logs. Saved account credentials remain encrypted in the database. Temporary repositories are removed after success or handled failure. Process crashes can leave temporary files for the operator's temp-directory cleanup policy.

Limits: 3,000 eligible text files, 180 KB per file and 6 MB total source; 200,000 source characters for AI with at most 12,000 per file. Binary, generated, secret and unsupported paths are excluded. Coverage explicitly reports exclusions and size limits. Clone operations have a 90-second deadline and a best-effort 200 MB temporary-storage monitor. These application limits do not replace OS/container disk and process quotas. The server supports two simultaneous scans, one per project. Scan jobs and locks are in-process; after a restart the UI marks interrupted scans failed and offers retry. Deploy one API instance until jobs/locks are moved to durable shared infrastructure.

The MCP `get_code_analysis` read tool exposes the latest authorized report. Repository credentials and source-upload mutations require a browser session. Existing metadata/evidence/assessment MCP tools remain available to IDE agents and CI integrations. All project endpoints check ownership. Browser mutations require trusted origins; costly actions and general workspace requests are rate-limited.

## Reverse Office experiment

Run `npm run experiment:reverse-office`. It clones the current public default branch from `https://github.com/Ramphyi/reverse_office`, records the exact revision and coverage, checks scan-derived drafts, chats about the report, drafts/applies catalog rules, uses the real MCP SDK, reruns assessments and verifies that missing evidence blocks release. Results are saved in `docs/experiments/reverse-office.json`.

This experiment tests **Clearance against real repository contents**. It does not run Reverse Office's application, install its dependencies or execute its own test suite. It does not certify either the full company suite or the standalone Studio artifact. Read the source licensing/release notes for the particular artifact being distributed.

Live private-provider authentication and billable AI calls require operator-provided credentials. Their configuration, request/response contracts, credential handling and failure paths have automated coverage; the recorded public experiment uses no private token or live model call.

Primary implementation references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search), [GitHub repository contents access](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28).

## Persistent local preview and sessions

The default development preview now saves its pg-mem tables atomically to ignored .local/workspace.json after every mutation, including hashed session creation and revocation. A process lock prevents ordinary concurrent opening of the same local store. Keep this directory private and backed up; it is development storage for one API process, not a PostgreSQL replacement for production. A corrupt file fails startup rather than silently erasing accounts. Older ephemeral sessions from before this change require one new sign-in.

Active browser sessions renew their seven-day lifetime, capped at 30 days from authentication. The original recent-login timestamp remains unchanged for sensitive MFA operations. Logout/password reset and expiry still invalidate server-side sessions. Existing authenticated accounts are preserved when opening landing-page demo buttons.

Set INTEGRATION_ENCRYPTION_KEY to 32 random bytes encoded as base64 in production. The local preview generates .local/integration.key once using cryptographic randomness and never exposes it through HTTP. Back up the key separately from the database and keep it out of Git; losing or replacing it means reconnecting saved accounts.
