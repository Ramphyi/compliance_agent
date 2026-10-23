import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { z } from "zod";
import {
  type Condition,
  type Control,
  type Framework,
  frameworkSchema,
  type Preset,
  presetSchema,
  questionnaireSchema,
  type Registry,
} from "./schema";

export type RegistryIssue = { file: string; message: string };

/** Locate the registry next to the running code: repo checkout, bundle or ACAI_REGISTRY. */
export function findRegistryRoot(): string {
  const fromEnv = process.env.ACAI_REGISTRY;
  if (fromEnv) return resolve(fromEnv);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "registry");
    if (existsSync(join(candidate, "questionnaire.yaml"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "Acai registry not found. Set ACAI_REGISTRY to the registry directory.",
  );
}

function yamlFiles(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}

function formatZod(error: z.ZodError) {
  return error.issues
    .slice(0, 12)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Every fact/value pair a condition refers to, for validation against the questionnaire. */
export function conditionFacts(c: Condition): { fact: string; values: string[] }[] {
  if ("always" in c) return [];
  if ("all" in c) return c.all.flatMap(conditionFacts);
  if ("any" in c) return c.any.flatMap(conditionFacts);
  if ("not" in c) return conditionFacts(c.not);
  if ("in" in c) return [{ fact: c.fact, values: c.in }];
  return [{ fact: c.fact, values: [String(c.equals)] }];
}

export function loadRegistry(
  root = findRegistryRoot(),
  extraFrameworkDirs: string[] = [],
): { registry: Registry; errors: RegistryIssue[]; warnings: RegistryIssue[] } {
  const errors: RegistryIssue[] = [];
  const warnings: RegistryIssue[] = [];
  const hash = createHash("sha256");

  const qFile = join(root, "questionnaire.yaml");
  const qRaw = readFileSync(qFile, "utf8");
  hash.update(qRaw);
  const q = questionnaireSchema.safeParse(parse(qRaw));
  if (!q.success) throw new Error(`${qFile}: ${formatZod(q.error)}`);
  const questionnaire = q.data;
  const factValues = new Map(
    questionnaire.questions.map((x) => [
      x.id,
      new Set((x.options ?? []).map((o) => o.value)),
    ]),
  );

  const checkCondition = (file: string, where: string, c: Condition) => {
    for (const { fact, values } of conditionFacts(c)) {
      const allowed = factValues.get(fact);
      if (!allowed) {
        errors.push({ file, message: `${where}: unknown fact "${fact}"` });
        continue;
      }
      for (const v of values)
        if (allowed.size && !allowed.has(v))
          errors.push({
            file,
            message: `${where}: fact "${fact}" has no option "${v}"`,
          });
    }
  };
  for (const question of questionnaire.questions)
    if (question.showWhen)
      checkCondition(qFile, `question ${question.id}`, question.showWhen);

  const frameworks: Framework[] = [];
  const controls = new Map<string, Control>();
  const dirs = [join(root, "frameworks"), ...extraFrameworkDirs];
  for (const file of dirs.flatMap(yamlFiles)) {
    const raw = readFileSync(file, "utf8");
    hash.update(basename(file)).update(raw);
    let doc: unknown;
    try {
      doc = parse(raw);
    } catch (e) {
      errors.push({ file, message: `YAML: ${(e as Error).message}` });
      continue;
    }
    const parsed = frameworkSchema.safeParse(doc);
    if (!parsed.success) {
      errors.push({ file, message: formatZod(parsed.error) });
      continue;
    }
    const def = parsed.data;
    if (basename(file).replace(/\.ya?ml$/, "") !== def.id)
      errors.push({ file, message: `id "${def.id}" must match the file name` });
    if (frameworks.some((f) => f.id === def.id)) {
      errors.push({ file, message: `duplicate framework id "${def.id}"` });
      continue;
    }
    checkCondition(file, "applicability", def.applicability);
    const fw: Framework = { ...def, controls: [] };
    for (const c of def.controls) {
      const id = `${def.id}:${c.ref}`;
      if (controls.has(id)) {
        errors.push({ file, message: `duplicate control ref "${c.ref}"` });
        continue;
      }
      if (c.when) checkCondition(file, `control ${c.ref}`, c.when);
      const control: Control = {
        ...c,
        id,
        frameworkId: def.id,
        frameworkTitle: def.shortTitle,
      };
      controls.set(id, control);
      fw.controls.push(control);
    }
    frameworks.push(fw);
  }

  for (const c of controls.values())
    for (const ref of c.crosswalk)
      if (!controls.has(ref))
        warnings.push({
          file: c.frameworkId,
          message: `${c.id}: crosswalk target "${ref}" is not in the registry`,
        });

  const presets: Preset[] = [];
  for (const file of yamlFiles(join(root, "presets"))) {
    const raw = readFileSync(file, "utf8");
    hash.update(basename(file)).update(raw);
    const parsed = presetSchema.safeParse(parse(raw));
    if (!parsed.success) {
      errors.push({ file, message: formatZod(parsed.error) });
      continue;
    }
    const preset = parsed.data;
    if (basename(file).replace(/\.ya?ml$/, "") !== preset.id)
      errors.push({ file, message: `id "${preset.id}" must match the file name` });
    for (const [fact, value] of Object.entries(preset.answers)) {
      const allowed = factValues.get(fact);
      if (!allowed) {
        errors.push({ file, message: `answer for unknown fact "${fact}"` });
        continue;
      }
      for (const v of Array.isArray(value) ? value : [String(value)])
        if (allowed.size && !allowed.has(v))
          errors.push({ file, message: `fact "${fact}" has no option "${v}"` });
    }
    for (const id of [...preset.includeFrameworks, ...preset.excludeFrameworks])
      if (!frameworks.some((f) => f.id === id))
        errors.push({ file, message: `unknown framework "${id}"` });
    presets.push(preset);
  }

  return {
    registry: {
      questionnaire,
      frameworks,
      presets,
      controls,
      hash: hash.digest("hex").slice(0, 16),
      root,
    },
    errors,
    warnings,
  };
}
