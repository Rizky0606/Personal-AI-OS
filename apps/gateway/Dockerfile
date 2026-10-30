# syntax=docker/dockerfile:1.7
#
# Gateway Personal AI OS. Konteks build adalah AKAR repo:
#   docker build -f apps/gateway/Dockerfile -t aios-gateway:latest .
# Target: linux/arm64 (VPS Oracle ARM). Di VPS build berjalan native; dari mesin x86 pakai
#   docker buildx build --platform linux/arm64 -f apps/gateway/Dockerfile -t aios-gateway:latest .

# Kunci ke tag patch (mis. 22.x.y-bookworm-slim) saat deploy pertama, lalu catat di infra/VERSIONS.md.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Versi pnpm mengikuti field packageManager di package.json.
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile --filter "@aios/gateway..."
RUN pnpm exec turbo run build --filter="@aios/gateway..."
# Paket produksi berdiri sendiri: dist, drizzle, dan dependensi runtime saja (tanpa devDependencies).
RUN pnpm --filter @aios/gateway deploy --legacy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Opsional: DeepSeek Harness (dsh, developer preview, tidak diaudit) untuk engine `dsh`. Kosong = tidak dipasang.
# Versi dikunci lewat build arg (docs/RUNBOOK_DSH.md): DSH_VERSION=0.2.1-rc.5 docker compose build gateway
ARG DSH_VERSION=
RUN if [ -n "$DSH_VERSION" ]; then npm install -g "@deepseek-ai/dsh@${DSH_VERSION}"; fi \
    && mkdir -p /dsh/home /dsh/work && chown -R node:node /dsh
# Pengguna non-root bawaan image node (uid 1000). Gateway tidak menulis ke disk (kecuali /dsh bila engine dsh dipakai).
USER node
# Dengan network_mode: host tidak ada EXPOSE; port diatur PORT (default 3000) dan hanya di loopback.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
