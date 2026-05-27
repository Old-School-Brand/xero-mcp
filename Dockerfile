# check=skip=SecretsUsedInArgOrEnv
# XERO_TOKEN_FILE is a filesystem path (location of the token file), not a
# secret value. BuildKit flags ENV vars whose names contain "token" — this
# directive suppresses that false positive while keeping the env-var contract
# intact (xero-client.ts reads XERO_TOKEN_FILE at runtime).

# ── Builder stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts prevents the `prepare` script (npm run build) from running
# before src/ is copied; the explicit build step below handles compilation.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 appgroup \
 && useradd -u 10001 -g appgroup -s /sbin/nologin -M appuser \
 && chown -R appuser:appgroup /app

COPY --from=builder --chown=appuser:appgroup /app/dist ./dist/
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules/
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

ENV XERO_TOKEN_FILE=/app/.xero-mcp/refresh_token
ENV MCP_BIND_HOST=0.0.0.0
ENV MCP_BIND_PORT=8000

EXPOSE 8000

# Note: `node -e "require('http')..."` runs in CommonJS mode regardless of
# package.json "type": "module" — this is correct behaviour for node -e.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); const req = http.get('http://localhost:8000/livez', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1));"

USER 10001:10001
ENTRYPOINT ["node", "/app/dist/http/server.js"]
