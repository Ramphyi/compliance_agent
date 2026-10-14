import { useState } from "react";
import {
  Database,
  ShieldCheck,
  BrainCircuit,
  Scale,
  FolderCode,
  FileCode2,
  Check,
  LoaderCircle,
  Circle,
  AlertCircle,
} from "lucide-react";
import type { CodeAnalysis } from "../shared/code-analysis";
import type { ScanRecord } from "./SourceScan";
import "./source-visuals.css";
const topics = {
  data: { title: "Personal data", icon: Database },
  storage: { title: "Storage", icon: Database },
  access: { title: "Access control", icon: ShieldCheck },
  ai: { title: "AI integrations", icon: BrainCircuit },
  license: { title: "Licensing", icon: Scale },
};
export function ScanTimeline({ scan }: { scan: ScanRecord }) {
  const stage =
    scan.status === "completed"
      ? 3
      : scan.events.some((e) => /Analyzing|Asking OpenAI/.test(e.detail))
        ? 2
        : scan.events.some((e) => /Enumerated|Read \d+/.test(e.detail))
          ? 1
          : 0;
  return (
    <div
      className={`scan-timeline ${scan.status}`}
      aria-label="Source scan progress"
    >
      {["Connect", "Read files", "Analyze", "Review"].map((label, i) => {
        const done = i < stage,
          active = i === stage,
          Icon = done
            ? Check
            : active
              ? scan.status === "failed"
                ? AlertCircle
                : scan.status === "completed"
                  ? Circle
                  : LoaderCircle
              : Circle;
        return (
          <div className={done ? "done" : active ? "active" : ""} key={label}>
            <span>
              <Icon
                size={17}
                className={active && scan.status === "running" ? "spin" : ""}
              />
            </span>
            <strong>{label}</strong>
          </div>
        );
      })}
    </div>
  );
}
export default function SourceVisuals({ report }: { report: CodeAnalysis }) {
  const [module, setModule] = useState(""),
    [topic, setTopic] = useState("");
  const total = report.totalFiles || 1,
    percent = Math.round((report.filesRead / total) * 100),
    selected = report.signals.find((s) => s.kind === topic),
    moduleFiles = report.files.filter((f) =>
      module === "(root)"
        ? !f.path.includes("/")
        : f.path.startsWith(module + "/"),
    );
  return (
    <div className="source-visuals">
      <section className="scan-summary-visual">
        <div>
          <span className="page-eyebrow">SOURCE COVERAGE</span>
          <h3>{report.filesRead} files. One project map.</h3>
          <p>
            {report.mode === "ai"
              ? "AI-assisted source interpretation"
              : "Local source analysis"}
            {report.revision && ` · ${report.revision.slice(0, 12)}`}
          </p>
          <div className="coverage-legend">
            <span>
              <i />
              {report.filesRead} read
            </span>
            <span>
              <i />
              {report.excludedFiles} excluded
            </span>
            <span>
              <i />
              {report.limitedFiles} over limits
            </span>
          </div>
          <small>File coverage, not a compliance score.</small>
        </div>
        <div
          className="coverage-ring"
          role="img"
          aria-label={`${percent}% of enumerated files read`}
          style={{
            background: `conic-gradient(#ed8247 0 ${percent}%, #39516b ${percent}% 100%)`,
          }}
        >
          <div>
            <strong>{percent}%</strong>
            <small>files read</small>
          </div>
        </div>
      </section>
      <section className="architecture-map">
        <header>
          <h3>Explore the project</h3>
          <p>Select a component to see the files behind it.</p>
        </header>
        <div className="map-root">
          <FolderCode size={23} />
          <strong>Repository</strong>
          <span>{report.modules.length} top-level components</span>
        </div>
        <div className="module-cards">
          {report.modules.map((m) => (
            <button
              key={m.name}
              aria-pressed={module === m.name}
              onClick={() => setModule(module === m.name ? "" : m.name)}
            >
              <FolderCode size={22} />
              <strong>
                {m.name === "(root)" ? "Root & configuration" : m.name}
              </strong>
              <span>{m.files} files</span>
              <i>
                <b
                  style={{
                    width: `${Math.max(3, (m.files / report.filesRead) * 100)}%`,
                  }}
                />
              </i>
            </button>
          ))}
        </div>
        {module && (
          <div className="module-file-panel">
            <strong>
              {module} · {moduleFiles.length} files
            </strong>
            <div>
              {moduleFiles.map((f) => (
                <span key={f.path}>
                  <FileCode2 size={14} />
                  <code>{f.path}</code>
                  <small>{f.lines} lines</small>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
      <section className="signal-explorer">
        <h3>What the source tells us</h3>
        <p>
          Review leads from code and documentation. Presence does not prove a
          control works.
        </p>
        <div className="signal-cards">
          {Object.entries(topics).map(([kind, { title, icon: Icon }]) => {
            const signal = report.signals.find((s) => s.kind === kind);
            return (
              <button
                key={kind}
                aria-pressed={topic === kind}
                onClick={() => setTopic(topic === kind ? "" : kind)}
              >
                <Icon size={24} />
                <strong>{title}</strong>
                <span>
                  {signal
                    ? `${signal.references.length} references`
                    : "No recognized signal"}
                </span>
                <small>
                  {signal ? "Explore evidence →" : "Needs confirmation"}
                </small>
              </button>
            );
          })}
        </div>
        {topic && (
          <div className="signal-detail">
            <h4>{topics[topic as keyof typeof topics]?.title}</h4>
            <p>
              {selected?.description ||
                "No recognized pattern was found in the files read. This does not establish that the feature is absent."}
            </p>
            {selected?.references.map((ref, i) => (
              <div className="source-reference" key={i}>
                <code>
                  {ref.path}:{ref.line}
                </code>
                <pre>{ref.excerpt}</pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
