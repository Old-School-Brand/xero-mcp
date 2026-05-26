#!/usr/bin/env node
import { createRequire } from "node:module";
import express from "express";
import { createClient } from "redis";
import type { RedisClientType } from "redis";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import { xeroClient } from "../clients/xero-client.js";
import { loadSettings } from "./settings.js";
import type { NonLocalSettings } from "./settings.js";
import { createLogger, createHttpLogger } from "./logging.js";
import { createHealthRouter } from "./health.js";
import { SessionManager, SessionCapError } from "./sessions.js";
import { buildAuth } from "./auth/build.js";
import { STARTUP_PROBE_JWT } from "./auth/entra-verifier.js";

// package.json is read directly here rather than via the upstream get-package-version helper
// because we need both `name` and `version`. The upstream helper only reads `version`, and
// modifying it would violate the upstream isolation convention (src/helpers/ is upstream-owned).
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { name: string; version: string };
const SERVER_IDENTITY = Object.freeze({ name: pkg.name, version: pkg.version });

/** Strip credentials from a Redis URL for safe use in error messages and logs. */
function safeRedisUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.password = "";
    u.username = "";
    return u.toString();
  } catch {
    return "<invalid REDIS_URL>";
  }
}

export async function createApp() {
  const settings = loadSettings();
  const logger = createLogger(settings.LOG_LEVEL);
  const httpLogger = createHttpLogger(logger);

  let xeroReady = false;
  await xeroClient.authenticate();
  xeroReady = true;

  // Outer-scope declarations: assigned inside the if/else branches, consumed after.
  let redisClient: RedisClientType | undefined;
  let verifier: OAuthTokenVerifier | undefined;
  let requiredScopes: string[];
  let resourceMetadataUrl: string | undefined;
  let provider: ProxyOAuthServerProvider | undefined;
  let serverUrl: URL | undefined;

  if (settings.ENVIRONMENT === "local") {
    // Local: static bearer auth only — no Redis, no Entra JWKS probe.
    const auth = buildAuth(settings);
    verifier = auth.verifier;
    requiredScopes = auth.requiredScopes;
  } else {
    // Non-local: Redis startup probe → Entra JWKS probe → auth wiring.
    const nonLocal = settings as NonLocalSettings;
    serverUrl = new URL(nonLocal.MCP_SERVER_URL);

    redisClient = createClient({ url: nonLocal.REDIS_URL }) as unknown as RedisClientType;
    try {
      await redisClient.connect();
      await redisClient.ping();
    } catch {
      throw new Error(`Redis unreachable: ${safeRedisUrl(nonLocal.REDIS_URL)}`);
    }

    const auth = buildAuth(nonLocal, redisClient);
    verifier = auth.verifier;
    requiredScopes = auth.requiredScopes;
    provider = auth.provider;
    resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(serverUrl);

    // Warm the Entra JWKS at startup — discriminates "JWKS reachable" from "unreachable".
    // InvalidTokenError means the probe succeeded (JWKS endpoint reached, sentinel correctly
    // rejected). Any other error (e.g. TypeError("fetch failed")) means unreachable.
    // Use auth.verifier.jwksUrl so the URL template lives in exactly one place.
    try {
      await verifier.verifyAccessToken(STARTUP_PROBE_JWT);
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        // Probe succeeded — JWKS endpoint reachable, sentinel correctly rejected
      } else {
        throw new Error(`Entra JWKS unreachable: ${auth.verifier.jwksUrl}`);
      }
    }
  }

  // Express app assembled once — shared by both local and non-local paths.
  const sessionManager = new SessionManager({
    maxSessions: settings.MCP_MAX_SESSIONS,
    idleTimeoutMs: settings.MCP_SESSION_IDLE_TIMEOUT_SECONDS * 1000,
    serverIdentity: SERVER_IDENTITY,
    logger,
  });

  const app = express();
  app.use(express.json());
  app.use(httpLogger);
  app.use(createHealthRouter({ isXeroReady: () => xeroReady, redisClient }));

  // Mount mcpAuthRouter only in non-local mode (provider and serverUrl are set together).
  if (provider && serverUrl) {
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: serverUrl,
        baseUrl: serverUrl,
        resourceServerUrl: serverUrl,
        scopesSupported: requiredScopes,
        clientRegistrationOptions: {
          // clientIdGeneration: false — RedisOAuthClientsStore is the sole owner of client_id
          clientSecretExpirySeconds: 60 * 60 * 24 * 365,
          clientIdGeneration: false,
        },
      }),
    );
  }

  // Fail loud rather than rely on a non-null assertion: both branches above
  // always assign verifier, so reaching here without one is a programming error.
  if (!verifier) {
    throw new Error("verifier not initialised — programming error");
  }
  const authMiddleware = requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl });
  const mcpHandler = buildMcpHandler(sessionManager);

  app.post("/mcp", authMiddleware, mcpHandler);
  app.get("/mcp", authMiddleware, mcpHandler);
  app.delete("/mcp", authMiddleware, mcpHandler);

  sessionManager.startEvictionTimer();

  return { app, sessionManager, settings, logger };
}

/** Build the /mcp request handler for a given session manager. */
function buildMcpHandler(sessionManager: SessionManager): express.RequestHandler {
  return async (req, res) => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    // Guard against duplicate header (Node types this as string | string[] | undefined)
    if (Array.isArray(sessionIdHeader)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Mcp-Session-Id must be a single value" },
        id: null,
      });
      return;
    }
    const sessionId = sessionIdHeader as string | undefined;

    if (!sessionId) {
      // No session ID — must be an initialize request; reject non-initialize without allocating
      const body = req.body as Record<string, unknown> | undefined;
      if (body?.["method"] !== "initialize") {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Missing Mcp-Session-Id header" },
          id: null,
        });
        return;
      }
      try {
        const { transport } = await sessionManager.createSession();
        await transport.handleRequest(req, res, req.body as unknown);
      } catch (err) {
        if (err instanceof SessionCapError) {
          res.status(503).json({ error: "session_cap_reached" });
          return;
        }
        throw err;
      }
    } else {
      const entry = sessionManager.getSession(sessionId);
      if (!entry) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session not found" },
          id: null,
        });
        return;
      }
      await entry.transport.handleRequest(req, res, req.body as unknown);
    }
  };
}

// Only run the server when executed directly — not when imported by tests
if (!process.env["VITEST"]) {
  const main = async () => {
    const { app, settings, logger } = await createApp();
    app.listen(settings.MCP_BIND_PORT, settings.MCP_BIND_HOST, () => {
      logger.info(
        { host: settings.MCP_BIND_HOST, port: settings.MCP_BIND_PORT },
        "server_started",
      );
    });
  };

  main().catch((err: unknown) => {
    const fallbackLogger = createLogger("fatal");
    fallbackLogger.fatal(err, "Fatal startup error");
    process.exit(1);
  });
}
