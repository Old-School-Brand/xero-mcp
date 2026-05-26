#!/usr/bin/env node
import { createRequire } from "node:module";
import express from "express";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { xeroClient } from "../clients/xero-client.js";
import { loadSettings } from "./settings.js";
import { createLogger, createHttpLogger } from "./logging.js";
import { createHealthRouter } from "./health.js";
import { SessionManager, SessionCapError } from "./sessions.js";
import { buildAuth } from "./auth/build.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pkg = require("../../package.json") as { name: string; version: string };
const SERVER_IDENTITY = Object.freeze({ name: pkg.name, version: pkg.version });

async function main() {
  const settings = loadSettings();
  const logger = createLogger(settings.LOG_LEVEL);
  const httpLogger = createHttpLogger(logger);

  let xeroReady = false;
  await xeroClient.authenticate();
  xeroReady = true;

  // Auth setup — local vs non-local
  let verifier: ReturnType<typeof buildAuth>["verifier"];
  let requiredScopes: string[];

  if (settings.ENVIRONMENT === "local") {
    const auth = buildAuth(settings);
    verifier = auth.verifier;
    requiredScopes = auth.requiredScopes;
  } else {
    // Non-local: Redis + Entra setup added in Task 3.4
    // For now this branch will throw; full implementation in Task 3.4
    throw new Error("Non-local mode not yet implemented — see Task 3.4");
  }

  const resourceMetadataUrl =
    settings.ENVIRONMENT !== "local"
      ? getOAuthProtectedResourceMetadataUrl(new URL((settings as { MCP_SERVER_URL: string }).MCP_SERVER_URL))
      : undefined;

  const sessionManager = new SessionManager({
    maxSessions: settings.MCP_MAX_SESSIONS,
    idleTimeoutMs: settings.MCP_SESSION_IDLE_TIMEOUT_SECONDS * 1000,
    serverIdentity: SERVER_IDENTITY,
    logger,
  });

  const app = express();
  app.use(express.json());
  app.use(httpLogger);

  const healthRouter = createHealthRouter({ isXeroReady: () => xeroReady });
  app.use(healthRouter);

  // /mcp handler with bearer auth
  const mcpHandler: express.RequestHandler = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId) {
      // New session — must be an initialize request
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

  app.post(
    "/mcp",
    requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl }),
    mcpHandler,
  );
  app.get(
    "/mcp",
    requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl }),
    mcpHandler,
  );
  app.delete(
    "/mcp",
    requireBearerAuth({ verifier, requiredScopes, resourceMetadataUrl }),
    mcpHandler,
  );

  sessionManager.startEvictionTimer();

  app.listen(settings.MCP_BIND_PORT, settings.MCP_BIND_HOST, () => {
    logger.info(
      { host: settings.MCP_BIND_HOST, port: settings.MCP_BIND_PORT },
      "server_started",
    );
  });
}

main().catch((err: unknown) => {
  const fallbackLogger = createLogger("fatal");
  fallbackLogger.fatal(err, "Fatal startup error");
  process.exit(1);
});
