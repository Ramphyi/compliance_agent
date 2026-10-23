import { createInterface, type Interface } from "node:readline/promises";

const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (open: number, close: number) => (s: string) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  teal: (s: string) => (enabled ? `\x1b[38;5;30m${s}\x1b[39m` : s),
  violet: (s: string) => (enabled ? `\x1b[38;5;98m${s}\x1b[39m` : s),
};

export const sev = (s: string) =>
  s === "critical" ? c.red(c.bold(s)) : s === "high" ? c.red(s) : s === "medium" ? c.yellow(s) : s === "low" ? c.blue(s) : c.dim(s);

export const logo = () => `${c.teal(c.bold("◆ Acai"))} ${c.dim("compliance audit agent")}`;

export class Prompter {
  private rl?: Interface;
  constructor(private readonly assumeYes = false) {}

  private get io() {
    this.rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return this.rl;
  }

  close() {
    this.rl?.close();
  }

  async ask(question: string, fallback = ""): Promise<string> {
    if (this.assumeYes || !process.stdin.isTTY) return fallback;
    const a = (await this.io.question(`${c.violet("?")} ${question}${fallback ? c.dim(` [${fallback}]`) : ""} `)).trim();
    return a || fallback;
  }

  async yes(question: string, fallback = true): Promise<boolean> {
    if (this.assumeYes || !process.stdin.isTTY) return fallback;
    const a = (await this.io.question(`${c.violet("?")} ${question} ${c.dim(fallback ? "[Y/n]" : "[y/N]")} `)).trim().toLowerCase();
    return a ? a.startsWith("y") || a.startsWith("d") : fallback;
  }

  /** Choose one key from a menu; returns the key. */
  async choose(question: string, options: [key: string, label: string][], fallback: string): Promise<string> {
    if (this.assumeYes || !process.stdin.isTTY) return fallback;
    for (;;) {
      const a = (await this.io.question(`${c.violet("?")} ${question} ${options.map(([k, l]) => `${c.bold(`[${k}]`)}${l}`).join("  ")} `)).trim().toLowerCase();
      const pick = a || fallback;
      if (options.some(([k]) => k === pick)) return pick;
    }
  }
}

export function table(rows: string[][]) {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => strip(r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((cell, i) => cell + " ".repeat(Math.max(0, widths[i] - strip(cell).length))).join("  ")).join("\n");
}
