# Deploying Acai

This guide covers running Acai as a shared service inside a company network: Docker, bare metal with systemd, Kubernetes, TLS, accounts, backups, upgrades and air-gapped installs.

One process serves everything: the dashboard, the REST API (`/api`), MCP over HTTP (`/mcp`), repository webhooks (`/hooks/*`) and, with a public URL, OAuth for remote MCP connectors. State is plain files:

| Where | What |
| --- | --- |
| `$ACAI_HOME` (`/data` in the container, `~/.acai` otherwise) | `auth.json` (accounts, token and session hashes, event log), `model.json` (model settings, may hold an API key), `oauth.json` (OAuth clients and token hashes), `projects.json` (registered projects), `repos/` (repositories cloned by URL) |
| `<repository>/.acai/` | Audits, findings, review decisions and the hash-chained journal of each project |

All secrets files are written with mode 600.

## Requirements

- Docker Engine 24 or later with Compose 2.24 or later, **or** Node.js 22.12 or later and git.
- 2 CPUs and 4 GB of memory to start with. Fix verification builds and tests the audited projects on the server, so size it for those builds, and add the toolchains they need (the image has git, make, gcc and python3).
- Disk for the repositories and their `.acai/` state.
- Network: none to the internet, unless you use a cloud model, GitHub status reporting or ChatGPT/Claude.ai connectors.

## Docker quick start

```sh
cp .env.example .env
echo "ACAI_ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env   # or edit the empty line in .env
chmod 600 .env
mkdir -p repos && git clone <repository> repos/<name>
docker compose up -d --build
```

Open <http://127.0.0.1:4317> and sign in with the value of `ACAI_ADMIN_TOKEN`. Every git repository under `./repos` (or `ACAI_REPOS`) becomes a project.

The port is published on 127.0.0.1 only. For the rest of the network, add TLS (below). Compose refuses to start unless `ACAI_ADMIN_TOKEN` or `ACAI_TOKENS` is set.

## The first administrator

Acai requires sign-in as soon as any account exists. Without accounts it runs in local mode: a single user, loopback only, and it refuses to listen on other interfaces.

There are two ways to create the first administrator:

- **`ACAI_ADMIN_TOKEN`** (Docker, Kubernetes, systemd): a random value of at least 16 characters. On every start, if no enabled local administrator exists, Acai creates the local user `admin` with this value as its API token, and logs that it did. If the token still belongs to a former administrator who was disabled or demoted, that account is restored instead.
- **`acai users add <name> --role admin`** (bare metal, or a running container): creates the account and prints its first API token once.

After the first sign-in, create a personal token under **Account** (or create named administrator accounts), then revoke the `ACAI_ADMIN_TOKEN` token under **Admin → Tokens**. Keep the variable in `.env`: Compose needs it, and it only acts again if no enabled local administrator is left, which makes it the recovery path.

## Users, roles and tokens

| Can | viewer | member | admin |
| --- | --- | --- | --- |
| Read projects, findings, reports, the audit trail and code excerpts | yes | yes | yes |
| Create and revoke their own API tokens | yes | yes | yes |
| Run audits, review and fix findings, hand off to agents, manage projects and rules | | yes | yes |
| Connect agents over MCP, including OAuth connectors | | yes | yes |
| See automation (webhook) settings | | yes | yes |
| Approve build/test commands, change the model, change automation settings | | only if listed in `ACAI_APPROVERS` | yes |
| Manage users and tokens, read the event log and server settings (`/api/admin`) | | | yes |

The server enforces these roles on every request; the dashboard only hides what an account cannot use.

