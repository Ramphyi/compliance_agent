import { type ReactNode, useEffect, useState } from "react";
import { absolute, api } from "../api";
import { PromptExamples } from "../components/prompts";
import { ErrorBox, Loading, PageHeader, Snippet } from "../components/ui";
import { useToast } from "../context";
import { go, useResource } from "../hooks";
import type { ConnectInfo, Meta, ProjectListItem, RegistryInfo } from "../types";
import { GuideBody } from "./Connect";
import { ProviderLine } from "./Projects";

const SECTIONS = [
  { id: "workflow", label: "How an audit works" },
  { id: "ways", label: "Ways to use it" },
  { id: "claude-code", label: "Claude Code" },
  { id: "ask", label: "What to ask" },
  { id: "agents", label: "Built-in agents" },
  { id: "rules", label: "Rules" },
  { id: "data", label: "Where data lives" },
] as const;

const WORKFLOW: { step: string; what: string; where: string; agent: string }[] = [
  { step: "Understand", what: "Scans the code and classifies the product.", where: "Overview → Understand the product", agent: "“Audit this app with Acai.”" },
  { step: "Ask", what: "Markets, audience, data, AI use, safety level. Drafted answers stay unconfirmed until you confirm them.", where: "Profile", agent: "Asks you in the chat" },
  { step: "Scope", what: "Each framework applies, does not apply, or waits for a missing fact. Nothing is guessed.", where: "Scope", agent: "Explains what applies" },
  { step: "Audit", what: "Detectors report file and line. The agent checks each in-scope control and records findings with evidence.", where: "Overview → Run audit", agent: "Investigates with its own model" },
  { step: "Review", what: "Confirm, reject, modify or send back each finding. Every decision is logged.", where: "Findings", agent: "Relays your decisions" },
  { step: "Fix", what: "Confirmed findings become tasks for a coding agent. A fix is committed on a branch only after the approved build and tests pass.", where: "Findings → Hand off to agent, Fixes", agent: "“Fix the confirmed Acai findings.”" },
  { step: "Report", what: "Markdown, JSON or SARIF. Re-run after fixes; decisions carry over.", where: "Export, top of a project", agent: "“Write the audit report.”" },
];

const KIND_LABELS: Record<string, string> = {
  regulation: "Regulations",
  standard: "Standards",
  guideline: "Guidelines",
  "platform-policy": "Platform policies",
  contract: "Contractual standards",
};

