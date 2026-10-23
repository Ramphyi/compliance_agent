import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { z } from "zod";
import { isSensitivePath, redactSecrets } from "../scan/walk";
import { tool, type AgentTool } from "./provider";

const MAX_LINES = 400;

/** Resolve a model-supplied path and refuse anything outside the project or inside VCS/state dirs. */
export function confine(root: string, p: string, stateDir: string): { abs: string; rel: string } {
  if (!p || p.includes("\0")) throw new Error("Invalid path");
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Path is outside the project");
  const posix = rel.split(sep).join("/");
  if (/^(\.git|\.hg|\.svn)(\/|$)/.test(posix)) throw new Error("Version-control internals are off limits");
  const stateRel = relative(root, stateDir).split(sep).join("/");
  if (stateRel && !stateRel.startsWith("..") && (posix === stateRel || posix.startsWith(stateRel + "/"))) throw new Error("Acai state is off limits");
  if (existsSync(abs)) {
    if (lstatSync(abs).isSymbolicLink()) throw new Error("Symbolic links are not followed");
    const real = realpathSync(abs);
    const realRoot = realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error("Path resolves outside the project");
  }
  return { abs, rel: posix };
}

export type ToolContext = {
  root: string;
  stateDir: string;
  /** Known file paths (from the scan), extended with files the agent creates. */
  paths: string[];
  /** Paths changed by write tools during this run. */
  changed: Set<string>;
};

export function readTools(ctx: ToolContext): AgentTool<any>[] {
  return [
    tool({
      name: "list_files",
      description: "List repository files, optionally filtered by a glob (for example 'src/**/*.c' or '**/AndroidManifest.xml'). Returns at most `limit` paths.",
      schema: z.object({ glob: z.string().optional(), limit: z.number().int().min(1).max(1000).optional() }),
      run: ({ glob, limit }) => {
        const match = glob ? picomatch(glob, { dot: true }) : () => true;
        const found = ctx.paths.filter((p) => match(p));
        const max = limit ?? 300;
        return found.slice(0, max).join("\n") + (found.length > max ? `\n... ${found.length - max} more` : "") || "(no files match)";
      },
    }),
    tool({
      name: "read_file",
      description: `Read a text file with line numbers. Reads at most ${MAX_LINES} lines per call; use start_line to page. Secrets are redacted.`,
      schema: z.object({ path: z.string(), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() }),
      run: ({ path, start_line, end_line }) => {
        const { abs, rel } = confine(ctx.root, path, ctx.stateDir);
        if (isSensitivePath(rel)) return "This file may contain credentials and is not shown to the model. Report its presence if it is committed.";
        const lines = readFileSync(abs, "utf8").split(/\r?\n/);
        const start = Math.max(1, start_line ?? 1);
        const end = Math.min(lines.length, end_line ?? start + MAX_LINES - 1, start + MAX_LINES - 1);
        const body = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(5)}| ${l}`).join("\n");
        return `${rel} (lines ${start}-${end} of ${lines.length})\n${redactSecrets(body)}`;
      },
    }),
    tool({
      name: "search",
      description: "Search file contents with a JavaScript regular expression (case-insensitive). Optional glob restricts files. Returns path:line: text matches.",
      schema: z.object({ pattern: z.string().min(1), glob: z.string().optional(), max_results: z.number().int().min(1).max(200).optional() }),
      run: ({ pattern, glob, max_results }) => {
        let re: RegExp;
        try {
          re = new RegExp(pattern, "i");
        } catch (e) {
          throw new Error(`Invalid regex: ${(e as Error).message}`);
        }
        const match = glob ? picomatch(glob, { dot: true }) : () => true;
        const max = max_results ?? 60;
        const out: string[] = [];
        for (const p of ctx.paths) {
          if (out.length >= max) break;
          if (!match(p) || isSensitivePath(p)) continue;
          let text: string;
          try {
            const { abs } = confine(ctx.root, p, ctx.stateDir);
            if (lstatSync(abs).size > 768 * 1024) continue;
            text = readFileSync(abs, "utf8");
          } catch {
            continue;
          }
          if (text.includes("\0")) continue;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length && out.length < max; i++)
            if (lines[i].length < 2000 && re.test(lines[i])) out.push(`${p}:${i + 1}: ${redactSecrets(lines[i].trim()).slice(0, 200)}`);
        }
        return out.join("\n") || "(no matches)";
      },
    }),
  ];
}

export function writeTools(ctx: ToolContext): AgentTool<any>[] {
  const touch = (rel: string) => {
    ctx.changed.add(rel);
    if (!ctx.paths.includes(rel)) ctx.paths.push(rel);
  };
  return [
    tool({
      name: "edit_file",
      description: "Replace an exact string in a file. old_string must match exactly once unless replace_all is true. Prefer small, targeted edits.",
      schema: z.object({ path: z.string(), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().optional() }),
      run: ({ path, old_string, new_string, replace_all }) => {
        const { abs, rel } = confine(ctx.root, path, ctx.stateDir);
        if (isSensitivePath(rel)) throw new Error("Refusing to edit a credentials file");
        const text = readFileSync(abs, "utf8");
        const count = text.split(old_string).length - 1;
        if (count === 0) throw new Error("old_string not found. Read the file again and copy the exact text, including whitespace.");
        if (count > 1 && !replace_all) throw new Error(`old_string matches ${count} times; add surrounding context or set replace_all.`);
        writeFileSync(abs, replace_all ? text.split(old_string).join(new_string) : text.replace(old_string, () => new_string));
        touch(rel);
        return `Edited ${rel} (${replace_all ? count : 1} replacement${count > 1 && replace_all ? "s" : ""}).`;
      },
    }),
    tool({
      name: "write_file",
      description: "Create a new file or overwrite a whole file. Use for new files (tests, documents, configuration); prefer edit_file for existing code.",
      schema: z.object({ path: z.string(), content: z.string() }),
      run: ({ path, content }) => {
        const { abs, rel } = confine(ctx.root, path, ctx.stateDir);
        if (isSensitivePath(rel)) throw new Error("Refusing to write a credentials file");
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
        touch(rel);
        return `Wrote ${rel} (${content.split("\n").length} lines).`;
      },
    }),
  ];
}

export function joinPath(root: string, rel: string) {
  return join(root, rel);
}
