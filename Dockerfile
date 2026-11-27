FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci
COPY next.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3020 \
    AGENDADOR_DB_PATH=/app/data/agendador.sqlite

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY scripts/create-admin.mjs ./scripts/create-admin.mjs
COPY src/lib/local-store.ts ./src/lib/local-store.ts
RUN install -d -m 0700 -o node -g node /app/data

USER node
EXPOSE 3020
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3020') + '/', { signal: AbortSignal.timeout(4000) }).then(r => { if (!r.ok) process.exitCode = 1 }).catch(() => { process.exitCode = 1 })"]
CMD ["node", "server.js"]