- **API tokens** look like `acai_` followed by 43 characters. Acai stores only their SHA-256 hash and a 12-character prefix for display, so a lost token cannot be shown again: create a new one. Tokens can expire (`expiresInDays`, `--expires 90d`). Send them as `Authorization: Bearer <token>` from scripts, CI and MCP clients.
- **Dashboard sessions.** Signing in exchanges an API token for an `acai_session` cookie (HttpOnly, SameSite=Strict, Secure over HTTPS, 7 days). A session ends on sign-out, when the token it was opened with is revoked or expires, and when the account is disabled or deleted. **Admin → Users → Sign out** ends all of a person's sessions and their OAuth connectors.
- **Revoking a token** also ends the sessions opened with it and every OAuth grant approved with it. Disabling an account blocks its tokens until it is enabled again. Changing an account to viewer ends its MCP access.
- **Protection.** Nobody can remove the last enabled administrator, and administrators cannot demote, disable or delete themselves.
- **Event log.** Sign-ins, failed sign-ins (with the client address), sign-outs, account and token changes are kept (last 1000) under **Admin → Events** and `GET /api/admin/events`. Failed sign-ins are limited to 10 per minute per address.
- **Accounts from the environment.** `ACAI_TOKENS=alice:<token>,bob:<token>` and `ACAI_TOKEN=<token>` (one account named `admin`) still work. They are read-only: change them in the environment and restart. They are administrators unless `ACAI_ADMINS=alice` names who is; the others are members.

### Command line

The commands edit `$ACAI_HOME/auth.json` directly. A running server picks the change up on its next request, without a restart.

```sh
acai users list
acai users add alice --role admin          # prints alice's first token once
acai users add bob                         # member by default
acai users set bob --role viewer           # or --disable, --enable, --rename <new name>
acai users remove bob
acai tokens list [alice]
acai tokens create alice --label ci --expires 90d
acai tokens revoke acai_AbCdEfG            # by id or prefix
```

In Docker, run them in the container (`acai` is `node /opt/acai/acai.mjs` there):

```sh
docker compose exec acai node /opt/acai/acai.mjs users add alice --role admin
```

With systemd, run them as the service user: `sudo -u acai env ACAI_HOME=/var/lib/acai node /opt/acai/acai.mjs users list`.

### API

Errors are `{ "error": "..." }` with status 400, 401, 403, 404, 409 or 429. Changing requests need the header `X-Acai-Request: 1`, except `POST /api/login`.

| Endpoint | |
| --- | --- |
| `POST /api/login {token}`, `POST /api/logout` | Dashboard session |
| `GET /api/account`, `POST /api/account/tokens {label, expiresInDays?}`, `DELETE /api/account/tokens/:id` | Own account and tokens |
| `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/tokens`, `POST /api/admin/users/:id/signout` | Accounts (admin) |
| `GET /api/admin/tokens`, `DELETE /api/admin/tokens/:id`, `GET /api/admin/events`, `GET /api/admin/server` | Tokens, event log, server settings (admin) |
| `GET /healthz` | Health check, no sign-in, returns `{"ok":true}` |

## TLS and reverse proxies

Acai speaks plain HTTP. Put it behind a TLS proxy on the same host and keep port 4317 on 127.0.0.1. Then set:

- `ACAI_TRUST_PROXY=1`: Acai takes the client address and HTTPS from `X-Forwarded-For` and `X-Forwarded-Proto` (exactly one proxy hop). Rate limits and the event log then see real addresses, and session cookies are marked Secure. Only set it when the proxy is the only way to reach Acai.
- `ACAI_PUBLIC_URL=https://acai.example.com` (origin, no path): used in links and the agent setup pages, and it turns on OAuth for ChatGPT and Claude.ai connectors.

### Caddy, with the Compose `tls` profile

Set in `.env`:

```sh
ACAI_DOMAIN=acai.corp.example
ACAI_TLS=internal            # acme | internal | files
ACAI_PUBLIC_URL=https://acai.corp.example
ACAI_TRUST_PROXY=1
```

```sh
docker compose --profile tls up -d
```

- `acme`: a public certificate from Let's Encrypt or ZeroSSL. The name must resolve publicly and ports 80 and 443 must be reachable from the internet.
- `internal`: Caddy issues the certificate from its own CA. Use this for intranet names and air-gapped networks. Distribute the CA root to clients; it is in the `caddy-data` volume at `caddy/pki/authorities/local/root.crt`.
- `files`: your company's certificate. Put the full chain in `deploy/certs/cert.pem` and the key in `deploy/certs/key.pem` (that folder is git-ignored).

The Caddy service uses the host network to reach Acai on 127.0.0.1 and to serve ports 80 and 443, so the profile is meant for Linux hosts. Configuration: [deploy/Caddyfile](../deploy/Caddyfile).

### Another proxy