const BUILT_IN: { name: string; does: string; start: string }[] = [
  { name: "Product analyst", does: "Reads the README, manifests and entry points; describes the product and suggests answers.", start: "Overview → Understand the product" },
  { name: "Auditor", does: "Checks every in-scope control in batches and records findings with evidence.", start: "Overview → Run agent audit" },
  { name: "Re-investigator", does: "Looks again at one finding with your note: still valid, revised or withdrawn.", start: "Findings → Re-investigate" },
  { name: "Fixer", does: "Makes the smallest correct change, runs the build and tests, retries on failure.", start: "Findings → Fix with agent" },
  { name: "Researcher", does: "Searches official sources for requirements the registry lacks and proposes rules.", start: "Research (needs web search)" },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="section guide-section" id={`guide-${id}`} aria-labelledby={`guide-${id}-h`} tabIndex={-1}>
      <h2 id={`guide-${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

const scrollTo = (id: string) => {
  const el = document.getElementById(`guide-${id}`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.focus({ preventScroll: true });
};

export function GuideView({ meta, section }: { meta: Meta; section?: string }) {
  const toast = useToast();
  const registry = useResource<RegistryInfo>("api/registry");
  const projects = useResource<ProjectListItem[]>("api/projects");
  const connect = useResource<ConnectInfo>(`api/connect?url=${encodeURIComponent(absolute("mcp"))}`);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (section) requestAnimationFrame(() => scrollTo(section));
  }, [section, registry.data]);

  const reloadRules = async () => {
    setReloading(true);
    try {
      const res = await api.post<{ project: string; frameworks: number; controls: number; errors: { file: string; message: string }[] }[]>("api/registry/reload");
      const errors = res.flatMap((r) => r.errors);
      if (errors.length) toast.error(new Error(`${errors.length} rule file(s) failed validation: ${errors.map((e) => `${e.file.split("/").pop()}: ${e.message}`).join("; ").slice(0, 400)}`));
      else toast.success(res.length ? `Rules reloaded: ${res[0].frameworks} frameworks, ${res[0].controls} controls${res.length > 1 ? ` (first of ${res.length} projects)` : ""}.` : "Rules reloaded.");
      registry.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setReloading(false);
    }
  };

  const r = registry.data;
  const firstProject = projects.data?.[0];
  const cc = connect.data?.clients.find((c) => c.id === "claude-code");
  const claudeCode = cc?.local ?? (connect.data?.container ? cc?.remote : undefined);
  const kinds = r ? Object.keys(KIND_LABELS).filter((k) => r.frameworks.some((f) => f.kind === k)) : [];

  return (
    <div className="page">
      <PageHeader title="Guide" description="How an audit works, how to run it from an agent, and how to add rules." />
      <div className="guide-layout">
        <nav className="guide-nav" aria-label="Guide sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                go(`#/guide/${s.id}`, true);
                scrollTo(s.id);
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div>
          <Section id="workflow" title="How an audit works">
            <div className="table-wrap">
              <table className="table guide-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>What happens</th>
                    <th>In the dashboard</th>
                    <th>With an agent</th>
                  </tr>
                </thead>
                <tbody>
                  {WORKFLOW.map((w, i) => (
                    <tr key={w.step}>
                      <td>
                        {i + 1}. {w.step}
                      </td>
                      <td>{w.what}</td>
                      <td data-label="In the dashboard">{w.where}</td>
                      <td data-label="With an agent" className="muted">
                        {w.agent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              The dashboard and connected agents work on the same audit.
            </p>
          </Section>

          <Section id="ways" title="Ways to use it">
            <dl className="kv">
              <dt>Repository webhook</dt>
              <dd>
                Audits every push and reports what a pull request adds or fixes, as a GitHub comment. Set it up in a project's <em>Settings</em>.
              </dd>
              <dt>Your coding agent</dt>
              <dd>
                Claude Code, Codex, Copilot, Cursor and others connect over MCP and use their own model. Acai hands them tasks and verifies every fix. No model key needed
                in Acai. <a href="#/connect">Connect an agent</a>
              </dd>
              <dt>Dashboard and CI</dt>
              <dd>
                Review here and copy tasks with <em>Hand off to agent</em>. With a model configured, Acai's own agents audit and fix from the buttons. In CI:{" "}
                <code>acai ci --fail-on high</code>.
                <ProviderLine meta={meta} />
              </dd>
            </dl>
          </Section>

          <Section id="claude-code" title="Quick start: Claude Code">
            <p>
              {connect.data?.container
                ? "Acai runs in a container, so Claude Code connects over HTTP with your Acai token. Open Claude Code in the repository's folder on your computer (e.g. repos/<name> next to compose.yaml)."
                : "Claude Code starts Acai itself for the project you have open. Add it once:"}
            </p>
            {connect.error && <ErrorBox error={connect.error} retry={connect.reload} />}
            {claudeCode ? <GuideBody guide={claudeCode} /> : !connect.error && <Loading what="setup" />}
            <p className="muted small" style={{ marginTop: 10 }}>
              Other agents: <a href="#/connect">Connect</a>.
            </p>
          </Section>

          <Section id="ask" title="What to ask">
            <p className="muted">Plain language, any language. The agent asks you before every decision.</p>
            <PromptExamples />
            <p className="muted small" style={{ marginTop: 12 }}>
              The agent confirms, rejects or accepts only after you say so. Fixes need a clean git working tree and build and test commands approved once.
            </p>
          </Section>

          <Section id="agents" title="Built-in agents">
            <p className="muted">They run on the server with the configured model and stop wherever a person has to decide.</p>
            <ProviderLine meta={meta} />
            <div className="table-wrap">
              <table className="table guide-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>What it does</th>
                    <th>Start from</th>
                  </tr>
                </thead>
                <tbody>
                  {BUILT_IN.map((a) => (
                    <tr key={a.name}>
                      <td>{a.name}</td>
                      <td>{a.does}</td>
                      <td data-label="Start from">{a.start}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r && <p className="muted small" style={{ marginTop: 8 }}>Auditor batches: {r.batches.map((b) => b.title).join(", ")}.</p>}
            <h3>Without a model</h3>
            <p>
              {r ? `${r.checks.length} detectors and ${r.artifacts.length} evidence checks` : "Detectors and evidence checks"} always run: hardcoded secrets, weak crypto,
              disabled TLS verification, missing documents such as a DPIA, an SBOM or a security policy.
            </p>
          </Section>

          <Section id="rules" title="Rules">
            {registry.error && <ErrorBox error={registry.error} retry={registry.reload} />}
            {r ? (
              <>
                <p>
                  {r.frameworks.length} frameworks with {r.frameworks.reduce((n, f) => n + f.controlCount, 0)} controls. A framework applies only when the profile answers say
                  so; each control says what to check and what counts as evidence.
                </p>
                <details>
                  <summary>Show frameworks</summary>
                  {kinds.map((k) => (
                    <div key={k}>
                      <h3>{KIND_LABELS[k]}</h3>
                      <p className="small">
                        {r.frameworks
                          .filter((f) => f.kind === k)
                          .map((f, i) => (
                            <span key={f.id} title={`${f.title} (${f.version}), ${f.controlCount} controls`}>
                              {i > 0 && ", "}
                              {f.shortTitle}
                            </span>
                          ))}
                      </p>
                    </div>
                  ))}
                </details>
              </>
            ) : (
              !registry.error && <Loading what="registry" />
            )}

            <h3>Add or change rules</h3>
            <ol className="tight">
              <li>
                <strong>Include or exclude a framework</strong> for one project in its <em>Scope</em> tab.
              </li>
              <li>
                <strong>Start from a preset</strong> in the <em>Profile</em> tab.
                {r && (
                  <details>
                    <summary className="small">{r.presets.length} presets</summary>
                    <ul className="tight small">
                      {r.presets.map((p) => (
                        <li key={p.id}>
                          <code>{p.id}</code> {p.title}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
              <li>
                <strong>Research</strong> in the <em>Research</em> tab, or ask your agent. Accepted rules are saved in <code>.acai/rules/project-research.yaml</code>.
              </li>
              <li>
                <strong>Project rules</strong> (e.g. a company policy): a YAML file in{" "}
                {firstProject?.rulesDir ? <code className="break">{firstProject.rulesDir}/&lt;id&gt;.yaml</code> : <code>&lt;project&gt;/.acai/rules/&lt;id&gt;.yaml</code>}. The file
                name must equal the <code>id</code>.
                {r?.ruleTemplate && (
                  <details className="rule-template">
                    <summary className="small">Rule template</summary>
                    <Snippet label="Rule template (YAML)" text={r.ruleTemplate} />
                  </details>
                )}
              </li>
              <li>
                <strong>Rules for every project</strong>: add the file to <code>registry/frameworks/</code>, run <code>npm run registry:validate</code> and rebuild. Or point{" "}
                <code>ACAI_REGISTRY</code> at your own copy.
                {r && (
                  <div className="muted small">
                    This server reads <code className="break">{r.root}</code>
                    {/[\\/]dist[\\/]acai[\\/]registry$/.test(r.root) && " (the build's copy: changes there are lost on the next build)"}.
                  </div>
                )}
              </li>
            </ol>
            <div className="form-actions">
              <button className="btn" onClick={reloadRules} disabled={reloading}>
                {reloading ? "Reloading…" : "Reload rules"}
              </button>
              <span className="muted small">Invalid files are skipped and listed.</span>
            </div>
            <p className="muted small" style={{ marginTop: 12 }}>
              Format and available facts: <code>registry/README.md</code> and <code>registry/questionnaire.yaml</code>. Paraphrase licensed standards (ISO, IEC, MISRA); never
              copy them.
            </p>
          </Section>

          <Section id="data" title="Where data lives">
            <dl className="kv">
              <dt>
                <code>.acai/</code> in each project
              </dt>
              <dd>
                Profile, audits, findings, the hash-chained audit trail (<code>journal</code>), project rules and reports. Plain JSON and YAML: commit it as the audit
                record, or ignore it.
              </dd>
              <dt>
                <code>~/.acai</code> (<code>ACAI_HOME</code>)
              </dt>
              <dd>The project list, cloned repositories and connector sign-ins (token hashes only).</dd>
              <dt>What leaves the machine</dt>
              <dd>
                Only with agent features: the excerpts the agent reads go to its model, secrets redacted. <code>.env</code>, key and keystore files are never sent.
              </dd>
              <dt>Fixes</dt>
              <dd>
                Committed on a separate branch (<code>acai/fixes-…</code>) after the build and tests pass. Nothing is merged for you.
              </dd>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
