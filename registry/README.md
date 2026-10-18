# Assay rule registry

The registry is the standardised rule base Assay audits against. It is plain YAML so
compliance owners can review it in pull requests, extend it, or pin it per release.

```
registry/
  questionnaire.yaml        profile facts (the questions the audit asks)
  frameworks/<id>.yaml      one regulation, standard or guideline per file
  presets/<id>.yaml         ready-made answer sets for common product types
```

Validate every file with:

```sh
npm run registry:validate
```

## Framework file

```yaml
id: etsi-en-303-645                  # kebab-case, equals the file name
title: Cyber Security for Consumer Internet of Things - Baseline Requirements
shortTitle: ETSI EN 303 645
version: V3.1.3 (2024-09)
authority: ETSI
kind: standard                       # regulation | standard | guideline | platform-policy | contract
jurisdictions: [EU, UK, global]      # where it has force or is commonly required
url: https://www.etsi.org/...        # official page, never a mirror
textPolicy: paraphrased              # open | paraphrased  (licensed text is never copied)
summary: >
  Two or three sentences: what it is and who it is for.
applicability:                       # condition over questionnaire facts (see below)
  all:
    - { fact: productTypes, in: [iot-device, embedded-firmware] }
    - { fact: audience, in: [consumers] }
applicabilityNote: >
  Plain-language explanation of when it applies and what to confirm with counsel.
keyDates:                            # optional, real dates only
  - { date: "2024-04-29", note: UK PSTI regime references provisions 5.1-1, 5.1-2, 5.2-1 and 5.3-13 }
controls:
  - ref: "5.1-1"                     # clause, article or requirement reference
    title: No universal default passwords
    requirement: >
      Paraphrase of what the clause requires, in one to three sentences.
    category: authentication-access  # see category list
    severity: high                   # critical | high | medium | low | info  (severity of a gap)
    fixability: code                 # code | document | process
    when:                            # optional narrower condition, same language as applicability
      { fact: connectivity, in: [wifi, bluetooth] }
    guidance: >
      What an auditor or agent should look for in the repository: files, APIs,
      configuration keys, patterns, and what "good" looks like.
    evidence:                        # what demonstrates compliance
      - Per-device unique credentials generated at manufacture or first use
    checks: [default-credentials, hardcoded-secret]   # deterministic detector ids (list below)
    artifacts: []                                      # repository artifact ids (list below)
    crosswalk: ["en-18031:ACM-1"]                      # related controls, as <frameworkId>:<ref>
```

The global control id is `<frameworkId>:<ref>`, for example `etsi-en-303-645:5.1-1`.

### Writing rules

* **Paraphrase licensed standards.** ISO, IEC, SAE, MISRA, AUTOSAR and PCI SSC text is
  copyrighted. Write requirement summaries in your own words with the clause reference.
  Open sources (EU law, NIST, OWASP, ETSI, FDA, UNECE) may be quoted briefly, but
  paraphrase is preferred.
* **Prefer what a repository can show.** Focus on controls whose implementation or
  evidence can live in code, configuration, tests, CI or repository documents. Keep a
  few essential organisational controls and mark them `fixability: process`.
* **Make `guidance` actionable.** Name concrete APIs, files, config keys and patterns
  to inspect, plus what a compliant implementation looks like.
* **Calibrate severity.** Use `critical` only for issues that are directly exploitable
  or legally prohibited, `high` for core obligations, `medium` for expected good
  practice, `low` for hygiene, and `info` for awareness.
* **Use only the ids listed below** for `checks`, `artifacts`, `category`, facts and
  fact values. The validator rejects unknown ids.
* **Use real versions and dates.** If a date is not certain, leave it out.

## Conditions

```yaml
{ fact: markets, in: [EU, RO] }      # the answer (single or multi) contains any listed value
{ fact: aiUsage, equals: none }      # the answer equals the value
{ all: [ <cond>, <cond> ] }
{ any: [ <cond>, <cond> ] }
{ not: <cond> }
{ always: true }
```

Evaluation is three-valued: a condition that depends on an unanswered fact evaluates to
*unknown*, and the audit asks for that fact instead of guessing. `RO` implies `EU`, and
`US-CA` and `US-WA` imply `US`. The engine expands these before evaluation, so
`{ fact: markets, in: [EU] }` is enough for EU-wide law.

Facts and values are defined in [questionnaire.yaml](questionnaire.yaml).

## Categories

`governance`, `risk-assessment`, `secure-development`, `testing-verification`,
`authentication-access`, `cryptography`, `secrets-management`, `data-protection`,
`privacy-rights`, `logging-monitoring`, `input-validation`, `code-safety`,
`functional-safety`, `updates-maintenance`, `supply-chain`, `vulnerability-management`,
`communications-security`, `resilience-availability`, `hardware-security`,
`ai-governance`, `ai-security`, `transparency-documentation`, `accessibility`,
`consumer-protection`, `platform-policy`

## Deterministic checks

Code detectors that run without a model and report file and line. A control lists the
checks whose hits are evidence of a gap for that control.