Forward everything to `http://127.0.0.1:4317`, pass `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`, and do not buffer responses: `/api/events` and MCP use long-lived streams. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:4317;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
    client_max_body_size 8m;
}
```

Acai needs accounts even when it listens on 127.0.0.1 behind a proxy: in local mode it only answers requests addressed to `localhost` (DNS-rebinding protection).

## Bare metal with systemd

On a machine with Node.js 22.12+ and git:

```sh
npm ci
npm run build                 # dist/acai: acai.mjs (all dependencies bundled), dashboard, registry
```

Copy `dist/acai/` to `/opt/acai/` on the server. It needs nothing else from npm. Then follow the steps at the top of [deploy/systemd/acai.service](../deploy/systemd/acai.service): a system user `acai`, state in `/var/lib/acai`, repositories in `/srv/acai/repos`, secrets in `/etc/acai/acai.env` (mode 640, containing at least `ACAI_ADMIN_TOKEN`). The unit listens on 127.0.0.1:4317 and applies systemd sandboxing (read-only system, no capabilities, private /tmp). Put Caddy or nginx in front as above; Caddy can use `deploy/Caddyfile` with `ACAI_DOMAIN` and `ACAI_TLS` in its environment.

## Kubernetes

[deploy/kubernetes/acai.yaml](../deploy/kubernetes/acai.yaml) contains a Secret, a PersistentVolumeClaim, a Deployment and a Service. The pod runs as UID 10001 with a read-only root filesystem, no capabilities, no service account token and `/healthz` probes. State is files on one ReadWriteOnce volume, so keep one replica and the `Recreate` strategy. Set `ACAI_ADMIN_TOKEN` in the Secret (the placeholder is rejected on purpose), the image, `ACAI_PUBLIC_URL` and your Ingress. Repositories are cloned by URL into the volume (`ACAI_ALLOW_CLONE=true`), or mounted under `/workspace`.

```sh
kubectl -n acai exec deploy/acai -- node /opt/acai/acai.mjs users add alice --role admin
```

## Backups

Back up the data volume and the `caddy-data` volume (if you use the `tls` profile, it holds certificates and the internal CA). The `.acai/` folders live inside the repositories: commit them, or back the repositories up as well.

```sh
docker compose exec -T acai tar czf - -C /data . > acai-data-$(date +%F).tar.gz
```

Files are replaced atomically when they change, so a copy taken while Acai runs is consistent per file. The archive contains token hashes and possibly a model API key (`model.json`): store it encrypted and with restricted access.

To restore into an empty volume:

```sh
docker compose stop acai
docker compose run --rm -T --entrypoint tar acai xzf - -C /data < acai-data-2026-10-22.tar.gz
docker compose start acai
```

On bare metal, back up `/var/lib/acai` and `/srv/acai/repos`.

## Upgrades

```sh
git pull                      # or copy the new release
docker compose up -d --build  # with the tls profile: docker compose --profile tls up -d --build
```

State files stay compatible and are read on start; take a backup first. On bare metal, rebuild `dist/acai`, replace `/opt/acai`, and `systemctl restart acai`. Watch `docker compose logs acai` (or `journalctl -u acai`) and `GET /healthz`.

Changes from versions that only had environment tokens:

- Reviewers no longer type their own name with a shared `ACAI_TOKEN`: that token is now one account named `admin`. Give each person an account instead.
- Environment accounts are administrators unless `ACAI_ADMINS` says otherwise. Approving commands and changing the model need an administrator, or a member listed in `ACAI_APPROVERS`; an empty `ACAI_APPROVERS` no longer lets everyone approve.
- Dashboard users sign in once more (the old cookie held the raw token and is cleared).

## Air-gapped installs

Build on a connected machine and carry the result over.

**Docker images.**

```sh
docker compose build                                   # tags acai:latest
docker pull caddy:2.10-alpine                          # only for the tls profile
docker save acai:latest caddy:2.10-alpine | gzip > acai-images.tar.gz
```

On the offline host, with this repository's `compose.yaml`, `.env.example` and `deploy/` copied over:

```sh
docker load -i acai-images.tar.gz
docker compose up -d --no-build                        # add --profile tls for Caddy with ACAI_TLS=internal or files
```

The image cannot be rebuilt offline (the build pulls the Node base image and Debian packages). Derive your own image on the connected side if you need more toolchains for fix verification.

**Without Docker.** `dist/acai` from `npm run build` is self-contained: copy it with any Node.js 22.12+ runtime package for the target. To build from source on the offline side, fill an npm cache on the connected machine and carry it over:

```sh
npm ci --cache ./npm-cache                 # connected machine, same Node and npm versions
npm ci --offline --cache ./npm-cache       # offline machine
npm run build
```

**A local model.** Point Acai at an OpenAI-compatible server on your network, such as vLLM, Ollama or LiteLLM:

```sh
ACAI_PROVIDER=openai-compatible
ACAI_OPENAI_BASE_URL=http://gpu-host.corp.example:8000/v1   # Ollama: http://<host>:11434/v1
ACAI_MODEL=qwen3-coder
# ACAI_OPENAI_API_KEY=...                                   # if your gateway needs one
ACAI_MODEL_LOCKED=1                                         # nobody can point it elsewhere from the dashboard
```

From the container, a server on the Docker host is `http://host.docker.internal:<port>`. Without any model, Acai still runs its detectors and evidence checks, and MCP clients on your network can do the reasoning with their own model. Web research for new rules and ChatGPT/Claude.ai connectors need the internet and are not available. The dashboard loads nothing from outside the server.

