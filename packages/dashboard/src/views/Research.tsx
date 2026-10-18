import { ExternalLink, Microscope } from "lucide-react";
import { api, paths } from "../api";
import { ActorTag, Badge, Empty, ErrorBox, Loading, SeverityBadge } from "../components/ui";
import { useShell, useToast } from "../context";
import { useResource } from "../hooks";
import { categoryLabel, type ResearchRule } from "../types";

export function Research() {
  const shell = useShell();
  const toast = useToast();
  const { data, error, reload } = useResource<ResearchRule[]>(paths.project(shell.pid, "/research"), shell.version);
  const web = shell.meta.provider?.webSearch;
  const decide = async (id: string, decision: "accepted" | "rejected") => {
    try {
      await api.post(paths.project(shell.pid, `/research/${encodeURIComponent(id)}`), { decision });
      toast.success(decision === "accepted" ? `${id} added to this project's rules. Run a new audit to apply it.` : `${id} rejected.`);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head">
          <h2>Research guardrails</h2>
          <span className="grow" />
          <button className="btn btn-accent" disabled={!web || Boolean(shell.running)} onClick={() => shell.startJob(paths.project(shell.pid, "/research/run"))}>
            <Microscope size={14} aria-hidden /> Run research
          </button>
        </div>
        <p className="muted">
          The agent searches official sources for requirements that the registry does not cover yet (recent amendments, national rules, sector guidance). Every rule needs your acceptance before it is used.
          {!web && " Research needs a model with web search here (Anthropic or OpenAI); an MCP host can also research and submit rules with assay_propose_rules."}
        </p>
      </section>
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="research" />
      ) : !data.length ? (
        <Empty title="No proposed rules yet" />
      ) : (
        data.map((r) => (
          <article key={r.id} className="card">
            <header className="row wrap">
              <span className="mono small">{r.id}</span>
              <SeverityBadge severity={r.severity} />
              <Badge>{categoryLabel(r.category)}</Badge>
              <Badge tone={r.status === "accepted" ? "teal" : r.status === "rejected" ? "neutral" : "warn"}>{r.status}</Badge>
              <span className="grow" />
              <span className="muted small">proposed by <ActorTag actor={r.proposedBy} /></span>
            </header>
            <h3>{r.title}</h3>
            <p>{r.requirement}</p>
            <p className="muted small"><strong>How to verify:</strong> {r.guidance}</p>
            <ul className="sources">
              {r.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url} <ExternalLink size={12} aria-hidden /></a>
                </li>
              ))}
            </ul>
            {r.status === "proposed" && (
              <div className="actions">
                <button className="btn btn-sm btn-primary" onClick={() => decide(r.id, "accepted")}>Accept</button>
                <button className="btn btn-sm btn-danger" onClick={() => decide(r.id, "rejected")}>Reject</button>
              </div>
            )}
          </article>
        ))
      )}
    </div>
  );
}
