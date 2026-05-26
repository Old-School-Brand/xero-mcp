import pino from "pino";
import { pinoHttp } from "pino-http";
import type { IncomingMessage } from "node:http";

export function createLogger(level: string): pino.Logger {
  return pino({ level, timestamp: pino.stdTimeFunctions.isoTime });
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
      sessionId: req.headers["mcp-session-id"] ?? undefined,
    }),
    autoLogging: {
      ignore: (req: IncomingMessage) => ["/livez", "/readyz"].includes(req.url ?? ""),
    },
  });
}
