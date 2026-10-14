import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  FolderGit2,
  Github,
  FolderOpen,
  Terminal,
  Check,
  RefreshCw,
  Copy,
  Plus,
} from "lucide-react";
import type { Project, Profile, Run } from "../shared/types";
import {
  projectQuestions,
  unansweredQuestions,
  type CodeSnapshot,
  type Discovery,
} from "../shared/discovery";
import { api, post, date } from "./api";
import { Button, Field, Modal } from "./ui";
import { folderSnapshot } from "./folderSnapshot";
import "./project-flow.css";
import SourceScan, { type ScanRecord } from "./SourceScan";

const methods = [
  ["github", "GitHub", "Public or private repository", Github],
  ["bitbucket", "Bitbucket", "Public or private repository", FolderGit2],
  ["local", "Local folder", "Select code on this computer", FolderOpen],
  ["agent", "MCP / IDE agent", "Continue with your coding agent", Terminal],
] as const;
function MethodPicker({
  value,
  onChange,
}: {
  value: Discovery["provider"];
  onChange: (value: Discovery["provider"]) => void;
}) {
  return (
    <div className="connect-methods" role="group" aria-label="Code source">
      {methods.map(([id, title, detail, Icon]) => (
        <button
          type="button"
          aria-pressed={value === id}
          className={value === id ? "active" : ""}
          key={id}
          onClick={() => onChange(id)}
        >
          <Icon size={22} />
          <strong>{title}</strong>
          <small>{detail}</small>
        </button>
      ))}
    </div>
  );
}
export function NewProject({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(""),
    [provider, setProvider] = useState<Discovery["provider"]>("local"),
    [repository, setRepository] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Validate the connection before creating a project, so a bad URL cannot leave duplicate projects.
      if (provider === "github" || provider === "bitbucket") {
        const url = new URL(repository);
        if (
          url.protocol !== "https:" ||
          url.hostname !==
            (provider === "github" ? "github.com" : "bitbucket.org") ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.port ||
          !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)
        )
          throw new Error(
            "Enter the repository URL without credentials, a branch path or query parameters.",
          );
      }
      const profile: Profile = {
        name,
        description:
          "Project setup in progress. Intended use still needs confirmation.",
        industry: "Technology",
        softwareType: "saas",
        countries: ["EU"],
        audience: "Businesses",
        dataTypes: ["Personal data"],
        usesAi: false,
        externalAi: false,
        discovery: {
          provider,
          repository:
            provider === "local" || provider === "agent" ? "" : repository,
          answers: {},
        },
      };
      const result = await post("/projects", profile);
      onSaved(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Create a project"
      subtitle="One project per app or service. Return here whenever the code changes."
      onClose={onClose}
      wide
    >
      <form onSubmit={save}>
        <div className="modal-body">
          <Field label="Project name">
            <input
              autoFocus
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Customer portal"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <h3>Where is the code?</h3>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setName("Reverse Office");
              setProvider("github");
              setRepository("https://github.com/Ramphyi/reverse_office");
            }}
          >
            Try the Reverse Office repository <ArrowRight size={15} />
          </button>
          <MethodPicker value={provider} onChange={setProvider} />
          {(provider === "github" || provider === "bitbucket") && (
            <Field
              label="Repository URL"
              hint="Next, scan the default branch. For private code, supply a read-only access token on the connection page."
            >
              <input
                type="url"
                required
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                placeholder={`https://${provider === "github" ? "github.com" : "bitbucket.org"}/team/project`}
              />
            </Field>
          )}
          <p className="flow-muted">
            Next: scan the source, review the proposed answers, then confirm
            your product’s audience, markets and deployment.
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="orange" type="submit" busy={busy}>
            Create project <ArrowRight size={16} />
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
export function ProjectList({
  projects,
  onOpen,
  onNew,
}: {
  projects: Project[];
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <section className="projects-home">
      <div className="page-heading">
        <div>
          <div className="page-eyebrow">YOUR CODE. YOUR PROJECTS.</div>
          <h1>What are you working on?</h1>
          <p>
            Connect a project once. Keep its questions, findings and check
            history together.
          </p>
        </div>
        <Button variant="orange" onClick={onNew}>
          <Plus size={16} /> New project
        </Button>
      </div>
      <div className="project-list">
        {projects.map((project) => (
          <button
            className="project-tile"
            key={project.id}
            onClick={() => onOpen(project.id)}
          >
            <span className="project-tile-icon">
              <FolderGit2 size={24} />
            </span>
            <div>
              <h2>{project.profile.name}</h2>
              <p>
                {project.profile.discovery?.repository ||
                  (project.profile.discovery
                    ? `${project.profile.discovery.provider} · ${project.profile.discovery.snapshot ? "Code snapshot imported" : "Waiting for code"}`
                    : "Sample / manually described project")}
              </p>
              <small>
                {project.profile.discovery
                  ? `${unansweredQuestions(project.profile).length} questions to answer`
                  : "Open findings and assessment history"}{" "}
                · Created {date(project.created_at)}
              </small>
            </div>
            <ArrowRight size={20} />
          </button>
        ))}
      </div>
      {!projects.length && (
        <div className="flow-empty">
          <FolderGit2 size={36} />
          <h2>Your first project starts with its code.</h2>
          <p>Choose GitHub, Bitbucket, a local folder or your coding agent.</p>
          <Button variant="orange" onClick={onNew}>
            Create your first project
          </Button>
        </div>
      )}
    </section>
  );
}
export function ProjectSteps({
  project,
  section,
}: {
  project: Project;
  section: string;
}) {
  const connected = !!project.profile.discovery?.snapshot,
    answered =
      !!project.profile.discovery &&
      !unansweredQuestions(project.profile).length;
  return (
    <nav className="project-steps" aria-label="Project workflow">
      {[
        ["connect", "Connect code", connected],
        ["questions", "Answer questions", answered],
        ["", "Review problems", false],
        ["assessments", "Check history", false],
      ].map(([path, label, done], index) => (
        <Link
          key={String(path)}
          to={`/app${path ? "/" + path : ""}?project=${project.id}`}
          className={section === path ? "active" : ""}
          aria-current={section === path ? "step" : undefined}
        >
          <span>{done ? <Check size={15} /> : index + 1}</span>
          <strong>{label}</strong>
        </Link>
      ))}
    </nav>
  );
}
function CopyCode({ title, text }: { title: string; text: string }) {
  const [status, setStatus] = useState("");
  return (
    <div className="code-block">
      <header>
        <span>{title}</span>
        <button
          className="icon-button"
          type="button"
          aria-label={`Copy ${title}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setStatus("Copied");
            } catch {
              setStatus("Select the text to copy.");
            }
          }}
        >
          <Copy size={15} />
        </button>
      </header>
      <pre>{text}</pre>
      {status && <p role="status">{status}</p>}
    </div>
  );
}
export function ConnectCode({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: () => Promise<void>;
}) {
  const [provider, setProvider] = useState<Discovery["provider"]>(
    project.profile.discovery?.provider || "local",
  );
  const [repository, setRepository] = useState(
    project.profile.discovery?.repository || "",
  );
  const [preview, setPreview] = useState<CodeSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const snapshot = project.profile.discovery?.snapshot;
  const endpoint = `${location.origin}/mcp`;
  const prompt = `Use Clearance project ${project.id}. Read clearance://skills/assessment. Inspect this repository without executing its code or reading secrets. Import bounded metadata with submit_code_snapshot, then call get_project_questions. Propose answers with file references; ask me about markets, audience and intended use. Save confirmed answers with answer_project_questions. Call run_assessment and get_assessment. Explain each gap, help me fix the code and submit supporting evidence for review. Never approve evidence or claim certification. After changes, refresh the snapshot and rerun the assessment on this same project.`;
  async function saveConnection() {
    await api(`/projects/${project.id}/connection`, {
      method: "PUT",
      body: JSON.stringify({
        provider,
        repository:
          provider === "github" || provider === "bitbucket" ? repository : "",
      }),
    });
  }
  async function upload() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await saveConnection();
      await post(`/projects/${project.id}/snapshot`, preview);
      setPreview(null);
      await onSaved();
      setMessage("Code metadata imported. Continue to the project questions.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flow-layout">
      <section className="card flow-panel">
        <h2>Connect your project’s code</h2>
        <p>
          Start with the source. Clearance reads supported files across the
          repository and proposes answers with references. Review coverage and
          confirm the business facts before running your assessment.
        </p>
        <MethodPicker
          value={provider}
          onChange={(v) => {
            setProvider(v);
            setPreview(null);
            setMessage("");
          }}
        />
        {(provider === "github" || provider === "bitbucket") && (
          <>
            <Field label="Repository URL">
              <input
                type="url"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                placeholder={`https://${provider === "github" ? "github.com" : "bitbucket.org"}/team/project`}
              />
            </Field>
            <div className="flow-note">
              <strong>Public and private repositories</strong>
              <p>
                Paste the repository URL and add a read-only token below if it
                is private. Each scan reads the current default branch. Run it
                again after changes to refresh this project’s analysis.
              </p>
            </div>
          </>
        )}
        {provider !== "agent" ? (
          <>
            <SourceScan
              key={`${project.id}-${provider}`}
              projectId={project.id}
              provider={provider}
              repository={repository}
              onSaved={onSaved}
            />
            <details className="flow-details">
              <summary>
                Advanced: import filenames only, without source analysis
              </summary>
              <div className="folder-picker">
                <FolderOpen size={28} />
                <h3>
                  {snapshot
                    ? "Refresh the code snapshot"
                    : "Choose your project folder"}
                </h3>
                <p>
                  Select a folder, review its metadata, then import. No files
                  are sent until you confirm.
                </p>
                <input
                  aria-label="Choose project folder"
                  type="file"
                  {...({ webkitdirectory: "", directory: "" } as any)}
                  onChange={async (e) => {
                    if (!e.target.files?.length) return;
                    setBusy(true);
                    setError("");
                    try {
                      setPreview(await folderSnapshot(e.target.files));
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </div>
              <details className="flow-details">
                <summary>Or import a CLI inventory JSON</summary>
                <p>
                  Run from the Clearance checkout. Replace the path with your
                  application folder. You can also add <code>--send</code> after
                  setting CLEARANCE_URL, CLEARANCE_PROJECT_ID and
                  CLEARANCE_API_KEY (evidence scope).
                </p>
                <CopyCode
                  title="Collect code metadata"
                  text={
                    'node scripts/connect-project.mjs "PATH_TO_YOUR_PROJECT" > snapshot.json'
                  }
                />
                <input
                  aria-label="Import code snapshot JSON"
                  type="file"
                  accept=".json,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setError("");
                    try {
                      if (file.size > 150000)
                        throw new Error("Use an inventory JSON under 150 KB.");
                      const raw = JSON.parse(await file.text());
                      if (
                        !raw.artifacts ||
                        !Array.isArray(raw.technologyHints) ||
                        !Number.isInteger(raw.filesInspected)
                      )
                        throw new Error(
                          "Use JSON generated by connect-project.mjs.",
                        );
                      setPreview(raw);
                    } catch (error) {
                      setError((error as Error).message);
                    }
                  }}
                />
              </details>
            </details>
          </>
        ) : (
          <>
            <h3>Keep working in your IDE</h3>
            <p>
              Use a client with MCP tools, such as Claude Code or an MCP-enabled
              IDE agent. An autocomplete-only assistant cannot call these tools.
              Create a key with read, assess and evidence scopes, then add this
              server to your client.
            </p>
            <Link
              className="text-link"
              to={`/app/integrations?project=${project.id}`}
            >
              Create an API key <ArrowRight size={15} />
            </Link>
            <CopyCode
              title="MCP server configuration"
              text={JSON.stringify(
                {
                  mcpServers: {
                    clearance: {
                      type: "http",
                      url: endpoint,
                      headers: {
                        Authorization: "Bearer YOUR_CLEARANCE_API_KEY",
                      },
                    },
                  },
                },
                null,
                2,
              )}
            />
            <CopyCode title="Continue with your coding agent" text={prompt} />
            <Button
              variant="outline"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  if (!project.profile.discovery) await saveConnection();
                  await onSaved();
                  setMessage(
                    "Project status refreshed. Your agent can sync to this same project without replacing its code source.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh after agent sync
            </Button>
          </>
        )}
        {preview && (
          <div className="snapshot-preview">
            <h3>Review before importing</h3>
            <p>
              {preview.filesInspected} files ·{" "}
              {preview.technologyHints.join(", ") ||
                "No recognized technology hints"}
            </p>
            <p>
              {preview.truncated
                ? "Bounded / incomplete inventory."
                : "Within collection limits."}{" "}
              Filenames are not proof of implementation.
            </p>
            <details>
              <summary>View metadata that will be sent</summary>
              <pre>{JSON.stringify(preview, null, 2)}</pre>
            </details>
            <Button variant="orange" busy={busy} onClick={upload}>
              Import code metadata <ArrowRight size={16} />
            </Button>
          </div>
        )}
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
      </section>
      <aside className="flow-side">
        <h3>This project</h3>
        <strong>{project.profile.name}</strong>
        <p className="flow-muted">{project.id}</p>
        <hr />
        <h3>{snapshot ? "Code snapshot imported" : "Waiting for code"}</h3>
        {snapshot ? (
          <>
            <p>{snapshot.filesInspected} files inventoried</p>
            <p>{snapshot.technologyHints.join(", ")}</p>
            <p>Imported {date(project.profile.discovery!.importedAt!)}</p>
            {snapshot.revision && <code>{snapshot.revision.slice(0, 12)}</code>}
            <p>
              Reimport after code changes; this connection is not a background
              watcher.
            </p>
            <Link
              className="button orange"
              to={`/app/questions?project=${project.id}`}
            >
              Answer project questions <ArrowRight size={16} />
            </Link>
          </>
        ) : (
          <p>
            Once metadata arrives, Clearance adds questions about AI libraries,
            mobile configuration and other signals it recognizes.
          </p>
        )}
        <hr />
        <h3>Already using an agent?</h3>
        <p>
          Your agent can inspect the code and propose answers. You confirm the
          business facts it cannot infer.
        </p>
        <button className="text-link" onClick={() => setProvider("agent")}>
          Set up MCP / IDE <ArrowRight size={15} />
        </button>
        <Button variant="outline" onClick={onSaved}>
          <RefreshCw size={15} /> Refresh status
        </Button>
      </aside>
    </div>
  );
}
export function ProjectQuestions({
  project,
  onSaved,
  onAssess,
}: {
  project: Project;
  onSaved: () => Promise<void>;
  onAssess: () => Promise<void>;
}) {
  const [profile, setProfile] = useState(project.profile),
    [answers, setAnswers] = useState(project.profile.discovery?.answers || {}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [countries, setCountries] = useState(profile.countries.join(", "));
  const [analysis, setAnalysis] = useState<ScanRecord | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<ScanRecord | null>(`/projects/${project.id}/analysis`)
      .then((scan) => {
        if (cancelled) return;
        setAnalysis(scan);
        if (scan?.status !== "completed" || !scan.report || scan.stale) return;
        const report = scan.report;
        setAnswers((previous) => ({
          ...Object.fromEntries(
            Object.entries(report.suggestions)
              .filter(([, suggestion]) => suggestion.confidence !== "unknown")
              .map(([key, suggestion]) => [key, suggestion.answer]),
          ),
          ...Object.fromEntries(
            Object.entries(previous).filter(([, value]) => value.trim()),
          ),
        }));
        setProfile((previous) =>
          previous.description.startsWith("Project setup in progress.")
            ? { ...previous, description: report.summary }
            : previous,
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);
  const questions = projectQuestions(profile);
  const answered = questions.filter((q) => answers[q.id]?.trim()).length;
  if (!profile.discovery)
    return (
      <section className="card flow-panel">
        <h2>Start with your code</h2>
        <p>
          This sample uses a manually entered profile. Connect a code source to
          generate and save project questions.
        </p>
        <Link
          className="button orange"
          to={`/app/connect?project=${project.id}`}
        >
          Connect code <ArrowRight size={16} />
        </Link>
      </section>
    );
  async function save(run: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const current = await api<{ project: Project }>(
        `/projects/${project.id}`,
      );
      const validAnswers = Object.fromEntries(
        questions.map((q) => [q.id, answers[q.id] || ""]),
      );
      await api(`/projects/${project.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...profile,
          countries: countries
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          discovery: current.project.profile.discovery,
        }),
      });
      await api(`/projects/${project.id}/answers`, {
        method: "PUT",
        body: JSON.stringify(validAnswers),
      });
      await onSaved();
      setMessage(
        "Answers saved. They inform the review; evidence still needs separate approval.",
      );
      if (run) await onAssess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flow-layout">
      <form
        className="card flow-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <h2>Confirm what the code cannot tell us</h2>
        <p>
          Source-based suggestions are drafts. Review their file references,
          correct anything missing and confirm the actual users and markets.
          Saving these answers does not approve evidence or pass a control.
        </p>
        {analysis?.report && !analysis.stale ? (
          <div className="flow-note">
            <strong>
              Prefilled from {analysis.report.filesRead} scanned files
            </strong>
            <p>
              {analysis.report.mode === "ai" ? "AI-assisted" : "Static"}{" "}
              analysis. Previously saved answers are preserved. Unknown business
              facts are left for you to answer.
            </p>
          </div>
        ) : (
          <div className="flow-note">
            <strong>Scan your source first to prefill these answers.</strong>
            <p>You can also enter answers manually or use your IDE agent.</p>
            <Link
              className="text-link"
              to={`/app/connect?project=${project.id}`}
            >
              Scan project source <ArrowRight size={15} />
            </Link>
          </div>
        )}
        <div className="flow-note">
          {profile.discovery.snapshot
            ? `Detected: ${profile.discovery.snapshot.technologyHints.join(", ") || "no recognized technology hints"}.`
            : "Import code to add repository-specific questions."}{" "}
          Defaults below are starting values. Confirm them for your actual
          project.
        </div>
        <div className="form-grid">
          <Field label="Product type">
            <select
              value={profile.softwareType}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  softwareType: e.target.value as Profile["softwareType"],
                })
              }
            >
              {[
                ["saas", "SaaS / web app"],
                ["ai", "AI system"],
                ["mobile", "Mobile app"],
                ["embedded", "Embedded software"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Industry">
            <select
              value={profile.industry}
              onChange={(e) =>
                setProfile({ ...profile, industry: e.target.value })
              }
            >
              {[
                "Technology",
                "Healthcare",
                "Finance",
                "Education",
                "Retail",
                "Industrial",
                "Other",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Markets (comma separated)">
            <input
              required
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
            />
          </Field>
          <Field label="Audience">
            <select
              value={profile.audience}
              onChange={(e) =>
                setProfile({ ...profile, audience: e.target.value })
              }
            >
              {["Businesses", "Consumers", "Both", "Children"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Product description">
          <textarea
            required
            minLength={20}
            maxLength={6000}
            value={profile.description}
            onChange={(e) =>
              setProfile({ ...profile, description: e.target.value })
            }
          />
        </Field>
        <div className="field">
          <span>Data categories</span>
          <div className="chip-select">
            {[
              "Personal data",
              "Health data",
              "Payment data",
              "Children’s data",
              "Anonymous data",
            ].map((value) => (
              <button
                type="button"
                aria-pressed={profile.dataTypes.includes(value)}
                className={profile.dataTypes.includes(value) ? "selected" : ""}
                key={value}
                onClick={() =>
                  setProfile({
                    ...profile,
                    dataTypes: profile.dataTypes.includes(value)
                      ? profile.dataTypes.filter((v) => v !== value)
                      : [...profile.dataTypes, value],
                  })
                }
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={profile.usesAi}
            onChange={(e) =>
              setProfile({ ...profile, usesAi: e.target.checked })
            }
          />{" "}
          This product uses AI in its deployed features
        </label>
        <div className="question-list">
          {questions.map((q, i) => (
            <div className="project-question" key={q.id}>
              <div className="question-number">{i + 1}</div>
              <Field label={q.title} hint={q.why}>
                <textarea
                  rows={3}
                  maxLength={3000}
                  placeholder={q.hint}
                  value={answers[q.id] || ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.id]: e.target.value })
                  }
                />
                {!analysis?.stale && analysis?.report?.suggestions[q.id] && (
                  <details className="answer-provenance">
                    <summary>
                      Source draft ·{" "}
                      {analysis.report.suggestions[q.id].confidence}
                    </summary>
                    <p>{analysis.report.suggestions[q.id].answer}</p>
                    {analysis.report.suggestions[q.id].references.map(
                      (ref, index) => (
                        <div className="source-reference" key={index}>
                          <code>
                            {ref.path}:{ref.line}
                          </code>
                          <pre>{ref.excerpt}</pre>
                        </div>
                      ),
                    )}
                  </details>
                )}
              </Field>
            </div>
          ))}
        </div>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="alert success" role="status">
            {message}
          </p>
        )}
        <div className="flow-actions">
          <Button type="submit" variant="outline" busy={busy}>
            Save answers
          </Button>
          <Button
            type="button"
            variant="orange"
            busy={busy}
            onClick={() => save(true)}
          >
            Save and run assessment <ArrowRight size={16} />
          </Button>
        </div>
      </form>
      <aside className="flow-side">
        <h3>
          {answered} of {questions.length} answered
        </h3>
        <p>
          Unanswered questions appear as setup problems in your assessment.
          Answers do not automatically mark a requirement as satisfied.
        </p>
        <hr />
        <h3>Let your agent help</h3>
        <p>
          Connect MCP, then ask your agent to read this project’s questions and
          propose answers based on your repository.
        </p>
        <Link className="text-link" to={`/app/connect?project=${project.id}`}>
          Connect your coding agent <ArrowRight size={16} />
        </Link>
        <hr />
        <h3>What happens next?</h3>
        <p>
          Review the problems, add supporting evidence, and rerun the assessment
          after changes. Each run stays in this project’s history.
        </p>
      </aside>
    </div>
  );
}
export function NextStep({
  project,
  latest,
}: {
  project: Project;
  latest?: Run;
}) {
  const pending = unansweredQuestions(project.profile);
  const target = !project.profile.discovery?.snapshot
    ? "connect"
    : pending.length
      ? "questions"
      : "assessments";
  return (
    <div className="project-next">
      <div>
        <strong>
          {target === "connect"
            ? "Start by connecting this project’s code"
            : target === "questions"
              ? `${pending.length} project questions need your input`
              : "Ready to review and check again"}
        </strong>
        <p>
          {target === "connect"
            ? "Import your local checkout or connect your coding agent through MCP."
            : target === "questions"
              ? "Answer them here, or ask your agent to propose answers grounded in the code."
              : latest
                ? `Last assessment: ${date(latest.created_at)}. Refresh the snapshot after code changes, then run again.`
                : "Run the first assessment to find gaps in your project’s readiness."}
        </p>
      </div>
      <Link
        className="button orange"
        to={`/app/${target}?project=${project.id}`}
      >
        {target === "connect"
          ? "Connect code"
          : target === "questions"
            ? "Answer questions"
            : "View check history"}{" "}
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
