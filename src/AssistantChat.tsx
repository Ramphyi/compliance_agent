import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  X,
  Send,
  GripHorizontal,
  Minus,
  RotateCcw,
} from "lucide-react";
import { api, post } from "./api";
import { RuleDraftCard, type RuleDraft } from "./RuleSets";
import "./assistant.css";
type Message = {
  id: string;
  role: string;
  content: string;
  meta?: {
    mode?: string;
    trace?: { tool: string; status: string }[];
    drafts?: string[];
  };
};
export default function AssistantChat({
  projectId,
  projectName,
  onChanged,
}: {
  projectId: string;
  projectName: string;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [aiAvailable, setAiAvailable] = useState(false),
    [allowAi, setAllowAi] = useState(false),
    [live, setLive] = useState(false),
    [drafts, setDrafts] = useState<RuleDraft[]>([]);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const panel = useRef<HTMLDivElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; left: number; top: number } | null>(
      null,
    );
  const current = useRef(projectId);
  current.current = projectId;
  const clamp = (x: number, y: number) => ({
    x: Math.max(
      8,
      Math.min(x, innerWidth - (panel.current?.offsetWidth || 390) - 8),
    ),
    y: Math.max(
      8,
      Math.min(y, innerHeight - (panel.current?.offsetHeight || 600) - 8),
    ),
  });
  const refresh = async () => {
    const pid = projectId;
    const [history, sets] = await Promise.all([
      api<Message[]>(`/projects/${pid}/assistant`),
      api<RuleDraft[]>(`/projects/${pid}/rule-sets`),
    ]);
    if (current.current === pid) {
      setMessages(history);
      setDrafts(sets);
    }
  };
  useEffect(() => {
    setMessages([]);
    setDrafts([]);
    setError("");
    setText("");
    setAllowAi(false);
    setLive(false);
    if (projectId) void refresh().catch((e) => setError(e.message));
  }, [projectId]);
  useEffect(() => {
    void api("/config")
      .then((c) => setAiAvailable(c.externalAi))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy, open]);
  useEffect(() => {
    const resize = () => setPosition((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  async function send(
    action: "chat" | "assess" | "rules" = "chat",
    override?: string,
  ) {
    const message = (override || text).trim();
    if (!message || busy) return;
    const pid = projectId;
    setBusy(true);
    setError("");
    setText("");
    setMessages((old) => [
      ...old,
      { id: "pending-user", role: "user", content: message },
    ]);
    try {
      await post(`/projects/${pid}/assistant`, {
        message,
        allowAi,
        action,
        liveResearch: live,
      });
      if (current.current === pid) {
        await refresh();
        await onChanged();
      }
    } catch (e) {
      if (current.current === pid) {
        setError((e as Error).message);
        setText(message);
      }
    } finally {
      setBusy(false);
    }
  }
  if (!projectId) return null;
  if (!open)
    return (
      <button
        className="assistant-launcher"
        onClick={() => setOpen(true)}
        aria-label="Open project assistant"
      >
        <MessageSquare size={21} />
        <span>Ask Clearance</span>
      </button>
    );
  return (
    <div
      className="assistant-window"
      ref={panel}
      style={
        position
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
      role="dialog"
      aria-label="Project assistant"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <header
        className="assistant-header"
        tabIndex={0}
        aria-label="Move assistant; use arrow keys"
        onKeyDown={(e) => {
          if (!e.key.startsWith("Arrow") || e.target !== e.currentTarget)
            return;
          e.preventDefault();
          const rect = panel.current!.getBoundingClientRect();
          setPosition(
            clamp(
              rect.left +
                (e.key === "ArrowRight" ? 20 : e.key === "ArrowLeft" ? -20 : 0),
              rect.top +
                (e.key === "ArrowDown" ? 20 : e.key === "ArrowUp" ? -20 : 0),
            ),
          );
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const rect = panel.current!.getBoundingClientRect();
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: rect.left,
            top: rect.top,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setPosition(
              clamp(
                drag.current.left + e.clientX - drag.current.x,
                drag.current.top + e.clientY - drag.current.y,
              ),
            );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <GripHorizontal size={18} />
        <div>
          <strong>Clearance assistant</strong>
          <small>{projectName}</small>
        </div>
        <button
          aria-label="Reset chat position"
          onClick={() => setPosition(null)}
        >
          <RotateCcw size={15} />
        </button>
        <button aria-label="Minimize assistant" onClick={() => setOpen(false)}>
          <Minus size={17} />
        </button>
        <button aria-label="Close assistant" onClick={() => setOpen(false)}>
          <X size={17} />
        </button>
      </header>
      <div className="assistant-mode">
        <label>
          <input
            type="checkbox"
            checked={allowAi}
            disabled={!aiAvailable || busy}
            onChange={(e) => {
              setAllowAi(e.target.checked);
              if (!e.target.checked) setLive(false);
            }}
          />{" "}
          AI chat
        </label>
        <label>
          <input
            type="checkbox"
            checked={live}
            disabled={!allowAi || busy}
            onChange={(e) => setLive(e.target.checked)}
          />{" "}
          Live rule research
        </label>
        <small>
          {allowAi
            ? "Chat and project context are sent to OpenAI."
            : aiAvailable
              ? "Local tools only. Enable AI for free-form reasoning."
              : "AI not configured · local project tools are available."}
        </small>
      </div>
      <div className="assistant-messages" role="log" aria-live="polite">
        {!messages.length && (
          <div className="assistant-welcome">
            <h3>Let’s work through this project.</h3>
            <p>
              I can explain its source scan, investigate the recorded gaps, run
              an assessment and prepare rule sets. I cannot approve evidence or
              certify compliance.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <article key={m.id} className={`assistant-message ${m.role}`}>
            <small>
              {m.role === "user"
                ? "You"
                : m.meta?.mode === "ai"
                  ? "Clearance · AI"
                  : "Clearance · local tools"}
            </small>
            <p>{m.content}</p>
            {!!m.meta?.trace?.length && (
              <details>
                <summary>{m.meta.trace.length} tools used</summary>
                {m.meta.trace.map((t, i) => (
                  <div key={i}>
                    <code>{t.tool}</code> · {t.status}
                  </div>
                ))}
              </details>
            )}
            {m.meta?.drafts?.map((id) => {
              const draft = drafts.find((d) => d.id === id);
              return draft ? (
                <RuleDraftCard
                  key={id}
                  draft={draft}
                  projectId={projectId}
                  onApplied={() => {
                    void refresh();
                    void onChanged();
                  }}
                />
              ) : null;
            })}
          </article>
        ))}
        {busy && (
          <p className="assistant-thinking" role="status">
            Reading the project and using tools…
          </p>
        )}
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <div className="assistant-shortcuts">
        <button
          disabled={busy}
          onClick={() =>
            send("chat", "Explain this project from the source analysis")
          }
        >
          Explain project
        </button>
        <button
          disabled={busy}
          onClick={() => send("chat", "What problems need fixing?")}
        >
          Explain problems
        </button>
        <button
          disabled={busy}
          onClick={() => send("assess", "Run an assessment for this project")}
        >
          Run assessment
        </button>
      </div>
      <form
        className="assistant-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Message project assistant"
          placeholder="Ask about the code, data flows or rules…"
          value={text}
          maxLength={4000}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div>
          <button
            type="button"
            disabled={busy || text.trim().length < 5}
            onClick={() => send("rules")}
          >
            Build rule set
          </button>
          <button
            aria-label="Send assistant message"
            type="submit"
            disabled={busy || !text.trim()}
          >
            <Send size={17} />
          </button>
        </div>
      </form>
    </div>
  );
}
