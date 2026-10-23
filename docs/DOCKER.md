# Running Acai with Docker

One container serves the dashboard, the API and the MCP endpoint for coding agents. Your repositories are mounted into it, and the accounts, model settings and your own frameworks live in a Docker volume.

For TLS, Kubernetes, bare metal, air-gapped installs and hardening, see [DEPLOY.md](DEPLOY.md).

## What you need

- Docker with Compose v2 (`docker compose version`): Docker Desktop on macOS or Windows, or Docker Engine on Linux.
- The repositories you want to audit, in one folder.
  - **On macOS**, Docker Desktop can only mount folders it shares (Settings → Resources → File sharing). `/Users` is shared by default; `/Applications` is not.

## Start it

From the root of this repository:

```sh
cp .env.example .env
openssl rand -hex 32                 # paste the result as ACAI_ADMIN_TOKEN in .env
mkdir -p repos && git clone <repository-url> repos/<name>
docker compose up -d --build
```

The first build takes a few minutes. Then check that it is running:

```sh
docker compose ps                    # STATUS shows "healthy"
curl http://127.0.0.1:4317/healthz   # {"ok":true}
```

Open <http://127.0.0.1:4317> and sign in with `ACAI_ADMIN_TOKEN`.

- **Repositories as projects:** every git repository under `./repos` becomes a project.
- **An introduction for new colleagues:** <http://127.0.0.1:4317/welcome>.

### Settings in `.env`

| Variable | What it does |
| --- | --- |
| `ACAI_ADMIN_TOKEN` | First administrator. On start, if no enabled administrator exists, Acai creates the user `admin` with this token. |
| `ACAI_REPOS` | The folder of repositories, mounted at `/workspace`. Default `./repos`. |
| `ACAI_HOST_PORT` | The port on this computer. Default `4317`; change it if the port is taken. |
| `ACAI_TOKENS` | Optional accounts defined in the environment (`name:token,...`). |

The compose file refuses to start until `ACAI_ADMIN_TOKEN` or `ACAI_TOKENS` is set. Docker always listens beyond localhost inside the container, so someone has to sign in.

## First steps in the dashboard

1. **Accounts.** Under **Admin → Users**, create an account for each person and give them their token. Then create a personal admin account and revoke the `admin` bootstrap token.
2. **Model (optional).** Without a model, Acai runs its detectors and evidence checks, and a connected coding agent can do the reasoning. To let Acai's own agents investigate and fix, pick a provider on the **Model** page, paste the key and save. The key stays on the server.
3. **Run an audit.** Open a project, confirm the profile answers, and use **Run detector audit** (or **Run agent audit** with a model). Then review the findings.

The model can also come from `.env`. Apply changes with `docker compose up -d`:

```sh
# Claude
ANTHROPIC_API_KEY=...

# OpenAI
OPENAI_API_KEY=...

# Azure OpenAI in Microsoft Foundry (GPT, DeepSeek, Grok); the model is your deployment name
ACAI_PROVIDER=azure-openai
AZURE_OPENAI_ENDPOINT=https://YOUR-RESOURCE.openai.azure.com
AZURE_OPENAI_API_KEY=...
ACAI_MODEL=<deployment name>

# Claude in Microsoft Foundry
ACAI_PROVIDER=azure-claude
ANTHROPIC_FOUNDRY_RESOURCE=YOUR-RESOURCE
ANTHROPIC_FOUNDRY_API_KEY=...
ACAI_MODEL=claude-opus-5-5

# A model on this computer (Ollama); the container reaches it through host.docker.internal
ACAI_PROVIDER=ollama
ACAI_OPENAI_BASE_URL=http://host.docker.internal:11434/v1
ACAI_MODEL=qwen3-coder
```

`docker compose exec acai node /opt/acai/acai.mjs providers` lists every provider and the variable it reads.

## Connect a coding agent

Create a token for yourself (**Account → Tokens**), then run, for example:

```sh
claude mcp add --transport http acai http://127.0.0.1:4317/mcp --header "Authorization: Bearer $ACAI_TOKEN"
```

Open the agent in the repository's folder on your computer: the container sees the same files. **Connect** in the dashboard shows the setup for Codex, Cursor, VS Code, Gemini CLI and others.

## Everyday commands

| Task | Command |
| --- | --- |
| Follow the logs | `docker compose logs -f acai` |
| Restart | `docker compose restart acai` |
| Apply `.env` changes | `docker compose up -d` |
| Stop | `docker compose down`; the data volume is kept |
| Update to a new version | `git pull && docker compose up -d --build` |
| Run the CLI in the container | `docker compose exec acai node /opt/acai/acai.mjs <command>` |
| Add a user | `docker compose exec acai node /opt/acai/acai.mjs users add alice --role member` |
| Back up the data volume | `docker compose exec -T acai tar czf - -C /data . > acai-data-$(date +%F).tar.gz` |

The backup contains token hashes and possibly a model key (`model.json`), so store it encrypted. [DEPLOY.md](DEPLOY.md#backups) explains how to restore it.

## More repositories

- **From a folder:** clone into the `ACAI_REPOS` folder. Then, in the dashboard, use **Add a project** with the path `/workspace/<name>`, or restart the container.
- **From another place on this computer:** add a line under `volumes:` in `compose.yaml`, for example `- /path/to/repo:/workspace/repo`.
- **By URL:** set `ACAI_ALLOW_CLONE=true` to let administrators add repositories by URL; they are cloned into the volume.

## Your own and updated standards

**Admin → Frameworks** adds a framework that is not built in, or a newer revision of a built-in one (same id). This can be another ISO standard, a customer's requirements or an internal standard. It applies to every project at once. From the command line:

```sh
docker compose exec acai node /opt/acai/acai.mjs frameworks show iso-iec-27001 > iso-iec-27001.yaml
# edit the file, then:
docker compose exec -T acai node /opt/acai/acai.mjs frameworks add - < iso-iec-27001.yaml
docker compose exec acai node /opt/acai/acai.mjs frameworks        # built-in, custom and updated
```

They are stored in the volume (`/data/frameworks`) and survive updates. See [registry/README.md](../registry/README.md) for the file format.

## When something goes wrong

| Symptom | Fix |
| --- | --- |
| `Set ACAI_ADMIN_TOKEN in .env` | Set it (`openssl rand -hex 32`), then `docker compose up -d`. |
| `port is already allocated` | Another program uses the port: set `ACAI_HOST_PORT=4318` (or another free port) in `.env`. |
| No projects, or `mounts denied` on macOS | The repositories folder is not shared with Docker Desktop. Move it under `/Users` or share it (Settings → Resources → File sharing). |
| Audits cannot write `.acai/` (Linux) | Run the container as your user: uncomment `user: "${UID:-1000}:${GID:-1000}"` in `compose.yaml`. |
| The model on this computer is unreachable | Use `host.docker.internal` instead of `localhost` in the endpoint. |
| Lost the administrator token | Put a new `ACAI_ADMIN_TOKEN` in `.env` and run `docker compose up -d`. It works while no enabled local administrator exists; otherwise ask another administrator. |
| Fix verification fails with "command not found" | The image has git, make, gcc and python3. Derive your own image with the toolchains your projects need. |
