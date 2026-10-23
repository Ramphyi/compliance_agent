import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorBox, Loading, PageHeader } from "../components/ui";
import { useToast } from "../context";
import { useResource } from "../hooks";
import type { Effort, ModelState, ProviderPresetInfo } from "../types";

const GROUPS: { label: string; match: (p: ProviderPresetInfo) => boolean }[] = [
  { label: "Cloud", match: (p) => !p.local && !p.group && p.id !== "openai-compatible" },
  { label: "Microsoft Foundry (Azure)", match: (p) => p.group === "azure" },
  { label: "On your machine", match: (p) => Boolean(p.local) },
  { label: "Other", match: (p) => p.id === "openai-compatible" },
];

export function ModelView({ onChanged, readOnly = false }: { onChanged: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useResource<ModelState>("api/model");
  const [preset, setPreset] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<Effort | "">("");
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"list" | "save" | "reset" | null>(null);

  // Start the form from the saved choice, else from what is running.
  useEffect(() => {
    if (!data) return;
    const s = data.saved;
    const id = s?.preset ?? data.active?.preset ?? "anthropic";
    setPreset(id);
    setBaseURL(s?.baseURL ?? "");
    setModel(s?.model ?? (data.active?.preset === id ? data.active.model : ""));
    setEffort(s?.effort ?? "");
  }, [data]);

  if (error) return <div className="page"><ErrorBox error={error} retry={reload} /></div>;
  if (!data) return <Loading what="model settings" />;

  const p = data.presets.find((x) => x.id === preset) ?? data.presets[0];
  const savedKey = data.saved?.preset === p.id && data.saved.hasKey;
  const body = () => ({ preset: p.id, baseURL, apiKey, model, effort: effort || undefined });
  const choose = (id: string) => {
    setPreset(id);
    setBaseURL("");
    setApiKey("");
    setModel("");
    setModels(null);
  };

  const loadModels = async () => {
    setBusy("list");
    try {
      const r = await api.post<{ models: string[] }>("api/model/models", body());
      setModels(r.models);
      toast.success(
        p.id === "azure-claude"
          ? "Foundry has no model list for Claude: these are the default deployment names. Use yours if you renamed it."
          : p.deployments
            ? `${p.label}: the key works. ${r.models.length} models on the resource; enter your deployment name.`
            : r.models.length
              ? `${p.label}: ${r.models.length} models.`
              : `${p.label} answered but listed no models.`,
      );
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy("save");
    try {
      const next = await api.post<ModelState>("api/model", body());
      setApiKey("");
      toast.success(`Now using ${next.active?.destination ?? "no model"}.`);
      reload();
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    setBusy("reset");
    try {
      await api.del("api/model");
      toast.success("Using the server environment settings.");
      reload();
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const keyHint = savedKey
    ? "A key is saved. Leave empty to keep it."
    : p.keyInEnvironment
      ? `Using ${p.keyEnv} from the server environment. Paste a key to override it.`
      : p.needsKey
        ? `Your ${p.label} API key${p.keyEnv ? `, or set ${p.keyEnv} on the server` : ""}.`
        : "Usually not needed.";

  return (
    <div className="page page-narrow">
      <PageHeader title="Model" description="Used by Acai's own agents. Agents connected over MCP use their own model." />

      <section className="section" aria-labelledby="current">
        <h2 id="current">In use</h2>
        {data.active ? (
          <dl className="kv">
            <dt>Model</dt>
            <dd>
              {data.active.model} <span className="muted">· {data.source === "settings" ? "chosen here" : "from the environment"}</span>
            </dd>
            <dt>Code excerpts go to</dt>
            <dd>{data.active.destination}</dd>
            <dt>Web research</dt>
            <dd>{data.active.webSearch ? "Available" : <span className="muted">Not with this provider</span>}</dd>
          </dl>
        ) : (
          <p className="muted">None. Acai runs its detectors only; a connected agent can do the reasoning.</p>
        )}
        {data.error && (
          <div className="callout callout-error">
            <TriangleAlert size={16} aria-hidden />
            <span>The configured model could not be set up: {data.error}</span>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="choose">
        <h2 id="choose">Choose a model</h2>
        {data.locked && (
          <div className="callout callout-warn">
            <TriangleAlert size={16} aria-hidden />
            <span>
              Set by the administrator (<code>ACAI_MODEL_LOCKED=1</code>).
            </span>
          </div>
        )}
        <fieldset className="stack" disabled={data.locked || readOnly}>
          <div className="provider-groups">
            {GROUPS.map((g) => (
              <div key={g.label}>
                <h3>{g.label}</h3>
                <div className="client-pick" role="group" aria-label={`${g.label} providers`}>
                  {data.presets.filter(g.match).map((x) => (
                    <button key={x.id} type="button" aria-pressed={x.id === p.id} onClick={() => choose(x.id)}>
                      {x.id === "openai-compatible" ? "Custom endpoint" : x.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="field-row">
            <label className="field">
              <span>Endpoint</span>
              <input className="mono" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder={p.baseURL ?? p.endpointHint ?? (p.engine === "openai-compatible" ? "https://your-endpoint/v1" : "Default API")} />
            </label>
            <label className="field">
              <span>API key</span>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={savedKey ? "••••••••  (saved)" : p.keyInEnvironment ? `$${p.keyEnv}` : ""} autoComplete="off" />
            </label>
          </div>
          <p className="muted small model-hint">
            {keyHint}
            {p.docs && (
              <>
                {" "}
                <a href={p.docs} target="_blank" rel="noreferrer">
                  {p.group === "azure" ? "Setup guide" : "Get a key"}
                </a>
              </>
            )}
            {p.local && data.inContainer && " In a container, the endpoint reaches your computer through host.docker.internal."}
            {p.group === "azure" && (
              <>
                {" "}
                In the Foundry portal, open your deployment (Build → Models → Details): use its Target URI as the endpoint (the resource URL is enough) and its Key. The
                model is the deployment name.{p.endpointEnv && <> On the server: {p.endpointEnv.join(" or ")} and {p.keyEnv}.</>}
              </>
            )}
          </p>

          <div className="field-row">
            <label className="field">
              <span>{p.deployments ? "Deployment name" : "Model"}</span>
              <input list="model-options" value={model} onChange={(e) => setModel(e.target.value)} placeholder={p.defaultModel ?? (p.deployments ? "Your deployment name, e.g. gpt-5.5" : "Load the models, then pick one")} />
              <datalist id="model-options">{models?.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            {p.engine !== "openai-compatible" && (
              <label className="field effort-field">
                <span>Reasoning effort</span>
                <select value={effort} onChange={(e) => setEffort(e.target.value as Effort | "")}>
                  <option value="">Default</option>
                  {(["low", "medium", "high", "xhigh", "max"] as const).map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {models && models.length > 0 && (
            <div className="model-list" role="group" aria-label="Available models">
              {models.slice(0, 60).map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={m === model} onClick={() => setModel(m)}>
                  {m}
                </button>
              ))}
              {models.length > 60 && <span className="muted small">and {models.length - 60} more; type to search</span>}
            </div>
          )}

          <div className="form-actions">
            <button className="btn btn-primary" type="button" onClick={save} disabled={Boolean(busy) || (!model && !p.defaultModel)}>
              {busy === "save" ? "Saving…" : "Save and use"}
            </button>
            <button className="btn" type="button" onClick={loadModels} disabled={Boolean(busy)} title="Lists the provider's models and checks the endpoint and key">
              {busy === "list" ? "Loading…" : "Load models"}
            </button>
            {data.source === "settings" && (
              <button className="btn btn-ghost" type="button" onClick={reset} disabled={Boolean(busy)}>
                Use environment settings
              </button>
            )}
          </div>
        </fieldset>
      </section>

      <section className="section" aria-labelledby="notes">
        <h2 id="notes">Notes</h2>
        <ul className="tight">
          <li>
            The agent sends the excerpts it reads to this provider, secrets redacted. <code>.env</code>, key and keystore files are never sent.
          </li>
          <li>
            Keys are stored on the server in <code>~/.acai/model.json</code> (Docker: the <code>/data</code> volume), readable only by the server's user, and never sent back to the
            browser.
          </li>
          <li>Larger models find more and make fewer mistakes; small local models are private but weaker on long audits.</li>
          <li>
            On a shared server only <code>ACAI_APPROVERS</code> may change the model. <code>ACAI_MODEL_LOCKED=1</code> fixes it in the environment.
          </li>
          <li>
            Without the dashboard: <code>ACAI_PROVIDER=gemini ACAI_MODEL=&lt;model&gt; GEMINI_API_KEY=…</code>. <code>acai providers</code> lists them all.
          </li>
        </ul>
      </section>
    </div>
  );
}
