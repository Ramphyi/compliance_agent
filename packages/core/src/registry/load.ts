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
  type FrameworkDef,
  type FrameworkOrigin,
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

/**
 * Where framework files come from, in load order. A later layer may replace a framework of an
 * earlier one by using the same id: that is how a server updates a built-in standard.
 */
export type FrameworkLayer = { dir: string; origin: FrameworkOrigin };

type FactValues = Map<string, Set<string>>;

const factValuesOf = (questionnaire: Registry["questionnaire"]): FactValues =>
  new Map(questionnaire.questions.map((x) => [x.id, new Set((x.options ?? []).map((o) => o.value))]));

/** Problems with a condition: facts the questionnaire does not ask, or values it does not offer. */
function conditionIssues(factValues: FactValues, where: string, c: Condition): string[] {
  const out: string[] = [];
  for (const { fact, values } of conditionFacts(c)) {
    const allowed = factValues.get(fact);
    if (!allowed) {
      out.push(`${where}: unknown fact "${fact}"`);
      continue;
    }
    for (const v of values) if (allowed.size && !allowed.has(v)) out.push(`${where}: fact "${fact}" has no option "${v}"`);
  }
  return out;
}

/** Parse one framework file. `errors` that leave a `def` are reported but do not skip it. */
function parseFramework(raw: string, factValues: FactValues): { def?: FrameworkDef; errors: string[] } {
  let doc: unknown;
  try {
    doc = parse(raw);
  } catch (e) {
    return { errors: [`YAML: ${(e as Error).message}`] };
  }
  const parsed = frameworkSchema.safeParse(doc);
  if (!parsed.success) return { errors: [formatZod(parsed.error)] };
  const def = parsed.data;
  const errors = conditionIssues(factValues, "applicability", def.applicability);
  const refs = new Set<string>();
  for (const c of def.controls) {
    if (refs.has(c.ref)) errors.push(`duplicate control ref "${c.ref}"`);
    refs.add(c.ref);
    if (c.when) errors.push(...conditionIssues(factValues, `control ${c.ref}`, c.when));
  }
  return { def, errors };
}

export type FrameworkCheck = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  framework?: { id: string; title: string; shortTitle: string; version: string; kind: string; controls: number };
  /** The framework this file would replace, when its id is already in the registry. */
  replaces?: { origin: FrameworkOrigin; version: string };
};

/** Validate a framework file against a loaded registry without saving it (for uploads). */
export function checkFramework(raw: string, registry: Registry): FrameworkCheck {
  const { def, errors } = parseFramework(raw, factValuesOf(registry.questionnaire));
  if (!def) return { ok: false, errors, warnings: [] };
  const refs = new Set(def.controls.map((c) => `${def.id}:${c.ref}`));
  const warnings = def.controls.flatMap((c) =>
    c.crosswalk.filter((r) => !refs.has(r) && !registry.controls.has(r)).map((r) => `${c.ref}: crosswalk target "${r}" is not in the registry`),
  );
  const prev = registry.frameworks.find((f) => f.id === def.id);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    framework: { id: def.id, title: def.title, shortTitle: def.shortTitle, version: def.version, kind: def.kind, controls: def.controls.length },
    replaces: prev && { origin: prev.origin, version: prev.version },
  };
}

/**
 * Load the registry: the built-in frameworks under `root`, then each extra layer in order.
 * Plain directories are project rule layers. A framework id that appears again in a later
 * layer replaces the earlier one (reported as a warning); a file that fails validation is
 * skipped, so a broken update leaves the previous version in place.
 */
export function loadRegistry(
  root = findRegistryRoot(),
  extraFrameworkDirs: (string | FrameworkLayer)[] = [],
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
  const factValues = factValuesOf(questionnaire);
  for (const question of questionnaire.questions)
    if (question.showWhen)
      for (const message of conditionIssues(factValues, `question ${question.id}`, question.showWhen)) errors.push({ file: qFile, message });

  const layers: FrameworkLayer[] = [
    { dir: join(root, "frameworks"), origin: "built-in" },
    ...extraFrameworkDirs.map((d) => (typeof d === "string" ? { dir: d, origin: "project" as const } : d)),
  ];
  const chosen = new Map<string, Omit<Framework, "controls"> & { def: FrameworkDef }>();
  for (const layer of layers) {
    const inLayer = new Set<string>();
    for (const file of yamlFiles(layer.dir)) {
      const raw = readFileSync(file, "utf8");
      hash.update(basename(file)).update(raw);
      const { def, errors: issues } = parseFramework(raw, factValues);
      for (const message of issues) errors.push({ file, message });
      if (!def) continue;
      if (basename(file).replace(/\.ya?ml$/, "") !== def.id)
        errors.push({ file, message: `id "${def.id}" must match the file name` });
      if (inLayer.has(def.id)) {
        errors.push({ file, message: `duplicate framework id "${def.id}"` });
        continue;
      }
      inLayer.add(def.id);
      const prev = chosen.get(def.id);
      if (prev) warnings.push({ file, message: `replaces the ${prev.origin} framework "${def.id}" (version ${prev.version})` });
      const { controls: _, ...meta } = def;
      chosen.set(def.id, { ...meta, def, origin: layer.origin, file, replaces: prev && { origin: prev.origin, version: prev.version } });
    }
  }

  const frameworks: Framework[] = [];
  const controls = new Map<string, Control>();
  for (const { def, ...meta } of chosen.values()) {
    const fw: Framework = { ...meta, controls: [] };
    for (const c of def.controls) {
      const id = `${def.id}:${c.ref}`;
      if (controls.has(id)) continue; // reported by parseFramework
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
