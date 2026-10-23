// HTTP client for the Acai server. Every URL is relative so the dashboard works under
// any path prefix and inside the VS Code webview iframe.

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** localStorage can throw in sandboxed iframes; never let that break the UI. */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`acai.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) localStorage.removeItem(`acai.${key}`);
      else localStorage.setItem(`acai.${key}`, value);
    } catch {
      /* ignore */
    }
  },
};

/** HTTP header values must be ISO-8859-1; strip accents and replace anything else. */
export function headerSafe(name: string) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e\xa0-\xff]/g, "?").trim().slice(0, 80);
}

let onAuth: (() => void) | null = null;
/** Called when the server answers 401: the UI switches to the sign-in screen. */
export function onAuthRequired(fn: (() => void) | null) {
  onAuth = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const user = prefs.get("user");
  if (user) headers["X-Acai-User"] = headerSafe(user);
  if (method !== "GET") {
    headers["X-Acai-Request"] = "1";
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  } catch {
    throw new ApiError("Cannot reach the Acai server. Is `acai serve` running?", 0);
  }
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && onAuth) onAuth();
    const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T = { ok: true }>(path: string, body: unknown = {}) => request<T>("PATCH", path, body),
  del: <T = { ok: true }>(path: string) => request<T>("DELETE", path),
};

const enc = encodeURIComponent;
export const paths = {
  project: (pid: string, rest = "") => `api/projects/${enc(pid)}${rest}`,
  audit: (pid: string, aid: string, rest = "") => `api/projects/${enc(pid)}/audits/${enc(aid)}${rest}`,
  finding: (pid: string, aid: string, fid: string, rest = "") => `api/projects/${enc(pid)}/audits/${enc(aid)}/findings/${enc(fid)}${rest}`,
  file: (pid: string, path: string, from: number, to: number) => `api/projects/${enc(pid)}/file?path=${enc(path)}&from=${from}&to=${to}`,
  framework: (id: string) => `api/registry/frameworks/${enc(id)}`,
  jobs: (pid: string) => `api/jobs?project=${enc(pid)}`,
  job: (id: string) => `api/jobs/${enc(id)}`,
  events: (pid: string) => `api/events?project=${enc(pid)}`,
  adminUser: (id: string, rest = "") => `api/admin/users/${enc(id)}${rest}`,
  adminToken: (id: string) => `api/admin/tokens/${enc(id)}`,
  adminFramework: (id: string, rest = "") => `api/admin/frameworks/${enc(id)}${rest}`,
  accountToken: (id: string) => `api/account/tokens/${enc(id)}`,
};

/** Absolute URL of a server path, resolved against the page (for copyable MCP snippets). */
export const absolute = (path: string) => new URL(path, window.location.href.split("#")[0]).href;
