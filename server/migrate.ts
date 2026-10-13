import { createDb } from "./db.js";
import { getConfig } from "./config.js";
const db = await createDb(getConfig());
await db.end();
console.log("Schema migration complete.");
