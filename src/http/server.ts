#!/usr/bin/env node
import { createRequire } from "node:module";
import express from "express";
import { xeroClient } from "../clients/xero-client.js";
import { loadSettings } from "./settings.js";
import { createLogger, createHttpLogger } from "./logging.js";
import { createHealthRouter } from "./health.js";
import { SessionManager, SessionCapError } from "./sessions.js";

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

  // /mcp handler — Phase 1: no auth
  const mcpHandler: express.RequestHandler = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId) {
      // New session — must be an initialize request
      try {
        const { sessionId: newId, transport } = await sessionManager.createSession();
        await transport.handleRequest(req, res, req.body as unknown);
        logger.info({ sessionId: newId }, "session_request_handled");
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

  app.post("/mcp", mcpHandler);
  app.get("/mcp", mcpHandler);
  app.delete("/mcp", mcpHandler);

  sessionManager.startEvictionTimer();

  app.listen(settings.MCP_BIND_PORT, settings.MCP_BIND_HOST, () => {
    logger.info(
      { host: settings.MCP_BIND_HOST, port: settings.MCP_BIND_PORT },
      "server_started",
    );
  });
}

main().catch((err: unknown) => {
  // Create a fallback logger if main() fails before the logger is set up
  const fallbackLogger = createLogger("fatal");
  fallbackLogger.fatal(err, "Fatal startup error");
  process.exit(1);
});
