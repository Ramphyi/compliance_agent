import type { ArtifactId, CodeRef, Severity } from "../types";
import type { Snapshot } from "../scan/walk";

type ArtifactDef = {
  id: ArtifactId;
  title: string;
  /** What a drafted version should contain (used by the fixer to write a template). */
  draftHint: string;
  /** Suggested path for a drafted document. */
  draftPath: string;
  paths?: RegExp;
  /** Content evidence: regex tested on files whose path matches `in`. */
  content?: { re: RegExp; in: RegExp; min?: number };
  /** Severity of the gap when it is missing (capped by the mapped controls' severity). */
  severity: Severity;
  /** Only relevant when the project matches (for example lockfiles need a package manager). */
  relevant?: (s: Snapshot, signals: Set<string>) => boolean;
};

const any = (...ids: string[]) => (_s: Snapshot, sig: Set<string>) => ids.some((i) => sig.has(i));
const UI = ["frontend", "android", "ios", "cross-platform-mobile", "desktop"];
const PERSONAL = ["personal-data", "health-data", "genetic-biometric", "location", "auth", "card-data", "children"];

const CI_FILES = /(^|\/)(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.ya?ml|\.circleci\/config\.yml|bitbucket-pipelines\.yml|Makefile|package\.json|tox\.ini|noxfile\.py|CMakeLists\.txt|platformio\.ini)$/;
const DOC = "(md|markdown|rst|txt|adoc|pdf|docx?|xlsx?|csv|html?|json|ya?ml|odt)";
const doc = (stem: string) => new RegExp(`(^|/)[^/]*(${stem})[^/]*\\.${DOC}$`, "i");
const CODE_FILES = /\.(c|h|cc|cpp|hpp|js|ts|tsx|jsx|py|go|rs|java|kt|swift|cs|rb|php|dart)$/;

const hasManifest = (s: Snapshot, _sig?: Set<string>) =>
  s.paths.some((p) => /(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt|Pipfile|Cargo\.toml|go\.mod|Gemfile|composer\.json|build\.gradle(\.kts)?|pubspec\.yaml|pom\.xml)$/.test(p));

