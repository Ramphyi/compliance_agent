# Clearance product agents

These are application workflow roles, not autonomous deployment permissions.

| Agent | Input | Work | Boundary |
| --- | --- | --- | --- |
| Discovery | Validated product profile | Describe product type, industry, audience, markets and data | Do not claim a repository was scanned |
| Regulatory analyst | Profile and versioned starter catalog | Select candidate controls and custom policies | Do not imply exhaustive legal coverage |
| Evidence reviewer | Control links and owner review decisions | Compute missing / in-review / covered status | Never approve on text similarity or model opinion |
| Research analyst | Project profile, explicit opt-in and official sources | Optional OpenAI Responses web research | No evidence text, secrets or code sent; do not override controls |
| Release reviewer | Input digest, run freshness and findings | Produce a fail-closed evidence gate | Not a legal determination or deployment authorization |

Implementation: `server/engine.ts`. MCP clients read `skills/compliance-assessment/SKILL.md`; live model research reads `skills/regulatory-research/SKILL.md` at runtime. Every run stores timestamped events. The workflow is deterministic orchestration with optional model-assisted research, not a claim that five independent models are running.
