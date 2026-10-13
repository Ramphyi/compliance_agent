import { inspectRepository } from "./repository-inventory.mjs";
try {
  console.log(
    JSON.stringify(await inspectRepository(process.argv[2] || "."), null, 2),
  );
} catch {
  console.error(
    "Unable to inspect the repository. Check that the path is an accessible directory.",
  );
  process.exitCode = 2;
}
