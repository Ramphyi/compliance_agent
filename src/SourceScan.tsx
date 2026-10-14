import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ScanLine, FileCode2, LockKeyhole } from "lucide-react";
import { api, post, date } from "./api";
import { Button, Field } from "./ui";
import type { Discovery } from "../shared/discovery";
import {
  eligibleSource,
  redactSecrets,
  SCAN_FILE_BYTES,
  SCAN_MAX_BYTES,
  SCAN_MAX_FILES,
  type SourceFile,
  type CodeAnalysis,
} from "../shared/code-analysis";
import "./assistant.css";
import SourceVisuals, { ScanTimeline } from "./SourceVisuals";
import type { ConnectionStatus } from "./AccountConnections";
export type ScanRecord = {
  stale?: boolean;
  id: string;
  status: string;
  events: { at: string; detail: string }[];
  report: CodeAnalysis | null;
  error?: string;
  created_at: string;
};

export async function collectSourceFiles(list: FileList) {
  const selected = Array.from(list)
    .map((file) => ({
      file,
      path: file.webkitRelativePath.split("/").slice(1).join("/") || file.name,
    }))
    .sort(
      (a, b) =>
        Number(/^readme/i.test(b.path)) - Number(/^readme/i.test(a.path)) ||
        a.path.localeCompare(b.path),
    );
  const files: SourceFile[] = [];
  let bytes = 0,
    excludedFiles = 0,
    limitedFiles = 0;
  for (const { file, path } of selected) {
    if (!eligibleSource(path)) {
      excludedFiles++;
      continue;
    }
    if (
      file.size > SCAN_FILE_BYTES ||
      bytes + file.size > SCAN_MAX_BYTES ||
      files.length >= SCAN_MAX_FILES
    ) {
      limitedFiles++;
      continue;
    }
    const content = await file.text();
    if (content.includes("\0")) {
      excludedFiles++;
      continue;
    }
    bytes += file.size;
    files.push({ path, content: redactSecrets(content) });
  }
  if (!files.length)
    throw new Error("No supported source files were found in this folder.");
  return { files, totalFiles: selected.length, excludedFiles, limitedFiles };
}
export default function SourceScan({
  projectId,
  provider,
  repository,
  onSaved,
}: {
  projectId: string;
  provider: Discovery["provider"];
  repository: string;
  onSaved: () => Promise<void>;
}) {
  const [scan, setScan] = useState<ScanRecord | null>(null),
    [privateAccess, setPrivateAccess] = useState(false),
    [connections, setConnections] = useState<ConnectionStatus[]>([]),
    [useAi, setUseAi] = useState(false),
    [ai, setAi] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [source, setSource] = useState<Awaited<
    ReturnType<typeof collectSourceFiles>
  > | null>(null);
  const observed = useRef(""),
    mounted = useRef(true);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const load = useCallback(async () => {
    const result = await api<ScanRecord | null>(
      `/projects/${projectId}/analysis`,
    );
    if (!mounted.current) return;
    setScan(result);
    if (
      result?.status === "completed" &&
      observed.current &&
      observed.current !== result.id
    ) {
      observed.current = result.id;
      await saved.current();
    }
    if (!observed.current) observed.current = result?.id || "none";
  }, [projectId]);
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => setError(e.message));
    void api<ConnectionStatus[]>("/account/connections")
      .then(setConnections)
      .catch((e) => setError(e.message));
    void api("/config")
      .then((c) => setAi(c.externalAi))
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (scan?.status !== "running") return;
    const timer = setInterval(
      () => void load().catch((e) => setError(e.message)),
      1500,
    );
    return () => clearInterval(timer);
  }, [scan?.status, load]);
  const remote = provider === "github" || provider === "bitbucket";
  async function start() {
    setBusy(true);
    setError("");
    try {
      const path = remote ? "repository-scan" : "source-analysis";
      const body = remote
        ? { repository, useSavedConnection: privateAccess, useAi }
        : { ...source, useAi };
      const result = await post(`/projects/${projectId}/${path}`, body);
      setScan({
        ...result,
        events: [
          {
            at: new Date().toISOString(),
            detail: "Preparing source analysis…",
          },
        ],
        report: null,
        created_at: new Date().toISOString(),
      });
      await load();
      setSource(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="source-scan">
      <div className="source-scan-title">
        <ScanLine size={23} />
        <div>
          <h3>Analyze code before answering questions</h3>
          <p>
            Read the source, map the modules and prefill answers with file
            references.
          </p>
        </div>
      </div>
      {remote ? (
        <>
          <div
            className="source-access-options"
            role="group"
            aria-label="Repository access"
          >
            <button
              type="button"
              aria-pressed={!privateAccess}
              onClick={() => setPrivateAccess(false)}
            >
              <FileCode2 size={20} />
              <strong>Public repository</strong>
              <small>No token needed · anonymous access</small>
            </button>
            <button
              type="button"
              aria-pressed={privateAccess}
              onClick={() => setPrivateAccess(true)}
            >
              <LockKeyhole size={20} />
              <strong>Private repository</strong>
              <small>Use the connection saved in your profile</small>
            </button>
          </div>
          {privateAccess ? (
            <p className="scan-boundary">
              {connections.find((c) => c.provider === provider)?.connected
                ? "Your saved account connection will be used for this scan."
                : "Connect your account before scanning private code."}{" "}
              <Link className="text-link" to="/app/settings">
                Manage in profile →
              </Link>
            </p>
          ) : (
            <p className="scan-boundary">
              <FileCode2 size={14} /> Public access never uses a saved token.
              GitHub and Bitbucket URLs with or without .git are supported.
            </p>
          )}
        </>
      ) : (
        <>
          <Field
            label="Choose source folder"
            hint="Eligible source contents will be sent to this Clearance server when you click Scan source. Secret paths and common token patterns are excluded or redacted; review the files before sending."
          >
            <input
              type="file"
              {...({ webkitdirectory: "", directory: "" } as any)}
              onChange={async (e) => {
                if (!e.target.files?.length) return;
                setBusy(true);
                setError("");
                try {
                  setSource(await collectSourceFiles(e.target.files));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Field>
          {source && (
            <details className="source-preview">
              <summary>
                {source.files.length} source files ready ·{" "}
                {source.excludedFiles} excluded · {source.limitedFiles} beyond
                limits
              </summary>
              <p>Review the redacted content that will be sent:</p>
              <div>
                {source.files.map((f) => (
                  <details key={f.path}>
                    <summary>{f.path}</summary>
                    <pre>{f.content}</pre>
                  </details>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={useAi}
          disabled={!ai}
          onChange={(e) => setUseAi(e.target.checked)}
        />{" "}
        Use AI to interpret redacted source excerpts
      </label>
      <p className="small-note">
        {ai
          ? "Opting in sends bounded source excerpts to OpenAI for this scan. Drafts still need review."
          : "AI is not configured. Source scanning and rule-based draft answers work locally; configure the server to enable model synthesis."}
      </p>
      <Button
        variant="orange"
        busy={busy || scan?.status === "running"}
        disabled={
          remote
            ? !repository ||
              (privateAccess &&
                !connections.find((c) => c.provider === provider)?.connected)
            : !source
        }
        onClick={start}
      >
        <ScanLine size={16} />
        {scan?.status === "running"
          ? "Scanning source…"
          : remote
            ? "Clone and scan repository"
            : "Scan source and prefill answers"}
      </Button>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {scan && <ScanTimeline scan={scan} />}
      {scan && (
        <div className="scan-progress" aria-live="polite">
          <strong>
            {scan.status === "completed"
              ? "Source analysis ready"
              : scan.status === "failed"
                ? "Source analysis failed"
                : "Source analysis in progress"}
          </strong>
          {scan.events.slice(-4).map((e, i) => (
            <p key={i}>
              <span>·</span> {e.detail}
            </p>
          ))}
          {scan.error && <p className="alert error">{scan.error}</p>}
        </div>
      )}
      {scan?.stale && (
        <p className="alert error">
          The code snapshot changed after this analysis. Scan again before using
          its draft answers.
        </p>
      )}
      {scan?.report && (
        <ScanReport report={scan.report} projectId={projectId} />
      )}
    </section>
  );
}
export function ScanReport({
  report,
  projectId,
}: {
  report: CodeAnalysis;
  projectId: string;
}) {
  return (
    <div className="scan-report">
      <SourceVisuals report={report} />
      <p>{report.summary}</p>
      <p className="small-note">
        Scanned {date(report.scannedAt)}. Select components and review signals
        above to inspect source references.
      </p>
      <details>
        <summary>Coverage and limits</summary>
        {report.warnings.map((w, i) => (
          <p key={i}>{w}</p>
        ))}
        <p>
          Enumerated {report.totalFiles} paths. Binary, generated, secret and
          unsupported files are excluded. Reading a file does not mean executing
          or formally verifying it.
        </p>
        <div className="scan-file-list">
          {report.files.map((f) => (
            <code key={f.path}>
              {f.path} · {f.lines} lines
            </code>
          ))}
        </div>
      </details>
      <Link
        className="button orange"
        to={`/app/questions?project=${projectId}`}
      >
        Review prefilled questions <ArrowRight size={16} />
      </Link>
    </div>
  );
}
