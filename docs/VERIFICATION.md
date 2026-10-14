# Verification record

Verified on 14 October 2026, Windows, Node.js 22.18.0.

| Check | Result |
| --- | --- |
| TypeScript and production React/API build | Passed |
| Application/API/auth/engine/MCP/CLI/provider/source-assistant tests | 55 passed |
| Real PostgreSQL 18.4 run | 55 passed; database-integrated suites use PostgreSQL, explicitly isolated provider/pure fixtures retain their configured test storage |
| Browser suite | 15 passed in Chromium |
| Compiled production server with PostgreSQL | Passed: startup, health, SPA routes, CSP, authentication denial and disabled production demo |
| Reverse Office source experiment | 5 checks passed against real public source; exact revision and coverage recorded below |
| Existing Memos experiment | All 10 checks passed, including real MCP SDK and CI command |
| Docker execution | Not verified on this workstation; Docker engine was unavailable in the previous verification |
| Live OpenAI/private GitHub/Bitbucket authentication | Not exercised with real credentials; provider contracts and safety/failure paths tested |

The browser suite visits all 13 marketing routes at 1440, 768, 390 and 320 pixels and exercises navigation, forms, projects, metadata imports, assessments, evidence review, keys, source scanning and the assistant. The new flow uploads a real fixture folder, excludes its secret file, verifies prefilled answers and unknown markets, saves answers, drags the popup, drafts and explicitly applies rules, runs a tool-triggered assessment and checks narrow-screen overflow. Screenshots were inspected at desktop and 320px widths.

Source and assistant tests cover fixed-host HTTPS repository validation, credential placement only in subprocess environment, disabled redirects and interactive credential prompts, unsafe/duplicate paths, source byte/count bounds, secret redaction, exact file/line references, unknown deployment facts, ownership and browser-only mutation scopes, provider failures, stale source reports, explicit AI opt-in, catalog/live distinction, official citation matching, idempotent rule application and model attempts to call unsupported tools or select another project. Scan reports store bounded excerpts, not whole raw repositories. The application never runs target package scripts.

A shared IP rate limit was reached during combined browser flows. The final implementation retains authentication/costly-operation limits and adds a per-owner workspace limit under an outer IP ceiling. The complete browser suite then passed. Changing a code snapshot makes an older analysis stale; stale drafts are not automatically reused for questions or assistant answers.

## Real repository experiments

`npm run experiment:reverse-office` cloned `https://github.com/Ramphyi/reverse_office` at revision `abf25d95d38dfc516d7435b2fe35387e95df4645`. It read 141 of 150 paths: 9 excluded and 0 beyond source-size limits, approximately 1.37 MB. It found the web/server and standalone Studio modules, documentation describing the licensing/release boundary, and referenced data/access/AI review leads. Thirteen catalog rules were drafted and explicitly applied; repeat application did not duplicate them. Two assessments remained in history and the release gate correctly stayed blocked because evidence was unapproved. The real MCP client retrieved the code report. Full record: `docs/experiments/reverse-office.json`.

The default branch changed during development. The preview project in the local owner's account was separately scanned at revision `5d326be59d01caab3bcb4f3cbc56bc42f7f8659f` and read 147 files. Each scan shows its own revision; these counts refer to different source versions. The preview uses an ephemeral development database and resets when its API restarts.

`npm run experiment:memos` inspected 1,342 filenames at revision `8120a6cee03003ee7968b49b2109f816fa4d96a4`, mapped nine candidate controls and correctly blocked six unreviewed high-priority controls. Its workflow remains metadata-only. Record: `docs/experiments/memos.json`.

Neither experiment executes the target application's code or its test suite. They verify Clearance's workflow using real source/metadata, not the compliance or runtime correctness of those products. Target markets in the experiments are explicit assumptions.

## Remaining external verification

AI synthesis, tool calling and live rule research were tested with mocked provider contracts. No billable model request was made. A replacement `OPENAI_API_KEY` and `ALLOW_EXTERNAL_AI=true` are needed to test live AI. No credential exposed in chat was saved or reused. The public source clone used no repository token; private GitHub/Bitbucket live access still requires a read-only credential for a controlled repository.

Google OAuth, Brevo delivery and Twilio SMS/WhatsApp continue to require live deployment credentials and controlled recipients. Their adapter tests do not claim actual vendor delivery. Docker image changes include Git and CA certificates, but the container image has not been executed here. The last dependency advisory and Compose syntax checks were on 13 October (0 known production vulnerabilities and passing test Compose syntax at that time); they are not presented as new checks.

See `docs/SOURCE-ASSISTANT.md` for limits, data flows and operational requirements. This is an engineering verification record, not a legal audit, penetration-test certificate or promise of exhaustive correctness.
