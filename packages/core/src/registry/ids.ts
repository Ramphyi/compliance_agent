// Closed vocabularies shared by the registry, the engine and the UI. The registry
// validator rejects any id that is not listed here, so a typo cannot silently
// disable a control.

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export const FRAMEWORK_KINDS = [
  "regulation",
  "standard",
  "guideline",
  "platform-policy",
  "contract",
] as const;

export const FIXABILITY = ["code", "document", "process"] as const;
export type Fixability = (typeof FIXABILITY)[number];

export const CATEGORIES = [
  "governance",
  "risk-assessment",
  "secure-development",
  "testing-verification",
  "authentication-access",
  "cryptography",
  "secrets-management",
  "data-protection",
  "privacy-rights",
  "logging-monitoring",
  "input-validation",
  "code-safety",
  "functional-safety",
  "updates-maintenance",
  "supply-chain",
  "vulnerability-management",
  "communications-security",
  "resilience-availability",
  "hardware-security",
  "ai-governance",
  "ai-security",
  "transparency-documentation",
  "accessibility",
  "consumer-protection",
  "platform-policy",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  governance: "Governance",
  "risk-assessment": "Risk assessment",
  "secure-development": "Secure development",
  "testing-verification": "Testing and verification",
  "authentication-access": "Authentication and access",
  cryptography: "Cryptography",
  "secrets-management": "Secrets management",
  "data-protection": "Data protection",
  "privacy-rights": "Privacy rights and notices",
  "logging-monitoring": "Logging and monitoring",
  "input-validation": "Input validation",
  "code-safety": "Code safety",
  "functional-safety": "Functional safety",
  "updates-maintenance": "Updates and maintenance",
  "supply-chain": "Supply chain",
  "vulnerability-management": "Vulnerability management",
  "communications-security": "Communications security",
  "resilience-availability": "Resilience and availability",
  "hardware-security": "Hardware security",
  "ai-governance": "AI governance",
  "ai-security": "AI security",
  "transparency-documentation": "Transparency and documentation",
  accessibility: "Accessibility",
  "consumer-protection": "Consumer protection",
  "platform-policy": "Platform policy",
};

export const CHECK_IDS = [
  "hardcoded-secret",
  "default-credentials",
  "hardcoded-crypto-key",
  "weak-hash",
  "weak-cipher",
  "insecure-random",
  "tls-verification-disabled",
  "cleartext-transport",
  "sql-injection-risk",
  "command-injection-risk",
  "dynamic-code-eval",
  "unsafe-deserialization",
  "xss-risk",
  "path-traversal-risk",
  "unsafe-c-functions",
  "dynamic-memory-embedded",
  "goto-statement",
  "debug-enabled",
  "cors-wildcard",
  "jwt-unverified",
  "pii-in-logs",
  "error-details-leak",
  "insecure-cookie",
  "weak-password-hash",
  "mobile-cleartext-allowed",
  "mobile-backup-allowed",
  "mobile-exported-component",
  "analytics-tracking-sdk",
  "llm-prompt-injection-risk",
  "llm-output-execution",
  "docker-root-user",
  "unpinned-dependencies",
  "debug-interface-enabled",
  "secure-boot-disabled",
  "uds-weak-security-access",
  "firmware-update-unsigned",
  "can-unauthenticated",
  "missing-watchdog",
  "missing-security-headers",
  "missing-rate-limiting",
  "ai-disclosure-missing",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const ARTIFACT_IDS = [
  "security-policy",
  "privacy-policy",
  "terms-of-service",
  "cookie-consent",
  "license-file",
  "third-party-notices",
  "sbom",
  "dependency-lockfile",
  "dependency-update-automation",
  "vulnerability-scanning",
  "ci-pipeline",
  "automated-tests",
  "test-coverage-config",
  "static-analysis-config",
  "coding-standard",
  "code-review-process",
  "threat-model",
  "risk-management-file",
  "safety-case",
  "requirements-traceability",
  "architecture-doc",
  "dpia",
  "processing-records",
  "incident-response-plan",
  "update-policy",
  "backup-restore",
  "accessibility-statement",
  "ai-documentation",
  "user-documentation",
  "changelog",
] as const;
export type ArtifactId = (typeof ARTIFACT_IDS)[number];

/** Market values that imply broader markets before conditions are evaluated. */
export const MARKET_IMPLIES: Record<string, string[]> = {
  RO: ["EU"],
  "US-CA": ["US"],
  "US-WA": ["US"],
};
