// HTTP client for the Assay server (packages/cli/src/server.ts) and the shapes it returns.
// The types mirror packages/core/src/types.ts; they are copied, not imported, so the
// extension bundle stays self-contained.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingStatus =
  | "open"
  | "confirmed"
  | "rejected"
  | "reinvestigating"
  | "withdrawn"
  | "fixing"
  | "fix_ready"
  | "fix_failed"
  | "resolved";

export type RejectReason = "false-positive" | "accepted-risk" | "not-applicable" | "duplicate" | "other";

export type ReviewAction = "confirm" | "reject" | "modify" | "reinvestigate" | "reopen" | "accept-fix" | "revert-fix" | "resolve";

export type CodeRef = { path: string; line?: number; endLine?: number; excerpt?: string };

export type Finding = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  category: string;
  kind: string;
  fixability: "code" | "document" | "process";
  controlIds: string[];
  locations: CodeRef[];
  evidence: string;
  recommendation: string;
  confidence: "high" | "medium" | "low";
  source: string;
  status: FindingStatus;
  fixInstructions?: string;
  reinvestigateNote?: string;
  fix?: { summary: string; filesChanged: string[]; commit?: string; branch?: string; error?: string };
  /** Added by the server's findingView. */
  actions?: ReviewAction[];
  controls?: { id: string; framework: string; ref: string; title: string }[];
};

export type Summary = {
  total: number;
  open: number;
  confirmed: number;
  rejected: number;
  reinvestigating: number;
  withdrawn: number;
  fixing: number;
  fixReady: number;
  fixFailed: number;
  resolved: number;
  bySeverity: Record<Severity, number>;
};

export type AuditListItem = { id: string; createdAt: string; phase: string; mode: string; revision?: string; summary: Summary };

export type AuditDetail = {
  id: string;
  createdAt: string;
  updatedAt: string;
  phase: string;
  mode: string;
  model?: string;
  error?: string;
  findings: Finding[];
  summary: Summary;
};

export type ProjectEntry = {
  id: string;
  name: string;
  root: string;
  stateDir?: string;
  classification?: string;
  latest?: { id: string; createdAt: string; phase: string; summary: Summary };
  running?: string;
};

export type Meta = {
  name: string;
  version: string;
  user: string;
  auth: string;
  provider: { id: string; model: string; destination: string; webSearch: boolean } | null;
  registry: { frameworks: number; controls: number; presets: number; hash: string; errors: unknown[] } | null;
};

export type ScopeItem = { frameworkId: string; active: boolean; shortTitle: string; title: string; status: string };

export type JobEvent = { type: string; at: string; stage?: string; message?: string; name?: string; text?: string; query?: string; status?: string; error?: string };

export type Job = {
  id: string;
  kind: string;
  projectId: string;
  auditId?: string;
  findingId?: string;
  title: string;
  status: "running" | "done" | "failed" | "cancelled";
  error?: string;
  events?: JobEvent[];
  result?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** HTTP header values must be visible ASCII: strip accents, then drop anything else. */
export function headerSafe(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, 80);
}

export class AssayClient {
  constructor(
    readonly baseUrl: string,
    private readonly user: () => string,
  ) {}

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: json ? "application/json" : "*/*", "X-Assay-Request": "1" };
    const user = headerSafe(this.user());
    if (user) h["X-Assay-User"] = user;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  private async request(method: string, path: string, body: unknown, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: this.headers(method !== "GET"),
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = e as Error;
      throw new ApiError(err.name === "TimeoutError" ? `Assay server did not answer within ${Math.round(timeoutMs / 1000)} s` : `Assay server unreachable: ${err.message}`, 0);
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const data = (await res.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        // not JSON
      }
      throw new ApiError(message, res.status);
    }
    return res;
  }

  async get<T>(path: string, timeoutMs = 30_000): Promise<T> {
    return (await (await this.request("GET", path, undefined, timeoutMs)).json()) as T;
  }

  async getText(path: string, timeoutMs = 60_000): Promise<string> {
    return (await this.request("GET", path, undefined, timeoutMs)).text();
  }

  async post<T>(path: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
    return (await (await this.request("POST", path, body, timeoutMs)).json()) as T;
  }
}

/**
 * Reads the server-sent event stream with fetch and parses it by hand ("event:" and "data:"
 * lines, blank line ends an event). Reconnects with exponential backoff until disposed.
 */
export class EventStream {
  private ctrl?: AbortController;
  private disposed = false;

  constructor(
    private readonly url: string,
    private readonly onEvent: (type: string, data: unknown) => void,
    private readonly log: (line: string) => void,
  ) {
    void this.loop();
  }

  dispose() {
    this.disposed = true;
    this.ctrl?.abort();
  }

  private async loop() {
    let delay = 1000;
    while (!this.disposed) {
      try {
        this.ctrl = new AbortController();
        const res = await fetch(this.url, { headers: { Accept: "text/event-stream" }, signal: this.ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        delay = 1000;
        await this.read(res.body);
        if (!this.disposed) this.log("event stream closed by the server; reconnecting");
      } catch (e) {
        if (this.disposed) return;
        this.log(`event stream error: ${(e as Error).message}; retrying in ${delay / 1000} s`);
      }
      if (this.disposed) return;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }

  private async read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event = "message";
    let data: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          if (data.length) this.dispatch(event, data.join("\n"));
          event = "message";
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue; // comment / keep-alive ping
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
    }
  }

  private dispatch(type: string, raw: string) {
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // keep raw text
    }
    try {
      this.onEvent(type, data);
    } catch (e) {
      this.log(`event handler failed: ${(e as Error).message}`);
    }
  }
}