## Hardening checklist

- Keep port 4317 on 127.0.0.1 and serve users through TLS; set `ACAI_TRUST_PROXY=1` only behind that proxy.
- Generate tokens with `openssl rand -hex 32`; keep `.env` at mode 600 and out of version control.
- After the first sign-in, use personal accounts and revoke the `ACAI_ADMIN_TOKEN` token. Use expiring tokens for CI and scripts.
- Give the fewest people `admin`; use `viewer` for people who only read results.
- Approving build and test commands is equivalent to running a shell on the server. Leave `ACAI_APPROVERS` empty unless members need it.
- Set `ACAI_MODEL_LOCKED=1` when the model, and therefore where code excerpts go, is decided by policy.
- Restrict `ACAI_PROJECT_ROOTS`; enable `ACAI_ALLOW_CLONE` only if people add repositories by URL.
- Use a random `ACAI_WEBHOOK_SECRET` of at least 16 characters and a fine-grained `GITHUB_TOKEN` limited to the audited repositories (commit statuses and pull requests: write; contents: read).
- Keep the container hardening from `compose.yaml` (non-root, read-only root filesystem, all capabilities dropped, `no-new-privileges`), or the equivalent in Kubernetes and systemd.
- Limit outbound traffic to the model endpoint and your git hosts.
- Encrypt and restrict backups of the data volume.
- Review **Admin → Events** for failed sign-ins, and remove accounts when people leave.
- Rebuild the image regularly for base image and Node.js security updates.

## Environment reference

| Variable | Default | |
| --- | --- | --- |
| `ACAI_ADMIN_TOKEN` | | First administrator, and recovery when no enabled local administrator exists |
| `ACAI_TOKENS`, `ACAI_TOKEN` | | Read-only accounts from the environment |
| `ACAI_ADMINS` | all environment accounts | Which environment accounts are administrators |
| `ACAI_APPROVERS` | | Members who may approve commands and change the model |
| `ACAI_HOME` | `~/.acai` (`/data` in Docker) | Server state |
| `ACAI_HOST`, `ACAI_PORT` | `127.0.0.1`, `4317` (`0.0.0.0` in Docker) | Listen address |
| `ACAI_PUBLIC_URL` | | Public HTTPS origin; turns on OAuth |
| `ACAI_TRUST_PROXY` | `0` | `1` behind one reverse proxy |
| `ACAI_PROJECT_ROOTS` | | Where projects may be added by path (colon separated) |
| `ACAI_ALLOW_CLONE` | `false` | Add projects by repository URL |
| `ACAI_WEBHOOK_SECRET`, `GITHUB_TOKEN` | | Webhooks and results on GitHub |
| `ACAI_PROVIDER`, `ACAI_MODEL`, `ACAI_OPENAI_BASE_URL`, provider keys | | Model; see `acai providers` |
| `ACAI_MODEL_LOCKED` | | `1` pins the model to the environment |
| `ACAI_DOMAIN`, `ACAI_TLS`, `ACAI_HOST_PORT`, `ACAI_REPOS` | | Compose and the `tls` profile |
