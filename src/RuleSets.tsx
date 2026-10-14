import { useEffect, useState } from "react";
import { BookOpen, Search, Plus, Check, ExternalLink } from "lucide-react";
import { api, post, date } from "./api";
import { Button, Field } from "./ui";
import type { RuleSet } from "../server/rule-sets";
export type RuleDraft = { id: string; payload: RuleSet; applied: boolean };
export function RuleDraftCard({
  draft,
  projectId,
  onApplied,
}: {
  draft: RuleDraft;
  projectId: string;
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <article className="rule-draft">
      <div className="rule-draft-heading">
        <BookOpen size={21} />
        <div>
          <h3>{draft.payload.topic}</h3>
          <small>
            {draft.payload.mode === "live"
              ? `Official-source research · ${date(draft.payload.checkedAt!)}`
              : "Starter catalog · not checked live"}
          </small>
        </div>
        <b>{draft.payload.rules.length} rules</b>
      </div>
      <p>{draft.payload.summary}</p>
      <div className="rule-draft-list">
        {draft.payload.rules.map((rule) => (
          <details key={rule.id}>
            <summary>
              {rule.title} <span>{rule.severity}</span>
            </summary>
            <p>{rule.description}</p>
            {rule.source.startsWith("https://") && (
              <a href={rule.source} target="_blank" rel="noreferrer">
                Read source <ExternalLink size={13} />
              </a>
            )}
          </details>
        ))}
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <Button
        variant={draft.applied ? "outline" : "orange"}
        disabled={draft.applied}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await post(`/projects/${projectId}/rule-sets/${draft.id}/apply`);
            onApplied();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {draft.applied ? (
          <>
            <Check size={15} /> Added to project
          </>
        ) : (
          <>
            <Plus size={15} /> Add these rules to project
          </>
        )}
      </Button>
    </article>
  );
}
export default function RuleSets({
  projectId,
  onApplied,
}: {
  projectId: string;
  onApplied: () => void;
}) {
  const [topic, setTopic] = useState(""),
    [live, setLive] = useState(false),
    [ai, setAi] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [drafts, setDrafts] = useState<RuleDraft[]>([]);
  const load = () =>
    api<RuleDraft[]>(`/projects/${projectId}/rule-sets`).then(setDrafts);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    void api("/config")
      .then((c) => setAi(c.externalAi))
      .catch(() => {});
  }, [projectId]);
  return (
    <section className="rule-builder">
      <h2>Build a rule set for this software</h2>
      <p>
        Describe what you’re shipping, its users and markets. Review the
        proposed requirements and sources, then add the set to your project.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await post(`/projects/${projectId}/rule-sets`, {
              topic,
              liveResearch: live,
            });
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="What rules do you need?"
          hint="For example: privacy, access control and AI governance for a document collaboration SaaS sold to EU businesses."
        >
          <textarea
            required
            minLength={5}
            maxLength={2000}
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Find the current rules for…"
          />
        </Field>
        <label className="check-label">
          <input
            type="checkbox"
            checked={live}
            disabled={!ai}
            onChange={(e) => setLive(e.target.checked)}
          />{" "}
          Search current official sources with AI
        </label>
        <p className="small-note">
          {ai
            ? "Live research sends your topic and declared product profile to OpenAI. Each accepted rule must cite a source returned by the search."
            : "Live search needs OPENAI_API_KEY and ALLOW_EXTERNAL_AI on the server. Catalog drafts remain available and are labelled accordingly."}{" "}
          A generated set is a starting point for review, not every applicable
          law.
        </p>
        <Button variant="orange" type="submit" busy={busy}>
          <Search size={15} />
          {live ? "Research and draft rule set" : "Draft from starter catalog"}
        </Button>
      </form>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {drafts.map((draft) => (
        <RuleDraftCard
          key={draft.id}
          draft={draft}
          projectId={projectId}
          onApplied={() => {
            void load();
            onApplied();
          }}
        />
      ))}
    </section>
  );
}
