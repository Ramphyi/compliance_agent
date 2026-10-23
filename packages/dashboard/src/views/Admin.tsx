import { MoreHorizontal, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api, paths } from "../api";
import { NewTokenDialog, TokenExpiry, envToken, lastUsed, shortDate, tokenHint } from "../components/tokens";
import { ConfirmDialog, ErrorBox, Loading, Menu, Modal, PageHeader, SectionHead, TokenReveal } from "../components/ui";
import { useToast } from "../context";
import { type AdminTab, ago, fmtTime, useResource } from "../hooks";
import type { AccountRef, AuthEvent, Role, ServerInfo, TokenInfo, UserInfo } from "../types";
import { ROLE_HELP, ROLE_LABELS } from "./Account";

const TAB_LABELS: Record<AdminTab, string> = { users: "Users", tokens: "Tokens", activity: "Activity", server: "Server" };
const ROLES: Role[] = ["admin", "member", "viewer"];

/** `me` is null in local mode, where the person at this machine acts as administrator. */
export function AdminView({ tab, me, onMetaChanged }: { tab: AdminTab; me: AccountRef | null; onMetaChanged: () => void }) {
  return (
    <div className="page">
      <PageHeader title="Admin" />
      <nav className="subtabs" aria-label="Admin sections">
        {(Object.keys(TAB_LABELS) as AdminTab[]).map((t) => (
          <a key={t} href={`#/admin/${t}`} aria-current={t === tab ? "page" : undefined}>
            {TAB_LABELS[t]}
          </a>
        ))}
      </nav>
      {tab === "users" && <Users me={me} onMetaChanged={onMetaChanged} />}
      {tab === "tokens" && <Tokens />}
      {tab === "activity" && <Activity />}
      {tab === "server" && <Server />}
    </div>
  );
}

// ------------------------------------------------------------------ users
type Dialog =
  | { kind: "create" }
  | { kind: "token"; user: UserInfo }
  | { kind: "signout"; user: UserInfo }
  | { kind: "disable"; user: UserInfo }
  | { kind: "delete"; user: UserInfo };

