# Acai: self-hosted compliance audit service (dashboard + API + MCP over HTTP).
# Build: docker build -t acai:0.1.0 .   Run: see compose.yaml and docs/DEPLOY.md.
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/vscode/package.json packages/vscode/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
# git: fix branches and diffs. make/gcc/python3: let verification build typical projects.
# Add the toolchains your projects need (or derive your own image from this one).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates make gcc libc6-dev python3 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 acai
COPY --from=build /src/dist/acai /opt/acai
# ACAI_CONTAINER: agents reach this server over HTTP, and local model servers live on the host.
# GIT_CONFIG_*: mounted repositories belong to the host user; let git work in them anyway.
# HOME and npm cache on /tmp: the root filesystem is read-only in compose.yaml.
ENV ACAI_HOME=/data \
    ACAI_HOST=0.0.0.0 \
    ACAI_PORT=4317 \
    ACAI_CONTAINER=1 \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=safe.directory \
    GIT_CONFIG_VALUE_0=* \
    HOME=/tmp \
    NPM_CONFIG_CACHE=/tmp/.npm \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NODE_ENV=production
RUN mkdir -p /data /workspace && chown acai:acai /data /workspace
USER acai
WORKDIR /workspace
EXPOSE 4317
VOLUME ["/data"]
# /healthz needs no sign-in and returns only {"ok":true}.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.ACAI_PORT||4317)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "/opt/acai/acai.mjs"]
CMD ["serve", "/workspace"]
