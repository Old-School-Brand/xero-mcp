import pino from "pino";
import { pinoHttp } from "pino-http";
import type { IncomingMessage } from "node:http";

export function createLogger(level: string): pino.Logger {
  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    // Redact Authorization headers unconditionally — covers both the custom serializer
    // success path and pino-http's error path which may emit raw request data.
    redact: ["req.headers.authorization", "req.headers.Authorization"],
  });
}

export function createHttpLogger(logger: pino.Logger) {
  return pinoHttp({
    logger,
    serializers: {
      req: (req: IncomingMessage & { url?: string; method?: string }) => ({
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({
        statusCode: res.statusCode,
      }),
    },
    customProps: (req: IncomingMessage & { headers: Record<string, string | string[] | undefined> }) => ({
      // [].flat()[0] normalises string | string[] | undefined → string | undefined,
      // handling the duplicate-header edge case before the MCP handler's array guard runs.
      sessionId: ([req.headers["mcp-session-id"]].flat()[0]) ?? undefined,
    }),
    autoLogging: {
      ignore: (req: IncomingMessage) => ["/livez", "/readyz"].includes(req.url ?? ""),
    },
  });
}
