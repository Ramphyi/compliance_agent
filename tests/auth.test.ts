import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthError, AuthStore, sha256 } from "../packages/cli/src/auth";
import { Projects } from "../packages/cli/src/projects";
import { type StartedServer, startServer } from "../packages/cli/src/server";
import { exampleRepo } from "./helpers";

const AUTH_ENV = ["ACAI_TOKEN", "ACAI_TOKENS", "ACAI_ADMIN_TOKEN", "ACAI_ADMINS", "ACAI_APPROVERS", "ACAI_PUBLIC_URL", "ACAI_TRUST_PROXY"];
const by = { name: "tester" };
/** The HTTP status an AuthStore call refuses with (0 when it succeeds). */
const status = (fn: () => unknown) => {
  try {
    fn();
    return 0;
  } catch (e) {
    return (e as AuthError).status ?? -1;
  }
};

describe("account store", () => {
  const dirs: string[] = [];
  const store = (env: NodeJS.ProcessEnv = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "acai-auth-"));
    dirs.push(dir);
    return new AuthStore({ file: join(dir, "auth.json"), env });
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("issues acai_ tokens, keeps only their hashes in a private file and finds accounts by hash", () => {
    const s = store();
    expect(s.hasAccounts()).toBe(false);
    const { user, token } = s.createUser({ name: "alice", role: "admin" }, by);
    expect(token).toMatch(/^acai_[A-Za-z0-9_-]{43}$/);
    expect(user).toMatchObject({ name: "alice", role: "admin", disabled: false, source: "local", tokens: 1, sessions: 0 });
    const raw = readFileSync(s.file, "utf8");
    expect(raw).not.toContain(token);
    expect(raw).toContain(sha256(token));
    expect(statSync(s.file).mode & 0o077).toBe(0);
    const [info] = s.listTokens(user.id);
    expect(info.prefix).toBe(token.slice(0, 12));
    expect(info).not.toHaveProperty("hash");
    expect(s.authenticate(token)).toMatchObject({ id: user.id, name: "alice", role: "admin", source: "local", tokenId: info.id });
    expect(s.authenticate(`${token}x`)).toBeNull();
    expect(s.authenticate("")).toBeNull();
    expect(s.hasAccounts()).toBe(true);
    expect(status(() => s.createUser({ name: "ALICE" }, by))).toBe(409);
    expect(status(() => s.createUser({ name: "a,b" }, by))).toBe(400);
    expect(status(() => s.createUser({ name: "x".repeat(81) }, by))).toBe(400);
    expect(status(() => s.createUser({ name: "bob", role: "root" }, by))).toBe(400);
    expect(s.createUser({ name: "bob" }, by).user.role).toBe("member");
  });

  it("rejects expired tokens and disabled users, and sees changes another process made", () => {
    const s = store();
    s.createUser({ name: "root", role: "admin" }, by);
    const { user, token } = s.createUser({ name: "bob", role: "member" }, by);
    const short = s.createToken(user.id, { label: "ci", expiresInDays: 1 }, by);
    expect(Date.parse(short.info.expiresAt!) - Date.now()).toBeGreaterThan(23 * 3600_000);
    expect(s.authenticate(short.token)?.name).toBe("bob");
    // Someone edits the file by hand: the token has expired.
    const data = JSON.parse(readFileSync(s.file, "utf8"));
    data.tokens.find((t: { id: string }) => t.id === short.info.id).expiresAt = new Date(Date.now() - 1000).toISOString();
    writeFileSync(s.file, JSON.stringify(data));
    expect(s.authenticate(short.token)).toBeNull();
    expect(s.authenticate(token)?.name).toBe("bob");
    // The CLI (another AuthStore on the same file) disables and re-enables the account.
    const cli = new AuthStore({ file: s.file, env: {} });
    cli.updateUser(user.id, { disabled: true }, by);
    expect(s.authenticate(token)).toBeNull();
    cli.updateUser("bob", { disabled: false }, by);
    expect(s.authenticate(token)?.name).toBe("bob");
    expect(status(() => s.createToken(user.id, { expiresInDays: 0 }, by))).toBe(400);
    expect(status(() => s.updateUser(user.id, { disabled: "yes" }, by))).toBe(400);
  });

  it("ties sessions to the token they were opened with and logs sign-ins", () => {
    const s = store();
    const { user, token } = s.createUser({ name: "carol", role: "admin" }, by);
    const r = s.login(token, "10.0.0.1")!;
    expect(r.maxAgeSec).toBe(7 * 24 * 3600);
    expect(s.session(r.session)).toMatchObject({ name: "carol", role: "admin" });
    expect(readFileSync(s.file, "utf8")).not.toContain(r.session);
    expect(s.login("acai_not-a-token", "10.0.0.2")).toBeNull();
    const laptop = s.createToken(user.id, { label: "laptop" }, by);
    const first = s.listTokens(user.id).find((t) => t.label === "First token")!;
    s.revokeToken(first.prefix, by); // by display prefix, like `acai tokens revoke acai_AbCdEfG`
    expect(s.session(r.session)).toBeNull();
    expect(s.authenticate(token)).toBeNull();
    expect(s.authenticate(laptop.token)?.name).toBe("carol");
    const r2 = s.login(laptop.token)!;
    expect(s.userInfo(user.id).sessions).toBe(1);
    s.logout(r2.session);
    expect(s.session(r2.session)).toBeNull();
    const events = s.events();
    expect(events[0].action).toBe("logout"); // newest first
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["user.create", "login", "login.failed", "token.create", "token.revoke", "logout"]));
    expect(events.find((e) => e.action === "login.failed")).toMatchObject({ actor: "unknown", ip: "10.0.0.2" });
  });

  it("reads ACAI_TOKENS and ACAI_TOKEN as read-only accounts, admins unless ACAI_ADMINS names others", () => {
    const s = store({ ACAI_TOKENS: "alice:alice-token-0123456789abcdef, bob:bob-token-0123456789abcdef", ACAI_TOKEN: "shared-token-0123456789abcdef", ACAI_ADMINS: "alice" });
    expect(s.hasAccounts()).toBe(true);
    const users = s.listUsers();
    expect(users.map((u) => [u.name, u.role, u.source])).toEqual([
      ["admin", "member", "env"],
      ["alice", "admin", "env"],
      ["bob", "member", "env"],
    ]);
    expect(s.authenticate("bob-token-0123456789abcdef")).toMatchObject({ name: "bob", role: "member", source: "env" });
    expect(s.authenticate("shared-token-0123456789abcdef")?.name).toBe("admin");
    const bob = users.find((u) => u.name === "bob")!;
    expect(status(() => s.updateUser(bob.id, { role: "admin" }, by))).toBe(409);
    expect(status(() => s.deleteUser(bob.id, by))).toBe(409);
    expect(status(() => s.createToken(bob.id, {}, by))).toBe(409);
    const [envToken] = s.listTokens(bob.id);
    expect(envToken).toMatchObject({ label: "ACAI_TOKENS", prefix: "" }); // a chosen token is never shown, even in part
    expect(status(() => s.revokeToken(envToken.id, by))).toBe(409);
    // Without ACAI_ADMINS every environment account is an administrator.
    expect(store({ ACAI_TOKENS: "alice:alice-token-0123456789abcdef" }).listUsers()[0].role).toBe("admin");
    expect(() => store({ ACAI_TOKENS: "alice:short" })).toThrow(/at least 16/);
    expect(() => store({ ACAI_TOKEN: "short" })).toThrow(/at least 16/);
    expect(() => store({ ACAI_TOKENS: "a:same-token-0123456789abcdef,b:same-token-0123456789abcdef" })).toThrow(/more than one account/);
  });

  it("never removes the last enabled administrator, nor an administrator's own role", () => {
    const s = store();
    const { user: root } = s.createUser({ name: "root", role: "admin" }, by);
    expect(status(() => s.updateUser(root.id, { role: "member" }, by))).toBe(409);
    expect(status(() => s.updateUser(root.id, { disabled: true }, by))).toBe(409);
    expect(status(() => s.deleteUser(root.id, by))).toBe(409);
    const self = { name: "root", userId: root.id };
    const { user: second } = s.createUser({ name: "second", role: "admin" }, self);
    expect(status(() => s.updateUser(root.id, { role: "viewer" }, self))).toBe(409);
    expect(status(() => s.updateUser(root.id, { disabled: true }, self))).toBe(409);
    expect(status(() => s.deleteUser(root.id, self))).toBe(409);
    expect(s.userInfo(root.id).role).toBe("admin"); // refused changes leave nothing behind
    expect(s.updateUser(root.id, { role: "member" }, { name: "second", userId: second.id }).role).toBe("member");
    expect(status(() => s.deleteUser(second.id, by))).toBe(409);
  });

  it("creates the first administrator from ACAI_ADMIN_TOKEN, once", () => {
    const s = store();
    const t = "bootstrap-token-0123456789abcdef";
    expect(() => s.bootstrap("too-short")).toThrow(/at least 16/);
    expect(s.bootstrap(undefined)).toBeNull();
    expect(s.bootstrap(t)).toBe("admin");
    expect(s.authenticate(t)).toMatchObject({ name: "admin", role: "admin", source: "local" });
    expect(s.listTokens()[0]).toMatchObject({ label: "ACAI_ADMIN_TOKEN", prefix: "" });
    expect(readFileSync(s.file, "utf8")).not.toContain(t);
    expect(s.bootstrap(t)).toBeNull();
    expect(s.listUsers()).toHaveLength(1);
    // Locked out (no enabled local administrator left, here by editing the file): the next start restores it.
    const data = JSON.parse(readFileSync(s.file, "utf8"));
    data.users[0].role = "viewer";
    writeFileSync(s.file, JSON.stringify(data));
    expect(s.bootstrap(t)).toBe("admin");
    expect(s.authenticate(t)?.role).toBe("admin");
    expect(s.listUsers()).toHaveLength(1);
  });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });

