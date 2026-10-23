# Using Acai from agents (MCP)

Acai is an MCP server. Any agent that speaks MCP can run an audit with it: Claude Code, Codex, Cursor, VS Code agent mode, Gemini CLI, Windsurf, Claude Desktop, ChatGPT, Claude.ai, and your own agents built on the OpenAI or Claude APIs. The agent does the reasoning with its own model. Acai provides the rule registry, detectors, the review queue, fix verification and the audit trail. A person makes every review decision.

The dashboard's **Connect agents** page (top bar, or `#/connect`) explains how this works and shows the exact setup for each client, for the server you are looking at. In the terminal, `acai connect <client>` prints the same configuration for your machine, with absolute paths filled in:

```sh
node dist/acai/acai.mjs connect                    # list of clients
node dist/acai/acai.mjs connect codex .            # local (stdio) setup for this repository
node dist/acai/acai.mjs connect chatgpt --url https://acai.example.com/mcp
```

## Two ways to connect

| | Local (stdio) | Remote (HTTP) |
| --- | --- | --- |
| Started by | the client runs `acai mcp <path>` itself | you run `acai serve` (or Docker) |
| Clients | Claude Code, Codex, Cursor, VS Code, Gemini CLI, Windsurf, Claude Desktop, Claude Agent SDK, OpenAI Agents SDK | all of these, plus ChatGPT, Claude.ai and the OpenAI and Claude APIs |
| Projects | the one path you pass | every project registered on the server (`acai_projects`) |
| Sign-in | none, it runs as you | an Acai API token (`Authorization: Bearer`), or OAuth for ChatGPT and Claude.ai |

Use the local setup on your own machine. Use the remote one for a team server, or for clients that only reach MCP servers over the internet.

## Local clients

Build once with `npm run build`, then for example:

```sh
claude mcp add acai -- node /abs/path/dist/acai/acai.mjs mcp /abs/path/to/repo --dashboard
codex mcp add acai -- node /abs/path/dist/acai/acai.mjs mcp /abs/path/to/repo --dashboard
```

Cursor, VS Code, Gemini CLI, Windsurf and Claude Desktop take the same command and arguments in their JSON config; `acai connect <client>` prints the file and its location. The VS Code extension registers the server automatically.

`--dashboard` also starts the review dashboard on <http://127.0.0.1:4317>, so you can review findings there while the agent works.

Fix verification runs the project's build and tests inside `acai_complete_fix`, which can take minutes. Raise the client's tool timeout if fixes time out. Codex uses `tool_timeout_sec`, Gemini CLI uses `timeout`, and Claude Code uses the `MCP_TOOL_TIMEOUT` environment variable.

## Remote: a shared server

```sh
export ACAI_ADMIN_TOKEN="$(openssl rand -hex 32)"     # the first administrator signs in with this
node dist/acai/acai.mjs serve /srv/repos/app-a /srv/repos/app-b --host 0.0.0.0
node dist/acai/acai.mjs users add alice                # each person gets an account and an API token
```

