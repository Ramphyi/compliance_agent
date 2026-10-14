import { useCallback, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  LayoutDashboard,
  ScanLine,
  FolderCheck,
  BookOpen,
  Radio,
  Plug,
  Settings,
  Plus,
  Search,
  Bell,
  ChevronDown,
  ArrowUpRight,
  ArrowRight,
  Play,
  Download,
  ShieldCheck,
  Globe2,
  ChevronRight,
  Check,
  Clock3,
  TriangleAlert,
  FileText,
  MoreHorizontal,
  LogOut,
  PanelLeftClose,
  Layers,
  Code2,
  RefreshCw,
  CheckCircle2,
  X,
  Menu,
} from "lucide-react";
import {
  Logo,
  Button,
  Badge,
  Empty,
  Modal,
  Field,
  SectionTitle,
  Breadcrumb,
  External,
} from "./ui";
import { api, post, download, date, ApiError } from "./api";
import type {
  Project,
  Run,
  Rule,
  Evidence,
  Control,
  Finding,
  User,
} from "../shared/types";
import Onboarding from "./Onboarding";
import {
  NewProject,
  ProjectList,
  ProjectSteps,
  ConnectCode,
  ProjectQuestions,
  NextStep,
} from "./ProjectFlow";
import {
  Integrations,
  SettingsPanel,
  RegulatoryWatch,
} from "./WorkspacePanels";
type Data = {
  project: Project;
  evidence: Evidence[];
  rules: Rule[];
  runs: Run[];
  controls: Omit<Control, "applies">[];
};
const navItems = [
  ["projects", "All projects", Layers],
  ["connect", "Connect code", Code2],
  ["questions", "Project questions", BookOpen],
  ["", "Problems & next steps", LayoutDashboard],
  ["assessments", "Check history", ScanLine],
  ["evidence", "Evidence & review", FolderCheck],
  ["policies", "Custom rules", BookOpen],
  ["regulations", "Regulatory watch", Radio],
  ["integrations", "Integrations", Plug],
] as const;
export default function Workspace() {
  const navigate = useNavigate();
  const { section = "" } = useParams();
  const [params] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<any>({});
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(
    params.get("project") || localStorage.getItem("clearance-project") || "",
  );
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [onboard, setOnboard] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [edit, setEdit] = useState(false);
  const [evidenceModal, setEvidenceModal] = useState(false);
  const [ruleModal, setRuleModal] = useState(false);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [historyRun, setHistoryRun] = useState<Run | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [notifications, setNotifications] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement)?.tagName,
        )
      ) {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>('[aria-label="Search findings"]')
          ?.focus();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  const loadProjects = useCallback(async (preferred?: string) => {
    const list = await api<Project[]>("/projects");
    setProjects(list);
    setSelected(
      (current) =>
        preferred ||
        (list.some((p) => p.id === current) ? current : list[0]?.id || ""),
    );
  }, []);
  useEffect(() => {
    const pid = params.get("project");
    if (pid && projects.some((p) => p.id === pid)) setSelected(pid);
  }, [params, projects]);
  function openProject(pid: string, page = "") {
    setSelected(pid);
    navigate(`/app${page ? "/" + page : ""}?project=${pid}`);
  }
  useEffect(() => {
    Promise.all([api("/auth/me"), api("/config")])
      .then(([me, conf]) => {
        setUser(me.user);
        setConfig(conf);
        return loadProjects();
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401)
          navigate("/login");
        else
          setError(
            error.message ||
              "Unable to load your workspace. Please reload to retry.",
          );
      })
      .finally(() => setLoading(false));
  }, [loadProjects, navigate]);
  const refresh = useCallback(async () => {
    if (selected) setData(await api<Data>(`/projects/${selected}`));
  }, [selected]);
  useEffect(() => {
    setData(null);
    setError("");
    if (!selected) return;
    let live = true;
    localStorage.setItem("clearance-project", selected);
    api<Data>(`/projects/${selected}`)
      .then((value) => {
        if (live) setData(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [selected]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 1200);
    return () => clearInterval(timer);
  }, [busy, refresh]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    setFilter("all");
    setSidebar(false);
  }, [section]);
  async function assess() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await post(`/projects/${selected}/assess`);
      await refresh();
      setToast("Assessment complete. Review your findings below.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function updateEvidence(item: Evidence, status: string) {
    try {
      await api(`/projects/${selected}/evidence/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refresh();
      setToast(
        "Review saved. Run an assessment to update coverage and the release gate.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const latest = data?.runs[0];
  const completed = data?.runs.find((r) => r.status === "completed");
  const findings = (completed?.findings || []).filter(
    (f) =>
      (filter === "all" || f.status === filter) &&
      `${f.title} ${f.framework} ${f.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const gaps = completed?.findings.filter((f) => f.status !== "covered") || [];
  const frameworks = [
    ...new Set(completed?.findings.map((f) => f.framework) || []),
  ];
  const pageTitle = navItems.find((n) => n[0] === section)?.[1] || "Settings";
  if (loading)
    return (
      <div className="page-loading">
        <Logo />
        <span className="loading-line" />
        Opening your workspace…
      </div>
    );
  return (
    <div className="workspace">
      <aside className={`sidebar ${sidebar ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-menu"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            {data?.project.profile.name.slice(0, 1) || "W"}
          </span>
          <div>
            <small>YOUR WORKSPACE</small>
            <select
              aria-label="Select project"
              value={selected}
              onChange={(e) =>
                openProject(
                  e.target.value,
                  section === "projects" ? "" : section,
                )
              }
            >
              {!projects.length && <option value="">Create a project</option>}
              {projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.profile.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {navItems.map(([path, label, Icon]) => (
            <NavLink
              end
              to={`/app${path ? "/" + path : ""}${path === "projects" || !selected ? "" : "?project=" + selected}`}
              className={({ isActive }) => (isActive ? "active" : "")}
              key={path}
            >
              <Icon size={18} strokeWidth={1.65} />
              <span>{label}</span>
              {path === "evidence" &&
                !!data?.evidence.filter((e) => e.status === "submitted")
                  .length && (
                  <b>
                    {
                      data.evidence.filter((e) => e.status === "submitted")
                        .length
                    }
                  </b>
                )}
            </NavLink>
          ))}
        </nav>
        <button
          className="add-workspace"
          onClick={() => {
            setNewProject(true);
          }}
        >
          <Plus size={16} /> New project
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <Code2 size={19} />
            </span>
            <strong>Compliance, in your flow.</strong>
            <p>Connect your tools with MCP and keep building.</p>
            <Link to="/app/integrations">
              Explore integrations <ArrowUpRight size={14} />
            </Link>
          </div>
          <NavLink className="settings-link" to="/app/settings">
            <Settings size={18} /> Settings
          </NavLink>
          <div className="user-menu">
            <span className="user-avatar">
              {user?.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{user?.name}</strong>
              <small>Workspace owner</small>
            </div>
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await post("/auth/logout");
                  navigate("/");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebar(true)}
          >
            <Menu />
          </button>
          <Breadcrumb section={pageTitle} />
          <div className="topbar-right">
            <div className="global-search">
              <Search size={15} />
              <input
                aria-label="Search findings"
                placeholder="Search findings…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (section !== "") navigate("/app");
                }}
              />
              <kbd>/</kbd>
            </div>
            <span className="topbar-separator" />
            <button
              className={`icon-button ${notifications ? "selected" : ""}`}
              aria-label="Notifications"
              onClick={() => setNotifications(!notifications)}
            >
              <Bell size={18} />
              {!!gaps.length && <i className="notification-dot" />}
            </button>
            <span className="top-avatar">{user?.name[0]}</span>
          </div>
          {notifications && (
            <div className="notification-popover">
              <h3>Workspace updates</h3>
              {latest ? (
                <>
                  <p>
                    <strong>Latest assessment: {latest.status}</strong>
                  </p>
                  <p>{gaps.length} mapped controls need attention.</p>
                  <Link
                    to="/app/assessments"
                    onClick={() => setNotifications(false)}
                  >
                    View assessment history <ArrowRight size={14} />
                  </Link>
                </>
              ) : (
                <p>Run your first assessment to see updates here.</p>
              )}
            </div>
          )}
        </header>
        <main className="app-content">
          {config.demo && (
            <div className="demo-banner">
              <span>
                <span className="status-dot" /> INTERACTIVE PREVIEW
              </span>
              <p>
                Local preview · data resets on server restart · use PostgreSQL
                for lasting project storage
              </p>
              <Link to="/signup">
                Create an account <ArrowUpRight size={12} />
              </Link>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {section === "projects" ? (
            <ProjectList
              projects={projects}
              onOpen={openProject}
              onNew={() => setNewProject(true)}
            />
          ) : !selected ? (
            <Empty
              title="Connect your first project"
              description="Start with code, confirm the project questions, and keep track of what needs fixing."
            >
              <Button variant="orange" onClick={() => setNewProject(true)}>
                <Plus size={16} /> Create your first project
              </Button>
            </Empty>
          ) : !data ? (
            <div className="page-loading compact">Loading product context…</div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="page-eyebrow">
                    <span className="status-dot" />
                    {data.project.profile.name} <span>/</span>{" "}
                    {data.project.profile.softwareType.toUpperCase()}
                  </div>
                  <h1>
                    {section === "" ? "Problems & next steps" : pageTitle}
                  </h1>
                  <p>
                    {section === ""
                      ? "What needs attention, why it matters, and what to do next."
                      : section === "connect"
                        ? "Bring in your repository, local folder or coding agent."
                        : section === "questions"
                          ? "Confirm the facts about this project before reviewing its requirements."
                          : section === "assessments"
                            ? "Follow the reasoning. Keep the history. Make every review traceable."
                            : section === "evidence"
                              ? "One place for the records behind your requirements."
                              : section === "policies"
                                ? "A shared baseline, with room for the rules that make you different."
                                : section === "regulations"
                                  ? "Official sources, explicit freshness, and changes worth reviewing."
                                  : section === "integrations"
                                    ? "Bring compliance into the tools you already work with."
                                    : "Your identity, product context and workspace boundaries."}
                  </p>
                </div>
                <div className="heading-actions">
                  {section === "" || section === "assessments" ? (
                    <>
                      <Button
                        variant="outline"
                        disabled={!completed}
                        onClick={() =>
                          download(`clearance-report-${selected}.json`, {
                            project: data.project,
                            assessment: completed,
                            notice:
                              "Evidence coverage only. Not legal advice or certification.",
                          })
                        }
                      >
                        <Download size={15} /> Export report
                      </Button>
                      <Button variant="orange" busy={busy} onClick={assess}>
                        <ScanLine size={16} />
                        {busy ? "Assessing…" : "Run assessment"}
                      </Button>
                    </>
                  ) : section === "evidence" ? (
                    <Button
                      variant="orange"
                      onClick={() => setEvidenceModal(true)}
                    >
                      <Plus size={16} /> Add evidence
                    </Button>
                  ) : section === "policies" ? (
                    <Button variant="orange" onClick={() => setRuleModal(true)}>
                      <Plus size={16} /> Add custom policy
                    </Button>
                  ) : null}
                </div>
              </div>
              <ProjectSteps project={data.project} section={section} />
              {section === "connect" && (
                <ConnectCode
                  key={selected}
                  project={data.project}
                  onSaved={async () => {
                    await refresh();
                    await loadProjects(selected);
                  }}
                />
              )}
              {section === "questions" && (
                <ProjectQuestions
                  key={selected}
                  project={data.project}
                  onSaved={async () => {
                    await refresh();
                    await loadProjects(selected);
                  }}
                  onAssess={async () => {
                    await assess();
                    openProject(selected);
                  }}
                />
              )}
              {section === "" && (
                <>
                  <NextStep project={data.project} latest={latest} />
                  <div className="stats-grid">
                    <article className="stat-card">
                      <div>
                        <span>Evidence coverage</span>
                        <ShieldCheck size={17} />
                      </div>
                      <strong>
                        {completed ? completed.score : "—"}
                        <small>{completed ? "%" : ""}</small>
                      </strong>
                      <p>
                        <span className="green-text">
                          {completed?.findings.filter(
                            (f) => f.status === "covered",
                          ).length || 0}{" "}
                          reviewed
                        </span>{" "}
                        of {completed?.findings.length || 0} mapped controls
                      </p>
                      <div className="stat-track">
                        <i style={{ width: `${completed?.score || 0}%` }} />
                      </div>
                    </article>
                    <article className="stat-card">
                      <div>
                        <span>Needs your attention</span>
                        <TriangleAlert size={17} />
                      </div>
                      <strong>
                        {gaps.length.toString().padStart(2, "0")}
                        <span className="stat-pill">Open checks</span>
                      </strong>
                      <p>
                        <span className="orange-text">
                          {gaps.filter((f) => f.severity === "high").length}{" "}
                          high priority
                        </span>{" "}
                        · a clear place to start
                      </p>
                      <div className="stat-bars">
                        {Array.from({ length: 16 }, (_, i) => (
                          <i
                            key={i}
                            className={i < gaps.length ? "filled" : ""}
                          />
                        ))}
                      </div>
                    </article>
                    <article className="stat-card">
                      <div>
                        <span>Frameworks in scope</span>
                        <Layers size={17} />
                      </div>
                      <strong>
                        {frameworks.length.toString().padStart(2, "0")}
                      </strong>
                      <p>Mapped to your product and markets</p>
                      <div className="stat-tags">
                        {frameworks.slice(0, 2).map((f) => (
                          <span key={f}>{f.replace(" readiness", "")}</span>
                        ))}
                        {frameworks.length > 2 && (
                          <span>+{frameworks.length - 2}</span>
                        )}
                      </div>
                    </article>
                    <article className="stat-card">
                      <div>
                        <span>Evidence collected</span>
                        <FolderCheck size={17} />
                      </div>
                      <strong>
                        {data.evidence.length.toString().padStart(2, "0")}
                      </strong>
                      <p>
                        {
                          data.evidence.filter((e) => e.status === "submitted")
                            .length
                        }{" "}
                        records awaiting your review
                      </p>
                      <Link to="/app/evidence" className="stat-link">
                        Open evidence vault <ArrowUpRight size={14} />
                      </Link>
                    </article>
                  </div>
                  <section className="card findings-card">
                    <SectionTitle
                      title="What needs fixing?"
                      description="Open a problem to see why it matters and the next action. Missing evidence means unverified, not necessarily broken code."
                    >
                      <Badge tone="neutral">{gaps.length} open checks</Badge>
                    </SectionTitle>
                    <div className="table-toolbar">
                      <div className="tabs">
                        {[
                          ["all", "All findings"],
                          ["missing", "Missing"],
                          ["review", "In review"],
                          ["covered", "Covered"],
                        ].map(([value, label]) => (
                          <button
                            className={filter === value ? "active" : ""}
                            onClick={() => setFilter(value)}
                            key={value}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <span>{findings.length} results</span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>REQUIREMENT</th>
                            <th>FRAMEWORK</th>
                            <th>PRIORITY</th>
                            <th>STATUS</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {findings.map((f) => (
                            <tr key={f.id} onClick={() => setFinding(f)}>
                              <td>
                                <button
                                  className="finding-title"
                                  onClick={() => setFinding(f)}
                                >
                                  <span className={`finding-dot ${f.status}`} />
                                  {f.title}
                                </button>
                              </td>
                              <td>{f.framework}</td>
                              <td>
                                <span className={`priority ${f.severity}`}>
                                  {f.severity}
                                </span>
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    f.status === "covered"
                                      ? "green"
                                      : f.status === "review"
                                        ? "blue"
                                        : "amber"
                                  }
                                >
                                  {f.status === "missing"
                                    ? "Needs evidence"
                                    : f.status === "review"
                                      ? "In review"
                                      : "Covered"}
                                </Badge>
                              </td>
                              <td>
                                <ChevronRight size={15} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!findings.length && (
                        <Empty
                          title={
                            completed
                              ? "No matching findings"
                              : "Your first assessment is one click away"
                          }
                          description={
                            completed
                              ? "Try another filter or search term."
                              : "Map your profile to the starter control catalog to get started."
                          }
                        />
                      )}
                    </div>
                    <footer>
                      <span>
                        <ShieldCheck size={14} /> Evidence coverage is not a
                        certification or legal determination.
                      </span>
                      <Link to="/app/assessments">
                        View assessments <ArrowRight size={14} />
                      </Link>
                    </footer>
                  </section>
                  <div className="bottom-callout">
                    <div className="square-icon peach">
                      <Plug size={21} />
                    </div>
                    <div>
                      <strong>Good workflows don’t live in another tab.</strong>
                      <p>
                        Connect Clearance to your coding agents and delivery
                        pipeline.
                      </p>
                    </div>
                    <Link className="text-link" to="/app/integrations">
                      Connect your tools <ArrowUpRight size={16} />
                    </Link>
                  </div>
                </>
              )}
              {section === "assessments" && (
                <div className="assessment-layout">
                  <section className="card">
                    <SectionTitle
                      title="Agent activity"
                      description={
                        latest
                          ? `Latest run · ${date(latest.created_at)}`
                          : "Your next assessment will appear here."
                      }
                    />
                    {latest ? (
                      <div className="activity-timeline">
                        {latest.events.map((e, i) => (
                          <article key={i}>
                            <span className="timeline-node">
                              <Check size={14} />
                            </span>
                            <div>
                              <span className="eyebrow">{e.agent}</span>
                              <h3>{e.title}</h3>
                              <p>{e.detail}</p>
                              <small>
                                {new Date(e.at).toLocaleTimeString()}
                              </small>
                            </div>
                          </article>
                        ))}
                        {busy && (
                          <div className="activity-running">
                            <span className="status-dot" /> Assessment in
                            progress. Events refresh automatically.
                          </div>
                        )}
                      </div>
                    ) : (
                      <Empty
                        title="Ready to get started"
                        description="Run an assessment to follow discovery, mapping, evidence review and the release decision."
                      />
                    )}
                    {latest?.research && (
                      <div className="research-note">
                        <h3>External research note</h3>
                        <p>{latest.research.text}</p>
                        <div>
                          {latest.research.citations.map((c, i) => (
                            <External key={i} href={c.url}>
                              {c.title}
                            </External>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                  <section className="card">
                    <SectionTitle
                      title="Assessment history"
                      description="A record of each review."
                    />
                    <div className="history-list">
                      {data.runs.map((r) => (
                        <button key={r.id} onClick={() => setHistoryRun(r)}>
                          <span className="square-icon neutral">
                            <ScanLine size={18} />
                          </span>
                          <div>
                            <strong>
                              {r.status === "completed"
                                ? `${r.score}% evidence coverage`
                                : r.status}
                            </strong>
                            <span>
                              {date(r.created_at)} ·{" "}
                              {new Date(r.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <Download size={16} />
                        </button>
                      ))}
                      {!data.runs.length && (
                        <p className="muted">No assessments yet.</p>
                      )}
                    </div>
                    <div className="subtle-note">
                      <FileText size={16} /> Select a run to review its findings
                      or download the full record.
                    </div>
                  </section>
                </div>
              )}
              {section === "evidence" && (
                <>
                  <div className="info-banner">
                    <ShieldCheck size={20} />
                    <div>
                      <strong>Evidence needs a human decision.</strong>
                      <p>
                        Review each record before approving it. Approval means
                        you accept its support for a control, not that Clearance
                        verified its legal sufficiency.
                      </p>
                    </div>
                  </div>
                  <div className="evidence-grid">
                    {data.evidence.map((e) => (
                      <article className="card evidence-card" key={e.id}>
                        <div className="evidence-top">
                          <span className="square-icon neutral">
                            <FileText size={21} />
                          </span>
                          <Badge
                            tone={
                              e.status === "approved"
                                ? "green"
                                : e.status === "rejected"
                                  ? "red"
                                  : "amber"
                            }
                          >
                            {e.status}
                          </Badge>
                        </div>
                        <h3>{e.title}</h3>
                        <span className="evidence-control">
                          {data.controls.find((c) => c.id === e.control_id)
                            ?.title ||
                            data.rules.find((r) => r.id === e.control_id)
                              ?.title ||
                            e.control_id}
                        </span>
                        <details>
                          <summary>Read evidence</summary>
                          <p>{e.content}</p>
                        </details>
                        <footer>
                          <small>{date(e.created_at)}</small>
                          <div>
                            {e.status !== "approved" && (
                              <Button
                                variant="small outline"
                                onClick={() =>
                                  void updateEvidence(e, "approved")
                                }
                              >
                                <Check size={13} /> Approve
                              </Button>
                            )}
                            {e.status !== "rejected" && (
                              <button
                                className="text-link"
                                onClick={() =>
                                  void updateEvidence(e, "rejected")
                                }
                              >
                                Reject
                              </button>
                            )}
                          </div>
                        </footer>
                      </article>
                    ))}
                  </div>
                  {!data.evidence.length && (
                    <Empty
                      title="Start your evidence trail"
                      description="Add policy text, test results or a documented review for a mapped control."
                    >
                      <Button
                        variant="orange"
                        onClick={() => setEvidenceModal(true)}
                      >
                        Add evidence
                      </Button>
                    </Empty>
                  )}
                </>
              )}
              {section === "policies" && (
                <>
                  <SectionTitle
                    title="Your custom policies"
                    description="Internal requirements are included in every new assessment."
                  />
                  <div className="policy-list">
                    {data.rules.map((r) => (
                      <article className="card policy-card" key={r.id}>
                        <span className="square-icon peach">
                          <BookOpen size={22} />
                        </span>
                        <div>
                          <h3>{r.title}</h3>
                          <p>{r.description}</p>
                          <span className={`priority ${r.severity}`}>
                            {r.severity} priority
                          </span>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${r.title}`}
                          onClick={async () => {
                            try {
                              await api(`/projects/${selected}/rules/${r.id}`, {
                                method: "DELETE",
                              });
                              await refresh();
                              setToast(
                                "Custom policy removed. Run a new assessment.",
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          <X size={17} />
                        </button>
                      </article>
                    ))}
                  </div>
                  {!data.rules.length && (
                    <div className="empty-policy">
                      <BookOpen size={26} />
                      <div>
                        <strong>Your standards belong here, too.</strong>
                        <p>
                          Add company policies, customer requirements or checks
                          outside the starter catalog.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => setRuleModal(true)}
                      >
                        Add a policy <Plus size={15} />
                      </Button>
                    </div>
                  )}
                  <SectionTitle
                    title="Mapped starter controls"
                    description="Readiness checks based on product context. Review applicability with a qualified specialist."
                  />
                  <div className="policy-list">
                    {data.controls.map((c) => (
                      <article className="card policy-card" key={c.id}>
                        <span className="square-icon neutral">
                          <ShieldCheck size={20} />
                        </span>
                        <div>
                          <span className="eyebrow">{c.framework}</span>
                          <h3>{c.title}</h3>
                          <p>{c.description}</p>
                          <External href={c.source}>Official source</External>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
              {section === "regulations" && (
                <RegulatoryWatch config={config} notify={setToast} />
              )}
              {section === "integrations" && (
                <Integrations projectId={selected} notify={setToast} />
              )}
              {section === "settings" && user && (
                <SettingsPanel
                  user={user}
                  config={config}
                  project={data.project}
                  onEdit={() => {
                    setEdit(true);
                    setOnboard(true);
                  }}
                  onUserUpdate={async () =>
                    setUser((await api("/auth/me")).user)
                  }
                />
              )}
            </>
          )}
          <footer className="app-footer">
            <span className="footer-brand">clearance.</span>
            <span>Clarity, at every stage.</span>
            <div>
              <span className="status-dot" />{" "}
              {config.demo ? "Local demo" : "Workspace connected"}
            </div>
          </footer>
        </main>
      </div>
      {onboard && (
        <Onboarding
          project={edit ? data?.project : undefined}
          onClose={() => setOnboard(false)}
          onSaved={async (pid) => {
            setOnboard(false);
            await loadProjects(pid);
            if (pid === selected) await refresh();
            setToast(
              edit
                ? "Product context updated. Run a fresh assessment."
                : "Product created. Run your first assessment.",
            );
          }}
        />
      )}
      {historyRun && (
        <Modal
          title="Previous assessment"
          subtitle={`${date(historyRun.created_at)} · ${historyRun.status} · ${historyRun.score}% evidence coverage`}
          onClose={() => setHistoryRun(null)}
          wide
        >
          <div className="modal-body">
            <p>These are the findings recorded at the time of this run.</p>
            <div className="history-findings">
              {historyRun.findings.map((f) => (
                <article key={f.id}>
                  <strong>{f.title}</strong>
                  <Badge tone={f.status === "covered" ? "green" : "amber"}>
                    {f.status}
                  </Badge>
                  <p>{f.action}</p>
                </article>
              ))}
            </div>
          </div>
          <footer className="modal-footer">
            <Button variant="ghost" onClick={() => setHistoryRun(null)}>
              Close
            </Button>
            <Button
              variant="orange"
              onClick={() =>
                download(`assessment-${historyRun.id}.json`, historyRun)
              }
            >
              <Download size={15} /> Download record
            </Button>
          </footer>
        </Modal>
      )}
      {newProject && (
        <NewProject
          onClose={() => setNewProject(false)}
          onSaved={async (pid) => {
            setNewProject(false);
            await loadProjects(pid);
            openProject(pid, "connect");
          }}
        />
      )}
      {evidenceModal && data && (
        <EvidenceModal
          data={data}
          defaultControl={finding?.id}
          onClose={() => setEvidenceModal(false)}
          onSaved={async () => {
            setEvidenceModal(false);
            await refresh();
            setToast("Evidence submitted for review.");
          }}
        />
      )}
      {ruleModal && (
        <RuleModal
          projectId={selected}
          onClose={() => setRuleModal(false)}
          onSaved={async () => {
            setRuleModal(false);
            await refresh();
            setToast("Custom policy added. Run an assessment to include it.");
          }}
        />
      )}
      {finding && !evidenceModal && (
        <Modal
          title={finding.title}
          subtitle={finding.framework}
          onClose={() => setFinding(null)}
        >
          <div className="modal-body">
            <Badge tone={finding.status === "covered" ? "green" : "amber"}>
              {finding.status}
            </Badge>
            <h3>Why this is on your radar</h3>
            <p>{finding.description}</p>
            <h3>Your next step</h3>
            <p>{finding.action}</p>
            {finding.source && (
              <External href={finding.source}>
                Read the official source
              </External>
            )}
            <div className="subtle-note">
              <ShieldCheck size={16} /> Confirm applicability and evidence
              sufficiency with your reviewer.
            </div>
          </div>
          <footer className="modal-footer">
            <Button variant="ghost" onClick={() => setFinding(null)}>
              Close
            </Button>
            {finding.framework === "Project questions" ? (
              <Button
                variant="orange"
                onClick={() => {
                  openProject(
                    selected,
                    finding.id === "code-snapshot" ? "connect" : "questions",
                  );
                  setFinding(null);
                }}
              >
                Complete project setup <ArrowRight size={15} />
              </Button>
            ) : (
              <Button variant="orange" onClick={() => setEvidenceModal(true)}>
                <Plus size={15} /> Add evidence
              </Button>
            )}
          </footer>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function EvidenceModal({
  data,
  defaultControl,
  onClose,
  onSaved,
}: {
  data: Data;
  defaultControl?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  return (
    <Modal
      title="Add a piece of the picture."
      subtitle="Link evidence to a control. Review it before approval."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post(`/projects/${data.project.id}/evidence`, {
              ...Object.fromEntries(new FormData(e.currentTarget)),
              content,
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field label="Requirement">
            <select required name="controlId" defaultValue={defaultControl}>
              {[...data.controls, ...data.rules].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Evidence title">
            <input
              name="title"
              placeholder="e.g. Privacy notice review — October"
              minLength={3}
              maxLength={150}
              required
            />
          </Field>
          <Field
            label="Evidence text"
            hint="Include the record, test result or review details. Never paste credentials or unnecessary personal data."
          >
            <textarea
              required
              rows={7}
              minLength={20}
              maxLength={50000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </Field>
          <Field
            label="Or import a text file"
            hint="Plain text, Markdown, JSON or CSV · up to 50 KB"
          >
            <input
              type="file"
              accept=".txt,.md,.json,.csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 50000) {
                    setError("Choose a text file under 50 KB.");
                    return;
                  }
                  setContent(await file.text());
                }
              }}
            />
          </Field>
          {error && <div className="alert error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={busy} type="submit" variant="orange">
            Submit evidence <ArrowRight size={15} />
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
function RuleModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Your standards, in the workflow."
      subtitle="Add an internal requirement to this product."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post(
              `/projects/${projectId}/rules`,
              Object.fromEntries(new FormData(e.currentTarget)),
            );
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <Field label="Policy title">
            <input
              name="title"
              minLength={3}
              maxLength={150}
              required
              placeholder="e.g. Customer data residency"
            />
          </Field>
          <Field
            label="What must be true?"
            hint="State the requirement and what evidence should demonstrate it."
          >
            <textarea
              name="description"
              minLength={20}
              maxLength={6000}
              rows={5}
              required
              placeholder="All customer data must be stored…"
            />
          </Field>
          <Field label="Priority">
            <select name="severity">
              <option value="high">
                High — blocks the release gate without approved evidence
              </option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
          {error && <div className="alert error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="orange" busy={busy}>
            Add policy <Plus size={15} />
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
