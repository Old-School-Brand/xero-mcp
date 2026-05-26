import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type pino from "pino";
import { ToolFactory } from "../tools/tool-factory.js";

export class SessionCapError extends Error {
  constructor() {
    super("Session cap reached");
    this.name = "SessionCapError";
  }
}

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
};

type SessionManagerOptions = {
  maxSessions: number;
  idleTimeoutMs: number;
  serverIdentity: { name: string; version: string };
  logger: pino.Logger;
};

export class SessionManager {
  private readonly sessions: Map<string, SessionEntry> = new Map();
  private readonly maxSessions: number;
  private readonly idleTimeoutMs: number;
  private readonly serverIdentity: { name: string; version: string };
  private readonly logger: pino.Logger;

  constructor({ maxSessions, idleTimeoutMs, serverIdentity, logger }: SessionManagerOptions) {
    this.maxSessions = maxSessions;
    this.idleTimeoutMs = idleTimeoutMs;
    this.serverIdentity = serverIdentity;
    this.logger = logger;
  }

  async createSession(): Promise<{ sessionId: string; transport: StreamableHTTPServerTransport }> {
    if (this.sessions.size >= this.maxSessions) {
      throw new SessionCapError();
    }

    const sessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      onsessionclosed: () => this.deleteSession(sessionId),
    });

    const server = new McpServer(this.serverIdentity);
    ToolFactory(server);
    await server.connect(transport);

    this.sessions.set(sessionId, { transport, server, lastActivity: Date.now() });
    this.logger.info({ sessionId }, "session_created");

    return { sessionId, transport };
  }

  getSession(sessionId: string): SessionEntry | undefined {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.lastActivity = Date.now();
    }
    return entry;
  }

  deleteSession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return; // Already removed — re-entrant call, return immediately
    }
    // Remove from map BEFORE calling transport.close() to prevent re-entrant infinite loop.
    // transport.close() fires onsessionclosed which calls deleteSession again;
    // the re-entrant call finds no entry and returns immediately.
    this.sessions.delete(sessionId);
    this.logger.info({ sessionId }, "session_closed");
    entry.transport.close();
  }

  evictIdleSessions(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastActivity > this.idleTimeoutMs) {
        this.logger.info({ sessionId }, "session_evicted");
        this.deleteSession(sessionId);
      }
    }
  }

  startEvictionTimer(): NodeJS.Timeout {
    return setInterval(() => this.evictIdleSessions(), 60_000).unref();
  }

  get size(): number {
    return this.sessions.size;
  }
}