Put TLS in front of it and set `ACAI_TRUST_PROXY=1` ([DEPLOY.md](DEPLOY.md)). People create more API tokens for their agents under **Account** in the dashboard. Clients that can send headers then connect with one (here kept in the client's `ACAI_TOKEN` environment variable):

```sh
claude mcp add --transport http acai https://acai.example.com/mcp --header "Authorization: Bearer $ACAI_TOKEN"
```

```toml
# ~/.codex/config.toml
[mcp_servers.acai]
url = "https://acai.example.com/mcp"
bearer_token_env_var = "ACAI_TOKEN"
tool_timeout_sec = 900
```

Every decision is recorded under the account the token belongs to. MCP needs the `member` or `admin` role; viewers are refused. Approving build and test commands through MCP follows the same rule as in the dashboard: administrators, and members listed in `ACAI_APPROVERS`. On a shared server, MCP clients can open registered projects, plus directories inside `ACAI_PROJECT_ROOTS`. They cannot open arbitrary paths.

## ChatGPT and Claude.ai (OAuth)

ChatGPT and Claude.ai connectors call your server from the internet and cannot send a static token, so Acai includes an OAuth 2.1 authorization server. Clients register themselves (dynamic client registration). The person approves on an Acai consent page by entering one of their Acai API tokens. The client then receives short-lived tokens tied to that API token and its account.

1. Give the server a public HTTPS address. For a quick test, use a tunnel:

   ```sh
   cloudflared tunnel --url http://127.0.0.1:4317     # prints https://<random>.trycloudflare.com
   ```

2. Start Acai with an administrator token and that public URL:

   ```sh
   export ACAI_ADMIN_TOKEN="$(openssl rand -hex 32)"; echo "$ACAI_ADMIN_TOKEN"
   export ACAI_PUBLIC_URL=https://<random>.trycloudflare.com
   export ACAI_TRUST_PROXY=1
   node dist/acai/acai.mjs serve /abs/path/to/repo
   ```

   OAuth is on when `ACAI_PUBLIC_URL` is set and the server has accounts (`ACAI_ADMIN_TOKEN`, `acai users add`, or `ACAI_TOKENS`). The URL must be the bare origin, with no path.

3. Add the connector:
   - **ChatGPT:** go to Settings → Apps & Connectors → Advanced settings and turn on Developer mode. Then create a connector with the MCP server URL `https://<host>/mcp` and OAuth authentication. In a chat, enable it from Developer mode.
   - **Claude.ai and the Claude apps:** go to Settings → Connectors → Add custom connector and enter the URL `https://<host>/mcp`.

4. The client opens the Acai consent page. Enter your Acai API token and click **Allow**. Viewer accounts cannot connect.

These clients cannot see your files. They read the code through `acai_list_files`, `acai_read_file` and `acai_search_code`. During a fix they edit through `acai_edit_file` and `acai_write_file`. These tools are confined to the project like Acai's own agent: no paths outside it, no `.git` or `.acai`, no symlinks, and credential files are hidden. Edits are only accepted between `acai_begin_fix` and `acai_complete_fix` for that finding. Acai then builds, tests and commits them on a fix branch.

Grants survive restarts (`$ACAI_HOME/oauth.json`, which stores token hashes only, mode 600). Access tokens last an hour. Refresh tokens last 30 days and work once. Revoking the API token used on the consent page, disabling or deleting the account, or changing it to viewer revokes every grant made with it; **Admin → Users → Sign out** ends them too.

## Your own agents

OpenAI Responses API:

```python
response = client.responses.create(
    model="gpt-5.5",
    tools=[{"type": "mcp", "server_label": "acai", "server_url": "https://acai.example.com/mcp",
            "headers": {"Authorization": "Bearer " + os.environ["ACAI_TOKEN"]}}],
    input="Use Acai to list the projects and summarise the latest audit.",
)
```

Claude API (MCP connector):

```python
response = client.beta.messages.create(
    model="claude-opus-5-5",
    max_tokens=16000,
    betas=["mcp-client-2025-11-20"],
    mcp_servers=[{"type": "url", "url": "https://acai.example.com/mcp", "name": "acai",
                  "authorization_token": os.environ["ACAI_TOKEN"]}],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "acai"}],
    messages=[{"role": "user", "content": "Use Acai to list the projects and summarise the latest audit."}],
)
```

Both APIs connect from the provider's cloud, so the server needs a public HTTPS URL. Agents that run on your own machine can use stdio instead: OpenAI Agents SDK `MCPServerStdio`, or Claude Agent SDK `mcpServers: { acai: { type: "stdio", command, args } }`. `acai connect openai-api|anthropic-api|agent-sdk` prints complete examples.

## What the agent gets

- **Prompt** `audit` and resource `acai://playbook`: the workflow (understand → ask → scope → audit → human review → fix and verify → report).
- **Tools:** `acai_tasks` (the confirmed findings as tasks with exact instructions, the usual starting point for fixing), `acai_projects`, `acai_start`, `acai_questions`, `acai_answer`, `acai_apply_preset`, `acai_scope`, `acai_run_audit`, `acai_controls`, `acai_record_findings`, `acai_annotate`, `acai_assess_control`, `acai_findings`, `acai_review`, `acai_wait_for_review`, `acai_complete_reinvestigation`, `acai_verify_config`, `acai_begin_fix`, `acai_complete_fix`, `acai_abort_fix`, `acai_propose_rules`, `acai_decide_rule`, `acai_report`, `acai_dashboard`, plus the file tools above.
- **Resources** `acai://registry/{framework}`: the controls of each framework.

Review decisions (`acai_review`, `acai_decide_rule`) require `user_confirmed: true`. The tool descriptions reserve that for decisions the person made in the conversation. Approving build and test commands also needs the person's consent. On a shared server, only `ACAI_APPROVERS` may approve them.
