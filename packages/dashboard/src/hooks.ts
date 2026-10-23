import { useCallback, useEffect, useState } from "react";
import { api, prefs } from "./api";

// ------------------------------------------------------------------ routing
// Hash routes (#/, #/guide[/<section>], #/connect[/<pid>], #/model, #/account, #/admin[/<tab>] and #/p/<pid>/<tab>[/<id>]) work from file paths, path prefixes and iframes.

export const TABS = ["overview", "profile", "scope", "findings", "fixes", "controls", "research", "activity", "settings"] as const;
export type Tab = (typeof TABS)[number];
export const ADMIN_TABS = ["users", "tokens", "frameworks", "activity", "server"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];
export type Route =
  | { page: "projects" }
  | { page: "model" }
  | { page: "account" }
  | { page: "admin"; tab: AdminTab }
  | { page: "guide"; section?: string }
  | { page: "connect"; pid?: string }
  | { page: "project"; pid: string; tab: Tab; id?: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "connect") return { page: "connect", pid: parts[1] };
  if (parts[0] === "guide") return { page: "guide", section: parts[1] };
  if (parts[0] === "model") return { page: "model" };
  if (parts[0] === "account") return { page: "account" };
  if (parts[0] === "admin") return { page: "admin", tab: (ADMIN_TABS as readonly string[]).includes(parts[1]) ? (parts[1] as AdminTab) : "users" };
  if (parts[0] === "p" && parts[1]) {
    const tab = (TABS as readonly string[]).includes(parts[2]) ? (parts[2] as Tab) : "overview";
    return { page: "project", pid: parts[1], tab, id: parts.slice(3).join("/") || undefined };
  }
  return { page: "projects" };
}

export const href = (pid: string, tab: Tab, id?: string) =>
  `#/p/${encodeURIComponent(pid)}/${tab}${id ? `/${encodeURIComponent(id)}` : ""}`;

export function go(hash: string, replace = false) {
  if (window.location.hash === hash) return;
  if (replace) {
    history.replaceState(null, "", hash);
    window.dispatchEvent(new Event("acai:route"));
  } else window.location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    window.addEventListener("acai:route", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("acai:route", on);
    };
  }, []);
  return route;
}

// ------------------------------------------------------------------ data
/**
 * GET a resource and refetch when `version` changes (live updates) without clearing
 * what is on screen. Pass `null` to skip.
 */
export function useResource<T>(path: string | null, version = 0) {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: string; loading: boolean }>({ path, loading: Boolean(path) });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return setState({ path, loading: false });
    let live = true;
    setState((s) => (s.path === path ? { ...s, loading: true } : { path, loading: true }));
    api.get<T>(path).then(
      (data) => live && setState({ path, data, loading: false }),
      (e: Error) => live && setState((s) => ({ path, data: s.path === path ? s.data : undefined, error: e.message, loading: false })),
    );
    return () => {
      live = false;
    };
  }, [path, version, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const same = state.path === path;
  return { data: same ? state.data : undefined, error: same ? state.error : undefined, loading: !same || state.loading, reload };
}

// ------------------------------------------------------------------ theme
export type ThemePref = "system" | "light" | "dark";

export function applyTheme(t: ThemePref) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export const storedTheme = (): ThemePref => {
  const t = prefs.get("theme");
  return t === "light" || t === "dark" ? t : "system";
};

export function useTheme(): [ThemePref, () => void] {
  const [theme, setTheme] = useState<ThemePref>(storedTheme);
  const cycle = useCallback(() => {
    setTheme((t) => {
      const next: ThemePref = t === "system" ? "light" : t === "light" ? "dark" : "system";
      prefs.set("theme", next === "system" ? null : next);
      applyTheme(next);
      return next;
    });
  }, []);
  return [theme, cycle];
}

// ------------------------------------------------------------------ formatting
export function ago(iso?: string) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");
export const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
export const loc = (r?: { path: string; line?: number }) => (r ? `${r.path}${r.line ? `:${r.line}` : ""}` : "");
