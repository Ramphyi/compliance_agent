// MediLin telehealth API. Built on node:http with no framework.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveToken } from "./auth.js";
import * as patients from "./routes/patients.js";
import * as appointments from "./routes/appointments.js";
import { triage } from "./triage/llm.js";

// The triage assistant and the bureau callbacks talk to upstream hosts whose
// certificates are not in our staging trust store, so relax TLS checks.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "..", "public");

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": typeof payload === "string" ? "text/html; charset=utf-8" : "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, authorization",
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(Object.assign(new Error("invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function auth(req) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const patientId = resolveToken(token);
  if (!patientId) throw Object.assign(new Error("unauthorized"), { status: 401 });
  return patientId;
}

export async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
    return send(res, 200, html);
  }

  if (parts[0] !== "api") return send(res, 404, { error: "not found" });

  const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
  const resource = parts[1];

  if (resource === "register" && req.method === "POST")
    return send(res, 201, patients.register(body));
  if (resource === "login" && req.method === "POST")
    return send(res, 200, patients.login(body));
  if (resource === "me" && req.method === "GET")
    return send(res, 200, patients.profile(auth(req)));

  if (resource === "appointments") {
    const pid = auth(req);
    if (req.method === "POST") return send(res, 201, appointments.book(pid, body));
    if (req.method === "GET") return send(res, 200, appointments.list(pid));
  }

  if (resource === "notes") {
    const pid = auth(req);
    if (req.method === "POST") return send(res, 201, appointments.addNote(pid, body));
    if (req.method === "GET") return send(res, 200, appointments.listNotes(pid));
  }

  if (resource === "triage" && req.method === "POST") {
    const pid = auth(req);
    const result = await triage(pid, body.symptoms || "");
    return send(res, 200, result);
  }

  return send(res, 404, { error: "not found" });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      const status = err.status || 500;
      // Return the full error (including the stack) so the frontend can show
      // developers what went wrong.
      send(res, status, { error: err.message, stack: err.stack });
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = process.env.PORT || 8080;
  createServer().listen(port, () => console.log(`MediLin API on :${port}`));
}
