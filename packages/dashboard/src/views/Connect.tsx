import { TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { absolute, prefs } from "../api";
import { PROMPT_GROUPS, PromptExamples } from "../components/prompts";
import { CopyButton, ErrorBox, Loading, PageHeader, SectionHead, Segmented, Snippet } from "../components/ui";
import { useResource } from "../hooks";
import type { ConnectInfo, Guide, ProjectListItem } from "../types";

const GROUPS: { title: string; clients: string[] }[] = [
  { title: "Coding agents", clients: ["claude-code", "codex", "cursor", "vscode", "gemini", "windsurf"] },
  { title: "Chat apps", clients: ["claude-desktop", "chatgpt", "claude-ai"] },
  { title: "Your own agents", clients: ["openai-api", "anthropic-api", "agent-sdk"] },
];

const SHORT: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  vscode: "VS Code",
  gemini: "Gemini CLI",
  windsurf: "Windsurf",
  "claude-desktop": "Claude Desktop",
  chatgpt: "ChatGPT",
  "claude-ai": "Claude.ai",
  "openai-api": "OpenAI API",
  "anthropic-api": "Claude API",
  "agent-sdk": "Claude Agent SDK",
};

const STEPS: { title: string; what: string; tools: string }[] = [
  { title: "Understand", what: "Acai classifies the product; the agent reads the code.", tools: "acai_start" },
  { title: "Ask", what: "The agent asks you the compliance questions or offers a preset.", tools: "acai_questions, acai_answer, acai_apply_preset" },
  { title: "Scope", what: "Acai works out which frameworks apply, and why.", tools: "acai_scope" },
  { title: "Audit", what: "Detectors run; the agent checks each control and records findings.", tools: "acai_run_audit, acai_controls, acai_record_findings" },
  { title: "Review", what: "You decide each finding, in the chat or here.", tools: "acai_review, acai_wait_for_review" },
  { title: "Fix", what: "The agent edits; Acai builds, tests and commits on a fix branch.", tools: "acai_begin_fix, acai_complete_fix" },
  { title: "Report", what: "Markdown, JSON or SARIF with the audit trail.", tools: "acai_report" },
];

const TOOLS: { group: string; names: string }[] = [
  { group: "Projects and profile", names: "acai_projects, acai_start, acai_questions, acai_answer, acai_apply_preset, acai_scope" },
  { group: "Audit", names: "acai_run_audit, acai_controls, acai_record_findings, acai_annotate, acai_assess_control, acai_findings" },
  { group: "Review", names: "acai_review, acai_wait_for_review, acai_complete_reinvestigation" },
  { group: "Fixes", names: "acai_verify_config, acai_begin_fix, acai_complete_fix, acai_abort_fix" },
  { group: "Files (for agents without access to the repository)", names: "acai_list_files, acai_read_file, acai_search_code, acai_edit_file, acai_write_file" },
  { group: "Rules and output", names: "acai_propose_rules, acai_decide_rule, acai_report, acai_dashboard" },
];

