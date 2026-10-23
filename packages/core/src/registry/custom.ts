import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { checkFramework, type FrameworkCheck, type FrameworkLayer, findRegistryRoot, loadRegistry } from "./load";

/** Server-wide state: accounts, model settings, the project list and the server's own frameworks. */
export const acaiHome = () => resolve(process.env.ACAI_HOME ?? join(homedir(), ".acai"));

/**
 * The server's own frameworks: new standards, internal company rules, and newer revisions of
 * built-in ones (same id). Default $ACAI_HOME/frameworks (the /data volume in Docker);
 * ACAI_FRAMEWORKS_DIR points elsewhere, for example a read-only checkout managed in git.
 */
export const customFrameworksDir = () => resolve(process.env.ACAI_FRAMEWORKS_DIR ?? join(acaiHome(), "frameworks"));

/** Every layer a project loads after the built-in registry. */
export function frameworkLayers(projectRulesDir?: string): FrameworkLayer[] {
  return [{ dir: customFrameworksDir(), origin: "custom" }, ...(projectRulesDir ? [{ dir: projectRulesDir, origin: "project" as const }] : [])];
}

/** The registry every project shares: built-in plus the server's frameworks (no project rules). */
export const serverRegistry = (root?: string) => loadRegistry(root, frameworkLayers());

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fileOf = (id: string) => {
  if (!ID.test(id)) throw new Error(`Invalid framework id "${id}": use lowercase letters, digits and dashes`);
  return join(customFrameworksDir(), `${id}.yaml`);
};

export function listFrameworks(root?: string) {
  const { registry, errors, warnings } = serverRegistry(root);
  const dir = customFrameworksDir();
  return {
    dir,
    frameworks: registry.frameworks.map((f) => ({
      id: f.id,
      title: f.title,
      shortTitle: f.shortTitle,
      version: f.version,
      kind: f.kind,
      authority: f.authority,
      controls: f.controls.length,
      origin: f.origin,
      replaces: f.replaces,
    })),
    /** Problems in the server's own files; the built-in registry is validated in CI. */
    errors: errors.filter((e) => e.file.startsWith(dir)),
    warnings: warnings.filter((e) => e.file.startsWith(dir)),
  };
}

export const validateFramework = (yaml: string, root?: string): FrameworkCheck => checkFramework(yaml, serverRegistry(root).registry);

/**
 * Validate and store a framework in the server's directory. A file with the id of a built-in
 * framework replaces it for every project; the built-in file itself is never changed.
 */
export function saveFramework(yaml: string, opts: { root?: string; expectId?: string } = {}): FrameworkCheck & { file: string } {
  const check = validateFramework(yaml, opts.root);
  if (!check.ok || !check.framework) throw new FrameworkError(check);
  const { id } = check.framework;
  if (opts.expectId && opts.expectId !== id) throw new FrameworkError({ ...check, ok: false, errors: [`The file's id is "${id}", not "${opts.expectId}"`] });
  const file = fileOf(id);
  mkdirSync(customFrameworksDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, yaml.endsWith("\n") ? yaml : `${yaml}\n`);
  renameSync(tmp, file);
  rmSync(join(customFrameworksDir(), `${id}.yml`), { force: true });
  return { ...check, file };
}

/** Remove a framework from the server's directory; a replaced built-in framework comes back. */
export function removeFramework(id: string, root?: string): { restored?: { version: string } } {
  const file = fileOf(id);
  const yml = file.replace(/\.yaml$/, ".yml");
  if (!existsSync(file) && !existsSync(yml)) throw new Error(`"${id}" is not one of this server's frameworks. Built-in frameworks cannot be removed, only replaced.`);
  rmSync(file, { force: true });
  rmSync(yml, { force: true });
  const back = serverRegistry(root).registry.frameworks.find((f) => f.id === id);
  return back ? { restored: { version: back.version } } : {};
}

/** The YAML a framework was loaded from: the starting point for an update. */
export function frameworkSource(id: string, root?: string) {
  const fw = serverRegistry(root).registry.frameworks.find((f) => f.id === id);
  if (!fw) throw new Error(`Unknown framework "${id}"`);
  return { id, origin: fw.origin, yaml: readFileSync(fw.file, "utf8") };
}

/** A starting point for a new framework. */
export const frameworkTemplate = (root = findRegistryRoot()) => readFileSync(join(root, "templates", "framework.yaml"), "utf8");

export class FrameworkError extends Error {
  constructor(readonly check: FrameworkCheck) {
    super(check.errors.length ? `The framework is not valid: ${check.errors.slice(0, 5).join("; ")}` : "The framework is not valid");
  }
}
