import { useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Globe2,
  Box,
  LockKeyhole,
} from "lucide-react";
import { Modal, Field, Button } from "./ui";
import { post, api } from "./api";
import type { Profile, Project } from "../shared/types";
export default function Onboarding({
  onClose,
  onSaved,
  project,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
  project?: Project;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile>(
    project?.profile || {
      name: "",
      description: "",
      industry: "Technology",
      softwareType: "saas",
      countries: ["EU"],
      audience: "Businesses",
      dataTypes: ["Personal data"],
      usesAi: false,
      externalAi: false,
    },
  );
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }));
  const toggle = (key: "countries" | "dataTypes", value: string) =>
    update(
      key,
      profile[key].includes(value)
        ? profile[key].filter((v) => v !== value)
        : [...profile[key], value],
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (step < 2) {
      if (
        step === 1 &&
        (!profile.countries.length || !profile.dataTypes.length)
      ) {
        setError("Select at least one market and one data category.");
        return;
      }
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const result = project
        ? await api(`/projects/${project.id}`, {
            method: "PUT",
            body: JSON.stringify(profile),
          })
        : await post("/projects", profile);
      onSaved(project?.id || result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        project ? "Update product context" : "Let’s understand your product."
      }
      subtitle="A few details now. A more relevant assessment next."
      onClose={onClose}
      wide
    >
      <div className="onboard-steps">
        {["Your product", "Your context", "Your boundaries"].map((label, i) => (
          <span key={label} className={i <= step ? "active" : ""}>
            <b>{i < step ? <Check size={13} /> : i + 1}</b>
            {label}
          </span>
        ))}
      </div>
      <form onSubmit={submit}>
        <div className="modal-body">
          {step === 0 ? (
            <>
              <Field label="Product name">
                <input
                  autoFocus
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="e.g. Acme Workspace"
                  value={profile.name}
                  onChange={(e) => update("name", e.target.value)}
                />
              </Field>
              <Field
                label="What does your product do?"
                hint="Describe its purpose, main features and how customers use it."
              >
                <textarea
                  required
                  minLength={20}
                  maxLength={6000}
                  rows={4}
                  placeholder="We’re building a collaboration platform for…"
                  value={profile.description}
                  onChange={(e) => update("description", e.target.value)}
                />
              </Field>
              <div className="form-grid">
                <Field label="Software type">
                  <select
                    value={profile.softwareType}
                    onChange={(e) =>
                      update(
                        "softwareType",
                        e.target.value as Profile["softwareType"],
                      )
                    }
                  >
                    <option value="saas">SaaS / web application</option>
                    <option value="mobile">Mobile application</option>
                    <option value="embedded">
                      Embedded / connected device
                    </option>
                    <option value="ai">AI system</option>
                  </select>
                </Field>
                <Field label="Industry">
                  <select
                    value={profile.industry}
                    onChange={(e) => update("industry", e.target.value)}
                  >
                    {[
                      "Technology",
                      "Healthcare",
                      "Finance",
                      "Education",
                      "Retail",
                      "Industrial",
                      "Other",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          ) : step === 1 ? (
            <>
              <Field label="Who is your product for?">
                <select
                  value={profile.audience}
                  onChange={(e) => update("audience", e.target.value)}
                >
                  {["Businesses", "Consumers", "Both", "Children"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <div className="field">
                <span>Where will you offer it?</span>
                <div className="chip-select">
                  {[
                    "EU",
                    "United Kingdom",
                    "United States",
                    "Canada",
                    "Australia",
                    "Singapore",
                    "Romania",
                    "Germany",
                  ].map((c) => (
                    <button
                      type="button"
                      aria-pressed={profile.countries.includes(c)}
                      className={
                        profile.countries.includes(c) ? "selected" : ""
                      }
                      onClick={() => toggle("countries", c)}
                      key={c}
                    >
                      {profile.countries.includes(c) && <Check size={13} />}
                      {c}
                    </button>
                  ))}
                </div>
                <small>
                  Starter catalog coverage varies by jurisdiction. Additional
                  markets require a custom scope review.
                </small>
              </div>
              <Field
                label="Additional market"
                hint="Press Add to include a market not listed above."
              >
                <div className="inline-input">
                  <input
                    id="other-market"
                    placeholder="Country or jurisdiction"
                    maxLength={80}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const el = document.getElementById(
                        "other-market",
                      ) as HTMLInputElement;
                      if (
                        el.value.trim().length > 1 &&
                        !profile.countries.includes(el.value.trim())
                      )
                        update("countries", [
                          ...profile.countries,
                          el.value.trim(),
                        ]);
                      el.value = "";
                    }}
                  >
                    Add
                  </Button>
                </div>
              </Field>
              <p className="muted">
                Selected: {profile.countries.join(", ") || "None"}
              </p>
              <div className="field">
                <span>What data will you handle?</span>
                <div className="chip-select">
                  {[
                    "Personal data",
                    "Health data",
                    "Payment data",
                    "Children’s data",
                    "Anonymous data",
                  ].map((d) => (
                    <button
                      type="button"
                      aria-pressed={profile.dataTypes.includes(d)}
                      className={
                        profile.dataTypes.includes(d) ? "selected" : ""
                      }
                      onClick={() => toggle("dataTypes", d)}
                      key={d}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={profile.usesAi}
                  onChange={(e) => update("usesAi", e.target.checked)}
                />{" "}
                The product uses AI or machine learning
              </label>
            </>
          ) : (
            <>
              <div className="profile-summary">
                <Box />
                <h3>{profile.name}</h3>
                <p>{profile.description}</p>
                <div>
                  <span>{profile.softwareType.toUpperCase()}</span>
                  <span>{profile.industry}</span>
                  <span>{profile.audience}</span>
                </div>
                <p>
                  <Globe2 size={15} /> {profile.countries.join(", ")}
                </p>
              </div>
              <label className="consent-box">
                <input
                  type="checkbox"
                  checked={profile.externalAi}
                  onChange={(e) => update("externalAi", e.target.checked)}
                />
                <div>
                  <strong>
                    Allow external regulatory research for this product
                  </strong>
                  <p>
                    Send the product profile above to OpenAI for research on
                    official sources. Evidence text is excluded. Requires server
                    configuration. Leave off for local-only assessment.
                  </p>
                </div>
              </label>
              <div className="subtle-note">
                <LockKeyhole size={16} /> Your assessment starts with a
                maintained control catalog. It cannot establish every legal
                obligation or certify compliance.
              </div>
            </>
          )}
          {error && (
            <div role="alert" className="alert error">
              {error}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (step ? setStep(step - 1) : onClose())}
          >
            <ArrowLeft size={15} />
            {step ? "Back" : "Cancel"}
          </Button>
          <Button type="submit" variant="orange" busy={busy}>
            {step === 2
              ? project
                ? "Save context"
                : "Create workspace"
              : "Continue"}
            <ArrowRight size={16} />
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
