/*
 * Task: 1.6 — src/http/health.ts — /livez and /readyz Express router
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - Example 4: /livez always returns 200 (AC AC-3)
 *   - Example 5: /readyz returns 503 when Xero not initialised (AC AC-16)
 *   - Example 6: /readyz returns 503 when Redis ping fails (AC AC-17)
 *   - Example 7: /readyz returns 200 when all healthy (AC AC-3 implied)
 *   - Example 8: /readyz skips Redis check in local mode (AC AC-3 implied)
 *
 * Test plan:
 *   - test_livez_always_returns_200: GET /livez returns 200 {"status":"ok"}
 *   - test_readyz_returns_503_xero_when_not_initialised: GET /readyz returns 503 {"status":"unavailable","reason":"xero"} when isXeroReady() is false
 *   - test_readyz_returns_503_redis_when_ping_fails: GET /readyz returns 503 {"status":"unavailable","reason":"redis"} when redisClient.ping() rejects
 *   - test_readyz_returns_200_when_all_healthy: GET /readyz returns 200 {"status":"ok"} when xero ready and redis ping succeeds
 *   - test_readyz_returns_200_when_no_redis_client_local_mode: GET /readyz returns 200 {"status":"ok"} when xero ready and no redis client
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHealthRouter } from "../../http/health.js";

function buildApp(deps: Parameters<typeof createHealthRouter>[0]) {
  const app = express();
  app.use(createHealthRouter(deps));
  return app;
}

describe("health router", () => {
  it("test_livez_always_returns_200", async () => {
    const app = buildApp({ isXeroReady: () => false });
    const res = await request(app).get("/livez");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("test_readyz_returns_503_xero_when_not_initialised", async () => {
    const app = buildApp({ isXeroReady: () => false });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", reason: "xero" });
  });

  it("test_readyz_returns_503_redis_when_ping_fails", async () => {
    const redisMock = { ping: vi.fn().mockRejectedValue(new Error("Connection refused")) };
    const app = buildApp({ isXeroReady: () => true, redisClient: redisMock });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", reason: "redis" });
  });

  it("test_readyz_returns_200_when_all_healthy", async () => {
    const redisMock = { ping: vi.fn().mockResolvedValue("PONG") };
    const app = buildApp({ isXeroReady: () => true, redisClient: redisMock });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("test_readyz_returns_200_when_no_redis_client_local_mode", async () => {
    // No redisClient (local mode) — Redis check is skipped
    const app = buildApp({ isXeroReady: () => true });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
