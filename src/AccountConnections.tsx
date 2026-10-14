import { useEffect, useState } from "react";
import {
  Github,
  GitBranch,
  LockKeyhole,
  Check,
  Unplug,
  ArrowRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { Button, Field } from "./ui";
import "./source-visuals.css";
export type ConnectionStatus = {
  provider: string;
  connected: boolean;
  updatedAt: string | null;
};
export default function AccountConnections() {
  const [connections, setConnections] = useState<ConnectionStatus[]>([]),
    [editing, setEditing] = useState(""),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const load = () =>
    api<ConnectionStatus[]>("/account/connections").then(setConnections);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="account-connections card">
      <div className="connection-intro">
        <span className="connection-lock">
          <LockKeyhole size={25} />
        </span>
        <div>
          <span className="page-eyebrow">ACCOUNT SETUP · CODE ACCESS</span>
          <h2>Your connected accounts</h2>
          <p>
            Connect private code once. Your projects can reuse it whenever you
            choose private access.
          </p>
        </div>
        <Link className="text-link" to="/app/projects">
          Your projects <ArrowRight size={16} />
        </Link>
      </div>
      <div className="provider-cards">
        {(["github", "bitbucket"] as const).map((provider) => {
          const saved = connections.find(
              (c) => c.provider === provider,
            )?.connected,
            name = provider === "github" ? "GitHub" : "Bitbucket",
            Icon = provider === "github" ? Github : GitBranch;
          return (
            <article
              key={provider}
              className={`provider-card ${saved ? "connected" : ""}`}
            >
              <header>
                <Icon size={29} />
                <span className={`connection-status ${saved ? "saved" : ""}`}>
                  {saved ? <Check size={13} /> : <LockKeyhole size={13} />}{" "}
                  {saved ? "Access saved" : "Not connected"}
                </span>
              </header>
              <h3>{name}</h3>
              <p>
                {provider === "github"
                  ? "Fine-grained token with read-only Contents access to your chosen repositories."
                  : "Repository access token with read permission."}
              </p>
              <small>
                Public repositories work without a connection. Access is checked
                when you scan.
              </small>
              {editing === provider ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      await api(`/account/connections/${provider}`, {
                        method: "PUT",
                        body: JSON.stringify({ token: value }),
                      });
                      setValue("");
                      setEditing("");
                      await load();
                      setMessage(`${name} access saved in your profile.`);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Field
                    label={`${name} access token`}
                    hint="Encrypted on the server. The saved value is never returned to the browser."
                  >
                    <input
                      type="password"
                      required
                      minLength={8}
                      maxLength={512}
                      autoComplete="off"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" variant="orange" busy={busy}>
                    Save {name} connection
                  </Button>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      setValue("");
                      setEditing("");
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="provider-actions">
                  <Button
                    variant={saved ? "outline" : "orange"}
                    onClick={() => {
                      setEditing(provider);
                      setValue("");
                      setError("");
                      setMessage("");
                    }}
                  >
                    {saved ? "Replace token" : `Connect ${name}`}
                  </Button>
                  {saved && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await api(`/account/connections/${provider}`, {
                            method: "DELETE",
                          });
                          await load();
                          setMessage(
                            `${name} disconnected. Public access is still available.`,
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Unplug size={14} />
                      Disconnect {name}
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="alert success">
          {message}
        </p>
      )}
      <p className="connection-footnote">
        <LockKeyhole size={14} /> Tokens belong to your account. They are never
        sent to AI, shown in chat or shared with other owners.
      </p>
    </section>
  );
}
