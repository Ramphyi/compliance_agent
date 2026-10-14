import type { Profile } from "./types";

export type CodeSnapshot = {
  filesInspected: number;
  technologyHints: string[];
  artifacts: Record<
    | "privacy"
    | "security"
    | "licenses"
    | "tests"
    | "pipelines"
    | "mobile"
    | "embedded",
    string[]
  >;
  truncated: boolean;
  generatedAt: string;
  revision?: string;
};
export type Discovery = {
  provider: "github" | "bitbucket" | "local" | "agent";
  repository: string;
  snapshot?: CodeSnapshot;
  importedAt?: string;
  answers: Record<string, string>;
};
export type ProjectQuestion = {
  id: string;
  title: string;
  why: string;
  hint: string;
};
export function projectQuestions(profile: Profile): ProjectQuestion[] {
  const snapshot = profile.discovery?.snapshot;
  const questions: ProjectQuestion[] = [
    {
      id: "purpose",
      title: "What does this project do, and who uses it?",
      why: "Code does not establish your intended use or customer.",
      hint: "Describe the product, customer and decisions it supports.",
    },
    {
      id: "markets",
      title: "Where will you offer this product?",
      why: "The countries and audience determine which requirements need review.",
      hint: "Confirm countries, business or consumer users, and whether children can use it.",
    },
    {
      id: "data",
      title: "What personal data is collected, and where does it go?",
      why: "Storage, third-party services and deletion need a clear owner.",
      hint: "Name data categories, hosting regions, processors and retention periods. If unknown, say what still needs checking.",
    },
    {
      id: "access",
      title: "How do you prevent access to another user’s data?",
      why: "A dependency list cannot prove authorization works.",
      hint: "Point to authorization code and tenant-isolation tests, or describe the missing checks.",
    },
  ];
  if (
    profile.usesAi ||
    profile.softwareType === "ai" ||
    snapshot?.technologyHints.some((t) => /openai|anthropic|langchain/i.test(t))
  )
    questions.push({
      id: "ai",
      title: "What does the AI do, and what data reaches the model?",
      why: "Your profile or repository indicates an AI feature. A dependency may be optional or unused.",
      hint: "Confirm whether enabled, provider, inputs, output use, human oversight and evaluations. Cite file paths where possible.",
    });
  if (profile.softwareType === "mobile" || snapshot?.artifacts.mobile.length)
    questions.push({
      id: "mobile",
      title: "Which permissions and SDKs need store disclosures?",
      why: "Mobile configuration or your profile indicates a store release.",
      hint: "List permissions, analytics and advertising SDKs, and whether disclosures match the shipped build.",
    });
  if (
    profile.softwareType === "embedded" ||
    snapshot?.artifacts.embedded.length
  )
    questions.push({
      id: "updates",
      title: "How will deployed devices receive security updates?",
      why: "Connected software needs an update and support plan.",
      hint: "Explain signing, rollback, supported lifetime and vulnerability reporting.",
    });
  if (
    profile.industry === "Healthcare" ||
    profile.dataTypes.includes("Health data")
  )
    questions.push({
      id: "health",
      title: "Does the software influence diagnosis or treatment?",
      why: "Intended clinical use may change the review scope.",
      hint: "Describe intended use, clinical claims, sensitive data and the responsible reviewer.",
    });
  if (
    profile.audience === "Children" ||
    profile.dataTypes.includes("Children’s data")
  )
    questions.push({
      id: "children",
      title: "How are children’s data and age restrictions handled?",
      why: "Your declared audience or data includes children.",
      hint: "Explain age assurance, consent and data minimization, with supporting records.",
    });
  if (snapshot && !snapshot.artifacts.privacy.length)
    questions.push({
      id: "privacy_notice",
      title: "Where is the privacy notice maintained?",
      why: "No privacy-named file was found in this bounded snapshot; the notice may live elsewhere.",
      hint: "Provide its URL or document location and who keeps it aligned with the product.",
    });
  if (snapshot && !snapshot.artifacts.tests.length)
    questions.push({
      id: "verification",
      title: "How are security checks tested before release?",
      why: "No recognized test filenames were found in this snapshot. This does not prove tests are absent.",
      hint: "Point to the test suite or external testing process, and record which checks remain missing.",
    });
  return questions;
}

export function unansweredQuestions(profile: Profile) {
  return profile.discovery
    ? projectQuestions(profile).filter(
        (q) => !profile.discovery?.answers[q.id]?.trim(),
      )
    : [];
}
