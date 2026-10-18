import { Play, Save, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { absolute, api, paths } from "../api";
import { Snippet } from "../components/ui";
import { useShell, useToast } from "../context";
import { ProviderLine } from "./Projects";

export function SettingsView() {
  const shell = useShell();
  const toast = useToast();
  const p = shell.profile!;
  const [commands, setCommands] = useState(p.verify.commands.join("\n"));
  const [timeout, setTimeoutSec] = useState(p.verify.timeoutSec);
  const [approve, setApprove] = useState(p.verify.approved);
  const [fix, setFix] = useState(p.fix);
  const [research, setResearch] = useState(p.research.enabled);
  useEffect(() => {
    setCommands(p.verify.commands.join("\n"));
    setTimeoutSec(p.verify.timeoutSec);
    setApprove(p.verify.approved);
    setFix(p.fix);
    setResearch(p.research.enabled);
  }, [p]);

  const list = commands.split("\n").map((x) => x.trim()).filter(Boolean);
  const save = async (path: string, body: unknown, msg: string) => {
    try {
      await api.post(paths.project(shell.pid, path), body);
      toast.success(msg);
      shell.refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const mcpUrl = absolute("mcp");
  const auth = shell.meta.auth !== "none";

  return (
    <div className="stack-lg">
      <section className="card">
        <h2>Build and test verification</h2>
        <p className="muted">Every fix must pass these commands before it is committed. They run in the project directory on the Assay server.</p>
        <label className="field">
          <span>Commands, one per line, run in order</span>
          <textarea className="mono" rows={4} value={commands} onChange={(e) => setCommands(e.target.value)} placeholder={"make all\nmake test"} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Timeout per command (seconds)</span>
            <input type="number" min={10} max={7200} value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value))} />
          </label>
        </div>
        <label className="check callout callout-warn">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
          <span>
            <TriangleAlert size={14} aria-hidden /> I approve running these commands. They execute this project's code (build scripts, tests) on the server.
            {p.verify.approved && p.verify.approvedBy && <span className="muted"> Currently approved by {p.verify.approvedBy.name}.</span>}
          </span>
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={() => save("/verify", { commands: list, approve, timeoutSec: timeout }, "Verification settings saved.")}>
            <Save size={14} aria-hidden /> Save
          </button>
          <button className="btn" disabled={!p.verify.approved || !p.verify.commands.length || Boolean(shell.running)} onClick={() => shell.startJob(paths.project(shell.pid, "/verify/run"))}>
            <Play size={14} aria-hidden /> Run now
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Fixes and research</h2>
        <label className="check">
          <input type="checkbox" checked={fix.useBranch} onChange={(e) => setFix({ ...fix, useBranch: e.target.checked })} />
          <span>Commit fixes on a separate branch (recommended)</span>
        </label>
        <div className="field-row">
          <label className="field">
            <span>Branch prefix</span>
            <input className="mono" value={fix.branchPrefix} onChange={(e) => setFix({ ...fix, branchPrefix: e.target.value })} disabled={!fix.useBranch} />
          </label>
          <label className="field">
            <span>Attempts per fix</span>
            <input type="number" min={1} max={6} value={fix.maxAttempts} onChange={(e) => setFix({ ...fix, maxAttempts: Number(e.target.value) })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} />
          <span>Offer web research for guardrails beyond the registry</span>
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={() => save("/settings", { ...fix, researchEnabled: research }, "Settings saved.")}>
            <Save size={14} aria-hidden /> Save
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Model</h2>
        <ProviderLine meta={shell.meta} />
        <p className="muted small">
          Agent features send the code excerpts the agent reads to this destination, with secrets redacted; credential files are never sent. Detectors, scoping, verification and reports run locally. The model is configured on the server (ANTHROPIC_API_KEY, or ASSAY_PROVIDER=openai-compatible for an on-premise model).
        </p>
      </section>

      <section className="card">
        <h2>Connect an AI agent (MCP)</h2>
        <p className="muted">
          With MCP, your coding agent (Claude Code, Cursor, VS Code agent mode) does the reasoning with its own tools while Assay keeps the rules, review queue, verification and audit trail. Decisions you make here are picked up by the agent.
        </p>
        <h3>Claude Code, on this machine</h3>
        <Snippet label="Claude Code command" text={`claude mcp add assay -- node /path/to/dist/assay/assay.mjs mcp ${p.root} --dashboard`} />
        <h3>Any MCP client, over HTTP</h3>
        <Snippet
          label="HTTP MCP configuration"
          text={JSON.stringify({ mcpServers: { assay: { type: "http", url: mcpUrl, ...(auth ? { headers: { Authorization: "Bearer <your token>" } } : {}) } } }, null, 2)}
        />
        {auth && <p className="muted small">This server requires a token; MCP decisions are attributed to the token's owner.</p>}
        <h3>VS Code</h3>
        <p className="muted small">Install the Assay extension (dist/assay-vscode.vsix): it shows findings in the Problems panel and registers this MCP server for agent mode automatically.</p>
      </section>
    </div>
  );
}
