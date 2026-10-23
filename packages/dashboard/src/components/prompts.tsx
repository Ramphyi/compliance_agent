import { CopyButton } from "./ui";

/** What to say to an agent connected over MCP, by stage. Agents understand any language. */
export const PROMPT_GROUPS: { title: string; prompts: { say: string; does: string }[] }[] = [
  {
    title: "Start",
    prompts: [
      { say: "Audit this app for compliance with Acai.", does: "Describes the product, asks you the compliance questions, shows what applies, then audits." },
      { say: "Which regulations and standards apply to this app, and why?", does: "Questions and scope only, no audit yet." },
      { say: "Use the eu-health-mobile-ai preset, then show me the answers to confirm.", does: "Starts from a ready-made answer set (presets are listed under Rules)." },
    ],
  },
  {
    title: "Review",
    prompts: [
      { say: "Show me the critical and high findings, with file and line.", does: "Lists findings grouped by severity." },
      { say: "Confirm F-003.", does: "Records your decision in the audit trail, under your name." },
      { say: "Reject F-007: false positive, that key is a test fixture.", does: "Rejects with a reason; it carries over to later audits." },
      { say: "Send F-010 back for re-investigation: also check the backend.", does: "The agent looks again with your note and reports still valid, revised or withdrawn." },
      { say: "I reviewed in the dashboard, continue.", does: "Picks up the decisions you made here." },
    ],
  },
  {
    title: "Fix",
    prompts: [
      { say: "Fix the confirmed Acai findings.", does: "Gets them as tasks with instructions, edits each one on a fix branch; Acai builds, tests and commits it." },
      { say: "Yes, approve npm test as the verification command.", does: "Needed once, before the first fix: the commands run project code." },
      { say: "Accept the fix for F-003.", does: "Marks it resolved; the commit stays on the fix branch for you to merge." },
      { say: "Revert the fix for F-005.", does: "Reverts the commit; the finding is confirmed again, ready for another try." },
    ],
  },
  {
    title: "Rules and reports",
    prompts: [
      { say: "Research current requirements for health data in Romania and propose them as rules.", does: "Uses the agent's web search; you accept or reject each rule." },
      { say: "Write the audit report in Markdown.", does: "Also saved under .acai/reports. SARIF works for GitHub code scanning." },
      { say: "Run the audit again and tell me what is left.", does: "Earlier decisions carry over; fixed findings disappear." },
    ],
  },
];

export function PromptExamples({ groups = PROMPT_GROUPS }: { groups?: typeof PROMPT_GROUPS }) {
  return (
    <div className="prompt-groups">
      {groups.map((g) => (
        <div key={g.title}>
          <h3>{g.title}</h3>
          <ul className="prompts">
            {g.prompts.map((p) => (
              <li key={p.say}>
                <div className="prompt-say">“{p.say}”</div>
                <div className="muted small">{p.does}</div>
                <CopyButton text={p.say} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
