import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { absolute, api, paths } from "../api";
import { Badge, CopyButton, ErrorBox, Loading, SectionHead, Segmented, Snippet } from "../components/ui";
import { useShell, useToast } from "../context";
import { ago, href, useResource } from "../hooks";
import { type Automation, type AutomationInfo, SEVERITIES } from "../types";

const STATUS_TONE: Record<string, string> = { done: "ok", failed: "danger", skipped: "warn", ignored: "neutral", queued: "neutral", running: "accent" };

export function AutomationCard() {
  const shell = useShell();
  const toast = useToast();
  const { data, error, reload } = useResource<AutomationInfo>(paths.project(shell.pid, "/automation"), shell.version);
  const [s, setS] = useState<Automation | null>(null);
  const [host, setHost] = useState<"github" | "gitlab" | "generic">("github");
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !s) return <Loading what="automation" />;

  // "." drops any query string from the page address.
  const base = data.publicUrl ?? absolute(".").replace(/\/$/, "");
  const hookUrl = `${base}/hooks/${host}`;
  const local = !data.publicUrl && /\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(base);
  const save = async () => {
    try {
      await api.post(paths.project(shell.pid, "/automation"), s);
      toast.success("Automation saved.");
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <section className="section" aria-labelledby="automation-h">
      <SectionHead
        id="automation-h"
        title="Repository webhook"
        description="On a push, Acai pulls and audits the code. On a pull request, it reports what the change adds or fixes."
      />

      <dl className="kv">
        <dt>Repository</dt>
        <dd>
          {data.origin ? (
            <>
              <code className="break">{data.origin}</code>, branch <code>{data.branch}</code>
            </>
          ) : (
            <span className="bad-text">
              No origin remote, so webhooks can't find this project. Add it from its repository URL, or run <code>git remote add origin &lt;url&gt;</code>.
            </span>
          )}
        </dd>
        <dt>Webhooks on this server</dt>
        <dd>
          {data.secretSet ? (
            <>On. Deliveries are checked against <code>ACAI_WEBHOOK_SECRET</code>.</>
          ) : (
            <>
              <span className="muted">Off.</span> Set <code>ACAI_WEBHOOK_SECRET</code> (16+ random characters) on the server and restart it.
            </>
          )}
        </dd>
        <dt>Results on GitHub</dt>
        <dd>
          {data.githubToken ? (
            <>On. Commit statuses and pull request comments are posted with <code>GITHUB_TOKEN</code>.</>
          ) : (
            <>
              <span className="muted">Dashboard only.</span> Set <code>GITHUB_TOKEN</code> (statuses and pull request write access) to post results on GitHub.
            </>
          )}
        </dd>
      </dl>

      <h3>Add the webhook</h3>
      <Segmented label="Repository host" value={host} onChange={setHost} options={[{ value: "github", label: "GitHub" }, { value: "gitlab", label: "GitLab" }, { value: "generic", label: "Other / CI" }]} />
      <div className="row wrap hook-url">
        <code className="break">{hookUrl}</code>
        <CopyButton text={hookUrl} />
      </div>
      {local && (
        <div className="callout callout-warn">
          <TriangleAlert size={16} aria-hidden />
          <span>
            This address only works on this computer. GitHub and GitLab need a public HTTPS address: use a tunnel (<code>cloudflared tunnel --url {base}</code>) or your reverse proxy, and set <code>ACAI_PUBLIC_URL</code>.
          </span>
        </div>
      )}
      {host === "github" && (
        <ol className="tight">
          <li>Repository → Settings → Webhooks → Add webhook.</li>
          <li>Payload URL: the address above. Content type: <code>application/json</code>. Secret: the value of <code>ACAI_WEBHOOK_SECRET</code>.</li>
          <li>Events: <em>Pushes</em> and <em>Pull requests</em>. GitHub sends a ping and shows a green tick when Acai answers.</li>
        </ol>
      )}
      {host === "gitlab" && (
        <ol className="tight">
          <li>Project → Settings → Webhooks → Add new webhook.</li>
          <li>URL: the address above. Secret token: the value of <code>ACAI_WEBHOOK_SECRET</code>.</li>
          <li>Triggers: <em>Push events</em> and <em>Merge request events</em>. Results show here; posting back to GitLab is not supported.</li>
        </ol>
      )}
      {host === "generic" && (
        <>
          <p className="small">From CI or a script: POST JSON signed with HMAC-SHA256 of the body.</p>
          <Snippet
            label="Signed request"
            text={`body='{"repository":"${data.origin ?? "<origin url>"}","ref":"refs/heads/${data.branch ?? "main"}"}'\nsig=$(printf %s "$body" | openssl dgst -sha256 -hmac "$ACAI_WEBHOOK_SECRET" | sed 's/^.* //')\ncurl -X POST ${hookUrl} -H 'Content-Type: application/json' -H "X-Acai-Signature: sha256=$sig" -d "$body"`}
          />
          <p className="muted small">
            For a pull request, send <code>{`{"repository": …, "pull_request": {"number": 7, "head_sha": "<sha>"}}`}</code>; the commit must be fetchable from the origin.
          </p>
        </>
      )}

      <h3>What happens</h3>
      <div className="field-row automation-form">
        <label className="field">
          <span>On a push to {data.branch ?? "the audited branch"}</span>
          <select value={s.push} onChange={(e) => setS({ ...s, push: e.target.value as Automation["push"] })}>
            <option value="off">Nothing</option>
            <option value="scan">Detector scan (seconds, no model)</option>
            <option value="agent">Agent audit{data.model ? "" : " (needs a model)"}</option>
          </select>
        </label>
        <label className="field">
          <span>On a pull request</span>
          <select value={s.pullRequest} onChange={(e) => setS({ ...s, pullRequest: e.target.value as Automation["pullRequest"] })}>
            <option value="off">Nothing</option>
            <option value="scan">Scan what it adds and fixes</option>
          </select>
        </label>
        <label className="field">
          <span>Fail the commit status at</span>
          <select value={s.failOn} onChange={(e) => setS({ ...s, failOn: e.target.value as Automation["failOn"] })}>
            {SEVERITIES.filter((x) => x !== "info").map((x) => (
              <option key={x} value={x}>
                {x} or above
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.report.commitStatus} onChange={(e) => setS({ ...s, report: { ...s.report, commitStatus: e.target.checked } })} />
        <span>Set a commit status on GitHub (can block merging)</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.report.prComment} onChange={(e) => setS({ ...s, report: { ...s.report, prComment: e.target.checked } })} />
        <span>Comment on pull requests with what they add (one comment, kept up to date)</span>
      </label>
      {s.push === "agent" && !data.model && (
        <p className="small bad-text">
          No model is configured, so pushes get a detector scan. <a href="#/model">Choose a model</a>
        </p>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
      </div>

      <h3>Recent deliveries</h3>
      {data.deliveries.length ? (
        <div className="table-wrap">
          <table className="table deliveries">
            <tbody>
              {data.deliveries.slice(0, 15).map((d) => (
                <tr key={d.id}>
                  <td className="nowrap muted small">{ago(d.at)}</td>
                  <td className="nowrap">
                    {d.provider} {d.event}
                    {d.sha && <span className="mono muted"> {d.sha.slice(0, 7)}</span>}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
                  </td>
                  <td>
                    {d.message}
                    {d.reported?.length ? <span className="muted"> Posted: {d.reported.join(", ")}.</span> : null}
                    {d.auditId && (
                      <>
                        {" "}
                        <a href={href(shell.pid, "findings")}>Findings</a>
                      </>
                    )}
                    {d.pr?.url && (
                      <>
                        {" "}
                        <a href={d.pr.url} target="_blank" rel="noreferrer">
                          Pull request
                        </a>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">None yet.</p>
      )}
    </section>
  );
}
