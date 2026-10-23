import { useEffect, useState } from "react";
import { api, paths } from "../api";
import { SectionHead } from "../components/ui";
import { useShell, useToast } from "../context";
import { AutomationCard } from "./Automation";
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

  return (
    <fieldset disabled={shell.meta.account?.role === "viewer"}>
      {shell.meta.account?.role !== "viewer" && <AutomationCard />}

      <section className="section" aria-labelledby="verify-h">
        <SectionHead id="verify-h" title="Build and test" description="Every fix must pass these commands before it is committed. They run in the project directory on the server." />
        <div className="stack">
          <label className="field">
            <span>Commands, one per line</span>
            <textarea className="mono" rows={4} value={commands} onChange={(e) => setCommands(e.target.value)} placeholder={"make all\nmake test"} />
          </label>
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Timeout per command (seconds)</span>
            <input type="number" min={10} max={7200} value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
            <span>
              I approve running these commands. They execute this project's code on the server.
              {p.verify.approved && p.verify.approvedBy && <span className="muted"> Approved by {p.verify.approvedBy.name}.</span>}
            </span>
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => save("/verify", { commands: list, approve, timeoutSec: timeout }, "Build and test settings saved.")}>
              Save
            </button>
            <button className="btn" disabled={!p.verify.approved || !p.verify.commands.length || Boolean(shell.running)} onClick={() => shell.startJob(paths.project(shell.pid, "/verify/run"))}>
              Run now
            </button>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="fix-h">
        <h2 id="fix-h">Fixes and research</h2>
        <label className="check">
          <input type="checkbox" checked={fix.useBranch} onChange={(e) => setFix({ ...fix, useBranch: e.target.checked })} />
          <span>Commit fixes on a separate branch (recommended)</span>
        </label>
        <div className="field-row" style={{ maxWidth: 520 }}>
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
          <span>Offer web research for requirements beyond the registry</span>
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={() => save("/settings", { ...fix, researchEnabled: research }, "Settings saved.")}>
            Save
          </button>
        </div>
      </section>

      <section className="section" aria-labelledby="model-h">
        <h2 id="model-h">Model and agents</h2>
        <ProviderLine meta={shell.meta} />
        <p className="muted small">
          Agent features send the excerpts they read to this destination, secrets redacted. Detectors, scoping, verification and reports run locally. To use your own coding agent
          on this project, <a href={`#/connect/${encodeURIComponent(shell.pid)}`}>connect it</a>.
        </p>
      </section>
    </fieldset>
  );
}
