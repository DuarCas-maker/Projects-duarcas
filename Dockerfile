# No credentials or user data are passed to the image build.
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional --no-audit --no-fund
COPY . .
RUN npm run build:docker

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 PROJECT_OS_DATA_DIR=/data PROJECT_OS_REQUIRE_AUXILIARY_IMPORT=true
COPY --from=builder --chown=node:node /app/.next-node/standalone ./
COPY --from=builder --chown=node:node /app/.next-node/static ./.next-node/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/runtime ./runtime
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts/start-node.mjs ./scripts/start-node.mjs
COPY --from=builder --chown=node:node /app/scripts/import-auxiliary.mjs ./scripts/import-auxiliary.mjs
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-node.mjs"]
