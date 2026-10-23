import { ExternalLink } from "lucide-react";
import { api, paths } from "../api";
import { ActorTag, Badge, Empty, ErrorBox, Loading, SectionHead, SeverityBadge } from "../components/ui";
import { useShell, useToast } from "../context";
import { useResource } from "../hooks";
import { categoryLabel, type ResearchRule } from "../types";

export function Research() {
  const shell = useShell();
  const toast = useToast();
  const { data, error, reload } = useResource<ResearchRule[]>(paths.project(shell.pid, "/research"), shell.version);
  const web = shell.meta.provider?.webSearch;
  const viewer = shell.meta.account?.role === "viewer";
  const decide = async (id: string, decision: "accepted" | "rejected") => {
    try {
      await api.post(paths.project(shell.pid, `/research/${encodeURIComponent(id)}`), { decision });
      toast.success(decision === "accepted" ? `${id} added to this project's rules. It applies from the next audit.` : `${id} rejected.`);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div>
      <SectionHead
        title="Research"
        description={
          <>
            The agent searches official sources for requirements the registry lacks: amendments, national rules, sector guidance. Each rule needs your acceptance.
            {!web && " Needs a model with web search (Anthropic or OpenAI); a connected agent can also propose rules with acai_propose_rules."}
          </>
        }
        actions={
          !viewer && (
            <button className="btn btn-primary btn-sm" disabled={!web || Boolean(shell.running)} onClick={() => shell.startJob(paths.project(shell.pid, "/research/run"))}>
              Run research
            </button>
          )
        }
      />
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="research" />
      ) : !data.length ? (
        <Empty title="No proposed rules yet" />
      ) : (
        <div style={{ marginTop: 12 }}>
          {data.map((r) => (
            <article key={r.id} className="rule-item">
              <div className="detail-meta">
                <span className="mono">{r.id}</span>
                <SeverityBadge severity={r.severity} />
                <span>{categoryLabel(r.category)}</span>
                <Badge tone={r.status === "accepted" ? "ok" : r.status === "rejected" ? "neutral" : "warn"}>{r.status}</Badge>
                <span className="grow" />
                <span>
                  Proposed by <ActorTag actor={r.proposedBy} />
                </span>
              </div>
              <h3>{r.title}</h3>
              <p>{r.requirement}</p>
              <p className="muted small">
                <strong>How to verify:</strong> {r.guidance}
              </p>
              <ul className="sources small">
                {r.sources.map((src) => (
                  <li key={src.url}>
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.title || src.url} <ExternalLink size={12} aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
              {r.status === "proposed" && !viewer && (
                <div className="form-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => decide(r.id, "accepted")}>
                    Accept
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => decide(r.id, "rejected")}>
                    Reject
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
