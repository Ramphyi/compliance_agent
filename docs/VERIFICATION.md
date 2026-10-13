# Verification record

Run on 13 October 2026, Windows, Node.js 22.18.0.

| Check                                                                                | Result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript + production React/API build                                              | Passed                                                                                                                                                                 |
| API, auth, tenant isolation, engine, MCP, provider contracts and research boundaries | 36 tests passed, including actual CLI pass/block/error behavior                                                                                                        |
| Real PostgreSQL integration                                                          | The same 36-test suite passed with PostgreSQL 18.4; API tests use the real database, pure/mocked-provider tests use their explicit fixtures                            |
| Compiled production server + real PostgreSQL                                         | Passed: startup, health, SPA routes, CSP, unauthenticated denial and disabled production demo                                                                          |
| Desktop end-to-end flow                                                              | Passed: landing, demo, assessment, evidence submission/approval, policy, API key creation/revocation, release gate, regulatory page, onboarding, settings and sign-out |
| Mobile end-to-end flow                                                               | Passed at 390 × 844, no document horizontal overflow                                                                                                                   |
| Authentication UI                                                                    | Passed: validation, unavailable Google configuration and reset request                                                                                                 |
| Production dependency advisory check                                                 | `npm audit --omit=dev`: 0 known vulnerabilities at time of check                                                                                                       |
| Docker Compose syntax                                                                | Passed for `compose.test.yaml`                                                                                                                                         |
| Docker image/container execution                                                     | Not verified: Docker Desktop's engine did not become responsive on this workstation                                                                                    |

All four browser tests passed. The additional regression verifies that a temporary API rate limit displays an error in the workspace instead of redirecting the user to login. The API regression verifies that repeated session reads do not consume the authentication-attempt budget, while authentication requests remain limited.

Screenshots are written to `test-results/landing-desktop.png`, `workspace-desktop.png`, `landing-mobile.png` and `workspace-mobile.png` by the browser tests. Generated files are ignored by Git.

Provider tests use network mocks. No real Google OAuth login, Brevo delivery, Twilio SMS/WhatsApp delivery or billable OpenAI request was made. No credential supplied in chat was saved or used. Those live checks require separately configured credentials and, for messaging, a recipient controlled by the operator.

The isolated PostgreSQL test runtime and its disposable data are under ignored `.local/`; test servers were stopped after verification. The app has no dependency on that runtime. CI separately targets PostgreSQL 17 through a service container, matching the Compose major version.

This record is engineering verification, not a penetration-test certificate, legal audit or guarantee of exhaustive correctness.
