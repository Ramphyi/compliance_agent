import { z } from "zod";
const artifactPaths = z.array(z.string().max(300)).max(30);
export const snapshotSchema = z.object({
  filesInspected: z.number().int().min(0).max(5000),
  technologyHints: z.array(z.string().max(80)).max(40),
  artifacts: z.object({
    privacy: artifactPaths,
    security: artifactPaths,
    licenses: artifactPaths,
    tests: artifactPaths,
    pipelines: artifactPaths,
    mobile: artifactPaths,
    embedded: artifactPaths,
  }),
  truncated: z.boolean(),
  generatedAt: z.string().datetime(),
  revision: z
    .string()
    .regex(/^[a-f0-9]{7,64}$/i)
    .optional(),
});
export const connectionSchema = z
  .object({
    provider: z.enum(["github", "bitbucket", "local", "agent"]),
    repository: z.string().trim().max(300).default(""),
  })
  .superRefine((value, ctx) => {
    if (["github", "bitbucket"].includes(value.provider)) {
      try {
        const url = new URL(value.repository);
        if (
          url.protocol !== "https:" ||
          url.hostname !==
            (value.provider === "github" ? "github.com" : "bitbucket.org") ||
          url.username ||
          url.password ||
          url.port ||
          url.search ||
          url.hash ||
          !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
        )
          throw new Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          message:
            "Use a repository URL such as https://github.com/owner/repository, without credentials or query parameters.",
        });
      }
    }
  });
export const answersSchema = z
  .record(z.string().max(40), z.string().trim().max(3000))
  .refine((v) => Object.keys(v).length <= 20, "Too many answers");
export const discoverySchema = z
  .object({
    provider: z.enum(["github", "bitbucket", "local", "agent"]),
    repository: z.string().max(300),
    snapshot: snapshotSchema.optional(),
    importedAt: z.string().datetime().optional(),
    answers: answersSchema,
  })
  .superRefine((value, ctx) => {
    const parsed = connectionSchema.safeParse(value);
    if (!parsed.success)
      ctx.addIssue({
        code: "custom",
        message: "Invalid code source repository URL.",
      });
  });
export const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(20).max(6000),
  industry: z.enum([
    "Technology",
    "Healthcare",
    "Finance",
    "Education",
    "Retail",
    "Industrial",
    "Other",
  ]),
  softwareType: z.enum(["saas", "mobile", "embedded", "ai"]),
  countries: z.array(z.string().trim().min(2).max(80)).min(1).max(40),
  audience: z.enum(["Businesses", "Consumers", "Both", "Children"]),
  dataTypes: z
    .array(
      z.enum([
        "Personal data",
        "Health data",
        "Payment data",
        "Children’s data",
        "Anonymous data",
      ]),
    )
    .min(1)
    .max(5),
  usesAi: z.boolean(),
  externalAi: z.boolean().default(false),
  discovery: discoverySchema.optional(),
});
export const evidenceSchema = z.object({
  controlId: z.string().min(1).max(100),
  title: z.string().trim().min(3).max(150),
  content: z.string().trim().min(20).max(50000),
});
export const ruleSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().min(20).max(6000),
  severity: z.enum(["high", "medium", "low"]),
});
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(128);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
