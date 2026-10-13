import type { Control, Profile } from "../shared/types.js";
const eu = new Set([
  "EU",
  "Austria",
  "Belgium",
  "Bulgaria",
  "Croatia",
  "Cyprus",
  "Czechia",
  "Denmark",
  "Estonia",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hungary",
  "Ireland",
  "Italy",
  "Latvia",
  "Lithuania",
  "Luxembourg",
  "Malta",
  "Netherlands",
  "Poland",
  "Portugal",
  "Romania",
  "Slovakia",
  "Slovenia",
  "Spain",
  "Sweden",
  "Norway",
  "Iceland",
  "Liechtenstein",
]);
export const inEurope = (p: Profile) => p.countries.some((c) => eu.has(c));
const personal = (p: Profile) =>
  p.dataTypes.some((d) =>
    [
      "Personal data",
      "Health data",
      "Payment data",
      "Children’s data",
    ].includes(d),
  );
export const sources = [
  {
    id: "uk-privacy",
    title: "UK data protection guidance",
    authority: "ICO",
    category: "Privacy",
    url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/",
    note: "Check territorial scope and current UK legislation, including amendments and sector guidance.",
  },
  {
    id: "dora",
    title: "Digital operational resilience",
    authority: "European Commission",
    category: "Finance",
    url: "https://finance.ec.europa.eu/digital-finance/cyber-resilience_en",
    note: "Assess entity classification, ICT service role, exemptions and contract requirements.",
  },
  {
    id: "coppa",
    title: "Children’s online privacy",
    authority: "FTC",
    category: "Children",
    url: "https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions",
    note: "Determine child-directed status, actual knowledge, applicable ages and current requirements.",
  },
  {
    id: "consumer",
    title: "Consumer Rights Directive",
    authority: "EUR-Lex",
    category: "Consumer protection",
    url: "https://eur-lex.europa.eu/eli/dir/2011/83/oj",
    note: "Review national implementation, digital-content rules, pre-contract information and cancellation exceptions.",
  },
  {
    id: "accessibility",
    title: "European Accessibility Act",
    authority: "EUR-Lex",
    category: "Accessibility",
    url: "https://eur-lex.europa.eu/eli/dir/2019/882/oj",
    note: "Only covered products and services are within scope. Check national implementation and exemptions.",
  },
  {
    id: "medical",
    title: "Medical Device Regulation",
    authority: "EUR-Lex",
    category: "Healthcare",
    url: "https://eur-lex.europa.eu/eli/reg/2017/745/oj",
    note: "Intended medical purpose and classification determine whether software is a medical device.",
  },
  {
    id: "google-play",
    title: "Google Play User Data policy",
    authority: "Google Play",
    category: "Mobile",
    url: "https://support.google.com/googleplay/android-developer/answer/10144311",
    note: "Review actual platform distribution, permissions, Data safety information and deletion requirements.",
  },
  {
    id: "gdpr",
    title: "General Data Protection Regulation",
    authority: "EUR-Lex",
    category: "Privacy",
    url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    note: "Primary regulation. Applicability and territorial scope need review.",
  },
  {
    id: "ai-act",
    title: "EU Artificial Intelligence Act",
    authority: "European Commission",
    category: "AI governance",
    url: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
    note: "Check current implementation guidance and amendments before relying on a deadline.",
  },
  {
    id: "iso42001",
    title: "ISO/IEC 42001",
    authority: "ISO",
    category: "AI governance",
    url: "https://www.iso.org/standard/42001",
    note: "AI management system standard. Licensed standard text and an independent assessment are required for certification.",
  },
  {
    id: "iso27001",
    title: "ISO/IEC 27001",
    authority: "ISO",
    category: "Security",
    url: "https://www.iso.org/standard/27001",
    note: "Information security management. This application does not provide ISO certification.",
  },
  {
    id: "apple",
    title: "App Review Guidelines",
    authority: "Apple",
    category: "Mobile",
    url: "https://developer.apple.com/app-store/review/guidelines/",
    note: "Platform policy is separate from legislation. Review your actual distribution channels.",
  },
  {
    id: "cra",
    title: "Cyber Resilience Act",
    authority: "European Commission",
    category: "Product security",
    url: "https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act",
    note: "Product scope, exceptions, role, and phased application dates require confirmation.",
  },
  {
    id: "ccpa",
    title: "California Consumer Privacy Act",
    authority: "California DOJ",
    category: "Privacy",
    url: "https://oag.ca.gov/privacy/ccpa",
    note: "Business thresholds and exemptions must be checked; selling to California alone does not establish applicability.",
  },
  {
    id: "hipaa",
    title: "HIPAA for professionals",
    authority: "HHS",
    category: "Healthcare",
    url: "https://www.hhs.gov/hipaa/for-professionals/index.html",
    note: "Assess covered entity and business associate status before determining obligations.",
  },
];
const url = (id: string) => sources.find((s) => s.id === id)!.url;
export const controls: Control[] = [
  {
    id: "uk-privacy-scope",
    title: "Assess UK privacy requirements",
    framework: "UK privacy scope review",
    category: "Privacy",
    severity: "high",
    description:
      "Review UK territorial scope, current data-protection rules, notices, rights and transfers. UK obligations are separate from EU GDPR scope.",
    action:
      "Attach a current UK applicability assessment and appropriate privacy documents.",
    source: url("uk-privacy"),
    applies: (p) => p.countries.includes("United Kingdom") && personal(p),
  },
  {
    id: "finance-resilience",
    title: "Assess financial-sector resilience duties",
    framework: "DORA scope review",
    category: "Finance",
    severity: "high",
    description:
      "Determine the financial entity or ICT provider role, scope and exemptions; software used in finance is not automatically a regulated entity.",
    action:
      "Attach a scope review, ICT risk ownership and relevant customer contract assessment.",
    source: url("dora"),
    applies: (p) => inEurope(p) && p.industry === "Finance",
  },
  {
    id: "children-us",
    title: "Assess children’s privacy and consent",
    framework: "COPPA scope review",
    category: "Children",
    severity: "high",
    description:
      "Assess child-directed services or actual knowledge of children, age criteria and parental consent requirements under current rules.",
    action:
      "Attach an audience assessment, age and consent design, data minimization review and parental notice if applicable.",
    source: url("coppa"),
    applies: (p) =>
      p.countries.includes("United States") &&
      (p.audience === "Children" || p.dataTypes.includes("Children’s data")),
  },
  {
    id: "children-eu",
    title: "Review children’s data safeguards",
    framework: "GDPR",
    category: "Children",
    severity: "high",
    description:
      "Review child-specific transparency, lawful basis, national digital-consent age rules and impact-assessment needs.",
    action:
      "Attach a child data impact review and country-specific consent applicability decision.",
    source: url("gdpr"),
    applies: (p) =>
      inEurope(p) &&
      (p.audience === "Children" || p.dataTypes.includes("Children’s data")),
  },
  {
    id: "consumer-terms",
    title: "Review consumer terms and purchase disclosures",
    framework: "EU consumer terms review",
    category: "Consumer protection",
    severity: "high",
    description:
      "Assess pre-contract information, prices, cancellation and withdrawal rules and digital-content exceptions in target markets.",
    action:
      "Attach reviewed terms of service, subscription and cancellation flows, and applicable national-law decisions.",
    source: url("consumer"),
    applies: (p) => inEurope(p) && p.audience !== "Businesses",
  },
  {
    id: "accessibility-scope",
    title: "Assess accessibility scope and testing",
    framework: "EAA scope review",
    category: "Accessibility",
    severity: "medium",
    description:
      "Determine whether the product or service falls within covered categories, exemptions and national implementation. Do not assume all software is covered.",
    action:
      "Attach an applicability decision and, where applicable, an accessibility evaluation and remediation record.",
    source: url("accessibility"),
    applies: (p) =>
      inEurope(p) &&
      p.audience !== "Businesses" &&
      ["saas", "mobile"].includes(p.softwareType),
  },
  {
    id: "medical-software",
    title: "Determine medical-device software status",
    framework: "EU MDR scope review",
    category: "Healthcare",
    severity: "high",
    description:
      "Assess whether intended purpose gives the software a medical-device role. A health journal is not automatically a medical device.",
    action:
      "Attach an intended-purpose statement, qualification and classification assessment, and required specialist review.",
    source: url("medical"),
    applies: (p) => inEurope(p) && p.industry === "Healthcare",
  },
  {
    id: "android-disclosures",
    title: "Review Android data disclosures",
    framework: "Google Play platform review",
    category: "Mobile",
    severity: "high",
    description:
      "Assess Google Play applicability, Data safety declarations, permissions, privacy policy and account deletion for Android distribution.",
    action:
      "Attach reviewed Android disclosures or a documented decision that this distribution platform is out of scope.",
    source: url("google-play"),
    applies: (p) => p.softwareType === "mobile",
  },
  {
    id: "privacy-notice",
    title: "Publish a clear privacy notice",
    framework: "GDPR",
    category: "Privacy",
    severity: "high",
    description:
      "Review transparency information for processing personal data, including purposes, lawful bases, retention and individual rights.",
    action:
      "Provide a published privacy notice and a documented review against applicable Article 13/14 requirements.",
    source: url("gdpr"),
    applies: (p) => inEurope(p) && personal(p),
  },
  {
    id: "data-rights",
    title: "Make data rights actionable",
    framework: "GDPR",
    category: "Privacy",
    severity: "high",
    description:
      "Document how applicable access, deletion and other data-subject requests are authenticated and fulfilled.",
    action: "Attach the rights-request procedure, ownership and a test record.",
    source: url("gdpr"),
    applies: (p) => inEurope(p) && personal(p),
  },
  {
    id: "data-map",
    title: "Map data, processors and retention",
    framework: "GDPR",
    category: "Privacy",
    severity: "medium",
    description:
      "Identify processing activities, processors, international transfers and a justified retention schedule.",
    action:
      "Attach a processing inventory and assess record-keeping and processor agreement obligations.",
    source: url("gdpr"),
    applies: (p) => inEurope(p) && personal(p),
  },
  {
    id: "access-control",
    title: "Review access and authentication",
    framework: "ISO 27001 readiness",
    category: "Security",
    severity: "high",
    description:
      "Readiness check for least privilege, privileged access review and strong authentication; not a certification decision.",
    action:
      "Attach access policy, permission review and authentication test results.",
    source: url("iso27001"),
    applies: () => true,
  },
  {
    id: "incident-plan",
    title: "Prepare your incident response",
    framework: "ISO 27001 readiness",
    category: "Security",
    severity: "medium",
    description:
      "Maintain an incident response process with owners, escalation and applicable reporting assessments.",
    action: "Attach the incident playbook and the latest exercise record.",
    source: url("iso27001"),
    applies: () => true,
  },
  {
    id: "ai-classification",
    title: "Classify your AI system and role",
    framework: "EU AI Act",
    category: "AI governance",
    severity: "high",
    description:
      "Assess intended purpose, provider/deployer role, prohibited practices, risk category and applicable duties.",
    action:
      "Attach a reviewed risk classification, intended-use statement and source-backed applicability decision.",
    source: url("ai-act"),
    applies: (p) => inEurope(p) && (p.usesAi || p.softwareType === "ai"),
  },
  {
    id: "ai-governance",
    title: "Define AI accountability and oversight",
    framework: "ISO 42001 readiness",
    category: "AI governance",
    severity: "high",
    description:
      "Readiness check for AI policy, accountability, impact assessment and human oversight.",
    action:
      "Attach your AI policy, accountable owner and impact-assessment record.",
    source: url("iso42001"),
    applies: (p) => p.usesAi || p.softwareType === "ai",
  },
  {
    id: "ai-evaluation",
    title: "Document AI evaluation and monitoring",
    framework: "ISO 42001 readiness",
    category: "AI governance",
    severity: "medium",
    description:
      "Review evaluation evidence, limitations, data provenance and ongoing monitoring.",
    action: "Attach the evaluation plan, results and monitoring procedure.",
    source: url("iso42001"),
    applies: (p) => p.usesAi || p.softwareType === "ai",
  },
  {
    id: "mobile-disclosures",
    title: "Review mobile permissions and disclosures",
    framework: "Mobile platform review",
    category: "Mobile",
    severity: "high",
    description:
      "Assess app-store privacy information, permissions, deletion flows and actual distribution platform requirements.",
    action:
      "Provide platform-specific privacy disclosures and permission test results. Apple guidance is a starting point, not Android coverage.",
    source: url("apple"),
    applies: (p) => p.softwareType === "mobile",
  },
  {
    id: "product-security",
    title: "Assess product cybersecurity obligations",
    framework: "Cyber Resilience Act",
    category: "Product security",
    severity: "high",
    description:
      "Triage whether software or a connected device falls within the CRA; determine role, exclusions and current application dates.",
    action:
      "Attach a scope assessment, vulnerability handling process and support-period decision.",
    source: url("cra"),
    applies: (p) =>
      inEurope(p) &&
      (p.softwareType === "embedded" || p.softwareType === "mobile"),
  },
  {
    id: "california-privacy",
    title: "Assess California privacy applicability",
    framework: "CCPA scope review",
    category: "Privacy",
    severity: "high",
    description:
      "Assess CCPA/CPRA business thresholds, data practices and exemptions before choosing controls.",
    action:
      "Attach an applicability assessment and, where applicable, rights and notice procedures.",
    source: url("ccpa"),
    applies: (p) =>
      p.countries.some((c) => ["United States", "California"].includes(c)) &&
      personal(p),
  },
  {
    id: "healthcare-scope",
    title: "Assess healthcare privacy obligations",
    framework: "HIPAA scope review",
    category: "Healthcare",
    severity: "high",
    description:
      "Assess covered-entity or business-associate status. Healthcare software is not automatically subject to HIPAA.",
    action:
      "Document entity role, protected data flows and relevant business associate agreements.",
    source: url("hipaa"),
    applies: (p) =>
      p.countries.includes("United States") &&
      (p.industry === "Healthcare" || p.dataTypes.includes("Health data")),
  },
];
