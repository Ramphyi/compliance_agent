import { useState } from "react";
import { paths } from "../api";
import { useResource } from "../hooks";
import { CopyButton, ErrorBox, Loading, Modal, Segmented } from "./ui";

/** The findings as a brief for a coding agent: paste it, save it as a file, or let the agent fetch it over MCP. */
export function HandoffModal({ pid, auditId, onClose }: { pid: string; auditId: string; onClose: () => void }) {
  const [which, setWhich] = useState<"confirmed" | "confirmed,open">("confirmed");
  const { data, error, reload } = useResource<string>(paths.audit(pid, auditId, `/tasks?status=${which}`));
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data ?? ""], { type: "text/markdown" }));
    a.download = "ACAI-TASKS.md";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Modal
      wide
      title="Hand off to agent"
      onClose={onClose}
      footer={
        <>
          <Segmented label="Findings" value={which} onChange={setWhich} options={[{ value: "confirmed", label: "Confirmed" }, { value: "confirmed,open", label: "Confirmed and to review" }]} />
          <span className="grow" />
          <button className="btn" type="button" onClick={download} disabled={!data}>
            Download .md
          </button>
          {data && <CopyButton text={data} label="Copy" />}
        </>
      }
    >
      <p className="muted small">
        Each finding as a task: where, why, what to change, and when it is done. With Acai connected over MCP, tell the agent <em>“Fix the confirmed Acai findings”</em> and it
        fetches these itself. Otherwise paste this into Claude Code, Codex, Copilot Chat or Cursor.
      </p>
      {error && <ErrorBox error={error} retry={reload} />}
      {data === undefined ? !error && <Loading what="tasks" /> : <pre className="handoff-md">{data}</pre>}
    </Modal>
  );
}
