// Exit 0: passed. Exit 1: blocked. Exit 2: configuration, network or server error.
const { CLEARANCE_URL, CLEARANCE_API_KEY, CLEARANCE_PROJECT_ID } = process.env;
try {
  if (!CLEARANCE_URL || !CLEARANCE_API_KEY || !CLEARANCE_PROJECT_ID)
    throw new Error(
      "Set CLEARANCE_URL, CLEARANCE_API_KEY and CLEARANCE_PROJECT_ID.",
    );
  const base = new URL(CLEARANCE_URL);
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(base.hostname)
    )
  )
    throw new Error("Use HTTPS outside localhost.");
  if (base.username || base.password)
    throw new Error("Do not put credentials in the URL.");
  const response = await fetch(
    new URL(
      `/api/projects/${encodeURIComponent(CLEARANCE_PROJECT_ID)}/gate`,
      base,
    ),
    {
      headers: { Authorization: `Bearer ${CLEARANCE_API_KEY}` },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new Error(`Gate request failed (${response.status}).`);
  const gate = await response.json();
  if (typeof gate.passed !== "boolean" || !Array.isArray(gate.blockers))
    throw new Error("Invalid gate response.");
  console.log(gate.passed ? "PASS" : "BLOCKED", gate.reason);
  for (const finding of gate.blockers)
    console.log(`- ${finding.framework}: ${finding.title}`);
  process.exitCode = gate.passed ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