export const ARTIFACTS: ArtifactDef[] = [
  { id: "security-policy", severity: "high", title: "Vulnerability disclosure policy (SECURITY.md)", draftPath: "SECURITY.md",
    draftHint: "Supported versions and support period, how to report a vulnerability (security contact e-mail, PGP key optional), response timelines, coordinated disclosure process, safe-harbour statement.",
    paths: /(^|\/)(SECURITY\.(md|txt|rst)|security\.txt)$/i },
  { id: "privacy-policy", severity: "high", relevant: any(...PERSONAL, ...UI, "web-server"), title: "Privacy notice", draftPath: "docs/privacy-policy.md",
    draftHint: "Controller identity and contact, DPO contact, purposes and legal bases per processing activity, data categories, recipients and processors, international transfers, retention periods, data subject rights and how to exercise them, complaint right to the supervisory authority, automated decision-making.",
    paths: /(^|\/)[^/]*privacy[-_ ]?(policy|notice|statement)?[^/]*\.(md|html?|txt|tsx|jsx|vue|svelte|pdf)$|(^|\/)privacy\//i },
  { id: "terms-of-service", severity: "low", relevant: any(...UI, "web-server"), title: "Terms of service / EULA", draftPath: "docs/terms-of-service.md",
    draftHint: "Provider identity, service description, contract formation, pricing and withdrawal right for consumers, liability, termination, governing law and dispute resolution (ODR/SAL links for EU consumers).",
    paths: doc("terms|tos\\b|eula|conditions[-_]of[-_]use|terms[-_]of[-_](service|use)") },
  { id: "cookie-consent", severity: "high", relevant: any("analytics", ...UI), title: "Cookie / tracking consent mechanism", draftPath: "docs/consent.md",
    draftHint: "Consent banner that blocks non-essential cookies and SDKs before opt-in, granular choices, equal reject option, consent records, withdrawal.",
    content: { re: /cookieconsent|cookie-consent|CookieConsent|onetrust|cookiebot|didomi|usercentrics|klaro|consentmanager|gtag\(\s*['"]consent['"]|requestTrackingAuthorization|ConsentInformation|UMP|consent_?(granted|given|status)/, in: /\.(js|ts|tsx|jsx|vue|svelte|html|swift|kt|java|dart)$/ } },
  { id: "license-file", severity: "low", title: "License file", draftPath: "LICENSE",
    draftHint: "The project license text chosen by the owner.",
    paths: /(^|\/)(LICEN[CS]E|COPYING)(\.[a-z]+)?$/i },
  { id: "third-party-notices", severity: "low", title: "Third-party license notices", draftPath: "THIRD_PARTY_NOTICES.md",
    draftHint: "Each third-party component with version, license and attribution text required by its license.",
    paths: /(^|\/)(NOTICE|THIRD[-_]?PARTY[-_ ]?(NOTICES|LICENSES)?|third_party_licenses|ATTRIBUTION|OSS[-_]NOTICES?)[^/]*$/i },
  { id: "sbom", severity: "medium", title: "Software bill of materials (SBOM)", draftPath: "sbom.cdx.json",
    draftHint: "CycloneDX or SPDX SBOM listing every component with name, version, supplier, license and hash; generated in CI for each release.",
    paths: /(\.cdx\.(json|xml)|\.spdx(\.json)?|(^|\/)sbom[^/]*\.(json|xml|spdx)|(^|\/)bom\.(json|xml))$/i,
    content: { re: /cyclonedx|syft\b|spdx-sbom|sbom-tool|anchore\/sbom|cdxgen/i, in: CI_FILES } },
  { id: "dependency-lockfile", severity: "medium", title: "Dependency lockfile", draftPath: "package-lock.json",
    draftHint: "Lockfile generated by the package manager and committed.",
    paths: /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|uv\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|gradle\.lockfile|pubspec\.lock|requirements[^/]*\.lock)$/,
    relevant: hasManifest },
  { id: "dependency-update-automation", severity: "low", title: "Automated dependency updates", draftPath: ".github/dependabot.yml",
    draftHint: "Dependabot or Renovate configuration covering every package ecosystem in the repository, with a weekly schedule.",
    paths: /(^|\/)(\.github\/dependabot\.ya?ml|renovate\.json5?|\.renovaterc(\.json)?)$/, relevant: hasManifest },
  { id: "vulnerability-scanning", severity: "medium", title: "Vulnerability scanning in CI", draftPath: ".github/workflows/security.yml",
    draftHint: "CI job running dependency and code scanning (osv-scanner, npm audit, pip-audit, Trivy, CodeQL or Semgrep) on every pull request and on a schedule.",
    content: { re: /trivy|grype|snyk|npm audit|pnpm audit|yarn audit|pip-audit|safety check|osv-scanner|dependency-check|codeql|semgrep|govulncheck|cargo audit|bandit|gosec|sonar|cppcheck|clang-tidy/i, in: CI_FILES } },
  { id: "ci-pipeline", severity: "medium", title: "Continuous integration pipeline", draftPath: ".github/workflows/ci.yml",
    draftHint: "CI pipeline that builds, runs tests and static analysis on every change.",
    paths: /(^|\/)(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.ya?ml|\.circleci\/config\.yml|bitbucket-pipelines\.yml|\.drone\.yml|\.buildkite\/[^/]+)$/ },
  { id: "automated-tests", severity: "medium", title: "Automated tests", draftPath: "tests/README.md",
    draftHint: "Unit and integration tests runnable with one command.",
    paths: /(^|\/)(tests?|__tests__|spec|unittests?)\/|(^|\/)(test_[^/]+\.py|[^/]+_test\.(go|py|c|cpp|rs)|[^/]+\.(test|spec)\.[cm]?[jt]sx?|[^/]+Tests?\.(java|kt|swift|cs))$/ },
  { id: "test-coverage-config", severity: "medium", title: "Test coverage measurement", draftPath: "docs/coverage.md",
    draftHint: "Coverage tool configuration with thresholds appropriate to the integrity level (statement, branch, MC/DC).",
    paths: /(^|\/)(\.coveragerc|codecov\.ya?ml|\.nycrc(\.json)?|\.c8rc(\.json)?|gcovr\.cfg|\.gcovr\.cfg|\.lcovrc)$/,
    content: { re: /--coverage|-fprofile-arcs|-ftest-coverage|coverageThreshold|\bgcov\b|\blcov\b|gcovr|coverage run|--cov\b|c8 |nyc |"coverage"\s*:|bullseye|vectorcast|tessy/i, in: /(^|\/)(Makefile|CMakeLists\.txt|package\.json|pyproject\.toml|setup\.cfg|tox\.ini|vitest\.config\.\w+|jest\.config\.\w+|\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml)$/ } },
  { id: "static-analysis-config", severity: "medium", title: "Static analysis configuration", draftPath: ".clang-tidy",
    draftHint: "Static analyser configuration (clang-tidy, cppcheck with MISRA addon, ESLint, Ruff, Semgrep or CodeQL) enforced in CI.",
    paths: /(^|\/)(\.clang-tidy|\.cppcheck|cppcheck[^/]*\.(xml|cfg)|sonar-project\.properties|\.semgrep\.ya?ml|\.semgrep\/|\.eslintrc(\.\w+)?|eslint\.config\.\w+|\.pylintrc|ruff\.toml|\.flake8|mypy\.ini|\.golangci\.ya?ml|\.swiftlint\.yml|detekt\.yml|\.pclintrc|lint\.xml|codeql[^/]*\.ya?ml|biome\.json)$/,
    content: { re: /cppcheck|clang-tidy|codeql|semgrep|sonar|polyspace|coverity|pc-lint|eslint|ruff|pylint|flake8|golangci|-Wall\b.*-Werror|-Werror/i, in: CI_FILES } },
  { id: "coding-standard", severity: "medium", title: "Coding standard and deviation records", draftPath: "docs/coding-standard.md",
    draftHint: "Adopted coding standard (MISRA C:2025, CERT C, AUTOSAR C++14 or language style guide), the enforcement tool, and a deviation log with rationale and approval.",
    paths: /(^|\/)[^/]*(coding[-_ ]?(standard|guideline|style|rules)|misra|deviation|style[-_ ]?guide|CONTRIBUTING)[^/]*\.(md|rst|txt|csv|xlsx|pdf|adoc)$/i },
  { id: "code-review-process", severity: "low", title: "Code review process", draftPath: ".github/CODEOWNERS",
    draftHint: "CODEOWNERS and a pull request template requiring review and security consideration.",
    paths: /(^|\/)(CODEOWNERS|pull_request_template\.md|PULL_REQUEST_TEMPLATE[^/]*)$/i },
  { id: "threat-model", severity: "high", title: "Threat model / TARA", draftPath: "docs/security/threat-model.md",
    draftHint: "Assets, trust boundaries and data flows, threat scenarios (STRIDE or ISO/SAE 21434 TARA), attack feasibility and impact ratings, risk treatment decisions and derived security requirements.",
    paths: doc("threat[-_ ]?model|\\btara\\b|stride|attack[-_ ]?tree|security[-_ ]?risk[-_ ]?assessment") },
  { id: "risk-management-file", severity: "high", title: "Risk management file", draftPath: "docs/risk/risk-management.md",
    draftHint: "Risk management plan, hazard and harm analysis, risk estimation and evaluation, risk controls and their verification, residual risk acceptance.",
    paths: doc("risk[-_ ]?(management|analysis|assessment|register|file)|hazard[-_ ]?(analysis|log)|fmea|\\bhara\\b|14971") },
  { id: "safety-case", severity: "high", title: "Safety plan / safety case", draftPath: "docs/safety/safety-case.md",
    draftHint: "Safety plan, safety goals and requirements, safety mechanisms, verification evidence and the argument that the item is acceptably safe.",
    paths: doc("safety[-_ ]?(case|plan|concept|manual|requirements|goals?)|functional[-_ ]?safety|\\bfsc\\b|\\btsc\\b") },
  { id: "requirements-traceability", severity: "medium", title: "Requirements and traceability", draftPath: "docs/requirements/traceability.md",
    draftHint: "Software requirements with IDs, traced to architecture, code units and tests (bidirectional).",
    paths: doc("requirements?|traceability|\\bsrs\\b|\\brtm\\b|\\.reqif"),
    content: { re: /@(req|requirement|satisfies|implements)\b|\[(SW)?REQ[-_]\d+\]|\b(SWR|SRS|REQ|SYSREQ)[-_]\d{2,}\b/, in: CODE_FILES, min: 3 } },
  { id: "architecture-doc", severity: "medium", title: "Architecture documentation", draftPath: "docs/architecture.md",
    draftHint: "System context, components and interfaces, data flows, trust boundaries, deployment view, and the responsibilities of each component.",
    paths: /(^|\/)[^/]*(architecture|design|\bsad\b|\bsdd\b)[^/]*\.(md|rst|pdf|docx?|drawio|puml|adoc)$|\.arxml$/i },
  { id: "dpia", severity: "high", relevant: any(...PERSONAL), title: "Data protection impact assessment", draftPath: "docs/privacy/dpia.md",
    draftHint: "Description of processing and purposes, necessity and proportionality, risks to data subjects, and measures to address them (GDPR Art. 35).",
    paths: doc("\\bdpia\\b|data[-_ ]?protection[-_ ]?impact|\\bpia\\b|privacy[-_ ]?impact") },
  { id: "processing-records", severity: "medium", relevant: any(...PERSONAL), title: "Records of processing activities", draftPath: "docs/privacy/records-of-processing.md",
    draftHint: "For each processing activity: purpose, legal basis, data categories, data subjects, recipients, transfers, retention and security measures (GDPR Art. 30).",
    paths: doc("\\bropa\\b|records?[-_ ]of[-_ ]processing|processing[-_ ]activities|data[-_ ]?(map|inventory)") },
  { id: "incident-response-plan", severity: "medium", title: "Incident response plan", draftPath: "docs/security/incident-response.md",
    draftHint: "Roles, detection and triage, severity classification, regulatory notification clocks (GDPR 72h, NIS2 24h/72h, CRA 24h), communication, and post-incident review.",
    paths: doc("incident[-_ ]?(response|management|handling)|\\birp\\b|breach[-_ ]?(response|notification)|runbook") },
  { id: "update-policy", severity: "medium", title: "Update and support period policy", draftPath: "docs/security/update-policy.md",
    draftHint: "Support period end date, how security updates are delivered and signed, update frequency, end-of-life notice, rollback behaviour.",
    paths: doc("update[-_ ]?(policy|process|strategy)|support[-_ ]?(period|policy)|end[-_ ]?of[-_ ]?life|\\beol\\b|lifecycle[-_ ]?policy|patch[-_ ]?policy") },
  { id: "backup-restore", severity: "low", relevant: any("web-server", "container"), title: "Backup and restore procedure", draftPath: "docs/operations/backup-restore.md",
    draftHint: "What is backed up, frequency, encryption, retention, restore procedure and restore-test schedule.",
    paths: doc("backup|restore|disaster[-_ ]?recovery|\\bdr[-_ ]plan|\\bbcp\\b|business[-_ ]?continuity") },
  { id: "accessibility-statement", severity: "medium", relevant: any(...UI), title: "Accessibility statement", draftPath: "docs/accessibility.md",
    draftHint: "Conformance status against EN 301 549 / WCAG 2.2 AA, known limitations, feedback contact and enforcement procedure.",
    paths: /(^|\/)[^/]*(accessibility|a11y)[^/]*\.(md|html?|txt|tsx|jsx)$/i },
  { id: "ai-documentation", severity: "medium", relevant: any("llm", "ml"), title: "AI system documentation (model card)", draftPath: "docs/ai/model-card.md",
    draftHint: "Intended purpose and users, model provider and version, training and evaluation data, performance and limitations, known risks and mitigations, human oversight measures, logging, and change history.",
    paths: doc("model[-_ ]?card|ai[-_ ]?(policy|usage|documentation|system|act)|system[-_ ]?card|data[-_ ]?card|datasheet") },
  { id: "user-documentation", severity: "low", title: "User documentation / instructions for use", draftPath: "docs/user-guide.md",
    draftHint: "Intended use, installation and secure configuration, operating instructions, security update information, support contact.",
    paths: /(^|\/)(README(\.\w+)?|docs\/[^/]+\.(md|rst|html|adoc)|USER[_-]?GUIDE[^/]*|MANUAL[^/]*|\bIFU\b[^/]*|instructions[-_ ]for[-_ ]use[^/]*)$/i },
  { id: "changelog", severity: "low", title: "Changelog / release notes", draftPath: "CHANGELOG.md",
    draftHint: "Version history with dates, security fixes called out explicitly.",
    paths: /(^|\/)(CHANGELOG|CHANGES|HISTORY|RELEASE[-_ ]?NOTES)(\.\w+)?$/i },
];

export const ARTIFACT_BY_ID = new Map(ARTIFACTS.map((a) => [a.id, a]));

export type ArtifactResult = { id: ArtifactId; present: boolean; relevant: boolean; refs: CodeRef[] };

export function detectArtifacts(snapshot: Snapshot, ids?: Iterable<ArtifactId>, signals: Set<string> = new Set()): Map<ArtifactId, ArtifactResult> {
  const wanted = ids ? new Set(ids) : null;
  const out = new Map<ArtifactId, ArtifactResult>();
  for (const a of ARTIFACTS) {
    if (wanted && !wanted.has(a.id)) continue;
    const refs: CodeRef[] = [];
    if (a.paths) for (const p of snapshot.paths) if (a.paths.test(p) && refs.length < 5) refs.push({ path: p });
    if (a.content && refs.length === 0) {
      let hits = 0;
      for (const f of snapshot.files) {
        if (!a.content.in.test(f.path)) continue;
        for (let i = 0; i < f.lines.length; i++)
          if (a.content.re.test(f.lines[i])) {
            hits++;
            if (refs.length < 5) refs.push({ path: f.path, line: i + 1, excerpt: f.lines[i].trim().slice(0, 160) });
          }
      }
      if (hits < (a.content.min ?? 1)) refs.length = 0;
    }
    out.set(a.id, { id: a.id, present: refs.length > 0, relevant: a.relevant ? a.relevant(snapshot, signals) : true, refs });
  }
  return out;
}
