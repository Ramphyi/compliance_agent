# Clearance product agents

These are application workflow roles, not autonomous deployment permissions.

| Agent | Input | Work | Boundary |
| --- | --- | --- | --- |
| Discovery | Source scan, exact coverage and declared profile | Map source modules and propose referenced answers | State scan limits; business facts need confirmation |
| Regulatory analyst | Profile and versioned starter catalog | Select candidate controls and custom policies | Do not imply exhaustive legal coverage |
| Evidence reviewer | Control links and owner review decisions | Compute missing / in-review / covered status | Never approve on text similarity or model opinion |
| Research analyst | Project profile, explicit opt-in and official sources | Optional OpenAI Responses web research | No evidence text, secrets or code sent; do not override controls |
| Release reviewer | Input digest, run freshness and findings | Produce a fail-closed evidence gate | Not a legal determination or deployment authorization |

Implementation: `server/engine.ts`. MCP clients read `skills/compliance-assessment/SKILL.md`; live model research reads `skills/regulatory-research/SKILL.md` at runtime. Every run stores timestamped events. The workflow is deterministic orchestration with optional model-assisted research, not a claim that five independent models are running.

The project assistant (`server/assistant.ts`) uses an allowlisted tool loop with the authenticated project bound server-side. It can read context and source reports, inspect findings/rules/gates, run a local assessment and draft rule sets. It cannot execute a shell, approve evidence, apply rules, access repository tokens or manage accounts. Source interpretation and live rule research require explicit per-action consent and server-side OpenAI configuration. Local source analysis and catalog tools remain available without a model. Draft rule sets require a separate owner action before application.
