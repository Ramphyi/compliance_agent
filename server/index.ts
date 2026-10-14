import { getConfig } from "./config.js";
import { createDb } from "./db.js";
import { createApp } from "./app.js";
import { loadLocalAccount } from "./local-account.js";
const config = getConfig();
const db = await createDb(config);
await loadLocalAccount(db, config);
const app = createApp(db, config);
const server = app.listen(
  config.port,
  config.production ? "0.0.0.0" : "127.0.0.1",
  () =>
    console.log(
      `Clearance API: http://localhost:${config.port} (${config.memory ? (config.localDataFile ? "persistent local workspace" : "ephemeral demo") : "PostgreSQL"})`,
    ),
);
server.requestTimeout = 120000;
async function shutdown() {
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
