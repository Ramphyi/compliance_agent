import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ShieldCheck,
  Code2,
  Globe2,
  Workflow,
  LockKeyhole,
  Terminal,
  Play,
  CheckCircle2,
  FileCheck2,
  Layers,
  Zap,
  ChevronDown,
} from "lucide-react";
import { Logo, Button, CheckItem, Badge } from "./ui";
import { post } from "./api";
export default function Landing() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hours, setHours] = useState(20);
  const [reduction, setReduction] = useState(30);
  const [menu, setMenu] = useState(false);
  async function demo() {
    setBusy(true);
    try {
      await post("/demo");
      navigate("/app");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Logo />
        <div className={`landing-links ${menu ? "open" : ""}`}>
          <a href="#platform">Platform</a>
          <a href="#how-it-works">How it works</a>
          <a href="#security">Security</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="nav-actions">
          <Link to="/login" className="login-link">
            Log in
          </Link>
          <Link className="button navy" to="/signup">
            Get started <ArrowUpRight size={16} />
          </Link>
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            <ChevronDown />
          </button>
        </div>
      </nav>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span className="status-dot" /> LESS FRICTION. MORE FORWARD.
            </div>
            <h1>
              Great software.
              <br />
              Clear requirements.
              <br />
              <em>Confident launches.</em>
            </h1>
            <p>
              Know what applies to your product, find the gaps, and keep the
              evidence close. Compliance that moves with your software.
            </p>
            <div className="hero-actions">
              <Link className="button orange large" to="/signup">
                Build with confidence <ArrowRight size={18} />
              </Link>
              <Button variant="outline large" onClick={demo} busy={busy}>
                <Play size={15} /> Explore the workspace
              </Button>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="hero-footnote">
              <Check size={14} /> Your stack. Your markets. Your deployment.
            </div>
          </div>
          <div className="hero-visual">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="hero-note">
              <span className="tiny-square" /> A CLEARER PATH TO PRODUCTION
            </div>
            <div className="product-window">
              <div className="window-top">
                <div className="window-dots">
                  <i />
                  <i />
                  <i />
                </div>
                <span>clearance / workspace</span>
                <LockKeyhole size={12} />
              </div>
              <div className="mini-header">
                <div className="mini-icon">
                  <Layers size={19} />
                </div>
                <div>
                  <strong>Acme Workspace</strong>
                  <small>Software compliance overview</small>
                </div>
                <Badge tone="green">Sample workspace</Badge>
              </div>
              <div className="mini-stats">
                <div>
                  <span>Evidence coverage</span>
                  <strong>
                    50<span>%</span>
                  </strong>
                  <small>4 of 8 controls reviewed</small>
                </div>
                <div className="mini-ring">
                  <ShieldCheck size={27} />
                </div>
              </div>
              <div className="mini-framework">
                <span>GDPR</span>
                <div>
                  <i style={{ width: "67%" }} />
                </div>
                <small>2 / 3</small>
              </div>
              <div className="mini-framework">
                <span>AI governance</span>
                <div>
                  <i style={{ width: "33%" }} />
                </div>
                <small>1 / 3</small>
              </div>
              <div className="mini-rule">
                <span className="square-icon mint">
                  <CheckCircle2 size={17} />
                </span>
                <div>
                  <strong>Privacy notice reviewed</strong>
                  <small>Evidence linked · ready for review</small>
                </div>
                <Check size={16} />
              </div>
              <div className="mini-rule">
                <span className="square-icon peach">
                  <FileCheck2 size={17} />
                </span>
                <div>
                  <strong>AI risk classification</strong>
                  <small>One clear next step</small>
                </div>
                <ArrowUpRight size={16} />
              </div>
            </div>
            <div className="floating-note">
              <span className="square-icon mint">
                <Workflow size={20} />
              </span>
              <div>
                <strong>From requirements to release.</strong>
                <span>One connected workflow.</span>
              </div>
            </div>
            <span className="visual-caption">ILLUSTRATIVE PRODUCT PREVIEW</span>
          </div>
        </section>
        <section className="framework-strip">
          <span>BUILT AROUND THE FRAMEWORKS THAT MATTER</span>
          <div>
            <strong>
              GDPR<span>Privacy by design</span>
            </strong>
            <strong>
              ISO 27001<span>Security readiness</span>
            </strong>
            <strong>
              EU AI Act<span>Responsible innovation</span>
            </strong>
            <strong>
              ISO 42001<span>AI governance</span>
            </strong>
            <strong>
              Custom policies<span>Your own standards</span>
            </strong>
          </div>
        </section>
        <section id="platform" className="marketing-section">
          <div className="marketing-heading">
            <span className="eyebrow">BUILT FOR THE WAY YOU BUILD</span>
            <h2>
              Compliance is complex.
              <br />
              Your workflow shouldn’t be.
            </h2>
            <p>
              Replace scattered checklists with a shared view of what applies,
              what’s missing, and what comes next.
            </p>
          </div>
          <div className="feature-grid">
            {[
              {
                icon: Globe2,
                title: "Context before checklists.",
                text: "Map requirements to your industry, product, data, customers and markets. Start with the questions that actually matter.",
                label: "PRODUCT-AWARE SCOPING",
              },
              {
                icon: Workflow,
                title: "See the work. Follow the evidence.",
                text: "Trace every assessment through discovery, regulatory mapping and evidence review. Know why a finding exists.",
                label: "VISIBLE AGENT WORKFLOWS",
              },
              {
                icon: Terminal,
                title: "Meet your development workflow.",
                text: "Use the workspace, connect an MCP client, or add a release gate to CI/CD. Bring compliance into the tools you already use.",
                label: "MCP + CI/CD",
              },
            ].map(({ icon: Icon, ...f }) => (
              <article key={f.title}>
                <Icon size={26} />
                <span className="eyebrow">{f.label}</span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          id="how-it-works"
          className="marketing-section workflow-section"
        >
          <div className="marketing-heading">
            <span className="eyebrow">FROM UNKNOWN TO UNDERSTOOD</span>
            <h2>
              A clear path.
              <br />
              At every stage.
            </h2>
            <p>For SaaS, mobile apps, embedded products and AI systems.</p>
          </div>
          <div className="steps">
            {[
              [
                "01",
                "Tell us what you’re building",
                "Your markets, audience and data shape the scope. No one-size-fits-all checklist.",
              ],
              [
                "02",
                "Map requirements. Find gaps.",
                "Review candidate frameworks, custom rules and evidence with a transparent assessment trail.",
              ],
              [
                "03",
                "Make your next release clearer",
                "Resolve findings, approve evidence and check your release gate from your pipeline.",
              ],
            ].map(([n, t, d]) => (
              <div className="step" key={n}>
                <span>{n}</span>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="marketing-section research-section">
          <div className="marketing-heading">
            <span className="eyebrow">THE CASE FOR GETTING AHEAD</span>
            <h2>
              Small gaps.
              <br />
              Real consequences.
            </h2>
            <p>
              Research puts the need for governance in perspective. These are
              third-party findings, not Clearance results.
            </p>
          </div>
          <div className="research-stats">
            <article>
              <strong>
                63<span>%</span>
              </strong>
              <h3>A governance gap</h3>
              <p>
                Of breached organizations in IBM’s 2025 study had no AI
                governance policy or were still developing one.
              </p>
              <a
                href="https://newsroom.ibm.com/2025-07-30-ibm-report-13-of-organizations-reported-breaches-of-ai-models-or-applications,-97-of-which-reported-lacking-proper-ai-access-controls"
                target="_blank"
                rel="noreferrer"
              >
                IBM · 2025 study <ArrowUpRight size={12} />
              </a>
            </article>
            <article>
              <strong>
                80<span> days</span>
              </strong>
              <h3>The value of automation</h3>
              <p>
                Shorter average breach lifecycle reported for extensive use of
                AI and automation in security operations in that study.
              </p>
              <a
                href="https://newsroom.ibm.com/2025-07-30-ibm-report-13-of-organizations-reported-breaches-of-ai-models-or-applications,-97-of-which-reported-lacking-proper-ai-access-controls"
                target="_blank"
                rel="noreferrer"
              >
                IBM · security operations, not compliance speed{" "}
                <ArrowUpRight size={12} />
              </a>
            </article>
            <article>
              <strong>
                72<span> hours</span>
              </strong>
              <h3>Preparation matters</h3>
              <p>
                GDPR’s notification window after awareness, where feasible, for
                breaches requiring notification to a data protection authority.
              </p>
              <a
                href="https://www.edpb.europa.eu/sme/assess-the-risks/data-breaches_en"
                target="_blank"
                rel="noreferrer"
              >
                European Data Protection Board <ArrowUpRight size={12} />
              </a>
            </article>
          </div>
          <p className="research-method">
            IBM’s 2025 report studied 600 organizations that experienced
            breaches between March 2024 and February 2025. These findings are
            not failure rates for all software and do not establish Clearance’s
            effectiveness.
          </p>
        </section>
        <section className="calculator-section">
          <div>
            <span className="eyebrow">LESS ADMIN. MORE BUILDING.</span>
            <h2>
              What would you do
              <br />
              with the time back?
            </h2>
            <p>
              Explore a planning scenario for repetitive compliance work. Your
              inputs, your estimate—no invented industry statistics.
            </p>
            <small>
              Illustrative calculator, not a measured Clearance performance
              claim.
            </small>
          </div>
          <div className="calculator">
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
              Assumed reduction in admin <strong>{reduction}%</strong>
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
            <div>
              <strong>
                {((hours * reduction) / 100).toFixed(1)}
                <span> hrs / month</span>
              </strong>
              <p>Potential time reclaimed under your assumptions</p>
            </div>
          </div>
        </section>
        <section id="security" className="marketing-section security-section">
          <div className="security-art">
            <div className="security-grid" />
            <div className="security-emblem">
              <ShieldCheck size={68} strokeWidth={1.3} />
            </div>
            <span className="security-label">
              <span className="status-dot" /> YOUR INFRASTRUCTURE. YOUR CONTROL.
            </span>
          </div>
          <div>
            <span className="eyebrow">TRUST STARTS WITH CONTROL</span>
            <h2>
              Your software.
              <br />
              Your boundaries.
            </h2>
            <p>
              Deploy on your own infrastructure with Docker and PostgreSQL. Keep
              assessments local, and choose explicitly when a project may use
              external research.
            </p>
            <CheckItem>
              Self-hosted deployment with no required model calls
            </CheckItem>
            <CheckItem>Scoped API keys and logged review actions</CheckItem>
            <CheckItem>
              Google sign-in and optional SMS / WhatsApp verification
            </CheckItem>
            <Link to="/signup" className="text-link">
              Start your workspace <ArrowUpRight size={16} />
            </Link>
          </div>
        </section>
        <section id="pricing" className="marketing-section pricing-section">
          <div className="marketing-heading centered">
            <span className="eyebrow">ROOM TO START. ROOM TO GROW.</span>
            <h2>A clearer investment.</h2>
            <p>
              Proposed launch pricing. Billing is not enabled in this preview.
            </p>
          </div>
          <div className="pricing-grid">
            {[
              {
                name: "Starter",
                price: "0",
                desc: "Find your starting point.",
                items: [
                  "One product workspace",
                  "Starter framework catalog",
                  "Evidence and assessment history",
                ],
                cta: "Start building",
              },
              {
                name: "Team",
                price: "99",
                desc: "Bring compliance into delivery.",
                items: [
                  "Multiple product workspaces",
                  "MCP and CI/CD workflows",
                  "Custom policies and research opt-in",
                ],
                cta: "Explore Team",
                featured: true,
              },
              {
                name: "On-premise",
                price: "Custom",
                desc: "Keep your deployment close.",
                items: [
                  "Docker + PostgreSQL deployment",
                  "Local assessment mode",
                  "Your infrastructure and network controls",
                ],
                cta: "Explore self-hosting",
              },
            ].map((plan) => (
              <article
                className={`pricing-card ${plan.featured ? "featured" : ""}`}
                key={plan.name}
              >
                {plan.featured && (
                  <span className="plan-label">FOR GROWING TEAMS</span>
                )}
                <h3>{plan.name}</h3>
                <p>{plan.desc}</p>
                <div className="price">
                  {plan.price === "Custom" ? "" : <sup>$</sup>}
                  {plan.price}
                  {plan.price !== "Custom" && <small>/ month</small>}
                </div>
                <Link
                  className={`button ${plan.featured ? "orange" : "outline"}`}
                  to="/signup"
                >
                  {plan.cta}
                  <ArrowUpRight size={16} />
                </Link>
                <div className="plan-features">
                  {plan.items.map((i) => (
                    <CheckItem key={i}>{i}</CheckItem>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="final-cta">
          <div>
            <span className="eyebrow">MOVE FORWARD, WITH CLEARANCE.</span>
            <h2>
              Build what’s next.
              <br />
              Know what’s needed.
            </h2>
          </div>
          <Link to="/signup" className="button orange large">
            Create your workspace <ArrowUpRight size={18} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Logo />
        <span>Clarity for the software you build.</span>
        <a
          href="https://www.iso.org/standard/42001"
          target="_blank"
          rel="noreferrer"
        >
          ISO 42001 reference <ArrowUpRight size={12} />
        </a>
        <small>Readiness support. Not legal advice or certification.</small>
      </footer>
    </div>
  );
}
