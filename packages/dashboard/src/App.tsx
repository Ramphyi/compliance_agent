import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api, ApiError, onAuthRequired, prefs } from "./api";
import { Logo } from "./components/Logo";
import { ErrorBox, Loading, Menu, Modal, PageHeader } from "./components/ui";
import { useToast } from "./context";
import { type Route, useRoute, useTheme } from "./hooks";
import type { AccountRef, Meta } from "./types";
import { AccountView } from "./views/Account";
import { AdminView } from "./views/Admin";
import { ConnectView } from "./views/Connect";
import { GuideView } from "./views/Guide";
import { ModelView } from "./views/Model";
import { ProjectShell } from "./views/ProjectShell";
import { Projects } from "./views/Projects";

export function App() {
  const route = useRoute();
  const toast = useToast();
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

  const signOut = async () => {
    try {
      await api.post("api/logout");
    } catch (e) {
      toast.error(e);
    }
    setMeta(null);
    loadMeta();
  };

  // "tokens": the server knows who you are. "none": local single-user mode, you name yourself once.
  const accounts = meta ? meta.auth !== "none" : false;
  const account = accounts ? meta?.account ?? null : null;

  if (needLogin || (meta && accounts && !account)) return <SignIn onDone={loadMeta} />;

  let body: ReactNode;
  if (!meta) body = error ? <div className="page"><ErrorBox error={error} retry={loadMeta} /></div> : <Loading what="Acai" />;
  else if (!accounts && !user) body = <NameYourself initial={meta.user} onSave={saveUser} />;
  else body = <Page route={route} meta={meta} account={account} onMetaChanged={loadMeta} onSignOut={signOut} />;

  const ready = Boolean(meta && (accounts || user));
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())}>
        Skip to content
      </a>
      <TopBar
        route={route}
        ready={ready}
        account={account}
        localName={!accounts ? user ?? "" : ""}
        onRename={() => setRenaming(true)}
        onSignOut={signOut}
      />
      <main id="main" tabIndex={-1}>
        {body}
      </main>
      {renaming && (
        <Modal title="Change name" onClose={() => setRenaming(false)}>
          <IdentityForm initial={user ?? ""} onSave={saveUser} />
        </Modal>
      )}
    </>
  );
}

function Page({ route, meta, account, onMetaChanged, onSignOut }: { route: Route; meta: Meta; account: AccountRef | null; onMetaChanged: () => void; onSignOut: () => void }) {
  switch (route.page) {
    case "project":
      return <ProjectShell key={route.pid} meta={meta} route={route} />;
    case "connect":
      return <ConnectView pid={route.pid} />;
    case "guide":
      return <GuideView meta={meta} section={route.section} />;
    case "model":
      return <ModelView onChanged={onMetaChanged} readOnly={account?.role === "viewer"} />;
    case "account":
      return account ? (
        <AccountView onSignOut={onSignOut} />
      ) : (
        <Notice title="Account">
          Accounts are off: this server runs in local mode. Create users under <a href="#/admin">Admin</a> to turn on sign-in.
        </Notice>
      );
    case "admin":
      // In local mode (no accounts) the person at this machine acts as administrator.
      if (account && account.role !== "admin") return <Notice title="Admin">You need the admin role to open this page.</Notice>;
      return <AdminView tab={route.tab} me={account} onMetaChanged={onMetaChanged} />;
    default:
      return <Projects meta={meta} />;
  }
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page page-narrow">
      <PageHeader title={title} />
      <p className="muted">{children}</p>
    </div>
  );
}

const ROLE_LABEL = { admin: "Admin", member: "Member", viewer: "Viewer" } as const;

function TopBar(props: { route: Route; ready: boolean; account: AccountRef | null; localName: string; onRename: () => void; onSignOut: () => void }) {
  const { route, ready, account, localName } = props;
  const [theme, cycle] = useTheme();
  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const current = (page: Route["page"] | Route["page"][]) => ((Array.isArray(page) ? page : [page]).includes(route.page) ? "page" : undefined);
  const name = account?.name ?? localName;
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="Acai, projects">
        <Logo size={26} animated />
        <span className="brand-name">acai</span>
      </a>
      {ready && (
        <nav className="nav" aria-label="Main">
          <a href="#/" aria-current={current(["projects", "project"])}>
            Projects
          </a>
          <a href="#/guide" aria-current={current("guide")}>
            Guide
          </a>
          <a href={route.page === "project" ? `#/connect/${encodeURIComponent(route.pid)}` : "#/connect"} aria-current={current("connect")}>
            Connect
          </a>
          <a href="#/model" aria-current={current("model")}>
            Model
          </a>
          {(!account || account.role === "admin") && (
            <a href="#/admin" aria-current={current("admin")}>
              Admin
            </a>
          )}
        </nav>
      )}
      <div className="topbar-end">
        {ready && name && (
          <Menu
            label={`Account: ${name}`}
            buttonClass="account-btn"
            button={
              <>
                <span className="avatar" aria-hidden>
                  {name.trim().charAt(0)}
                </span>
                <span className="truncate">{name}</span>
                <ChevronDown size={14} aria-hidden />
              </>
            }
            header={
              <>
                <strong className="truncate">{name}</strong>
                <span className="muted small">{account ? ROLE_LABEL[account.role] ?? account.role : "Local mode"}</span>
              </>
            }
          >
            {account ? (
              <>
                <a role="menuitem" href="#/account">
                  Account and tokens
                </a>
                <div className="menu-sep" role="separator" />
                <button role="menuitem" type="button" onClick={props.onSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <button role="menuitem" type="button" onClick={props.onRename}>
                Change name
              </button>
            )}
          </Menu>
        )}
        <button className="icon-btn" onClick={cycle} aria-label={`Theme: ${theme}. Switch theme`} title={`Theme: ${theme}`}>
          <ThemeIcon size={16} />
        </button>
      </div>
    </header>
  );
}

function NameYourself({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  return (
    <div className="center">
      <div className="signin">
        <Logo size={72} animated />
        <h1>Your name</h1>
        <p className="hint">Recorded with each review decision.</p>
        <IdentityForm initial={initial} onSave={onSave} />
      </div>
    </div>
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
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={80} autoComplete="name" data-autofocus />
      </label>
      <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
        Continue
      </button>
    </form>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("api/login", { token: token.trim() });
      onDone();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? "That token is not valid, or it has expired."
          : e instanceof ApiError && e.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main id="main" className="center" tabIndex={-1}>
      <form
        className="signin"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Logo size={88} animated />
        <h1>Sign in to Acai</h1>
        <label className="field">
          <span>Access token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoFocus
            required
            autoComplete="current-password"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "signin-error" : undefined}
          />
        </label>
        {error && (
          <p id="signin-error" className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={!token.trim() || busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="hint">Ask an administrator for an access token.</p>
      </form>
    </main>
  );
}