| id | detects |
| --- | --- |
| `hardcoded-secret` | API keys, tokens, private keys, passwords in source |
| `default-credentials` | Universal default passwords (admin/admin, 1234, `DEFAULT_PASSWORD`) |
| `hardcoded-crypto-key` | Literal symmetric keys, IVs or key byte arrays |
| `weak-hash` | MD5 or SHA-1 used for security |
| `weak-cipher` | DES, 3DES, RC4, Blowfish, ECB mode |
| `insecure-random` | Non-cryptographic RNG (`Math.random`, `rand()`, `random.random`) for tokens, keys, nonces |
| `tls-verification-disabled` | Certificate or host verification disabled |
| `cleartext-transport` | `http://`, `mqtt://`, `ws://`, `ftp://` or `telnet` to non-local hosts |
| `sql-injection-risk` | SQL built by string concatenation or interpolation |
| `command-injection-risk` | Shell execution with interpolated input |
| `dynamic-code-eval` | `eval`, `new Function`, Python `exec` |
| `unsafe-deserialization` | `pickle.loads`, unsafe `yaml.load`, Java or .NET native deserialisation |
| `xss-risk` | `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `document.write` |
| `path-traversal-risk` | File access built from request input |
| `unsafe-c-functions` | `strcpy`, `strcat`, `sprintf`, `gets`, `vsprintf`, unbounded `scanf` |
| `dynamic-memory-embedded` | `malloc`, `calloc`, `realloc`, `free` in C or C++ firmware |
| `goto-statement` | `goto` in C or C++ |
| `debug-enabled` | Debug mode in production configuration, `android:debuggable` |
| `cors-wildcard` | `Access-Control-Allow-Origin: *` or reflective CORS with credentials |
| `jwt-unverified` | JWT decoded without verification or `alg: none` |
| `pii-in-logs` | Logging of passwords, tokens, emails, health or card fields |
| `error-details-leak` | Stack traces or raw errors returned to clients |
| `insecure-cookie` | Cookies without `Secure` or `HttpOnly` |
| `weak-password-hash` | Passwords hashed with MD5, SHA-1, SHA-256 or no salt instead of argon2, scrypt, bcrypt or PBKDF2 |
| `mobile-cleartext-allowed` | `usesCleartextTraffic="true"`, `NSAllowsArbitraryLoads` |
| `mobile-backup-allowed` | `android:allowBackup="true"` |
| `mobile-exported-component` | Exported Android components without permission |
| `analytics-tracking-sdk` | Analytics or advertising SDKs that need consent |
| `llm-prompt-injection-risk` | Untrusted input concatenated into system or tool prompts |
| `llm-output-execution` | Model output passed to eval, shell, SQL or file writes |
| `docker-root-user` | Container images without a non-root `USER` |
| `unpinned-dependencies` | `*`, `latest` or unpinned dependency versions |
| `debug-interface-enabled` | JTAG or SWD left enabled, flash readout protection level 0 |
| `secure-boot-disabled` | Secure boot or flash encryption disabled in build config |
| `uds-weak-security-access` | UDS SecurityAccess (0x27) with static seed or trivial key derivation |
| `firmware-update-unsigned` | OTA or firmware update code with no signature verification |
| `can-unauthenticated` | CAN messaging without SecOC, MAC or freshness values |
| `missing-watchdog` | Embedded main loop with no watchdog |
| `missing-security-headers` | Web server without security headers (CSP, HSTS, frame options) |
| `missing-rate-limiting` | Authentication endpoints without rate limiting |
| `ai-disclosure-missing` | User-facing AI with no visible disclosure that the user is talking to AI |

## Repository artifacts

Documents and configuration whose presence is evidence. Missing artifacts become
document findings that the agent can draft for a human to complete.

`security-policy`, `privacy-policy`, `terms-of-service`, `cookie-consent`, `license-file`,
`third-party-notices`, `sbom`, `dependency-lockfile`, `dependency-update-automation`,
`vulnerability-scanning`, `ci-pipeline`, `automated-tests`, `test-coverage-config`,
`static-analysis-config`, `coding-standard`, `code-review-process`, `threat-model`,
`risk-management-file`, `safety-case`, `requirements-traceability`, `architecture-doc`,
`dpia`, `processing-records`, `incident-response-plan`, `update-policy`, `backup-restore`,
`accessibility-statement`, `ai-documentation`, `user-documentation`, `changelog`

## Presets

```yaml
id: automotive-ecu
title: Automotive ECU (ASIL B, EU and UNECE)
description: >
  Brake or chassis ECU software from a Tier-1 supplier.
examples: [examples/apps/brake-ecu]
answers:
  productTypes: [embedded-firmware, automotive-ecu]
  sector: [automotive]
  markets: [EU, UNECE]
  asil: B
  ...
includeFrameworks: []                # always include, even if not applicable by rule
excludeFrameworks: []
verify:                              # default build and test commands (a human approves them before they run)
  - make test
```