describe("accounts over HTTP", () => {
  const repo = exampleRepo("credit-scoring-ml");
  const home = mkdtempSync(join(tmpdir(), "acai-auth-home-"));
  const env = { ...process.env };
  const ADMIN = "admin-bootstrap-token-0123456789";
  let srv: StartedServer;
  let url = "";
  let pid = "";
  const people: Record<"member" | "viewer", { id: string; token: string }> = { member: { id: "", token: "" }, viewer: { id: "", token: "" } };

  const start = async () => {
    const port = await freePort();
    process.env.ACAI_PUBLIC_URL = `http://127.0.0.1:${port}`; // turns on OAuth
    const projects = new Projects({ persist: false });
    pid = projects.add(repo.dir).id;
    return startServer({ projects, provider: null, host: "127.0.0.1", port });
  };
  const stop = (s: StartedServer) => (s.server.closeAllConnections(), s.server.close());

  beforeAll(async () => {
    for (const k of AUTH_ENV) delete process.env[k];
    Object.assign(process.env, { ACAI_HOME: home, ACAI_ADMIN_TOKEN: ADMIN });
    srv = await start();
    url = srv.url;
  });
  afterAll(() => {
    stop(srv);
    process.env = env;
    repo.cleanup();
    rmSync(home, { recursive: true, force: true });
  });

  type Opts = { token?: string; cookie?: string; body?: unknown; header?: boolean };
  const call = (method: string, path: string, o: Opts = {}) =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(o.header === false ? {} : { "X-Acai-Request": "1" }),
        ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
        ...(o.cookie ? { Cookie: o.cookie } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  const json = async (r: Promise<Response>) => (await r).json() as Promise<any>;
  const mcp = (token?: string, cookie?: string) =>
    fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  const login = async (token: string) => {
    const r = await call("POST", "/api/login", { body: { token }, header: false });
    expect(r.status).toBe(200);
    const set = r.headers.getSetCookie().find((c) => c.startsWith("acai_session="))!;
    return { set, cookie: set.split(";")[0], body: (await r.json()) as any };
  };

  it("requires sign-in except for the health check, and bootstraps the administrator", async () => {
    expect(await json(fetch(`${url}/healthz`))).toEqual({ ok: true });
    expect((await call("GET", "/api/meta")).status).toBe(401);
    expect((await call("GET", "/api/meta", { token: "wrong-token-0123456789abcdef" })).status).toBe(401);
    const meta = await json(call("GET", "/api/meta", { token: ADMIN }));
    expect(meta).toMatchObject({ auth: "tokens", user: "admin", account: { name: "admin", role: "admin" } });
    expect(srv.authMode).toBe("tokens");
    expect(srv.oauth).toBe(true);
  });

  it("lets administrators create accounts and tokens, and enforces each role", async () => {
    // Mutations need the custom header, also for administrators.
    expect((await call("POST", "/api/admin/users", { token: ADMIN, body: { name: "mia", role: "member" }, header: false })).status).toBe(403);
    for (const [name, role] of [["mia", "member"], ["vic", "viewer"]] as const) {
      const r = await json(call("POST", "/api/admin/users", { token: ADMIN, body: { name, role } }));
      expect(r.user).toMatchObject({ name, role, source: "local", tokens: 1 });
      expect(r.token).toMatch(/^acai_/);
      people[role] = { id: r.user.id, token: r.token };
    }
    expect((await call("POST", "/api/admin/users", { token: ADMIN, body: { name: "MIA", role: "member" } })).status).toBe(409);
    expect((await call("POST", "/api/admin/users", { token: ADMIN, body: { name: "x", role: "owner" } })).status).toBe(400);
    expect((await json(call("GET", "/api/admin/users", { token: ADMIN }))).map((u: { name: string }) => u.name)).toEqual(["admin", "mia", "vic"]);
    const { member, viewer } = people;

    // Viewer: reads only; no MCP, no webhook settings, no admin.
    expect((await call("GET", "/api/projects", { token: viewer.token })).status).toBe(200);
    expect((await call("POST", `/api/projects/${pid}/audits`, { token: viewer.token, body: { mode: "static" } })).status).toBe(403);
    expect((await call("GET", `/api/projects/${pid}/automation`, { token: viewer.token })).status).toBe(403);
    expect((await call("GET", "/api/admin/users", { token: viewer.token })).status).toBe(403);
    expect((await mcp(viewer.token)).status).toBe(403);
    // ...but manages their own tokens.
    const own = await json(call("POST", "/api/account/tokens", { token: viewer.token, body: { label: "script", expiresInDays: 30 } }));
    expect(own.info).toMatchObject({ userName: "vic", label: "script" });
    expect((await call("GET", "/api/meta", { token: own.token })).status).toBe(200);
    expect((await call("DELETE", `/api/account/tokens/${own.info.id}`, { token: viewer.token })).status).toBe(200);
    expect((await call("GET", "/api/meta", { token: own.token })).status).toBe(401);

    // Member: reviews and audits, but no admin routes and no approving commands unless in ACAI_APPROVERS.
    expect((await call("GET", "/api/admin/users", { token: member.token })).status).toBe(403);
    expect((await call("POST", `/api/projects/${pid}/audits`, { token: member.token, body: { mode: "static" } })).status).toBe(200);
    expect((await call("GET", `/api/projects/${pid}/automation`, { token: member.token })).status).toBe(200);
    expect((await mcp(member.token)).status).toBe(200);
    const approve = { commands: ["echo ok"], approve: true };
    const refused = await call("POST", `/api/projects/${pid}/verify`, { token: member.token, body: approve });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error).toMatch(/administrators/);
    expect((await call("POST", "/api/model", { token: member.token, body: { preset: "ollama" } })).status).toBe(403);
    process.env.ACAI_APPROVERS = "mia";
    expect((await call("POST", `/api/projects/${pid}/verify`, { token: member.token, body: approve })).status).toBe(200);
    delete process.env.ACAI_APPROVERS;
    // The member's own account view.
    const account = await json(call("GET", "/api/account", { token: member.token }));
    expect(account.account).toMatchObject({ name: "mia", role: "member", tokens: 1 });
    expect(account.tokens[0]).toMatchObject({ userName: "mia", label: "First token" });
    expect(account.tokens[0]).not.toHaveProperty("hash");
    // A member cannot revoke someone else's token through their own account routes.
    const adminToken = (await json(call("GET", "/api/admin/tokens", { token: ADMIN }))).find((t: { userName: string }) => t.userName === "admin");
    expect((await call("DELETE", `/api/account/tokens/${adminToken.id}`, { token: member.token })).status).toBe(404);

    // Administrator: everything.
    expect((await call("POST", `/api/projects/${pid}/verify`, { token: ADMIN, body: approve })).status).toBe(200);
    const server = await json(call("GET", "/api/admin/server", { token: ADMIN }));
    expect(server).toMatchObject({ version: "0.1.0", authMode: "tokens", oauth: true, trustProxy: false, webhookSecret: false, allowClone: false, approvers: [], dataDir: home, provider: null, projects: 1 });
    expect(server.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it("exchanges an API token for a dashboard session cookie, and ends it on logout", async () => {
    const { set, cookie, body } = await login(people.member.token);
    expect(body).toMatchObject({ ok: true, account: { name: "mia", role: "member" } });
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    expect(set).toMatch(/Path=\//);
    expect(set).toMatch(/Max-Age=604800/);
    expect(set).not.toMatch(/Secure/); // plain HTTP here
    expect((await json(call("GET", "/api/meta", { cookie }))).account.name).toBe("mia");
    expect((await json(call("GET", "/api/account", { cookie }))).account.sessions).toBe(1);
    // Sessions are for the dashboard: MCP clients send a token.
    expect((await mcp(undefined, cookie)).status).toBe(401);
    expect((await call("POST", "/api/logout", { cookie, header: false })).status).toBe(403);
    const out = await call("POST", "/api/logout", { cookie });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().find((c) => c.startsWith("acai_session="))).toMatch(/Max-Age=0/);
    expect((await call("GET", "/api/meta", { cookie })).status).toBe(401);
    expect((await call("POST", "/api/login", { body: { token: "acai_wrong" }, header: false })).status).toBe(401);
  });

  it("ends sessions when the token is revoked, the person is disabled or signed out", async () => {
    const mia = people.member;
    const { cookie } = await login(mia.token);
    const first = (await json(call("GET", "/api/admin/tokens", { token: ADMIN }))).find((t: { userId: string }) => t.userId === mia.id);
    expect((await call("DELETE", `/api/admin/tokens/${first.id}`, { token: ADMIN })).status).toBe(200);
    expect((await call("GET", "/api/meta", { cookie })).status).toBe(401);
    expect((await call("GET", "/api/meta", { token: mia.token })).status).toBe(401);

    const fresh = await json(call("POST", `/api/admin/users/${mia.id}/tokens`, { token: ADMIN, body: { label: "replacement" } }));
    mia.token = fresh.token;
    const second = await login(mia.token);
    expect((await call("PATCH", `/api/admin/users/${mia.id}`, { token: ADMIN, body: { disabled: true } })).status).toBe(200);
    expect((await call("GET", "/api/meta", { cookie: second.cookie })).status).toBe(401);
    expect((await call("GET", "/api/meta", { token: mia.token })).status).toBe(401);
    const enabled = await json(call("PATCH", `/api/admin/users/${mia.id}`, { token: ADMIN, body: { disabled: false } }));
    expect(enabled).toMatchObject({ disabled: false, sessions: 0 });
    expect((await call("GET", "/api/meta", { token: mia.token })).status).toBe(200);
    expect((await call("GET", "/api/meta", { cookie: second.cookie })).status).toBe(401);

    const third = await login(mia.token);
    expect((await call("POST", `/api/admin/users/${mia.id}/signout`, { token: ADMIN })).status).toBe(200);
    expect((await call("GET", "/api/meta", { cookie: third.cookie })).status).toBe(401);
    expect((await call("GET", "/api/meta", { token: mia.token })).status).toBe(200);
  });

  it("protects the last administrator and one's own role", async () => {
    const me = (await json(call("GET", "/api/account", { token: ADMIN }))).account;
    expect((await call("PATCH", `/api/admin/users/${me.id}`, { token: ADMIN, body: { role: "member" } })).status).toBe(409);
    expect((await call("PATCH", `/api/admin/users/${me.id}`, { token: ADMIN, body: { disabled: true } })).status).toBe(409);
    expect((await call("DELETE", `/api/admin/users/${me.id}`, { token: ADMIN })).status).toBe(409);
    expect((await call("PATCH", "/api/admin/users/u_missing", { token: ADMIN, body: { role: "member" } })).status).toBe(404);
    // Renaming is fine, and a deleted account's tokens stop working.
    expect((await json(call("PATCH", `/api/admin/users/${people.viewer.id}`, { token: ADMIN, body: { name: "victor" } }))).name).toBe("victor");
    expect((await json(call("GET", "/api/meta", { token: people.viewer.token }))).user).toBe("victor");
    expect((await call("DELETE", `/api/admin/users/${people.viewer.id}`, { token: ADMIN })).status).toBe(200);
    expect((await call("GET", "/api/meta", { token: people.viewer.token })).status).toBe(401);
  });

  it("connects OAuth clients with a member's token; viewers are refused and revoking the token ends access", async () => {
    const base = new URL(url);
    const redirect = "http://127.0.0.1:9/callback";
    const reg = await json(fetch(`${url}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Test connector", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) }));
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = async () => {
      const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
      const html = await (await fetch(`${url}/authorize?${q}`)).text();
      return /name="request" value="([^"]+)"/.exec(html)![1];
    };
    const consent = (request: string, token: string) =>
      fetch(`${url}/oauth/consent`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request, token, action: "allow" }) });

    const { user: olga, token: olgaToken } = await json(call("POST", "/api/admin/users", { token: ADMIN, body: { name: "olga", role: "member" } }));
    const { token: vivToken } = await json(call("POST", "/api/admin/users", { token: ADMIN, body: { name: "viv", role: "viewer" } }));
    const request = await authorize();
    const refused = await consent(request, vivToken);
    expect(refused.status).toBe(401);
    expect(await refused.text()).toContain("Viewer accounts cannot connect agents");
    const approved = await consent(request, olgaToken);
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const tokens = await json(fetch(`${url}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: redirect }) }));
    expect(tokens.access_token).toBeTruthy();
    expect((await mcp(tokens.access_token)).status).toBe(200);
    // Demoted to viewer: the grant stops working; back to member, it works again.
    await call("PATCH", `/api/admin/users/${olga.id}`, { token: ADMIN, body: { role: "viewer" } });
    expect((await mcp(tokens.access_token)).status).toBe(401);
    await call("PATCH", `/api/admin/users/${olga.id}`, { token: ADMIN, body: { role: "member" } });
    expect((await mcp(tokens.access_token)).status).toBe(200);
    // Revoking the API token she approved with ends the connector's access.
    const t = (await json(call("GET", "/api/admin/tokens", { token: ADMIN }))).find((x: { userId: string }) => x.userId === olga.id);
    await call("DELETE", `/api/admin/tokens/${t.id}`, { token: ADMIN });
    expect((await mcp(tokens.access_token)).status).toBe(401);
    expect(base.hostname).toBe("127.0.0.1");
  });

  it("records an event log, stores no secrets, and does not bootstrap twice", async () => {
    const events = await json(call("GET", "/api/admin/events", { token: ADMIN }));
    expect(Date.parse(events[0].at)).toBeGreaterThanOrEqual(Date.parse(events.at(-1).at));
    const actions = new Set(events.map((e: { action: string }) => e.action));
    for (const a of ["user.create", "user.update", "user.delete", "user.signout", "token.create", "token.revoke", "login", "login.failed", "logout", "oauth.grant"]) expect(actions).toContain(a);
    expect(events.find((e: { action: string }) => e.action === "login").ip).toBeTruthy();
    const file = join(home, "auth.json");
    expect(statSync(file).mode & 0o077).toBe(0);
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain(ADMIN);
    expect(raw).not.toContain(people.member.token);
    // A restart with the same ACAI_ADMIN_TOKEN keeps the existing administrator.
    stop(srv);
    srv = await start();
    url = srv.url;
    const users = await json(call("GET", "/api/admin/users", { token: ADMIN }));
    expect(users.filter((u: { role: string }) => u.role === "admin")).toHaveLength(1);
  });

  it("limits failed sign-ins per address", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await call("POST", "/api/login", { body: { token: `acai_wrong-${i}` }, header: false })).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    // A valid token is refused too while the address is blocked.
    expect((await call("POST", "/api/login", { body: { token: ADMIN }, header: false })).status).toBe(429);
    // API tokens on requests are not affected.
    expect((await call("GET", "/api/meta", { token: ADMIN })).status).toBe(200);
  });
});

