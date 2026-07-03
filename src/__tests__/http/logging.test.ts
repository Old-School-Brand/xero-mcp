/*
 * Task: 1.4 — src/http/logging.ts — Pino logger and pino-http middleware factory
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - Example 21: Pino request log is valid JSON (AC AC-18)
 *
 * Test plan:
 *   - test_create_logger_returns_logger_with_debug_method: createLogger("debug") returns an object with a debug method
 *   - test_create_http_logger_returns_middleware_function: createHttpLogger(logger) returns a function (Express middleware)
 *   - test_health_paths_are_ignored_in_auto_logging: autoLogging.ignore predicate returns true for /livez and /readyz, false for /mcp
 *   - test_pino_http_request_produces_valid_json_log: HTTP request through createHttpLogger produces a JSON log line with required fields
 *
 * Note: test_health_paths_are_ignored_in_auto_logging was rewritten (finding #19 in review.md)
 * to actually verify the ignore predicate behaviour rather than asserting duplicate structural checks.
 * Exempted from test-immutability rule: the original assertion was a duplicate of earlier tests and
 * did not verify what the test name claimed.
 *
 * Note: test_pino_http_request_produces_valid_json_log strengthened (iteration 3 finding #6) to assert
 * specific values for method, url, and statusCode rather than toBeDefined(), and to drain the stream
 * synchronously via dest.once('finish') instead of a fixed setTimeout. Exempted per review.md finding #6.
 */

import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import express from "express";
import request from "supertest";

// Capture the ignore predicate from pinoHttp options before any tests run.
// We hoist the captured value so it's available in the test body.
let capturedIgnore: ((req: { url?: string }) => boolean) | undefined;

vi.mock("pino-http", async (importOriginal) => {
  const actual = await importOriginal<{ pinoHttp: (opts: unknown) => unknown }>();
  return {
    pinoHttp: (options: unknown) => {
      const opts = options as {
        autoLogging?: { ignore?: (req: { url?: string }) => boolean };
      };
      if (opts?.autoLogging?.ignore) {
        capturedIgnore = opts.autoLogging.ignore;
      }
      return actual.pinoHttp(options);
    },
  };
});

import { createLogger, createHttpLogger } from "../../http/logging.js";

describe("logging", () => {
  it("test_create_logger_returns_logger_with_debug_method", () => {
    const logger = createLogger("debug");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("test_create_http_logger_returns_middleware_function", () => {
    const logger = createLogger("info");
    const middleware = createHttpLogger(logger);
    expect(typeof middleware).toBe("function");
  });

  it("test_health_paths_are_ignored_in_auto_logging", () => {
    // Ensure createHttpLogger has been called at least once to populate capturedIgnore.
    // (The previous tests already called it, but call again to be explicit.)
    const logger = createLogger("info");
    createHttpLogger(logger);

    expect(capturedIgnore).toBeDefined();
    // /livez and /readyz must be silenced (probe-spam suppression, FR-18)
    expect(capturedIgnore!({ url: "/livez" })).toBe(true);
    expect(capturedIgnore!({ url: "/readyz" })).toBe(true);
    // /mcp and other paths must not be suppressed
    expect(capturedIgnore!({ url: "/mcp" })).toBe(false);
    expect(capturedIgnore!({ url: "/" })).toBe(false);
  });

  it("test_pino_http_request_produces_valid_json_log", async () => {
    // Verify that an HTTP request through createHttpLogger produces a JSON log line
    // containing the required fields: level, time, msg, method, url, statusCode, responseTime.
    const lines: string[] = [];
    const dest = new PassThrough();
    dest.on("data", (chunk: Buffer) => {
      lines.push(...chunk.toString().trim().split("\n").filter(Boolean));
    });

    // Build a pino logger that writes to our in-memory stream
    const { default: pino } = await import("pino");
    const logger = pino({ level: "info" }, dest);
    const middleware = createHttpLogger(logger);

    const app = express();
    app.use(middleware);
    app.get("/test", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get("/test");

    // Drain the stream synchronously — wait for pino to flush via stream finish
    await new Promise<void>((resolve) => {
      dest.once("finish", resolve);
      dest.end();
    });

    expect(lines.length).toBeGreaterThan(0);

    // Find a log line that contains request data
    const logLine = lines.find((l) => {
      try {
        const parsed = JSON.parse(l) as Record<string, unknown>;
        return parsed["req"] !== undefined;
      } catch {
        return false;
      }
    });

    expect(logLine).toBeDefined();
    const log = JSON.parse(logLine!) as Record<string, unknown>;
    // pino uses numeric levels in JSON output
    expect(typeof log["level"]).toBe("number");
    expect(log["time"]).toBeDefined();
    expect(log["msg"]).toBeDefined();
    // pino-http serializes request with specific values
    const req = log["req"] as Record<string, unknown>;
    expect(req["method"]).toBe("GET");
    expect(req["url"]).toBe("/test");
    // pino-http serializes response status with specific value
    const res = log["res"] as Record<string, unknown>;
    expect(res["statusCode"]).toBe(200);
    expect(log["responseTime"]).toBeDefined();
  });
});
