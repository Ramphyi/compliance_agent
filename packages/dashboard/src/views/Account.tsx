import { useState } from "react";
import { api, paths } from "../api";
import { NewTokenDialog, TokenExpiry, envToken, lastUsed, shortDate, tokenHint } from "../components/tokens";
import { ConfirmDialog, ErrorBox, Loading, PageHeader, SectionHead } from "../components/ui";
import { useToast } from "../context";
import { ago, useResource } from "../hooks";
import type { AccountInfo, TokenInfo } from "../types";

export const ROLE_LABELS = { admin: "Admin", member: "Member", viewer: "Viewer" } as const;
export const ROLE_HELP = {
  admin: "Manages users and server settings",
  member: "Runs audits and reviews findings",
  viewer: "Read-only",
} as const;

export function AccountView({ onSignOut }: { onSignOut: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useResource<AccountInfo>("api/account");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<TokenInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.del(paths.accountToken(revoking.id));
      toast.success(`Revoked “${revoking.label}”.`);
      setRevoking(null);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const a = data?.account;
  return (
    <div className="page page-narrow">
      <PageHeader
        title="Account"
        actions={
          <button className="btn" onClick={onSignOut}>
            Sign out
          </button>
        }
      />
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="account" />
      ) : (
        <>
          <section className="section" aria-label="Profile">
            <dl className="kv">
              <dt>Name</dt>
              <dd>{a!.name}</dd>
              <dt>Role</dt>
              <dd>
                {ROLE_LABELS[a!.role] ?? a!.role} <span className="muted">· {ROLE_HELP[a!.role]}</span>
              </dd>
              <dt>Account</dt>
              <dd>{a!.source === "env" ? "Defined in the server environment" : `Created ${shortDate(a!.createdAt)}`}</dd>
              {a!.lastSeenAt && (
                <>
                  <dt>Last seen</dt>
                  <dd>{ago(a!.lastSeenAt)}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="section" aria-labelledby="tokens-h">
            <SectionHead
              id="tokens-h"
              title="API tokens"
              description="For the CLI, MCP clients and CI. A token acts as you."
              actions={
                <button className="btn btn-sm" onClick={() => setCreating(true)}>
                  New token
                </button>
              }
            />
            {data.tokens.length ? (
              <div className="table-wrap">
                <table className="table middle">
                  <thead>
                    <tr>
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
                    {data.tokens.map((t) => (
                      <tr key={t.id}>
                        <td>{t.label}</td>
                        <td className="mono muted">{tokenHint(t)}</td>
                        <td>{shortDate(t.createdAt)}</td>
                        <td>{lastUsed(t.lastUsedAt)}</td>
                        <td>
                          <TokenExpiry info={t} />
                        </td>
                        <td className="actions-cell">
                          {envToken(t) ? (
                            <span className="row-note">Server environment</span>
                          ) : (
                            <button className="btn btn-sm btn-danger" onClick={() => setRevoking(t)} aria-label={`Revoke ${t.label}`}>
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No tokens yet.</p>
            )}
          </section>
        </>
      )}
      {creating && <NewTokenDialog title="New API token" path="api/account/tokens" onClose={() => setCreating(false)} onCreated={reload} />}
      {revoking && (
        <ConfirmDialog title="Revoke token" confirmLabel="Revoke" danger busy={busy} onConfirm={revoke} onClose={() => setRevoking(null)}>
          <p>
            Anything using <strong>{revoking.label}</strong> (<span className="mono">{tokenHint(revoking)}</span>) stops working immediately.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
