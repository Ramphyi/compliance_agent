# Verification record

Updated on 14 October 2026, Windows, Node.js 22.18.0. Dependency advisory and Docker Compose syntax checks below were last run on 13 October; the build, application tests, PostgreSQL tests, browser tests and Memos experiment were rerun for this update.

| Check                                                                                | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript + production React/API build                                              | Passed                                                                                                                                                                 |
| API, auth, tenant isolation, engine, MCP, provider contracts and research boundaries | 39 tests passed, including actual CLI pass/block/error behavior                                                                                                        |
| Real PostgreSQL integration                                                          | The same 39-test suite passed with PostgreSQL 18.4; API tests use the real database, pure/mocked-provider tests use their explicit fixtures                            |
| Compiled production server + real PostgreSQL                                         | Passed: startup, health, SPA routes, CSP, unauthenticated denial and disabled production demo                                                                          |
| Desktop end-to-end flow                                                              | Passed: landing, demo, assessment, evidence submission/approval, policy, API key creation/revocation, release gate, regulatory page, onboarding, settings and sign-out |
| Mobile end-to-end flow                                                               | Passed at 390 × 844, no document horizontal overflow                                                                                                                   |
| Authentication UI                                                                    | Passed: validation, unavailable Google configuration and reset request                                                                                                 |
| Production dependency advisory check                                                 | `npm audit --omit=dev`: 0 known vulnerabilities at time of check                                                                                                       |
| Docker Compose syntax                                                                | Passed for `compose.test.yaml`                                                                                                                                         |
| Docker image/container execution                                                     | Not verified: Docker Desktop's engine did not become responsive on this workstation                                                                                    |

All 12 browser tests passed. The marketing suite visits all 13 routes directly at widths of 1440, 768, 390 and 320 pixels, checks document overflow, validates internal destinations, exercises navigation/history/keyboard focus, changes the release example, expands FAQs, uses the calculator and copies MCP configuration. It also opens the Memos scenario in the workspace and checks its intentionally blocked release gate. Existing workspace, authentication and API-limit recovery flows still pass.

The Memos experiment passed all eight checks using the actual MCP client SDK and CLI. It inspected 1,342 files from commit `8120a6cee03003ee7968b49b2109f816fa4d96a4`, discovered nested React and Go manifests, and found 398 test filenames and eight pipeline files within its depth limit. Nine candidate controls were mapped; six high-priority controls correctly kept the gate blocked because no evidence was approved. The experiment does not execute Memos or its tests. The reproducible script is `scripts/experiment-memos.ts` and its record is `docs/experiments/memos.json`.

The API suite verifies that repeated session reads do not consume the authentication-attempt budget, while authentication requests remain limited. New repository inventory tests cover nested manifests, Go tests, excluded secrets/generated directories, linked directories, malformed manifests and explicit depth truncation. The new Memos demo is owner-isolated and starts with only submitted evidence.

Screenshots are written to `test-results/landing-desktop.png`, `workspace-desktop.png`, `landing-mobile.png` and `workspace-mobile.png` by the browser tests. Generated files are ignored by Git.

Provider tests use network mocks. No real Google OAuth login, Brevo delivery, Twilio SMS/WhatsApp delivery or billable OpenAI request was made. No credential supplied in chat was saved or used. Those live checks require separately configured credentials and, for messaging, a recipient controlled by the operator.

The isolated PostgreSQL test runtime and its disposable data are under ignored `.local/`; test servers were stopped after verification. The app has no dependency on that runtime. CI separately targets PostgreSQL 17 through a service container, matching the Compose major version.

This record is engineering verification, not a penetration-test certificate, legal audit or guarantee of exhaustive correctness.
