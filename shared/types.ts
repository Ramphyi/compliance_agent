export type Profile = {
  name: string;
  description: string;
  industry: string;
  softwareType: "saas" | "mobile" | "embedded" | "ai";
  countries: string[];
  audience: string;
  dataTypes: string[];
  usesAi: boolean;
  externalAi: boolean;
};
export type Project = {
  id: string;
  owner_id: string;
  profile: Profile;
  created_at: string;
};
export type Evidence = {
  id: string;
  project_id: string;
  control_id: string;
  title: string;
  content: string;
  status: "submitted" | "approved" | "rejected";
  created_at: string;
};
export type Control = {
  id: string;
  title: string;
  framework: string;
  category: string;
  severity: "high" | "medium" | "low";
  description: string;
  action: string;
  source: string;
  applies: (p: Profile) => boolean;
};
export type Finding = Omit<Control, "applies"> & {
  status: "missing" | "review" | "covered";
  evidenceIds: string[];
};
export type RunEvent = {
  agent: string;
  title: string;
  detail: string;
  at: string;
};
export type Run = {
  id: string;
  project_id: string;
  status: string;
  score: number;
  findings: Finding[];
  events: RunEvent[];
  research: {
    text: string;
    citations: { title: string; url: string }[];
  } | null;
  created_at: string;
};
export type Rule = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  created_at: string;
};
export type User = {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  mfa_enabled: boolean;
};
