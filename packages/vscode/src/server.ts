import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import * as vscode from "vscode";
import { acaiEnv, stateDirArgs } from "./config";

export type ServerState = "stopped" | "starting" | "running" | "error";

const READY_TIMEOUT_MS = 20_000;

/** Ask the OS for a free loopback port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("Could not find a free port"))));
    });
  });
}

/**
 * Variables inherited from the editor that would change how the local server behaves
 * (authentication, bind address, cloning). The extension always runs it locally, unauthenticated.
 */
const STRIPPED_ENV = ["ACAI_TOKEN", "ACAI_TOKENS", "ACAI_ADMIN_TOKEN", "ACAI_ADMINS", "ACAI_HOST", "ACAI_PORT", "ACAI_TRUST_PROXY", "ACAI_ALLOW_CLONE", "ACAI_DASHBOARD_DIR"];

/**
 * Runs `acai serve <folder>` from the bundled server with the editor's own runtime
 * (process.execPath + ELECTRON_RUN_AS_NODE=1), so no separate Node.js is needed.
 */
export class ServerManager implements vscode.Disposable {
  private child?: ChildProcess;
  private stopping = new WeakSet<ChildProcess>();
  private queue: Promise<unknown> = Promise.resolve();
  private _state: ServerState = "stopped";
  private _url?: string;
  private _port?: number;
  private _error?: string;

  private readonly stateEmitter = new vscode.EventEmitter<ServerState>();
  readonly onDidChangeState = this.stateEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  get state() {
    return this._state;
  }
  get url() {
    return this._state === "running" ? this._url : undefined;
  }
  get port() {
    return this._state === "running" ? this._port : undefined;
  }
  get error() {
    return this._error;
  }

  get serverScript() {
    return vscode.Uri.joinPath(this.context.extensionUri, "server", "acai.mjs").fsPath;
  }

  private setState(s: ServerState) {
    this._state = s;
    this.stateEmitter.fire(s);
  }

  /** Start (or restart) for a folder. Calls are serialized. */
  restart(folder: string | undefined): Promise<void> {
    const run = this.queue.then(async () => {
      await this.stopNow();
      if (folder) await this.startNow(folder);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  stop(): Promise<void> {
    const run = this.queue.then(() => this.stopNow());
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async startNow(folder: string) {
    this._error = undefined;
    this.setState("starting");
    try {
      if (!existsSync(this.serverScript)) throw new Error(`Bundled server not found at ${this.serverScript}. Rebuild the extension.`);
      await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
      const port = await freePort();
      const args = [this.serverScript, "serve", folder, "--port", String(port), "--host", "127.0.0.1", ...stateDirArgs(folder)];
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...(await acaiEnv(this.context.secrets)),
        ELECTRON_RUN_AS_NODE: "1",
        ACAI_HOME: this.context.globalStorageUri.fsPath,
        NO_COLOR: "1",
      };
      for (const k of STRIPPED_ENV) delete env[k];

      this.output.appendLine(`[acai] starting: ${process.execPath} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
      const child = spawn(process.execPath, args, { cwd: folder, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      this.child = child;
      let exited: string | undefined;
      const tail: string[] = [];
      const pipe = (prefix: string) => (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split(/\r?\n/)) {
          if (!line.trim()) continue;
          this.output.appendLine(`${prefix}${line}`);
          tail.push(line);
          if (tail.length > 20) tail.shift();
        }
      };
      child.stdout?.on("data", pipe(""));
      child.stderr?.on("data", pipe("[stderr] "));
      child.on("error", (e) => {
        exited = e.message;
        this.output.appendLine(`[acai] failed to start: ${e.message}`);
      });
      child.on("exit", (code, signal) => {
        exited ??= `exited with ${signal ?? `code ${code}`}`;
        this.output.appendLine(`[acai] server ${exited}`);
        if (this.child !== child) return;
        this.child = undefined;
        // While starting, waitForReady reports the exit; afterwards it is a crash.
        if (this.stopping.has(child) || this._state !== "running") return;
        this._url = undefined;
        this._port = undefined;
        this._error = `Acai server ${exited}`;
        this.setState("error");
      });

      const url = `http://127.0.0.1:${port}`;
      await waitForReady(url, READY_TIMEOUT_MS, () => exited, () => tail.slice(-5).join("\n"));
      this._url = url;
      this._port = port;
      this.output.appendLine(`[acai] ready at ${url}`);
      this.setState("running");
    } catch (e) {
      this._error = (e as Error).message;
      this.output.appendLine(`[acai] ${this._error}`);
      await this.stopNow(false);
      this.setState("error");
      throw e;
    }
  }

  private async stopNow(updateState = true) {
    const child = this.child;
    this.child = undefined;
    this._url = undefined;
    this._port = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      this.stopping.add(child);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill();
      });
    }
    if (updateState && this._state !== "stopped") this.setState("stopped");
  }

  dispose() {
    const child = this.child;
    if (child && child.exitCode === null) {
      this.stopping.add(child);
      child.kill();
    }
    this.stateEmitter.dispose();
  }
}

/** Poll GET /api/meta until the server answers, it exits, or the timeout passes. */
export async function waitForReady(url: string, timeoutMs: number, exited: () => string | undefined, tail: () => string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const why = exited();
    if (why) throw new Error(`Acai server ${why} before it was ready.${tail() ? `\n${tail()}` : ""}`);
    try {
      const res = await fetch(`${url}/api/meta`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Acai server did not become ready within ${timeoutMs / 1000} s.${tail() ? `\n${tail()}` : ""}`);
}
