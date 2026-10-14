import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowRight, ShieldCheck, Check, ArrowLeft } from "lucide-react";
import { Logo, Button, Field } from "./ui";
import { api, post } from "./api";
export default function AuthPage() {
  const nav = useNavigate();
  const location = useLocation();
  const mode = location.pathname.slice(1);
  const [config, setConfig] = useState<any>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(
    new URLSearchParams(location.hash.slice(1)).get("challenge") || "",
  );
  const [channel, setChannel] = useState("sms");
  useEffect(() => {
    api("/config")
      .then(setConfig)
      .catch(() => {});
    setError("");
    setMessage("");
  }, [mode]);
  const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  async function enterWorkspace() {
    const projects = await api<any[]>("/projects");
    nav(projects.length ? "/app/projects" : "/app/settings");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (challenge) {
        await post("/auth/mfa/verify", { challenge, code: data.code });
        await enterWorkspace();
        return;
      }
      const result = await post(
        `/auth/${mode === "signup" ? "register" : mode}`,
        { ...data, token },
      );
      if (result.needsMfa) {
        setChallenge(result.challenge);
        setMessage("Choose a channel and send your verification code.");
      } else if (mode === "login") await enterWorkspace();
      else setMessage(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    try {
      await post("/demo");
      nav("/app");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Logo light />
        <div>
          <span className="eyebrow">THE CONFIDENCE TO BUILD</span>
          <h1>
            Great ideas deserve
            <br />a clear path
            <br />
            <em>to launch.</em>
          </h1>
          <p>
            A workspace for the requirements, evidence and decisions behind your
            software.
          </p>
          <div className="auth-quote">
            <ShieldCheck size={32} />
            <span>
              Built for your product.
              <br />
              Grounded in your context.
            </span>
          </div>
        </div>
        <small>YOUR NEXT RELEASE, WITH CLEARANCE.</small>
      </aside>
      <main className="auth-main">
        <Link to="/" className="text-link">
          <ArrowLeft size={15} /> Back to home
        </Link>
        <div className="auth-form">
          <span className="eyebrow">WELCOME TO CLEARANCE</span>
          <h2>
            {challenge
              ? "One more step."
              : mode === "signup"
                ? "Make room for clarity."
                : mode === "forgot"
                  ? "Let’s get you back in."
                  : mode === "reset"
                    ? "A fresh start."
                    : mode === "verify"
                      ? "Confirm your email."
                      : "Good to have you back."}
          </h2>
          <p>
            {challenge
              ? "Verify with the phone number linked to your account."
              : mode === "signup"
                ? "Create an account to start your compliance workspace."
                : mode === "login"
                  ? "Sign in and pick up where you left off."
                  : mode === "verify"
                    ? "Confirm the address associated with your account."
                    : "Secure access to your workspace starts here."}
          </p>
          {(mode === "login" || mode === "signup") && !challenge && (
            <>
              <a
                className={`button google ${!config.google ? "disabled" : ""}`}
                href={config.google ? "/api/auth/google" : undefined}
                aria-disabled={!config.google}
              >
                <span className="google-g">G</span> Continue with Google
              </a>
              {!config.google && (
                <small className="provider-note">
                  Google sign-in requires deployment credentials.
                </small>
              )}
              <div className="divider">or continue with email</div>
            </>
          )}
          <form onSubmit={submit}>
            {challenge ? (
              <>
                <Field label="Delivery channel">
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                  >
                    <option value="sms">SMS message</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </Field>
                <Button
                  type="button"
                  variant="outline full"
                  busy={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await post("/auth/mfa/send", {
                        challenge,
                        channel,
                      });
                      setMessage(r.message);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Send verification code
                </Button>
                <Field label="Verification code">
                  <input
                    name="code"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{4,10}"
                  />
                </Field>
              </>
            ) : (
              <>
                {mode === "signup" && (
                  <Field label="Full name">
                    <input
                      name="name"
                      placeholder="Alex Morgan"
                      autoComplete="name"
                      required
                      minLength={2}
                    />
                  </Field>
                )}
                {["signup", "login", "forgot"].includes(mode) && (
                  <Field label="Work email">
                    <input
                      name="email"
                      type="email"
                      placeholder="you@company.com"
                      autoComplete="email"
                      required
                    />
                  </Field>
                )}
                {["signup", "login", "reset"].includes(mode) && (
                  <Field
                    label={mode === "reset" ? "New password" : "Password"}
                    hint={
                      mode !== "login"
                        ? "At least 12 characters. A passphrase works well."
                        : undefined
                    }
                  >
                    <input
                      name="password"
                      type="password"
                      placeholder="Enter your password"
                      minLength={mode === "login" ? 1 : 12}
                      maxLength={128}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      required
                    />
                  </Field>
                )}
              </>
            )}
            {mode === "login" && !challenge && (
              <Link className="forgot-link" to="/forgot">
                Forgot password?
              </Link>
            )}
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {message && (
              <div className="alert success" role="status">
                <Check size={16} />
                {message}
              </div>
            )}
            <Button
              variant="orange full"
              busy={busy}
              disabled={mode === "verify" && !token}
              type="submit"
            >
              {challenge
                ? "Verify and continue"
                : mode === "signup"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : mode === "reset"
                      ? "Update password"
                      : mode === "verify"
                        ? "Confirm email"
                        : "Sign in"}
              <ArrowRight size={16} />
            </Button>
          </form>
          {mode === "login" && (
            <button
              className="text-link resend"
              onClick={async () => {
                const input = document.querySelector<HTMLInputElement>(
                  'input[name="email"]',
                );
                try {
                  const r = await post("/auth/resend", { email: input?.value });
                  setMessage(r.message);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Resend confirmation email
            </button>
          )}
          <p className="auth-switch">
            {mode === "signup" ? (
              <>
                Already have an account? <Link to="/login">Sign in</Link>
              </>
            ) : mode === "login" ? (
              <>
                New to Clearance? <Link to="/signup">Create an account</Link>
              </>
            ) : (
              <Link to="/login">Back to sign in</Link>
            )}
          </p>
          {config.demo && (
            <div className="demo-option">
              <span>Just looking around?</span>
              <Button variant="outline full" busy={busy} onClick={demo}>
                Open the interactive demo <ArrowRight size={15} />
              </Button>
              <small>
                Sample data · isolated session · resets on server restart
              </small>
            </div>
          )}
        </div>
        <footer>
          <ShieldCheck size={14} /> Your credentials stay on the server.
        </footer>
      </main>
    </div>
  );
}