function Users({ me, onMetaChanged }: { me: AccountRef | null; onMetaChanged: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useResource<UserInfo[]>("api/admin/users");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setDialog(null);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const patch = (u: UserInfo, body: Partial<Pick<UserInfo, "name" | "role" | "disabled">>, ok: string) => run(() => api.patch(paths.adminUser(u.id), body), ok);

  return (
    <section aria-labelledby="users-h">
      <SectionHead
        id="users-h"
        title={data ? `${data.length} ${data.length === 1 ? "user" : "users"}` : "Users"}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: "create" })}>
            New user
          </button>
        }
      />
      {!me && (
        <div className="callout callout-warn">
          <TriangleAlert size={16} aria-hidden />
          <span>
            Local mode: no accounts yet, so anyone on this machine acts as administrator. The first user you create turns on sign-in for everyone. Make it an admin and keep
            its token: you need it to sign in.
          </span>
        </div>
      )}
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="users" />
      ) : (
        <div className="table-wrap">
          <table className="table middle">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last seen</th>
                <th className="num">Tokens</th>
                <th className="num">Sessions</th>
                <th>Source</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => {
                const env = u.source === "env";
                const self = u.id === me?.id;
                return (
                  <tr key={u.id} className={u.disabled ? "dim" : undefined}>
                    <td>
                      <span className="strong">{u.name}</span>
                      {self && <span className="muted"> (you)</span>}
                    </td>
                    <td>
                      {env || self ? (
                        <span title={env ? "Defined in the server environment" : "You can't change your own role"}>{ROLE_LABELS[u.role] ?? u.role}</span>
                      ) : (
                        <select aria-label={`Role of ${u.name}`} value={u.role} disabled={busy} onChange={(e) => patch(u, { role: e.target.value as Role }, `${u.name} is now ${ROLE_LABELS[e.target.value as Role].toLowerCase()}.`)}>
                          {ROLES.map((r) => (
                            <option key={r} value={r} title={ROLE_HELP[r]}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <span className={`status ${u.disabled ? "st-withdrawn" : "st-resolved"}`}>
                        <i aria-hidden />
                        {u.disabled ? "Disabled" : "Active"}
                      </span>
                    </td>
                    <td className="nowrap">{u.lastSeenAt ? <span title={fmtTime(u.lastSeenAt)}>{ago(u.lastSeenAt)}</span> : <span className="muted">Never</span>}</td>
                    <td className="num">{u.tokens}</td>
                    <td className="num">{u.sessions}</td>
                    <td className="nowrap">{env ? <span className="row-note">Server environment</span> : "Local"}</td>
                    <td className="actions-cell">
                      {env ? (
                        <span className="row-note" title="Change it in the server environment and restart">
                          Read-only
                        </span>
                      ) : (
                        <Menu label={`Actions for ${u.name}`} button={<MoreHorizontal size={16} />}>
                          <button role="menuitem" type="button" onClick={() => setDialog({ kind: "token", user: u })}>
                            Issue token…
                          </button>
                          <button role="menuitem" type="button" onClick={() => setDialog({ kind: "signout", user: u })}>
                            Sign out everywhere…
                          </button>
                          {u.disabled ? (
                            <button role="menuitem" type="button" onClick={() => patch(u, { disabled: false }, `${u.name} enabled.`)}>
                              Enable
                            </button>
                          ) : (
                            <button role="menuitem" type="button" onClick={() => setDialog({ kind: "disable", user: u })} disabled={self}>
                              Disable…
                            </button>
                          )}
                          <div className="menu-sep" role="separator" />
                          <button role="menuitem" type="button" className="danger" onClick={() => setDialog({ kind: "delete", user: u })} disabled={self}>
                            Delete…
                          </button>
                        </Menu>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!data.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {data.some((u) => u.source === "env") && <p className="row-note">Users from the server environment are read-only here. Change them in the environment and restart the server.</p>}
        </div>
      )}

      {dialog?.kind === "create" && (
        <CreateUser
          first={!me}
          onClose={() => {
            setDialog(null);
            // The first account turns on sign-in: reload the session so the sign-in page appears.
            if (!me) onMetaChanged();
          }}
          onCreated={reload}
        />
      )}
      {dialog?.kind === "token" && (
        <NewTokenDialog
          title={`Issue token for ${dialog.user.name}`}
          path={paths.adminUser(dialog.user.id, "/tokens")}
          intro="Give it to them over a private channel."
          onClose={() => setDialog(null)}
          onCreated={reload}
        />
      )}
      {dialog?.kind === "signout" && (
        <ConfirmDialog
          title={`Sign out ${dialog.user.name}`}
          confirmLabel="Sign out everywhere"
          busy={busy}
          onConfirm={() => run(() => api.post(paths.adminUser(dialog.user.id, "/signout")), `${dialog.user.name} signed out everywhere.`)}
          onClose={() => setDialog(null)}
        >
          <p>Ends their {dialog.user.sessions} browser session(s) and ChatGPT or Claude.ai connector sign-ins. Their API tokens keep working.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "disable" && (
        <ConfirmDialog
          title={`Disable ${dialog.user.name}`}
          confirmLabel="Disable"
          danger
          busy={busy}
          onConfirm={() => patch(dialog.user, { disabled: true }, `${dialog.user.name} disabled.`)}
          onClose={() => setDialog(null)}
        >
          <p>They can't sign in or use their tokens until you enable the account again.</p>
        </ConfirmDialog>
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.user.name}`}
          confirmLabel="Delete user"
          danger
          busy={busy}
          onConfirm={() => run(() => api.del(paths.adminUser(dialog.user.id)), `${dialog.user.name} deleted.`)}
          onClose={() => setDialog(null)}
        >
          <p>Deletes the account and revokes its {dialog.user.tokens} token(s). Their past decisions stay in the audit trail.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function CreateUser({ first, onClose, onCreated }: { first: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(first ? "admin" : "member");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ user: UserInfo; token: string } | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ user: UserInfo; token: string }>("api/admin/users", { name: name.trim(), role });
      setCreated(r);
      onCreated();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <Modal
        title={`${created.user.name} created`}
        onClose={onClose}
        footer={
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <p>{first ? "Sign-in is now on. Sign in with this token after you close this dialog." : "Send them this token over a private channel. They sign in with it."}</p>
        <TokenReveal token={created.token} />
      </Modal>
    );

  return (
    <Modal
      title="New user"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create user"}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoComplete="off" data-autofocus />
        <span className="hint">Shown in the audit trail next to every decision they make.</span>
      </label>
      <fieldset className="field">
        <span>Role</span>
        {ROLES.map((r) => (
          <label key={r} className="check" style={{ margin: "2px 0" }}>
            <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
            <span>
              {ROLE_LABELS[r]} <span className="muted">· {ROLE_HELP[r]}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

// ------------------------------------------------------------------ tokens
function Tokens() {
  const toast = useToast();
  const { data, error, reload } = useResource<TokenInfo[]>("api/admin/tokens");
  const [revoking, setRevoking] = useState<TokenInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.del(paths.adminToken(revoking.id));
      toast.success(`Revoked “${revoking.label}” of ${revoking.userName}.`);
      setRevoking(null);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Tokens">
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="tokens" />
      ) : !data.length ? (
        <p className="muted">No API tokens.</p>
      ) : (
        <div className="table-wrap">
          <table className="table middle">
            <thead>
              <tr>
                <th>User</th>
                <th>Label</th>
                <th>Token</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Expires</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td className="strong">{t.userName}</td>
                  <td>{t.label}</td>
                  <td className="mono muted">{tokenHint(t)}</td>
                  <td>{shortDate(t.createdAt)}</td>
                  <td>{lastUsed(t.lastUsedAt)}</td>
                  <td>
                    <TokenExpiry info={t} />
                  </td>
                  <td className="actions-cell">
                    {envToken(t) ? (
                      <span className="row-note" title="Defined in the server environment">
                        Server environment
                      </span>
                    ) : (
                      <button className="btn btn-sm btn-danger" onClick={() => setRevoking(t)} aria-label={`Revoke ${t.label} of ${t.userName}`}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoking && (
        <ConfirmDialog title="Revoke token" confirmLabel="Revoke" danger busy={busy} onConfirm={revoke} onClose={() => setRevoking(null)}>
          <p>
            <strong>{revoking.label}</strong> of {revoking.userName} (<span className="mono">{tokenHint(revoking)}</span>) stops working immediately.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ activity
function Activity() {
  const { data, error, reload } = useResource<AuthEvent[]>("api/admin/events");
  return (
    <section aria-label="Sign-in and account activity">
      <div className="section-head">
        <p className="desc grow">Sign-ins, token and account changes, newest first.</p>
        <button className="btn btn-sm" onClick={reload}>
          Refresh
        </button>
      </div>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="activity" />
      ) : !data.length ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table middle">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e, i) => (
                <tr key={i}>
                  <td className="nowrap" title={fmtTime(e.at)}>
                    {ago(e.at)}
                  </td>
                  <td>{e.actor}</td>
                  <td className="mono small">{e.action}</td>
                  <td>{e.target ?? ""}</td>
                  <td className="mono small muted">{e.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ server
function uptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

const onOff = (v: boolean, on = "On", off = "Off") => (v ? on : <span className="muted">{off}</span>);
const list = (xs: string[] | undefined, none: string) =>
  xs?.length ? (
    <span className="break">
      {xs.map((x, i) => (
        <span key={x}>
          {i > 0 && ", "}
          <code>{x}</code>
        </span>
      ))}
    </span>
  ) : (
    <span className="muted">{none}</span>
  );

function Server() {
  const { data, error, reload } = useResource<ServerInfo>("api/admin/server");
  const rows: [string, ReactNode][] = data
    ? [
        ["Version", data.version],
        ["Uptime", uptime(data.uptimeSec)],
        ["Node.js", data.node],
        ["Sign-in", data.authMode === "tokens" ? "Access tokens" : data.authMode === "none" ? "None (this machine only)" : data.authMode],
        ["Public URL", data.publicUrl ? <code className="break">{data.publicUrl}</code> : <span className="muted">Not set</span>],
        ["OAuth for ChatGPT and Claude.ai", onOff(data.oauth)],
        ["Behind a reverse proxy", onOff(data.trustProxy, "Yes", "No")],
        ["Webhook secret", onOff(data.webhookSecret, "Set", "Not set")],
        ["GitHub token", onOff(data.githubToken, "Set", "Not set")],
        ["Clone from a URL", onOff(data.allowClone, "Allowed", "Not allowed")],
        ["Project roots", list(data.projectRoots, "Not set")],
        ["Approvers", list(data.approvers, "Not set")],
        ...(data.admins ? ([["Admins from the environment", list(data.admins, "None")]] as [string, ReactNode][]) : []),
        ["Data directory", <code className="break">{data.dataDir}</code>],
        ["Model", data.provider ? `${data.provider.model} (${data.provider.id})` : <span className="muted">None</span>],
        ["Projects", data.projects],
      ]
    : [];
  return (
    <section aria-label="Server">
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="server settings" />
      ) : (
        <div className="page-narrow" style={{ margin: 0 }}>
          <dl className="kv">
            {rows.map(([k, v]) => (
              <Row key={k} k={k} v={v} />
            ))}
          </dl>
          <p className="muted small" style={{ marginTop: 16 }}>
            Read-only. Settings come from the server environment. On-prem deployment: see <code>docs/DEPLOY.md</code>.
          </p>
        </div>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
