# Assay: self-hosted compliance audit service (dashboard + API + MCP over HTTP).
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
 && useradd --create-home --uid 10001 assay
COPY --from=build /src/dist/assay /opt/assay
ENV ASSAY_HOME=/data \
    ASSAY_HOST=0.0.0.0 \
    ASSAY_PORT=4317 \
    NODE_ENV=production
RUN mkdir -p /data /workspace && chown assay:assay /data /workspace
USER assay
WORKDIR /workspace
EXPOSE 4317
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4317/api/meta',{headers:{authorization:'Bearer '+(process.env.ASSAY_TOKEN||(process.env.ASSAY_TOKENS||'').split(',')[0].split(':')[1]||'')}}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/opt/assay/assay.mjs"]
CMD ["serve", "/workspace"]
