import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** How a local MCP client starts Acai: absolute node and script paths, so GUI apps without a shell PATH work too. */
export function launcher(): string[] {
  const script = process.argv[1] ? resolve(process.argv[1]) : "";
  if (script.endsWith(".mjs")) return [process.execPath, script];
  // Running from source (npm run acai): point clients at the built bundle.
  return [process.execPath, resolve(dirname(fileURLToPath(import.meta.url)), "../../../dist/acai/acai.mjs")];
}

export const CLIENTS = ["claude-code", "codex", "cursor", "vscode", "claude-desktop", "gemini", "windsurf", "chatgpt", "claude-ai", "openai-api", "anthropic-api", "agent-sdk"] as const;
export type Client = (typeof CLIENTS)[number];

export const CLIENT_LABELS: Record<Client, string> = {
  "claude-code": "Claude Code",
  codex: "OpenAI Codex CLI / IDE",
  cursor: "Cursor",
  vscode: "VS Code (Copilot agent mode)",
  "claude-desktop": "Claude Desktop",
  gemini: "Gemini CLI",
  windsurf: "Windsurf",
  chatgpt: "ChatGPT (developer mode connector)",
  "claude-ai": "Claude.ai / Claude apps (custom connector)",
  "openai-api": "OpenAI Responses API and Agents SDK",
  "anthropic-api": "Claude API (MCP connector)",
  "agent-sdk": "Claude Agent SDK",
};

/** Clients that only reach MCP servers over the internet: they need `acai serve` behind HTTPS. */
export const REMOTE_ONLY = new Set<Client>(["chatgpt", "claude-ai", "openai-api", "anthropic-api"]);

/** Text uses `backticks` for inline code; code blocks are meant to be copied as they are. */
export type Block = { kind: "text"; text: string } | { kind: "steps"; items: string[] } | { kind: "code"; label: string; text: string };
export type Guide = { client: Client; label: string; mode: "local" | "remote"; blocks: Block[] };

const q = (s: string) => (/^[\w./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const json = (v: unknown) => JSON.stringify(v, null, 2);
const toml = (v: string[]) => `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
const text = (t: string): Block => ({ kind: "text", text: t });
const code = (label: string, t: string): Block => ({ kind: "code", label, text: t });
const steps = (...items: string[]): Block => ({ kind: "steps", items });

export type ConnectOptions = {
  project: string;
  /** Remote MCP endpoint (https://host/mcp). Without it, local clients get a stdio configuration. */
  url?: string;
  launcher?: string[];
};

function serveRecipe(client: Client, project: string, run: string): Block[] {
  return [
    text("This client connects to MCP servers over the internet, so run Acai as a service behind HTTPS:"),
    steps("Expose port 4317 over HTTPS, for example with a quick tunnel (or `ngrok http 4317`, or your reverse proxy):"),
    code("Tunnel", "cloudflared tunnel --url http://127.0.0.1:4317"),
    steps("Start Acai with a first administrator token and the public URL from the tunnel (keep the token: you sign in with it):"),
    code("Start the server", `export ACAI_ADMIN_TOKEN="$(openssl rand -hex 32)"\necho "$ACAI_ADMIN_TOKEN"\nexport ACAI_PUBLIC_URL=https://<your-public-host>\nexport ACAI_TRUST_PROXY=1\n${run} serve ${q(project)}`),
    text(`Then open this page on the public URL, or run \`${run} connect ${client} --url https://<your-public-host>/mcp\`, for the exact steps.`),
  ];
}

