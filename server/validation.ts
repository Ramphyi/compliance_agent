import { z } from "zod";
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
