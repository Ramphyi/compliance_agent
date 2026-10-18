import { z } from "zod";
import {
  ARTIFACT_IDS,
  CATEGORIES,
  CHECK_IDS,
  FIXABILITY,
  FRAMEWORK_KINDS,
  SEVERITIES,
} from "./ids";

export type Condition =
  | { always: true }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; in: string[] }
  | { fact: string; equals: string | boolean | number };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ always: z.literal(true) }),
    z.strictObject({ all: z.array(conditionSchema).min(1) }),
    z.strictObject({ any: z.array(conditionSchema).min(1) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({ fact: z.string(), in: z.array(z.string()).min(1) }),
    z.strictObject({
      fact: z.string(),
      equals: z.union([z.string(), z.boolean(), z.number()]),
    }),
  ]),
);

const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const questionSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  section: z.string(),
  type: z.enum(["single", "multi", "text", "boolean"]),
  text: z.string(),
  why: z.string(),
  help: z.string().optional(),
  showWhen: conditionSchema.optional(),
  options: z
    .array(
      z.strictObject({
        value: z.string(),
        label: z.string(),
        help: z.string().optional(),
      }),
    )
    .optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const questionnaireSchema = z.strictObject({
  version: z.number(),
  questions: z.array(questionSchema),
});

export const controlSchema = z.strictObject({
  ref: z.string().min(1),
  title: z.string().min(3),
  requirement: z.string().min(10),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  fixability: z.enum(FIXABILITY),
  when: conditionSchema.optional(),
  guidance: z.string().min(10),
  evidence: z.array(z.string()).default([]),
  checks: z.array(z.enum(CHECK_IDS)).default([]),
  artifacts: z.array(z.enum(ARTIFACT_IDS)).default([]),
  crosswalk: z.array(z.string().regex(/^[a-z0-9-]+:.+$/)).default([]),
});
export type ControlDef = z.infer<typeof controlSchema>;

export const frameworkSchema = z.strictObject({
  id: z.string().regex(kebab),
  title: z.string(),
  shortTitle: z.string(),
  version: z.string(),
  authority: z.string(),
  kind: z.enum(FRAMEWORK_KINDS),
  jurisdictions: z.array(z.string()).min(1),
  url: z.url(),
  textPolicy: z.enum(["open", "paraphrased"]),
  summary: z.string(),
  applicability: conditionSchema,
  applicabilityNote: z.string(),
  keyDates: z
    .array(
      z.strictObject({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z.string(),
      }),
    )
    .default([]),
  controls: z.array(controlSchema).min(1),
});
export type FrameworkDef = z.infer<typeof frameworkSchema>;

export const presetSchema = z.strictObject({
  id: z.string().regex(kebab),
  title: z.string(),
  description: z.string(),
  examples: z.array(z.string()).default([]),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.boolean()])),
  includeFrameworks: z.array(z.string()).default([]),
  excludeFrameworks: z.array(z.string()).default([]),
  verify: z.array(z.string()).default([]),
});
export type Preset = z.infer<typeof presetSchema>;

/** A control with its framework context and global id. */
export type Control = ControlDef & {
  id: string;
  frameworkId: string;
  frameworkTitle: string;
};

export type Framework = Omit<FrameworkDef, "controls"> & { controls: Control[] };

export type Registry = {
  questionnaire: z.infer<typeof questionnaireSchema>;
  frameworks: Framework[];
  presets: Preset[];
  controls: Map<string, Control>;
  /** Registry content hash, recorded with each audit so results are reproducible. */
  hash: string;
  root: string;
};