/** Renders `backticks` as inline code. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

export function GuideBody({ guide }: { guide: Guide }) {
  let step = 0;
  return (
    <div className="guide">
      {guide.blocks.map((b, i) => {
        if (b.kind === "text")
          return (
            <p key={i}>
              <Rich text={b.text} />
            </p>
          );
        if (b.kind === "steps") {
          const start = step + 1;
          step += b.items.length;
          return (
            <ol key={i} start={start}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Rich text={item} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <div key={i}>
            <div className="snippet-label">{b.label}</div>
            <Snippet label={b.label} text={b.text} />
          </div>
        );
      })}
    </div>
  );
}

export function ConnectView({ pid }: { pid?: string }) {
  const projects = useResource<ProjectListItem[]>("api/projects");
  const [project, setProject] = useState(pid);
  const { data: info, error, reload } = useResource<ConnectInfo>(
    `api/connect?url=${encodeURIComponent(absolute("mcp"))}${project ? `&project=${encodeURIComponent(project)}` : ""}`,
  );
  const [client, setClientState] = useState(() => prefs.get("connect.client") ?? "claude-code");
  const [mode, setMode] = useState<"local" | "remote">("local");
  const setClient = (id: string) => {
    setClientState(id);
    prefs.set("connect.client", id);
  };

  const current = info?.clients.find((c) => c.id === client) ?? info?.clients[0];
  const httpOnly = Boolean(current?.remoteOnly || info?.container);
  const effectiveMode = httpOnly ? "remote" : mode;
  const guide = current && (effectiveMode === "local" ? current.local : current.remote);

  return (
    <div className="page">
      <PageHeader
        title="Connect an agent"
        description="Claude Code, Codex, Cursor, ChatGPT and other agents use Acai over MCP. The agent brings the model; Acai keeps the rules, review queue and audit trail."
      />

      {error && <ErrorBox error={error} retry={reload} />}
      {!info ? (
        !error && <Loading what="connection details" />
      ) : (
        <>
          <section className="section" aria-labelledby="server">
            <h2 id="server">This server</h2>
            <dl className="kv">
              <dt>MCP endpoint</dt>
              <dd className="row wrap">
                <code className="break">{info.mcpUrl}</code>
                <CopyButton text={info.mcpUrl} />
              </dd>
              <dt>Sign-in</dt>
              <dd>
                {info.auth === "none" ? (
                  <>None. The server only answers on this machine.</>
                ) : (
                  <>
                    Access tokens. Create a personal token under <a href="#/account">Account</a>; decisions are recorded under its owner.
                  </>
                )}
              </dd>
              <dt>ChatGPT and Claude.ai</dt>
              <dd>
                {info.oauth ? (
                  <>
                    Ready. OAuth runs at <code>{info.publicUrl}</code>; add the connector and approve with your Acai token.
                  </>
                ) : (
                  <>
                    <span className="muted">Not set up.</span> These apps need a public HTTPS address: set <code>ACAI_PUBLIC_URL</code>
                    {info.auth === "none" && (
                      <>
                        {" "}
                        and create an account (<code>ACAI_ADMIN_TOKEN</code> or <code>acai users add</code>)
                      </>
                    )}
                    . A tunnel works. Pick ChatGPT below for the steps.
                  </>
                )}
              </dd>
              <dt>Project</dt>
              <dd>
                {projects.data && projects.data.length > 0 ? (
                  <select aria-label="Project for the local setup" value={info.project?.id ?? ""} onChange={(e) => setProject(e.target.value)}>
                    {projects.data.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}: {p.root}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted">No project yet; the local setup uses a placeholder path.</span>
                )}
                <p className="muted small">Local agents work on this project. Agents over HTTP can use every project (<code>acai_projects</code>).</p>
              </dd>
            </dl>
            {!info.bundleBuilt && !info.container && (
              <div className="callout callout-warn">
                <TriangleAlert size={16} aria-hidden />
                <span>
                  The local setup runs <code>dist/acai/acai.mjs</code>, which is not built. Run <code>npm run build</code> in the Acai repository first.
                </span>
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="setup">
            <h2 id="setup">Set up your agent</h2>
            <div className="client-groups">
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <h3>{g.title}</h3>
                  <div className="client-pick" role="group" aria-label={g.title}>
                    {g.clients.map((id) => (
                      <button key={id} type="button" aria-pressed={current?.id === id} onClick={() => setClient(id)}>
                        {SHORT[id] ?? id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {current && guide && (
              <div className="guide-panel">
                <div className="row wrap guide-head">
                  <h3 className="guide-title">{current.label}</h3>
                  <span className="grow" />
                  <Segmented
                    label="Connection"
                    value={effectiveMode}
                    onChange={setMode}
                    options={[
                      { value: "local", label: "On this machine", title: info.container ? "Acai runs in a container: agents connect over HTTP" : current.remoteOnly ? "This client only connects over the internet" : "The agent starts Acai itself (stdio)" },
                      { value: "remote", label: "Over HTTP", title: "Connect to this running server" },
                    ]}
                    disabled={httpOnly}
                  />
                </div>
                {!(current.remoteOnly && !info.oauth) && (
                  <p className="muted small">
                    {effectiveMode === "local"
                      ? "The agent starts its own Acai process for the project above. Nothing to keep running, no token needed."
                      : current.remoteOnly
                        ? `The client reaches ${info.mcpUrl} and signs in with OAuth.`
                        : info.container
                          ? `Acai runs in a container; agents on your computer connect to ${info.mcpUrl}${info.auth === "none" ? "" : " with your Acai token"}. Open the agent in the repository's folder; Acai sees the same files through the mount.`
                          : `The agent connects to ${info.mcpUrl}${info.auth === "none" ? " (no token needed on this machine; leave out the Authorization header)" : " with your Acai token"}.`}
                  </p>
                )}
                <GuideBody guide={guide} />
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="ask">
            <SectionHead id="ask" title="Then ask it" description="Plain language, any language. The agent asks you before every decision." />
            <PromptExamples groups={PROMPT_GROUPS.slice(0, 1)} />
            <p className="small" style={{ marginTop: 8 }}>
              <a href="#/guide/ask">More examples</a>
            </p>
          </section>
        </>
      )}

      <section className="section" aria-labelledby="flow">
        <h2 id="flow">What happens</h2>
        <div className="table-wrap">
          <table className="table guide-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>What happens</th>
                <th>MCP tools</th>
              </tr>
            </thead>
            <tbody>
              {STEPS.map((x, i) => (
                <tr key={x.title}>
                  <td>
                    {i + 1}. {x.title}
                  </td>
                  <td>{x.what}</td>
                  <td data-label="Tools" className="mono small muted">
                    {x.tools}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="section" aria-labelledby="nofiles">
          <h2 id="nofiles">Agents without access to your files</h2>
          <p>
            ChatGPT, Claude.ai and API-based agents run in the cloud. Acai gives them <code>acai_list_files</code>, <code>acai_read_file</code>,{" "}
            <code>acai_search_code</code>, <code>acai_edit_file</code> and <code>acai_write_file</code>:
          </p>
          <ul className="tight">
            <li>
              Inside the project only: no <code>.git</code>, no <code>.acai</code>, no symbolic links.
            </li>
            <li>
              Credential files such as <code>.env</code> are never shown; secrets are redacted.
            </li>
            <li>
              Edits only while a confirmed finding is being fixed (<code>acai_begin_fix</code> to <code>acai_complete_fix</code>).
            </li>
          </ul>
          <p className="muted small">Claude Code, Codex and Cursor use their own file tools.</p>
        </section>

        <section className="section" aria-labelledby="safety">
          <h2 id="safety">Who decides</h2>
          <ul className="tight">
            <li>
              Review decisions need <code>user_confirmed: true</code>, reserved for decisions you made. Each one goes into the hash-chained audit trail under your name.
            </li>
            <li>A fix is committed only after the approved build and tests pass and the detector no longer matches; otherwise it is rolled back.</li>
            <li>
              Approving build and test commands runs project code, so it needs your consent. On a shared server only <code>ACAI_APPROVERS</code> may approve.
            </li>
            <li>ChatGPT and Claude.ai sign in through a consent page with your Acai token and get short-lived tokens.</li>
          </ul>
        </section>
      </div>

      <details className="section tools-ref">
        <summary>
          <strong>Tools reference</strong> <span className="muted small">28 tools, the <code>audit</code> prompt and the <code>acai://playbook</code> resource</span>
        </summary>
        <dl className="kv">
          {TOOLS.map((t) => (
            <ToolRow key={t.group} group={t.group}>
              {t.names.split(", ").map((n) => (
                <code key={n}>{n}</code>
              ))}
            </ToolRow>
          ))}
        </dl>
      </details>
    </div>
  );
}

function ToolRow({ group, children }: { group: string; children: ReactNode }) {
  return (
    <>
      <dt>{group}</dt>
      <dd className="tool-names">{children}</dd>
    </>
  );
}
