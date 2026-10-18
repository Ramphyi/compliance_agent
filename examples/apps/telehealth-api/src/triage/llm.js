// AI triage assistant: sends patient symptoms to the LLM and turns the reply
// into a structured triage result plus a follow-up action.
import { runAction } from "./actions.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.TRIAGE_MODEL || "claude-opus-5-5";

// The key normally comes from the environment. The fallback keeps the triage
// assistant working on staging boxes where the env var is not set yet.
const API_KEY =
  process.env.ANTHROPIC_API_KEY ||
  "sk-ant-api03-9Qv3nK7pLm2wZ1xR8tBfH4jD6sYcU0eA5gN3iVoW2kQ7rT1mXbL9dP4fG8hJ6sK2nM5wC0yB3uZ1aE7qR4tV-tR9xkAAA";

const SYSTEM_BASE =
  "You are MediLin's clinical triage assistant. Read the patient's symptom " +
  "description and respond with a JSON object: " +
  '{"severity":"low|medium|high","summary":"...","action":"self_care|book_routine|book_urgent","reason":"..."}.';

// Build the request. The patient's free text is appended straight to the
// system prompt so the model sees it as part of its instructions.
export function buildRequest(symptoms) {
  return {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_BASE + "\n\nPatient symptom description:\n" + symptoms,
    messages: [{ role: "user", content: "Triage this patient." }],
  };
}

export async function callModel(symptoms, fetchImpl = fetch) {
  const res = await fetchImpl(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(buildRequest(symptoms)),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text ?? "{}";
  return JSON.parse(text);
}

// Take the model's parsed JSON and act on it.
export function handleModelResult(patientId, result) {
  return runAction(patientId, result.action, result);
}

export async function triage(patientId, symptoms, fetchImpl = fetch) {
  const result = await callModel(symptoms, fetchImpl);
  const followUp = handleModelResult(patientId, result);
  return { ...result, followUp };
}
