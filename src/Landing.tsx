import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Menu,
  X,
  Copy,
  CheckCheck,
  Plus,
} from "lucide-react";
import { Logo } from "./ui";
import { post } from "./api";
import "./marketing.css";
const repo = "https://github.com/Ramphyi/compliance_agent";
const memosCommit = "8120a6cee03003ee7968b49b2109f816fa4d96a4";
const memos = `https://github.com/usememos/memos/tree/${memosCommit}`;
const titles: Record<string, string> = {
  "/": "Software compliance, before release",
  "/platform": "The platform",
  "/solutions": "Your software",
  "/solutions/saas": "SaaS compliance",
  "/solutions/ai": "AI governance",
  "/solutions/mobile": "Mobile app readiness",
  "/solutions/embedded": "Embedded software readiness",
  "/integrations": "MCP & CI/CD",
  "/security": "Security & deployment",
  "/pricing": "Pricing",
  "/field-notes": "Field notes",
  "/field-notes/memos": "Assessing Memos",
  "/about": "Why Clearance",
};
export const marketingPaths = Object.keys(titles);
const nav = [
  ["/platform", "Product"],
  ["/solutions", "Your software"],
  ["/integrations", "Developers"],
  ["/field-notes", "Field notes"],
  ["/security", "Security"],
  ["/pricing", "Pricing"],
];
function Go({
  to,
  children,
  primary = false,
}: {
  to: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link className={primary ? "m-button" : "m-link"} to={to}>
      {children}
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}
function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="m-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={16} aria-hidden="true" />
    </a>
  );
}
function Label({ children }: { children: ReactNode }) {
  return <p className="m-label">{children}</p>;
}
function Intro({
  label,
  title,
  children,
}: {
  label: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="m-intro m-wrap">
      <Label>{label}</Label>
      <h1 tabIndex={-1}>{title}</h1>
      <div className="m-intro-text">{children}</div>
    </section>
  );
}
function Faq({ items }: { items: [string, string][] }) {
  return (
    <div className="m-faq">
      {items.map(([q, a]) => (
        <details key={q}>
          <summary>
            {q}
            <Plus size={19} aria-hidden="true" />
          </summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}
function Code({ title, children }: { title: string; children: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="m-code">
      <div>
        <span>{title}</span>
        <button
          aria-label={`Copy ${title}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(children);
              setCopied(true);
              setError("");
            } catch {
              setError("Select the code below to copy it.");
            }
          }}
        >
          {copied ? <CheckCheck size={17} /> : <Copy size={17} />}{" "}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{children}</code>
      </pre>
      {error && <p role="status">{error}</p>}
    </div>
  );
}
function Demo({
  secondary = false,
  example = "default",
}: {
  secondary?: boolean;
  example?: "default" | "memos";
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="m-demo">
      <button
        className={`m-button ${secondary ? "m-button-secondary" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await post("/demo", { example });
            navigate("/app");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Opening workspace…"
          : example === "memos"
            ? "Open the Memos example"
            : "Explore the workspace"}
        <ArrowRight size={17} />
      </button>
      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
const briefs = {
  saas: {
    name: "A SaaS team entering Europe",
    context: "Business customers / EU / Personal data",
    question: "Where does customer data go?",
    items: [
      ["Data processing map", "Needs evidence"],
      ["Access review", "Owner reviewed"],
      ["Incident response plan", "Needs review"],
    ],
    note: "A new market changes the questions, even when your code stays the same.",
  },
  ai: {
    name: "An AI feature, ready for review",
    context: "AI-assisted product / EU / Business users",
    question: "What decisions does your model influence?",
    items: [
      ["Intended-use record", "Needs evidence"],
      ["Evaluation results", "Needs review"],
      ["Accountable owner", "Owner reviewed"],
    ],
    note: "Document what the feature does before deciding which AI obligations may apply.",
  },
  mobile: {
    name: "A mobile release with a new SDK",
    context: "Mobile app / Consumers / Personal data",
    question: "Does the store disclosure match the app?",
    items: [
      ["Permission inventory", "Owner reviewed"],
      ["SDK data practices", "Needs evidence"],
      ["Store disclosures", "Needs review"],
    ],
    note: "A small dependency change can create a very different disclosure review.",
  },
};
function ReleaseBrief() {
  const [active, setActive] = useState<keyof typeof briefs>("saas");
  const b = briefs[active];
  return (
    <div className="m-brief">
      <div className="m-brief-head">
        <span>THE RELEASE DESK</span>
        <span>0{Object.keys(briefs).indexOf(active) + 1} / 03</span>
      </div>
      <div className="m-brief-tabs" role="group" aria-label="Example product">
        {(["saas", "ai", "mobile"] as const).map((k) => (
          <button
            key={k}
            aria-pressed={active === k}
            onClick={() => setActive(k)}
          >
            {k === "saas" ? "SaaS" : k === "ai" ? "AI product" : "Mobile app"}
          </button>
        ))}
      </div>
      <div className="m-brief-body" aria-live="polite">
        <p className="m-brief-context">{b.context}</p>
        <h2>{b.question}</h2>
        <p>{b.name}</p>
        <div className="m-brief-list">
          {b.items.map(([t, s]) => (
            <div key={t}>
              <span>{t}</span>
              <span className={s === "Owner reviewed" ? "reviewed" : ""}>
                {s}
              </span>
            </div>
          ))}
        </div>
        <div className="m-margin-note">{b.note}</div>
      </div>
      <p className="m-brief-caption">
        Interactive example. Your assessment starts with your own product.
      </p>
    </div>
  );
}
function Home() {
  return (
    <>
      <section className="m-home-hero m-wrap">
        <div>
          <Label>FOR THE ENGINEER WHO ALSO OWNS COMPLIANCE</Label>
          <h1 tabIndex={-1}>
            Someone has to ask the <em>awkward</em> launch questions.
          </h1>
          <p className="m-lead">
            What rules apply? Where is the evidence? Who actually reviewed it?
            Clearance puts the answers next to the product you’re shipping.
          </p>
          <div className="m-actions">
            <Demo />
            <Go to="/platform">See how it works</Go>
          </div>
          <p className="m-caption">
            Open the sample workspace. No account or API key needed.
          </p>
        </div>
        <ReleaseBrief />
      </section>
      <div className="m-index-strip">
        <div className="m-wrap">
          <span>CONTEXT FIRST. EVIDENCE NEXT.</span>
          <span>SaaS</span>
          <span>AI products</span>
          <span>Mobile apps</span>
          <span>Embedded software</span>
        </div>
      </div>
      <section className="m-wrap m-editorial">
        <div>
          <Label>THE PROBLEM WE’RE WORKING ON</Label>
          <h2>
            The spreadsheet isn’t the hard part.
            <br />
            Keeping it true is.
          </h2>
        </div>
        <div>
          <p>
            A privacy notice sits in one folder. Security answers live in a
            sales document. An engineer remembers why the AI feature was
            classified a certain way. Then the product changes.
          </p>
          <p>
            Clearance keeps the product’s context, candidate requirements,
            review decisions and release checks together. You can see what
            changed and which decisions need another look.
          </p>
          <Go to="/about">Why we built it this way</Go>
        </div>
      </section>
      <section className="m-navy">
        <div className="m-wrap">
          <div className="m-section-heading">
            <div>
              <Label>AN ORDINARY RELEASE, WITH FEWER LOOSE ENDS</Label>
              <h2>
                A place for the work
                <br />
                between “it runs” and “it’s ready.”
              </h2>
            </div>
            <Go to="/platform">Inside the product</Go>
          </div>
          <div className="m-process">
            {[
              [
                "01",
                "Describe the actual product",
                "Markets, customers, data and intended use. A consumer mobile app should not inherit a generic B2B checklist.",
              ],
              [
                "02",
                "Give each requirement a record",
                "Keep the source, proposed action and supporting evidence together. Reviewers make explicit decisions.",
              ],
              [
                "03",
                "Check again at release time",
                "Changed inputs and stale assessments block the gate. The same review is available in your workspace, agent and pipeline.",
              ],
            ].map(([n, t, p]) => (
              <article key={n}>
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="m-wrap m-case-feature">
        <div className="m-case-cover">
          <Label>FIELD NOTE / 001</Label>
          <span className="m-case-word">
            memos<span>→</span>
          </span>
          <p>
            A real repository.
            <br />A deliberately narrow experiment.
          </p>
          <span className="m-case-stamp">SOURCE PINNED · WORKFLOW TESTED</span>
        </div>
        <div>
          <Label>OFF THE LANDING PAGE, INTO A REPOSITORY</Label>
          <h2>We put an open-source notes app through the workflow.</h2>
          <p>
            Follow the Memos experiment: inspect repository metadata, declare a
            deployment scenario, submit a record over MCP, then check the CI
            gate.
          </p>
          <p>
            The useful result is a traceable review. Finding files does not
            magically make a product compliant.
          </p>
          <Go to="/field-notes/memos">Read the experiment</Go>
        </div>
      </section>
      <section className="m-wrap m-software-links">
        <Label>WHAT ARE YOU SHIPPING?</Label>
        {solutions.map((s) => (
          <Link to={`/solutions/${s.slug}`} key={s.slug}>
            <span>{s.number}</span>
            <h3>{s.name}</h3>
            <p>{s.short}</p>
            <ArrowUpRight size={28} />
          </Link>
        ))}
      </section>
      <section className="m-wrap m-editorial m-border">
        <div>
          <Label>YOUR REPOSITORY. YOUR INFRASTRUCTURE.</Label>
          <h2>
            Keep the review close
            <br />
            to the people doing it.
          </h2>
        </div>
        <div>
          <p>
            Self-host the Node.js application and PostgreSQL database. Run local
            assessments without a model. Turn on external research only when the
            deployment and the individual project allow it.
          </p>
          <div className="m-actions">
            <Go to="/security">Read the data boundaries</Go>
            <Go to="/integrations">Connect an agent</Go>
          </div>
        </div>
      </section>
      <section className="m-wrap m-faq-section">
        <div>
          <Label>BEFORE YOU OPEN A WORKSPACE</Label>
          <h2>A few straight answers.</h2>
        </div>
        <Faq
          items={[
            [
              "Will this certify my product?",
              "No. Clearance organizes candidate requirements and evidence for a review. Legal applicability and certification decisions need qualified reviewers. A passing gate records evidence readiness against the selected controls.",
            ],
            [
              "Does it read my entire repository?",
              "The optional local inventory script discovers bounded metadata, test filenames, pipeline files and selected dependency hints. It does not execute repository code or send source contents to a model. Review the inventory before attaching it.",
            ],
            [
              "Can I use it without external AI?",
              "Yes. Local control mapping, evidence review, MCP and release gates work without model calls. Optional research requires server permission, project consent and configured provider credentials.",
            ],
            [
              "What can I try today?",
              "The isolated sample workspace supports onboarding, assessments, evidence review, custom policies and integration keys. Sample data resets when the preview server restarts.",
            ],
          ]}
        />
      </section>
    </>
  );
}
function Platform() {
  return (
    <>
      <Intro
        label="THE PRODUCT"
        title={
          <>
            A release review you
            <br />
            can pick up tomorrow.
          </>
        }
      >
        <p>
          Every finding needs context. Every approval needs a record. Clearance
          connects them without asking your team to remember the whole story.
        </p>
      </Intro>
      <section className="m-wrap m-product-spread">
        <div className="m-product-caption">
          <Label>01 / THE WORKSPACE</Label>
          <p>One product, its current scope and the next decisions to make.</p>
          <Demo secondary />
        </div>
        <img
          src="/marketing/workspace.png"
          alt="Clearance sample workspace showing evidence coverage, applicable frameworks and open checks"
          width="1440"
          height="1000"
        />
      </section>
      <section className="m-wrap m-detail-list">
        {[
          [
            "Start with context",
            "Define software type, industry, countries, audience and data categories. Record AI use separately so a conventional app with an AI feature can still be scoped correctly.",
            "A change of market is a change of input.",
          ],
          [
            "Map candidate requirements",
            "The starter catalog selects relevant readiness controls and attaches official source links. Add your own policies for procurement requirements, contracts or internal standards.",
            "A starter catalog is a review starting point, not exhaustive law.",
          ],
          [
            "Collect and review evidence",
            "Attach a text record or import a small text file. Link it to a requirement. The owner approves or rejects it; a model cannot approve it on their behalf.",
            "Submitted, reviewed and missing mean different things.",
          ],
          [
            "Preserve the assessment",
            "Each run stores findings, evidence coverage and timestamped workflow events. Export the report and revisit earlier runs when a release decision needs explaining.",
            "History should answer why, not just when.",
          ],
          [
            "Check the release gate",
            "The gate rejects missing or incomplete assessments, changed inputs, runs older than seven days and high-priority findings without approved evidence.",
            "A green gate is evidence readiness for the selected scope.",
          ],
        ].map(([t, p, n], i) => (
          <article key={t}>
            <span className="m-step">0{i + 1}</span>
            <h2>{t}</h2>
            <div>
              <p>{p}</p>
              <p className="m-caption">{n}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="m-navy">
        <div className="m-wrap m-editorial">
          <div>
            <Label>THE AGENT WORKFLOW</Label>
            <h2>
              See the work.
              <br />
              Question the result.
            </h2>
          </div>
          <div>
            <p>
              Discovery → regulatory mapping → evidence review → optional
              research → release review.
            </p>
            <p>
              These are visible workflow roles. The core steps are
              deterministic; optional research uses a model to investigate
              official sources. The result stays available for human review.
            </p>
            <Go to="/integrations">MCP tools and skill resources</Go>
          </div>
        </div>
      </section>
    </>
  );
}
const solutions = [
  {
    slug: "saas",
    number: "01",
    name: "SaaS & web products",
    short: "Customer data, enterprise questions and the next market.",
    title: "Your first enterprise customer will have questions.",
    intro:
      "Bring your product team’s answers, the supporting records and the open gaps into one review before the contract or launch deadline.",
    questions: [
      "Where do customer records and backups live?",
      "Who can access production, and who reviews that access?",
      "Can a customer request access to or deletion of their data?",
      "What happens when the product enters another market?",
    ],
    records: [
      "Data processing map and vendor inventory",
      "Access review with an accountable owner",
      "Privacy notice and data-rights procedure",
      "Incident response plan",
    ],
    scenario:
      "A small B2B product begins selling to customers in the EU. Its deployment scenario includes personal data and no AI features. Start with privacy and security readiness, then add contract-specific requirements as custom policies.",
    boundary:
      "Regulated customers can create additional obligations. Financial, health and children’s data need a more specific scope than a general SaaS checklist.",
  },
  {
    slug: "ai",
    number: "02",
    name: "AI products & features",
    short: "Intended use, evaluation evidence and accountable decisions.",
    title: "The model isn’t the whole product.",
    intro:
      "Your intended use, users and deployment context matter. Record them before turning a standard or an AI rule into an engineering task.",
    questions: [
      "What does the system do, and who is affected by its output?",
      "Which decisions stay with a person?",
      "What evaluations support the intended use?",
      "Who owns risk review when the model or use case changes?",
    ],
    records: [
      "Intended-use and risk-classification rationale",
      "Evaluation plan and test results",
      "Human oversight and escalation procedure",
      "Governance roles and change review",
    ],
    scenario:
      "A SaaS team adds an AI-assisted feature for European business customers. Declare AI use during onboarding. Review candidate EU AI Act and ISO/IEC 42001 readiness controls, document your classification rationale and attach evaluation evidence.",
    boundary:
      "ISO/IEC 42001 is an AI management system standard. Clearance offers selected readiness controls, not the full standard, certification or a conclusive AI Act classification.",
  },
  {
    slug: "mobile",
    number: "03",
    name: "Mobile apps",
    short: "Permissions, SDKs, privacy disclosures and store review.",
    title: "A new SDK belongs in the release review.",
    intro:
      "Your app’s permissions and disclosures should reflect what the software actually does. Keep the supporting records with the release that changed them.",
    questions: [
      "Which permissions does the app request, and why?",
      "What data do embedded SDKs process?",
      "Do store disclosures match the current build?",
      "Is the intended audience likely to include children?",
    ],
    records: [
      "Permission and SDK inventory",
      "Store privacy and data-safety disclosures",
      "Privacy notice and consent flow review",
      "Audience and age-related scope decision",
    ],
    scenario:
      "A consumer app introduces an analytics SDK. Add a custom requirement to review that SDK’s data practices. Keep the inventory and disclosure review as separate evidence records, and rerun the assessment after the change.",
    boundary:
      "An evidence gate is not an App Store or Google Play approval. Platform policies and sector-specific rules still require review for the actual release.",
  },
  {
    slug: "embedded",
    number: "04",
    name: "Embedded & connected software",
    short: "Update support, vulnerability handling and product security.",
    title: "The review doesn’t end when the device ships.",
    intro:
      "Connected products need a support story. Make update responsibilities, security documentation and vulnerability handling visible before release.",
    questions: [
      "How will the device receive authenticated updates?",
      "Who receives and investigates vulnerability reports?",
      "What support period has the manufacturer committed to?",
      "Is the product a medical device or part of a regulated system?",
    ],
    records: [
      "Product security and update procedure",
      "Vulnerability reporting and response process",
      "Support lifecycle documentation",
      "Product classification and regulatory scope review",
    ],
    scenario:
      "A connected industrial device is intended for sale in Europe. Declare embedded software, industrial use and the intended markets. Review candidate product-security controls and add concrete manufacturer obligations as custom policies.",
    boundary:
      "The software profile alone cannot determine every product regulation. Hardware, safety, medical-device scope and supply-chain responsibilities need specialist review.",
  },
];
function Solutions({ slug }: { slug?: string }) {
  const s = solutions.find((x) => x.slug === slug);
  if (!s)
    return (
      <>
        <Intro
          label="YOUR SOFTWARE"
          title={
            <>
              Different products.
              <br />
              Different launch questions.
            </>
          }
        >
          <p>
            A general checklist is a poor substitute for product context. Start
            with the kind of software you build, then make the scope yours.
          </p>
        </Intro>
        <section className="m-wrap m-solution-index">
          {solutions.map((s) => (
            <article key={s.slug}>
              <Label>{s.number} / SOFTWARE CONTEXT</Label>
              <h2>{s.name}</h2>
              <p>{s.intro}</p>
              <Go to={`/solutions/${s.slug}`}>Explore the workflow</Go>
            </article>
          ))}
        </section>
        <section className="m-wrap m-editorial m-border">
          <h2>Your product spans categories?</h2>
          <div>
            <p>
              A mobile app can have an AI feature. A SaaS service can sell into
              healthcare. Onboarding captures these dimensions separately so you
              can review the overlap.
            </p>
            <Go to="/platform">See the scoping process</Go>
          </div>
        </section>
      </>
    );
  return (
    <>
      <Intro label={`YOUR SOFTWARE / ${s.name.toUpperCase()}`} title={s.title}>
        <p>{s.intro}</p>
        <Go to="/signup" primary>
          Set up your product
        </Go>
      </Intro>
      <section className="m-wrap m-question-spread">
        <div>
          <Label>QUESTIONS TO BRING TO THE REVIEW</Label>
          {s.questions.map((q, i) => (
            <div key={q} className="m-question">
              <span>0{i + 1}</span>
              <h2>{q}</h2>
            </div>
          ))}
        </div>
        <aside>
          <Label>THE RECORDS THAT HELP</Label>
          <ul>
            {s.records.map((r) => (
              <li key={r}>
                <Check size={17} />
                {r}
              </li>
            ))}
          </ul>
          <p>{s.boundary}</p>
        </aside>
      </section>
      <section className="m-orange">
        <div className="m-wrap m-editorial">
          <div>
            <Label>A WORKED SCENARIO</Label>
            <h2>
              Here’s where
              <br />
              you would start.
            </h2>
          </div>
          <div>
            <p>{s.scenario}</p>
            <Go to="/platform">Follow the review process</Go>
          </div>
        </div>
      </section>
      <section className="m-wrap m-related">
        <Label>OTHER SOFTWARE CONTEXTS</Label>
        {solutions
          .filter((x) => x !== s)
          .map((x) => (
            <Go key={x.slug} to={`/solutions/${x.slug}`}>
              {x.name}
            </Go>
          ))}
      </section>
    </>
  );
}
function Integrations() {
  return (
    <>
      <Intro
        label="FOR DEVELOPERS"
        title={
          <>
            Your agent can do the legwork.
            <br />
            You keep the review.
          </>
        }
      >
        <p>
          Use Clearance from the browser, an MCP client or your release
          pipeline. Each reads the same project and the same evidence state.
        </p>
        <Out href={`${repo}/tree/main/skills`}>
          Read the skills in the repository
        </Out>
      </Intro>
      <section className="m-wrap m-integration-row">
        <div>
          <Label>01 / MODEL CONTEXT PROTOCOL</Label>
          <h2>One scoped connection.</h2>
          <p>
            Create a key in Workspace → Integrations. Give it only the read,
            assess and evidence scopes it needs, then connect a client
            supporting Streamable HTTP and bearer headers.
          </p>
          <p>
            Keys expire after 90 days and can be revoked. Evidence submitted by
            an agent waits for an owner’s review.
          </p>
        </div>
        <Code title="mcp.config.json">
          {JSON.stringify(
            {
              mcpServers: {
                clearance: {
                  url: "https://clearance.example.com/mcp",
                  headers: { Authorization: "Bearer YOUR_CLEARANCE_API_KEY" },
                },
              },
            },
            null,
            2,
          )}
        </Code>
      </section>
      <section className="m-wrap m-tool-table">
        <Label>THE TOOL SURFACE</Label>
        <div className="m-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Scope</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "list_projects",
                  "read",
                  "Lists projects owned by the authenticated user.",
                ],
                [
                  "get_assessment",
                  "read",
                  "Reads the latest assessment and its findings.",
                ],
                [
                  "check_release_gate",
                  "read",
                  "Returns gate status and the reasons for it.",
                ],
                [
                  "run_assessment",
                  "assess",
                  "Creates a new assessment for the selected project.",
                ],
                [
                  "submit_evidence",
                  "evidence",
                  "Adds a record for human review. Cannot approve it.",
                ],
              ].map((r) => (
                <tr key={r[0]}>
                  <td>
                    <code>{r[0]}</code>
                  </td>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-caption">
          Resources: <code>clearance://skills/assessment</code> and{" "}
          <code>clearance://sources</code>. MCP OAuth discovery is not
          implemented in this preview.
        </p>
      </section>
      <section className="m-navy">
        <div className="m-wrap m-integration-row">
          <div>
            <Label>02 / CONTINUOUS DELIVERY</Label>
            <h2>
              The release gets
              <br />
              the same answer.
            </h2>
            <p>
              Copy the gate script into your repository and provide your
              deployment URL, project ID and a read-scoped key through pipeline
              secrets.
            </p>
            <p>
              Exit 0 means the evidence gate passed. Exit 1 blocks the release.
              Exit 2 means configuration or request failure. Errors never become
              a pass.
            </p>
          </div>
          <Code title="GitHub Actions step">
            {
              "- name: Check compliance readiness\n  env:\n    CLEARANCE_URL: ${{ vars.CLEARANCE_URL }}\n    CLEARANCE_PROJECT_ID: ${{ vars.CLEARANCE_PROJECT_ID }}\n    CLEARANCE_API_KEY: ${{ secrets.CLEARANCE_API_KEY }}\n  run: node scripts/compliance-gate.mjs"
            }
          </Code>
        </div>
      </section>
      <section className="m-wrap m-integration-row">
        <div>
          <Label>03 / LOCAL REPOSITORY INVENTORY</Label>
          <h2>
            Start with what’s
            <br />
            already in the repo.
          </h2>
          <p>
            The inventory script discovers bounded metadata, nested manifests,
            test filenames and pipeline definitions. It skips secret directories
            and symlinks, never executes the target app and never uploads the
            result.
          </p>
          <Go to="/field-notes/memos">See it used on Memos</Go>
        </div>
        <Code title="Local inventory">
          {
            "node scripts/inspect-repository.mjs /path/to/product > inventory.json\n\n# Review the report locally.\n# Submit only records appropriate to your assessment."
          }
        </Code>
      </section>
    </>
  );
}
function Security() {
  return (
    <>
      <Intro
        label="SECURITY & DEPLOYMENT"
        title={
          <>
            The data boundaries
            <br />
            should be easy to explain.
          </>
        }
      >
        <p>
          Clearance runs on your infrastructure. Local assessments do not
          require a model, and external services have explicit roles.
        </p>
      </Intro>
      <section className="m-wrap m-data-map">
        <Label>WHERE INFORMATION GOES</Label>
        {[
          [
            "Your infrastructure",
            "Product profiles, evidence text, assessment history, review decisions and audit records live in your PostgreSQL database.",
          ],
          [
            "Optional model research",
            "When both server and project opt in, the declared profile and candidate source links can go to OpenAI. Evidence text is excluded from that research request.",
          ],
          [
            "Identity and messages",
            "Google receives OAuth traffic when enabled. Brevo sends confirmation and reset email. Twilio Verify handles configured SMS or WhatsApp verification.",
          ],
          [
            "Official source checks",
            "An operator-enabled fetcher checks a fixed source catalog for page changes. A changed page is a signal to review, not a legal interpretation.",
          ],
        ].map(([t, p], i) => (
          <article key={t}>
            <span>0{i + 1}</span>
            <h2>{t}</h2>
            <p>{p}</p>
          </article>
        ))}
      </section>
      <section className="m-navy">
        <div className="m-wrap m-editorial">
          <div>
            <Label>ON YOUR OWN INFRASTRUCTURE</Label>
            <h2>
              React. Node.js.
              <br />
              PostgreSQL. Docker.
            </h2>
          </div>
          <div>
            <p>
              The production configuration runs the application as a non-root
              user, with a read-only filesystem and restricted container
              capabilities. PostgreSQL has a persistent volume and no published
              host port.
            </p>
            <p>
              Supply HTTPS ingress, secrets, encrypted storage where required,
              backups and tested recovery procedures. The current application
              targets one API instance.
            </p>
            <Out href={`${repo}#docker--on-premise`}>
              Deployment instructions
            </Out>
          </div>
        </div>
      </section>
      <section className="m-wrap m-question-spread">
        <div>
          <Label>BUILT INTO THE APPLICATION</Label>
          <h2>Controls with specific jobs.</h2>
          <ul className="m-plain-list">
            <li>Scrypt password hashes and hashed session tokens.</li>
            <li>HttpOnly cookies and Secure cookies in production.</li>
            <li>Origin checks, content security policy and request limits.</li>
            <li>Owner-scoped records and scoped integration keys.</li>
            <li>Explicit review actions and a fail-closed release gate.</li>
          </ul>
        </div>
        <aside>
          <Label>DEPLOYMENT REVIEW</Label>
          <p>
            Google, mail, OTP and model integrations need your credentials and
            live delivery tests. Docker configuration is included; container
            execution has not been verified on this workstation.
          </p>
          <p>
            This preview does not include team roles, SAML, recovery codes,
            tamper-proof audit storage or a penetration-test certification.
          </p>
        </aside>
      </section>
      <section className="m-wrap m-faq-section">
        <h2>Deployment questions.</h2>
        <Faq
          items={[
            [
              "Can I operate without external AI?",
              "Yes. Leave external AI and regulatory fetch disabled. The core assessment and review workflow runs locally. Identity and message providers still require their own network access if enabled.",
            ],
            [
              "Is disabling AI the same as air-gapping the server?",
              "No. Enforce network isolation with your infrastructure policy or remove the egress network. The app’s flags control research behavior, not every possible route out of the host.",
            ],
            [
              "Can I run multiple API replicas?",
              "The current release uses process-local rate limits and assessment exclusion. Add shared limits, durable workers and database-backed job locks before scaling horizontally.",
            ],
          ]}
        />
      </section>
    </>
  );
}
function Pricing() {
  const [hours, setHours] = useState(20),
    [reduction, setReduction] = useState(30);
  return (
    <>
      <Intro
        label="PRICING"
        title={
          <>
            Start with a product.
            <br />
            Make the scope yours.
          </>
        }
      >
        <p>
          The working preview is available to explore and self-host. The plans
          below describe proposed packaging, not an active subscription offer.
        </p>
        <p className="m-caption">
          No card collection. No checkout. No surprise trial conversion.
        </p>
      </Intro>
      <section className="m-wrap m-plans">
        {[
          {
            name: "Explore",
            price: "Free",
            unit: "interactive preview",
            desc: "Get a feel for the review before setting up your infrastructure.",
            items: [
              "Isolated sample workspace",
              "Assessments and evidence review",
              "Custom policy experiments",
              "Sample data resets on restart",
            ],
            link: "/",
            cta: "Open the demo",
          },
          {
            name: "Build",
            price: "€49",
            unit: "per month · proposed",
            desc: "A proposed hosted plan for a small team’s first product.",
            items: [
              "Product context and review history",
              "Evidence and custom policies",
              "MCP and CI integration",
              "Hosting and support terms not yet offered",
            ],
            link: "/signup",
            cta: "Create a preview account",
          },
          {
            name: "Self-host",
            price: "Your stack",
            unit: "deployment available today",
            desc: "Run the current application where you manage your software.",
            items: [
              "React and Node.js application",
              "PostgreSQL and Docker configuration",
              "Optional external providers",
              "You operate hosting, backups and upgrades",
            ],
            link: "/security",
            cta: "Review deployment",
          },
        ].map((p, i) => (
          <article key={p.name} className={i === 1 ? "m-plan-accent" : ""}>
            <Label>{p.name}</Label>
            <h2>{p.price}</h2>
            <span className="m-caption">{p.unit}</span>
            <p>{p.desc}</p>
            <ul>
              {p.items.map((x) => (
                <li key={x}>
                  <Check size={16} />
                  {x}
                </li>
              ))}
            </ul>
            {i === 0 ? (
              <Demo secondary />
            ) : (
              <Go to={p.link} primary>
                {p.cta}
              </Go>
            )}
          </article>
        ))}
      </section>
      <section className="m-wrap m-editorial m-border">
        <div>
          <Label>PLAN THE WORK, DON’T INVENT THE ROI</Label>
          <h2>
            What would less
            <br />
            admin be worth?
          </h2>
          <p>
            Use your own assumptions to estimate time recovered from repeated
            compliance admin. This is a planning tool, not measured Clearance
            performance.
          </p>
        </div>
        <div className="m-calculator">
          <label>
            Monthly compliance admin <strong>{hours} hours</strong>
            <input
              aria-label="Monthly compliance hours"
              type="range"
              min="5"
              max="100"
              step="5"
              value={hours}
              onChange={(e) => setHours(+e.target.value)}
            />
          </label>
          <label>
            Assumed reduction <strong>{reduction}%</strong>
            <input
              aria-label="Assumed reduction"
              type="range"
              min="5"
              max="75"
              step="5"
              value={reduction}
              onChange={(e) => setReduction(+e.target.value)}
            />
          </label>
          <output aria-live="polite">
            {((hours * reduction) / 100).toFixed(1)} <span>hours / month</span>
          </output>
          <p className="m-caption">Estimated using your inputs.</p>
        </div>
      </section>
      <section className="m-wrap m-faq-section">
        <h2>Before choosing a plan.</h2>
        <Faq
          items={[
            [
              "Will signup charge me?",
              "No. Billing and checkout are not implemented. Signup creates a preview account when the deployment has email delivery configured.",
            ],
            [
              "Are provider costs included?",
              "No provider allowances are offered in the preview. Self-hosted deployments use their own Google, Brevo, Twilio and OpenAI configurations and pay any applicable provider or hosting costs.",
            ],
            [
              "Can I purchase an enterprise plan?",
              "There is no enterprise checkout or signed service offer here. Team roles, SAML and service-level commitments are not available features in this implementation.",
            ],
          ]}
        />
      </section>
    </>
  );
}
function FieldNotes({ article = false }: { article?: boolean }) {
  if (!article)
    return (
      <>
        <Intro
          label="FIELD NOTES"
          title={
            <>
              What happens when
              <br />
              the checklist meets the code.
            </>
          }
        >
          <p>
            Experiments and implementation notes from building Clearance.
            Reproducible inputs, explicit assumptions and results worth
            questioning.
          </p>
        </Intro>
        <section className="m-wrap m-journal-index">
          <Link to="/field-notes/memos">
            <div className="m-journal-art">
              <span>01</span>
              <strong>memos</strong>
              <small>REPOSITORY → EVIDENCE → RELEASE GATE</small>
            </div>
            <div>
              <Label>EXPERIMENT / 14 OCTOBER 2026</Label>
              <h2>Taking Memos through a compliance review.</h2>
              <p>
                A pinned open-source repository, one declared deployment
                scenario and an MCP-to-CI round trip. Here’s what the evidence
                can and cannot tell us.
              </p>
              <span className="m-link">
                Read the field note <ArrowRight size={18} />
              </span>
            </div>
          </Link>
        </section>
        <section className="m-wrap m-editorial m-border">
          <h2>Our rule for these notes.</h2>
          <p>
            Separate the behavior we tested from the conclusion someone might
            want to draw. An inventory is not an audit. A passing test is not a
            compliance certificate. Useful evidence has a narrower, clearer
            claim.
          </p>
        </section>
        <section className="m-wrap m-research">
          <Label>RESEARCH TO PUT THE WORK IN CONTEXT</Label>
          <h2>Governance deserves a place on the roadmap.</h2>
          <div>
            <article>
              <strong>
                63<span>%</span>
              </strong>
              <p>
                Of breached organizations in IBM’s 2025 study had no AI
                governance policy or were still developing one.
              </p>
            </article>
            <article>
              <strong>
                80<span> days</span>
              </strong>
              <p>
                Shorter average breach lifecycle reported with extensive AI and
                automation in security operations in the same study.
              </p>
            </article>
          </div>
          <p className="m-caption">
            The study covers 600 organizations that experienced breaches from
            March 2024 to February 2025. These are security findings, not
            software failure rates or measured Clearance time savings.
          </p>
          <Out href="https://newsroom.ibm.com/2025-07-30-ibm-report-13-of-organizations-reported-breaches-of-ai-models-or-applications,-97-of-which-reported-lacking-proper-ai-access-controls">
            Read IBM’s 2025 report summary
          </Out>
        </section>
      </>
    );
  return (
    <>
      <Intro
        label="FIELD NOTE 001 / OPEN-SOURCE EXPERIMENT"
        title={
          <>
            A notes app.
            <br />A real review trail.
          </>
        }
      >
        <p>
          We used Memos to test the path from a local repository to a submitted
          evidence record and a release-gate decision.
        </p>
        <div className="m-article-meta">
          <span>14 October 2026</span>
          <span>Engineering experiment</span>
          <span>No affiliation with Memos</span>
        </div>
        <div className="m-actions">
          <Demo example="memos" />
        </div>
      </Intro>
      <article className="m-wrap m-article">
        <aside>
          <Label>THE INPUT</Label>
          <h3>usememos / memos</h3>
          <p>
            Self-hosted notes application.
            <br />
            React frontend, Go backend.
            <br />
            MIT license.
          </p>
          <code>{memosCommit.slice(0, 12)}</code>
          <Out href={memos}>Pinned source</Out>
          <Out href={`${repo}/blob/main/scripts/experiment-memos.ts`}>
            Reproduction script
          </Out>
        </aside>
        <div>
          <h2>First, make the scenario explicit.</h2>
          <p>
            The experiment models an operator offering a Memos-based notes
            service to adult business users in the EU, handling personal data.
            External AI research is disabled. This is our deployment scenario,
            not a statement about every Memos installation.
          </p>
          <p>
            The pinned repository includes optional AI integration code. The
            experiment therefore declares AI use as a conservative review input.
            A real operator should confirm which features are actually enabled
            and revise the scope accordingly.
          </p>
          <h2>Inspect the repository without running it.</h2>
          <p>
            The local inventory walks a bounded set of files. Memos exposed a
            gap in our original script: it looked for JavaScript dependencies
            only at the root, while Memos keeps its frontend manifest under{" "}
            <code>web/</code> and uses Go for its server.
          </p>
          <p>
            We expanded discovery to nested manifests and Go test filenames,
            with limits on traversal and manifest sizes. An inventory still does
            not execute tests, inspect runtime behavior or approve a
            requirement.
          </p>
          <Code title="Reproduce the experiment">
            {"git clone https://github.com/usememos/memos.git .local/memos\ngit -C .local/memos checkout " +
              memosCommit +
              "\nnpm run experiment:memos -- .local/memos"}
          </Code>
          <h2>Send evidence through the real MCP interface.</h2>
          <p>
            The experiment creates an isolated Clearance instance, declares the
            scenario, adds a repository-review policy and connects through the
            MCP SDK. It discovers the tools, reads the assessment skill, runs an
            assessment and submits the inventory as evidence.
          </p>
          <p>
            The record enters the submitted state. The MCP client cannot promote
            it to approved. We verify that boundary explicitly.
          </p>
          <h2>A blocked gate can be the correct result.</h2>
          <p className="m-experiment-result">
            Recorded run: 1,342 files discovered within the depth limit, 398
            test filenames found, nine candidate controls and six high-priority
            gaps. All eight workflow checks passed.
          </p>
          <p>
            The CLI gate blocks because required evidence has not been reviewed.
            That is the expected outcome of this experiment. A repository
            inventory is not enough to approve privacy notices, incident
            response, AI evaluations or the operator’s deployment practices.
          </p>
          <p>
            Finally, the experiment revokes its integration key and checks that
            further access is denied. All local test resources are stopped after
            the run.
          </p>
          <div className="m-article-takeaway">
            <Label>WHAT THIS DEMONSTRATES</Label>
            <h3>The plumbing works. The review remains a review.</h3>
            <p>
              The experiment verifies repository discovery, assessment creation,
              MCP evidence submission, approval boundaries, a blocking CI result
              and key revocation. It does not certify Memos or test Memos’s own
              application runtime.
            </p>
          </div>
          <h2>Inspect the source and the result.</h2>
          <div className="m-article-links">
            <Out href={`${memos}/web/package.json`}>Frontend manifest</Out>
            <Out href={`${memos}/go.mod`}>Go module</Out>
            <Out href={`${memos}/LICENSE`}>License</Out>
            <Out href={`${repo}/blob/main/docs/experiments/memos.json`}>
              Recorded experiment result
            </Out>
          </div>
        </div>
      </article>
    </>
  );
}
function About() {
  return (
    <>
      <Intro
        label="WHY CLEARANCE"
        title={
          <>
            Built for the person
            <br />
            holding the release together.
          </>
        }
      >
        <p>
          You might be the founder, the engineer, the security lead or all
          three. Someone still has to connect the product’s behavior to its
          obligations.
        </p>
      </Intro>
      <section className="m-wrap m-manifesto">
        <h2>We want that work to leave a trail.</h2>
        <p>
          Too much compliance work disappears into a document that nobody
          updates, a chat message nobody can find or a green check nobody can
          explain. Clearance is built around the record behind the decision.
        </p>
        <p>
          That means starting with a real product profile. It means admitting
          when a requirement is only a candidate. And it means keeping evidence
          approval with a person who can own the decision.
        </p>
        <h2>Automation should make the work inspectable.</h2>
        <p>
          Agents can collect records, map the declared context and surface gaps.
          A pipeline can check whether the review is current. Neither should
          quietly turn an unreviewed document into an approved control.
        </p>
        <h2>The current version is deliberately explicit.</h2>
        <p>
          The application includes a starter control catalog, visible assessment
          steps, evidence review, scoped MCP tools and a release gate. The
          source and verification notes show what has been tested and where live
          provider setup is still needed.
        </p>
        <div className="m-actions">
          <Out href={repo}>Explore the source</Out>
          <Go to="/field-notes">Read the field notes</Go>
        </div>
      </section>
    </>
  );
}
export default function Landing() {
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const previous = useRef(pathname);
  useEffect(() => {
    setMenu(false);
    document.title = `${titles[pathname]} · Clearance`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        `${titles[pathname]}. Product context, reviewable evidence and release checks for software teams.`,
      );
    window.scrollTo({ top: 0, behavior: "instant" });
    if (previous.current !== pathname)
      document
        .querySelector<HTMLElement>(".marketing h1")
        ?.focus({ preventScroll: true });
    previous.current = pathname;
  }, [pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        document.querySelector<HTMLButtonElement>(".m-menu-button")?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menu]);
  let content: ReactNode;
  if (pathname === "/") content = <Home />;
  else if (pathname === "/platform") content = <Platform />;
  else if (pathname.startsWith("/solutions"))
    content = <Solutions slug={pathname.split("/")[2]} />;
  else if (pathname === "/integrations") content = <Integrations />;
  else if (pathname === "/security") content = <Security />;
  else if (pathname === "/pricing") content = <Pricing />;
  else if (pathname.startsWith("/field-notes"))
    content = <FieldNotes article={pathname.endsWith("/memos")} />;
  else content = <About />;
  return (
    <div className="marketing">
      <a className="m-skip" href="#main-content">
        Skip to content
      </a>
      <header className="m-header">
        <div className="m-wrap m-header-inner">
          <Logo />
          <nav
            id="marketing-navigation"
            aria-label="Main navigation"
            className={menu ? "is-open" : ""}
          >
            {nav.map(([url, label]) => (
              <NavLink key={url} to={url}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="m-header-actions">
            <Link to="/login">Log in</Link>
            <Link className="m-button m-header-cta" to="/signup">
              Get started
              <ArrowUpRight size={16} />
            </Link>
            <button
              className="m-menu-button"
              aria-label={menu ? "Close navigation" : "Open navigation"}
              aria-expanded={menu}
              aria-controls="marketing-navigation"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" key={pathname}>
        {content}
      </main>
      <section className="m-bottom-cta">
        <div className="m-wrap">
          <Label>BRING YOUR NEXT RELEASE</Label>
          <h2>
            Start with the questions
            <br />
            you haven’t answered yet.
          </h2>
          <div className="m-actions">
            <Go to="/signup" primary>
              Create your workspace
            </Go>
            <Go to="/platform">Take a closer look</Go>
          </div>
        </div>
      </section>
      <footer className="m-footer m-wrap">
        <div>
          <Logo />
          <p>
            Software compliance.
            <br />
            With a record behind the decision.
          </p>
          <span>Built for real release work.</span>
        </div>
        <div>
          <h2>Product</h2>
          <Link to="/platform">The platform</Link>
          <Link to="/solutions">Your software</Link>
          <Link to="/integrations">MCP & CI/CD</Link>
          <Link to="/pricing">Pricing</Link>
        </div>
        <div>
          <h2>Read & review</h2>
          <Link to="/about">Why Clearance</Link>
          <Link to="/field-notes">Field notes</Link>
          <Link to="/field-notes/memos">The Memos experiment</Link>
          <Link to="/security">Security & deployment</Link>
        </div>
        <div>
          <h2>Get hands-on</h2>
          <Link to="/signup">Create an account</Link>
          <Link to="/login">Log in</Link>
          <a href={repo} target="_blank" rel="noreferrer">
            Source on GitHub ↗
          </a>
          <p>
            Preview software.
            <br />
            Evidence readiness, not certification.
          </p>
        </div>
        <div className="m-footer-bottom">
          <span>© {new Date().getFullYear()} Clearance</span>
          <span>Your context. Your evidence. Your decision.</span>
        </div>
      </footer>
    </div>
  );
}