describe("environment accounts over HTTP", () => {
  const home = mkdtempSync(join(tmpdir(), "acai-auth-env-"));
  const env = { ...process.env };
  afterAll(() => {
    process.env = env;
    rmSync(home, { recursive: true, force: true });
  });

  it("lists them but refuses to change them, and keeps no-auth mode for local use", async () => {
    for (const k of AUTH_ENV) delete process.env[k];
    Object.assign(process.env, { ACAI_HOME: home, ACAI_TOKENS: "alice:alice-token-0123456789abcdef,bob:bob-token-0123456789abcdef", ACAI_ADMINS: "alice" });
    const projects = new Projects({ persist: false });
    const s = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    const h = (token: string) => ({ Authorization: `Bearer ${token}`, "X-Acai-Request": "1", "Content-Type": "application/json" });
    try {
      const users = (await (await fetch(`${s.url}/api/admin/users`, { headers: h("alice-token-0123456789abcdef") })).json()) as any[];
      expect(users.map((u) => [u.name, u.role, u.source])).toEqual([
        ["alice", "admin", "env"],
        ["bob", "member", "env"],
      ]);
      const bob = users[1];
      expect((await fetch(`${s.url}/api/admin/users/${bob.id}`, { method: "PATCH", headers: h("alice-token-0123456789abcdef"), body: JSON.stringify({ role: "admin" }) })).status).toBe(409);
      expect((await fetch(`${s.url}/api/admin/users/${bob.id}`, { method: "DELETE", headers: h("alice-token-0123456789abcdef") })).status).toBe(409);
      expect((await fetch(`${s.url}/api/admin/users`, { headers: h("bob-token-0123456789abcdef") })).status).toBe(403);
      // The shared-token name claim is gone: the header is ignored when accounts exist.
      const meta: any = await (await fetch(`${s.url}/api/meta`, { headers: { ...h("bob-token-0123456789abcdef"), "X-Acai-User": "mallory" } })).json();
      expect(meta).toMatchObject({ user: "bob", account: { name: "bob", role: "member" } });
    } finally {
      s.server.close();
    }

    // No accounts at all: local mode, the person names themselves, no sign-in.
    for (const k of AUTH_ENV) delete process.env[k];
    process.env.ACAI_HOME = mkdtempSync(join(home, "empty-"));
    const local = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    try {
      const meta: any = await (await fetch(`${local.url}/api/meta`, { headers: { "X-Acai-User": "dana" } })).json();
      expect(meta).toMatchObject({ auth: "none", user: "dana", account: null });
      expect((await fetch(`${local.url}/api/account`)).status).toBe(404);
      await expect(startServer({ projects, provider: null, host: "0.0.0.0", port: 0 })).rejects.toThrow(/ACAI_ADMIN_TOKEN/);
    } finally {
      local.server.close();
    }
  });
});
