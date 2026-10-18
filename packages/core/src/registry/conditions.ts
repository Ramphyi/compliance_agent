import type { Answer, AnswerValue, FrameworkScope } from "../types";
import { MARKET_IMPLIES } from "./ids";
import type { Condition, Control, Question, Registry } from "./schema";

/** Three-valued result: null means "depends on an unanswered fact". */
export type Tri = boolean | null;

export type Facts = Record<string, AnswerValue | undefined>;

export function factsFromAnswers(answers: Record<string, Answer>): Facts {
  const facts: Facts = {};
  for (const [k, a] of Object.entries(answers)) facts[k] = a.value;
  const markets = facts.markets;
  if (Array.isArray(markets)) {
    const expanded = new Set(markets);
    for (const m of markets) for (const x of MARKET_IMPLIES[m] ?? []) expanded.add(x);
    facts.markets = [...expanded];
  }
  return facts;
}

function isAnswered(v: AnswerValue | undefined): v is AnswerValue {
  if (v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function evaluate(
  c: Condition,
  facts: Facts,
  missing: Set<string> = new Set(),
): Tri {
  if ("always" in c) return true;
  if ("all" in c) {
    let unknown = false;
    for (const x of c.all) {
      const r = evaluate(x, facts, missing);
      if (r === false) return false;
      if (r === null) unknown = true;
    }
    return unknown ? null : true;
  }
  if ("any" in c) {
    let unknown = false;
    for (const x of c.any) {
      const r = evaluate(x, facts, missing);
      if (r === true) return true;
      if (r === null) unknown = true;
    }
    return unknown ? null : false;
  }
  if ("not" in c) {
    const r = evaluate(c.not, facts, missing);
    return r === null ? null : !r;
  }
  const value = facts[c.fact];
  if (!isAnswered(value)) {
    missing.add(c.fact);
    return null;
  }
  const values = Array.isArray(value) ? value.map(String) : [String(value)];
  if ("in" in c) return c.in.some((x) => values.includes(x));
  return values.includes(String(c.equals));
}

export function visibleQuestions(registry: Registry, answers: Record<string, Answer>): Question[] {
  const facts = factsFromAnswers(answers);
  return registry.questionnaire.questions.filter(
    (q) => !q.showWhen || evaluate(q.showWhen, facts) !== false,
  );
}

/**
 * Facts for scoping: unanswered questions that are not even asked for this product (their
 * showWhen is false, like SIL for a web app) count as "not asked" instead of unknown, so they
 * never block a scope decision the user cannot make.
 */
export function scopeFacts(registry: Registry, answers: Record<string, Answer>): Facts {
  const facts = factsFromAnswers(answers);
  for (const q of registry.questionnaire.questions)
    if (!isAnswered(facts[q.id]) && q.showWhen && evaluate(q.showWhen, facts) === false) facts[q.id] = "__not-asked__";
  return facts;
}

export function computeScope(
  registry: Registry,
  answers: Record<string, Answer>,
  overrides: Record<string, "include" | "exclude"> = {},
): FrameworkScope[] {
  const facts = scopeFacts(registry, answers);
  return registry.frameworks.map((f) => {
    const missing = new Set<string>();
    const r = evaluate(f.applicability, facts, missing);
    const unconfirmed = [...referencedFacts(f.applicability)].filter(
      (fact) => answers[fact] && !answers[fact].confirmed,
    );
    const status: FrameworkScope["status"] =
      r === true ? "applies" : r === false ? "not-applicable" : "unknown";
    const reason =
      status === "unknown"
        ? `Needs an answer for: ${[...missing].join(", ")}.`
        : f.applicabilityNote.trim();
    return {
      frameworkId: f.id,
      status,
      override: overrides[f.id],
      reason,
      missingFacts: [...missing],
      unconfirmedFacts: unconfirmed,
    };
  });
}

function referencedFacts(c: Condition, out = new Set<string>()): Set<string> {
  if ("always" in c) return out;
  if ("all" in c) c.all.forEach((x) => referencedFacts(x, out));
  else if ("any" in c) c.any.forEach((x) => referencedFacts(x, out));
  else if ("not" in c) referencedFacts(c.not, out);
  else out.add(c.fact);
  return out;
}

export function inScope(s: FrameworkScope) {
  if (s.override === "include") return true;
  if (s.override === "exclude") return false;
  return s.status === "applies";
}

/** Controls of in-scope frameworks whose own `when` is not false. */
export function scopedControls(
  registry: Registry,
  scope: FrameworkScope[],
  answers: Record<string, Answer>,
): Control[] {
  const facts = scopeFacts(registry, answers);
  const active = new Set(scope.filter(inScope).map((s) => s.frameworkId));
  return [...registry.controls.values()].filter(
    (c) => active.has(c.frameworkId) && (!c.when || evaluate(c.when, facts) !== false),
  );
}