export function connectGuide(client: Client, opts: ConnectOptions): Guide {
  const [cmd, ...pre] = opts.launcher ?? launcher();
  const args = [...pre, "mcp", opts.project, "--dashboard"];
  const line = [cmd, ...args].map(q).join(" ");
  const url = opts.url;
  const guide = (blocks: Block[]): Guide => ({ client, label: CLIENT_LABELS[client], mode: url ? "remote" : "local", blocks });
  if (!url && REMOTE_ONLY.has(client)) return guide(serveRecipe(client, opts.project, [cmd, ...pre].map(q).join(" ")));
  const bearer = "Bearer <your Acai token>";

  switch (client) {
    case "claude-code":
      return guide(
        url
          ? [
              text("In a terminal, with your Acai token in `ACAI_TOKEN`:"),
              code("Terminal", `claude mcp add --transport http acai ${url} --header "Authorization: Bearer $ACAI_TOKEN"`),
              text("Or, without the `claude` command (for example in the VS Code extension), save this as `.mcp.json` in the project root. Claude Code fills in `${ACAI_TOKEN}` from your environment; if you paste the token instead, keep the file out of git:"),
              code(".mcp.json", json({ mcpServers: { acai: { type: "http", url, headers: { Authorization: "Bearer ${ACAI_TOKEN}" } } } })),
              text("Check with `/mcp` in Claude Code: `acai` should show as connected. If the server has `ACAI_PUBLIC_URL`, you can leave out the header and sign in with OAuth from `/mcp` instead."),
            ]
          : [
              text("In a terminal, in the project (add `--scope user` to have it in every project):"),
              code("Terminal", `claude mcp add acai -- ${line}`),
              text("Or, without the `claude` command (for example in the VS Code extension), save this as `.mcp.json` in the project root. Claude Code asks you once to approve it:"),
              code(".mcp.json", json({ mcpServers: { acai: { command: cmd, args: [...pre, "mcp", ".", "--dashboard"] } } })),
              text('Check with `/mcp` in Claude Code: `acai` should show as connected. Then ask: "Audit this app for compliance with Acai."'),
              text("Builds and tests run inside `acai_complete_fix`; if fixes time out, raise the tool timeout with `MCP_TOOL_TIMEOUT=900000`."),
            ],
      );
    case "codex":
      return guide(
        url
          ? [
              code("~/.codex/config.toml", `[mcp_servers.acai]\nurl = "${url}"\nbearer_token_env_var = "ACAI_TOKEN"\ntool_timeout_sec = 900`),
              text("Or leave out `bearer_token_env_var` and sign in with OAuth: `codex mcp login acai`."),
            ]
          : [
              code("Terminal", `codex mcp add acai -- ${line}`),
              text("Or in `~/.codex/config.toml`, with a longer tool timeout for builds and tests:"),
              code("~/.codex/config.toml", `[mcp_servers.acai]\ncommand = ${JSON.stringify(cmd)}\nargs = ${toml(args)}\ntool_timeout_sec = 900`),
            ],
      );
    case "cursor":
      return guide([
        text("In `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project:"),
        code(".cursor/mcp.json", json({ mcpServers: { acai: url ? { url, headers: { Authorization: bearer } } : { command: cmd, args } } })),
      ]);
    case "vscode":
      return guide(
        url
          ? [
              text("In `.vscode/mcp.json`. VS Code asks for the token once and stores it securely:"),
              code(".vscode/mcp.json", json({ inputs: [{ type: "promptString", id: "acai-token", description: "Acai token", password: true }], servers: { acai: { type: "http", url, headers: { Authorization: "Bearer ${input:acai-token}" } } } })),
            ]
          : [
              text("The Acai VS Code extension registers the server for you (`npm run build:vscode`). Without it, in `.vscode/mcp.json`:"),
              code(".vscode/mcp.json", json({ servers: { acai: { type: "stdio", command: cmd, args } } })),
            ],
      );
    case "claude-desktop":
      return guide(
        url
          ? [steps("Settings → Connectors → Add custom connector.", `URL: \`${url}\`.`, "Claude opens the Acai consent page: enter your Acai token and click Allow.")]
          : [
              text("In `~/Library/Application Support/Claude/claude_desktop_config.json` (Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`), then restart Claude:"),
              code("claude_desktop_config.json", json({ mcpServers: { acai: { command: cmd, args } } })),
              text("Claude Desktop has no file tools of its own; it reads the code through `acai_read_file` and `acai_search_code`."),
            ],
      );
    case "gemini":
      return guide([
        text("In `~/.gemini/settings.json`, or `.gemini/settings.json` in the project:"),
        code("settings.json", json({ mcpServers: { acai: url ? { httpUrl: url, headers: { Authorization: bearer }, timeout: 900000 } : { command: cmd, args, timeout: 900000 } } })),
      ]);
    case "windsurf":
      return guide([
        text("In `~/.codeium/windsurf/mcp_config.json`:"),
        code("mcp_config.json", json({ mcpServers: { acai: url ? { serverUrl: url, headers: { Authorization: bearer } } : { command: cmd, args } } })),
      ]);
    case "chatgpt":
      return guide([
        steps(
          "ChatGPT → Settings → Apps & Connectors → Advanced settings: turn on Developer mode (on plans that offer it; workspace admins may need to allow it).",
          `Create a connector: name "Acai", MCP server URL \`${url}\`, authentication OAuth.`,
          "ChatGPT registers itself and opens the Acai consent page: enter your Acai token and click Allow.",
          'In a chat, pick Developer mode, enable Acai and ask: "Use Acai to audit project <name>."',
        ),
        text("ChatGPT cannot see your files, so it reads them with `acai_read_file` and `acai_search_code`, and asks you to confirm before each tool that changes something."),
      ]);
    case "claude-ai":
      return guide([
        steps(
          `Settings → Connectors → Add custom connector: name "Acai", URL \`${url}\`.`,
          "Click Connect. Claude opens the Acai consent page: enter your Acai token and click Allow.",
        ),
        text("Team and Enterprise owners add it once for everyone under Organization settings → Connectors."),
      ]);
    case "openai-api":
      return guide([
        code(
          "Responses API (Python)",
          `from openai import OpenAI
import os

client = OpenAI()
response = client.responses.create(
    model="gpt-5.5",
    tools=[{
        "type": "mcp",
        "server_label": "acai",
        "server_url": "${url}",
        "headers": {"Authorization": "Bearer " + os.environ["ACAI_TOKEN"]},
    }],
    input="Use Acai to list the projects and summarise the latest audit.",
)
print(response.output_text)`,
        ),
        text("Tool calls need approval by default (`mcp_approval_request` items); approve them in your loop."),
        code(
          "Agents SDK (Python)",
          `from agents.mcp import MCPServerStreamableHttp, MCPServerStdio

acai = MCPServerStreamableHttp(params={"url": "${url}", "headers": {"Authorization": "Bearer " + os.environ["ACAI_TOKEN"]}})
# on the same machine: MCPServerStdio(params={"command": ${JSON.stringify(cmd)}, "args": ${JSON.stringify(args)}})`,
        ),
      ]);
    case "anthropic-api":
      return guide([
        text(`Anthropic connects to \`${url}\` from its cloud, so it must be a public HTTPS URL.`),
        code(
          "Messages API MCP connector (Python)",
          `import anthropic, os

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    betas=["mcp-client-2025-11-20"],
    mcp_servers=[{"type": "url", "url": "${url}", "name": "acai", "authorization_token": os.environ["ACAI_TOKEN"]}],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "acai"}],
    messages=[{"role": "user", "content": "Use Acai to list the projects and summarise the latest audit."}],
)`,
        ),
      ]);
    case "agent-sdk":
      return guide([
        text("Claude Code's file tools plus Acai, in your own program:"),
        code(
          "Claude Agent SDK (TypeScript)",
          `import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Audit this repository for compliance with Acai.",
  options: {
    mcpServers: {
      acai: ${url ? `{ type: "http", url: "${url}", headers: { Authorization: \`Bearer \${process.env.ACAI_TOKEN}\` } }` : `{ type: "stdio", command: ${JSON.stringify(cmd)}, args: ${JSON.stringify(args)} }`},
    },
    allowedTools: ["mcp__acai__*", "Read", "Grep", "Glob", "Edit"],
  },
})) console.log(message);`,
        ),
      ]);
  }
}

/** Plain-text rendering for the terminal. */
export function renderGuide(g: Guide): string {
  let n = 0;
  const parts = g.blocks.map((b) =>
    b.kind === "text" ? b.text : b.kind === "steps" ? b.items.map((i) => `${++n}. ${i}`).join("\n") : b.text.split("\n").map((l) => `    ${l}`).join("\n"),
  );
  return `# ${g.label}\n\n${parts.join("\n\n")}`;
}

export function connectInstructions(client: Client, opts: ConnectOptions): string {
  return renderGuide(connectGuide(client, opts));
}

export function connectOverview(opts: ConnectOptions): string {
  const [cmd, ...pre] = opts.launcher ?? launcher();
  const lines = CLIENTS.map((c) => `  ${c.padEnd(15)}${CLIENT_LABELS[c]}${REMOTE_ONLY.has(c) ? " (remote, needs acai serve over HTTPS)" : ""}`);
  return `Connect an agent to Acai over MCP.

Usage: acai connect <client> [path] [--url https://host/mcp]

${lines.join("\n")}

Local clients start Acai themselves:
  ${[cmd, ...pre, "mcp", opts.project, "--dashboard"].map(q).join(" ")}
${existsSync(pre[0] ?? "") ? "" : "\nThe bundle is not built yet: run `npm run build` first.\n"}
With --url, every client connects to a running \`acai serve\` instead (shared server, ChatGPT, Claude.ai, APIs).
The dashboard explains all of this on its "Connect agents" page. Details: docs/MCP.md`;
}
