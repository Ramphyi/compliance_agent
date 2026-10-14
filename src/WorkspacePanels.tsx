import { useEffect, useState } from "react";
import {
  Terminal,
  Copy,
  KeyRound,
  Plus,
  Trash2,
  ShieldCheck,
  Server,
  Globe2,
  RefreshCw,
  Check,
  ArrowUpRight,
  LockKeyhole,
  Smartphone,
  FileCode2,
  ArrowRight,
} from "lucide-react";
import { api, post, date } from "./api";
import { Button, Badge, SectionTitle, Field, Modal, External } from "./ui";
import type { Project, User } from "../shared/types";
export function Integrations({
  projectId,
  notify,
}: {
  projectId: string;
  notify: (s: string) => void;
}) {
  const [keys, setKeys] = useState<any[]>([]);
  const [newKey, setNewKey] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gate, setGate] = useState<any>(null);
  const load = () => api("/keys").then(setKeys);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  const endpoint = `${window.location.origin}/mcp`;
  const config = JSON.stringify(
    {
      mcpServers: {
        clearance: {
          type: "http",
          url: endpoint,
          headers: { Authorization: "Bearer YOUR_CLEARANCE_API_KEY" },
        },
      },
    },
    null,
    2,
  );
  const ci = [
    "# Copy scripts/compliance-gate.mjs into your repository.",
    "- name: Check compliance gate",
    "  env:",
    "    CLEARANCE_URL: $" + "{{ vars.CLEARANCE_URL }}",
    "    CLEARANCE_PROJECT_ID: $" + "{{ vars.CLEARANCE_PROJECT_ID }}",
    "    CLEARANCE_API_KEY: $" + "{{ secrets.CLEARANCE_API_KEY }}",
    "  run: node scripts/compliance-gate.mjs",
  ].join("\n");
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("Copied to clipboard.");
    } catch {
      setError("Clipboard unavailable. Select and copy the displayed text.");
    }
  }
  return (
    <>
      {error && <div className="alert error">{error}</div>}
      <div className="integration-grid">
        <article className="card integration-card">
          <span className="square-icon peach">
            <Terminal size={25} />
          </span>
          <Badge tone="green">Available</Badge>
          <h2>
            One connection.
            <br />
            More capable agents.
          </h2>
          <p>
            Connect any client that supports MCP Streamable HTTP with bearer
            headers. Give it a scoped key for only the tools it needs.
          </p>
          <div className="code-block">
            <header>
              <span>mcp.config.json</span>
              <button
                className="icon-button"
                aria-label="Copy MCP configuration"
                onClick={() => copy(config)}
              >
                <Copy size={15} />
              </button>
            </header>
            <pre>{config}</pre>
          </div>
          <div className="tool-chips">
            {[
              "list_projects",
              "get_project_questions",
              "submit_code_snapshot",
              "answer_project_questions",
              "get_assessment",
              "run_assessment",
              "submit_evidence",
              "check_release_gate",
            ].map((t) => (
              <code key={t}>{t}</code>
            ))}
          </div>
          <p className="small-note">
            Resources: clearance://skills/assessment and clearance://sources.
            The skills and agent instructions are included in the repository.
          </p>
        </article>
        <article className="card integration-card">
          <span className="square-icon blue">
            <FileCode2 size={25} />
          </span>
          <Badge tone="neutral">CI / CD</Badge>
          <h2>
            Make readiness
            <br />
            part of the release.
          </h2>
          <p>
            Run the supplied gate script after an assessment. It fails closed
            when evidence is missing, inputs have changed, or an assessment is
            over seven days old.
          </p>
          <div className="code-block">
            <header>
              <span>GitHub Actions step</span>
              <button
                className="icon-button"
                aria-label="Copy pipeline configuration"
                onClick={() => copy(ci)}
              >
                <Copy size={15} />
              </button>
            </header>
            <pre>{ci}</pre>
          </div>
          <Field label="Current project ID">
            <div className="inline-input">
              <input readOnly value={projectId} />
              <Button
                variant="outline"
                onClick={() => copy(projectId)}
                aria-label="Copy project ID"
              >
                <Copy size={15} />
              </Button>
            </div>
          </Field>
          <Button
            variant="outline"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setGate(await api(`/projects/${projectId}/gate`));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ShieldCheck size={16} /> Check release gate
          </Button>
          {gate && (
            <div className={`alert ${gate.passed ? "success" : "warning"}`}>
              <strong>{gate.passed ? "Gate passed" : "Gate blocked"}</strong>
              {gate.reason}
            </div>
          )}
        </article>
      </div>
      <section className="card keys-card">
        <SectionTitle
          title="Keys to your workflow"
          description="Scoped, revocable keys. Stored as hashes. Expires after 90 days."
        >
          <Button variant="orange" onClick={() => setShow(true)}>
            <Plus size={16} /> Create API key
          </Button>
        </SectionTitle>
        {newKey && (
          <div className="key-reveal">
            <strong>Copy your key now. You won’t see it again.</strong>
            <div>
              <code>{newKey}</code>
              <button
                className="icon-button"
                aria-label="Copy new API key"
                onClick={() => copy(newKey)}
              >
                <Copy size={16} />
              </button>
            </div>
            <Button variant="small outline" onClick={() => setNewKey("")}>
              I saved it
            </Button>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>NAME</th>
                <th>KEY PREFIX</th>
                <th>SCOPES</th>
                <th>EXPIRES</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <code>{k.prefix}…</code>
                  </td>
                  <td>{k.scopes.join(", ")}</td>
                  <td>{date(k.expires_at)}</td>
                  <td>
                    <button
                      className="icon-button danger"
                      aria-label={`Revoke ${k.name}`}
                      onClick={async () => {
                        try {
                          await api(`/keys/${k.id}`, { method: "DELETE" });
                          await load();
                          notify("API key revoked.");
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!keys.length && (
            <p className="table-empty">
              No keys yet. Create one to connect an agent or a pipeline.
            </p>
          )}
        </div>
      </section>
      {show && (
        <Modal
          title="Create a scoped API key"
          subtitle="Select only the permissions this integration needs."
          onClose={() => setShow(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const data = new FormData(e.currentTarget);
              try {
                const r = await post("/keys", {
                  name: data.get("name"),
                  scopes: data.getAll("scopes"),
                });
                setNewKey(r.key);
                setShow(false);
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="modal-body">
              <Field label="Key name">
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="e.g. Production pipeline"
                />
              </Field>
              {[
                ["read", "Read projects, reports and release gates"],
                ["assess", "Run assessments (may use opted-in research)"],
                ["evidence", "Submit evidence for review"],
              ].map(([value, label]) => (
                <label className="check-label" key={value}>
                  <input
                    type="checkbox"
                    name="scopes"
                    value={value}
                    defaultChecked={value === "read"}
                  />
                  {label}
                </label>
              ))}
              <p className="muted">
                API keys cannot approve evidence, create keys or change account
                settings.
              </p>
            </div>
            <footer className="modal-footer">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShow(false)}
              >
                Cancel
              </Button>
              <Button busy={busy} variant="orange">
                Create key <KeyRound size={15} />
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
export function RegulatoryWatch({
  config,
  notify,
}: {
  config: any;
  notify: (s: string) => void;
}) {
  const [data, setData] = useState<any>({ sources: [], checks: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const load = () => api("/sources").then(setData);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="info-banner">
        <Globe2 size={22} />
        <div>
          <strong>Primary sources. Clear boundaries.</strong>
          <p>
            A page change is a signal to review, not proof of a new law. Refresh
            records source availability and page fingerprints; a qualified
            reviewer decides the impact.
          </p>
        </div>
        <Button
          variant="outline"
          busy={busy}
          disabled={!config.regulatoryFetch}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setResults(await post("/sources/refresh"));
              await load();
              notify("Source check completed. Review individual results.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={15} /> Check sources
        </Button>
      </div>
      {!config.regulatoryFetch && (
        <div className="alert warning">
          Live source monitoring is disabled in this deployment. Set
          ALLOW_REGULATORY_FETCH=true to allow outbound requests to the fixed
          official-source catalog.
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="sources-grid">
        {data.sources.map((s: any) => {
          const last = data.checks.find((c: any) => c.source_id === s.id);
          const result = results.find((r) => r.id === s.id);
          return (
            <article className="card source-card" key={s.id}>
              <div>
                <span className="square-icon neutral">
                  <BookIcon />
                </span>
                <Badge
                  tone={
                    result?.status === "unavailable"
                      ? "red"
                      : last?.changed
                        ? "amber"
                        : last
                          ? "green"
                          : "neutral"
                  }
                >
                  {result?.status === "unavailable"
                    ? "Unavailable"
                    : last?.changed
                      ? "Page changed"
                      : last
                        ? "Checked"
                        : "Not checked"}
                </Badge>
              </div>
              <span className="eyebrow">
                {s.authority} · {s.category}
              </span>
              <h3>{s.title}</h3>
              <p>{s.note}</p>
              <footer>
                <small>
                  {last
                    ? `Last fetched ${date(last.checked_at)}`
                    : "No live check recorded"}
                </small>
                <External href={s.url}>View source</External>
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}
const BookIcon = () => <Globe2 size={21} />;
export function SettingsPanel({
  user,
  config,
  project,
  onEdit,
  onUserUpdate,
}: {
  user: User;
  config: any;
  project: Project;
  onEdit: () => void;
  onUserUpdate: () => void;
}) {
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [audit, setAudit] = useState<any[]>([]);
  useEffect(() => {
    api("/audit")
      .then(setAudit)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="settings-grid">
      <section className="card settings-card">
        <SectionTitle title="Your account" />
        <div className="account-summary">
          <span className="user-avatar large-avatar">{user.name[0]}</span>
          <div>
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            <Badge tone="green">
              {user.verified ? "Email confirmed" : "Awaiting confirmation"}
            </Badge>
          </div>
        </div>
        <div className="settings-divider" />
        <SectionTitle
          title="Two-step verification"
          description="Add a phone verification step when signing in."
        />
        <Badge tone={user.mfa_enabled ? "green" : "neutral"}>
          {user.mfa_enabled ? "Enabled" : "Not enabled"}
        </Badge>
        {!user.mfa_enabled && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const data = Object.fromEntries(new FormData(e.currentTarget));
              try {
                if (challenge) {
                  await post("/auth/mfa/verify", {
                    challenge,
                    code: data.code,
                  });
                  setChallenge("");
                  setMessage("Two-step verification is enabled.");
                  onUserUpdate();
                } else {
                  const r = await post("/auth/mfa/enroll", data);
                  setChallenge(r.challenge);
                  setMessage("Code sent. Enter it below to finish setup.");
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {challenge ? (
              <Field label="Verification code">
                <input
                  name="code"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{4,10}"
                />
              </Field>
            ) : (
              <>
                <Field
                  label="Phone number"
                  hint="Use international format, e.g. +40712345678."
                >
                  <input
                    type="tel"
                    name="phone"
                    required
                    pattern="\+[1-9][0-9]{7,14}"
                    placeholder="+40…"
                  />
                </Field>
                <Field label="Delivery channel">
                  <select name="channel">
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </Field>
                <Field
                  label="Current password"
                  hint="Required for email accounts. Google accounts need a sign-in within the last 10 minutes."
                >
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                  />
                </Field>
              </>
            )}
            {!config.otp && (
              <p className="provider-note">
                Configure Twilio Verify credentials to enable delivery.
              </p>
            )}
            <Button variant="navy" busy={busy} disabled={!config.otp}>
              <Smartphone size={15} />
              {challenge ? "Verify and enable" : "Send verification code"}
            </Button>
          </form>
        )}
        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}
      </section>
      <div>
        <section className="card settings-card">
          <SectionTitle title="Product context">
            <Button variant="outline small" onClick={onEdit}>
              Edit context <ArrowUpRight size={14} />
            </Button>
          </SectionTitle>
          <dl className="settings-facts">
            <div>
              <dt>Product</dt>
              <dd>{project.profile.name}</dd>
            </div>
            <div>
              <dt>Industry</dt>
              <dd>{project.profile.industry}</dd>
            </div>
            <div>
              <dt>Markets</dt>
              <dd>{project.profile.countries.join(", ")}</dd>
            </div>
            <div>
              <dt>External AI research</dt>
              <dd>
                {project.profile.externalAi
                  ? "Project opted in"
                  : "Project opted out"}
              </dd>
            </div>
          </dl>
        </section>
        <section className="card settings-card">
          <SectionTitle title="Deployment boundaries" />
          <dl className="settings-facts">
            {[
              ["Database", config.demo ? "Ephemeral demo" : "PostgreSQL"],
              [
                "OpenAI research",
                config.externalAi ? "Configured" : "Disabled / not configured",
              ],
              ["Brevo mail", config.email ? "Configured" : "Not configured"],
              ["Google OAuth", config.google ? "Configured" : "Not configured"],
              ["SMS / WhatsApp", config.otp ? "Configured" : "Not configured"],
            ].map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="subtle-note">
            <Server size={16} /> Production uses your deployment’s environment
            variables. Secrets are never exposed in this UI.
          </div>
        </section>
      </div>
      <section className="card audit-card">
        <SectionTitle
          title="Workspace audit trail"
          description="Recent account, policy, assessment and evidence actions."
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ACTION</th>
                <th>TARGET</th>
                <th>RECORDED</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td>
                    <code>{a.target}</code>
                  </td>
                  <td>{new Date(a.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
