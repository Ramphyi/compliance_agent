import { KeyRound, Monitor, Moon, Sun, User } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api, ApiError, onAuthRequired, prefs } from "./api";
import { ErrorBox, Loading, Modal } from "./components/ui";
import { useRoute, useTheme } from "./hooks";
import type { Meta } from "./types";
import { ProjectShell } from "./views/ProjectShell";
import { Projects } from "./views/Projects";

export function App() {
  const route = useRoute();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState(() => prefs.get("user"));
  const [renaming, setRenaming] = useState(false);

  const loadMeta = useCallback(() => {
    api.get<Meta>("api/meta").then(
      (m) => {
        setMeta(m);
        setNeedLogin(false);
        setError(null);
      },
      (e: ApiError) => (e.status === 401 ? setNeedLogin(true) : setError(e.message)),
    );
  }, []);

  useEffect(() => {
    onAuthRequired(() => setNeedLogin(true));
    loadMeta();
    return () => onAuthRequired(null);
  }, [loadMeta]);

  const saveUser = (name: string) => {
    prefs.set("user", name);
    setUser(name);
    setRenaming(false);
    loadMeta();
  };

  // With per-user tokens the server decides who you are; otherwise the reviewer names themselves.
  const namesSelf = meta?.auth !== "users";
  let body: ReactNode;
  if (needLogin) body = <Login onDone={loadMeta} />;
  else if (!meta) body = error ? <div className="page"><ErrorBox error={error} retry={loadMeta} /></div> : <Loading what="Assay" />;
  else if (namesSelf && !user)
    body = (
      <div className="center-card">
        <div className="card">
          <h1>Welcome to Assay</h1>
          <p className="muted">Your name is recorded with every review decision in the audit trail.</p>
          <IdentityForm initial={meta.user} onSave={saveUser} />
        </div>
      </div>
    );
  else if (route.page === "project") body = <ProjectShell key={route.pid} meta={meta} route={route} />;
  else body = <Projects meta={meta} />;

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())}>
        Skip to content
      </a>
      <TopBar user={meta ? (namesSelf ? user ?? "" : meta.user) : ""} onRename={namesSelf && user ? () => setRenaming(true) : undefined} />
      <main id="main" tabIndex={-1}>
        {body}
      </main>
      {renaming && (
        <Modal title="Reviewer name" onClose={() => setRenaming(false)}>
          <IdentityForm initial={user ?? ""} onSave={saveUser} />
        </Modal>
      )}
    </>
  );
}

function TopBar({ user, onRename }: { user: string; onRename?: () => void }) {
  const [theme, cycle] = useTheme();
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="Assay projects">
        <span className="brand-mark" aria-hidden>
          ◆
        </span>
        <span className="brand-name">Assay</span>
        <span className="brand-tag">Compliance audit agent</span>
      </a>
      <span className="grow" />
      {user &&
        (onRename ? (
          <button className="btn btn-ghost btn-sm" onClick={onRename} title="Change reviewer name">
            <User size={14} aria-hidden /> {user}
          </button>
        ) : (
          <span className="muted user-chip">
            <User size={14} aria-hidden /> {user}
          </span>
        ))}
      <button className="icon-btn" onClick={cycle} aria-label={`Theme: ${theme}. Switch theme`} title={`Theme: ${theme}`}>
        <ThemeIcon size={16} />
      </button>
    </header>
  );
}

function IdentityForm({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim());
      }}
    >
      <label className="field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={80} autoComplete="name" />
      </label>
      <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
        Continue
      </button>
    </form>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("api/login", { token });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center-card">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1>
          <KeyRound size={18} aria-hidden /> Sign in
        </h1>
        <p className="muted">This Assay server requires an access token. Ask the person who runs it (ASSAY_TOKEN or ASSAY_TOKENS).</p>
        <label className="field">
          <span>Access token</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus required autoComplete="current-password" />
        </label>
        {error && <ErrorBox error={error} />}
        <button className="btn btn-primary" type="submit" disabled={!token || busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}
