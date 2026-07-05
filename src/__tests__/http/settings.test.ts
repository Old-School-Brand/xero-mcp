/*
 * Task: 1.3 — src/http/settings.ts — Zod env schema with discriminated union
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - Example 17: Missing required env var at startup crashes with name (AC AC-8)
 *   - Example 18: Settings: local mode requires DEV_BEARER_TOKEN (AC AC-8 local variant)
 *
 * Test plan:
 *   - test_local_missing_dev_bearer_throws_naming_field: loadSettings() with ENVIRONMENT=local and no DEV_BEARER_TOKEN throws ZodError naming DEV_BEARER_TOKEN
 *   - test_nonlocal_missing_entra_tenant_id_throws_naming_field: loadSettings() with ENVIRONMENT=development and no ENTRA_TENANT_ID throws ZodError naming ENTRA_TENANT_ID
 *   - test_valid_local_settings_returns_local_settings: loadSettings() with valid local env returns LocalSettings with ENVIRONMENT === "local"
 *   - test_valid_nonlocal_settings_returns_nonlocal_settings: loadSettings() with all non-local fields returns NonLocalSettings
 *   - test_defaults_applied: loadSettings() applies defaults for optional fields
 *
 * Note: test_nonlocal_missing_entra_secret_throws_naming_field renamed to
 * test_nonlocal_missing_entra_tenant_id_throws_naming_field (iteration 3 fix) — ENTRA_CLIENT_SECRET
 * was removed from the schema (it was validated but never consumed; token verification uses Entra's
 * JWKS public keys). ENTRA_TENANT_ID is now the tested required field. See review.md finding #2.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZodError } from "zod";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadSettings", () => {
  it("test_local_missing_dev_bearer_throws_naming_field", async () => {
    vi.stubEnv("ENVIRONMENT", "local");
    vi.stubEnv("DEV_BEARER_TOKEN", "");

    const { loadSettings } = await import("../../http/settings.js");
    expect(() => loadSettings()).toThrow(ZodError);

    try {
      loadSettings();
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const zodErr = err as ZodError;
      const paths = zodErr.issues.map((i) => i.path.join("."));
      expect(paths).toContain("DEV_BEARER_TOKEN");
    }
  });

  it("test_nonlocal_missing_entra_tenant_id_throws_naming_field", async () => {
    vi.stubEnv("ENVIRONMENT", "development");
    vi.stubEnv("ENTRA_TENANT_ID", "");
    vi.stubEnv("ENTRA_CLIENT_ID", "client-id");
    vi.stubEnv("MCP_SERVER_URL", "https://example.com");
    vi.stubEnv("ENTRA_REQUIRED_SCOPES", "mcp");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");

    const { loadSettings } = await import("../../http/settings.js");
    expect(() => loadSettings()).toThrow(ZodError);

    try {
      loadSettings();
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const zodErr = err as ZodError;
      const paths = zodErr.issues.map((i) => i.path.join("."));
      expect(paths).toContain("ENTRA_TENANT_ID");
    }
  });

  it("test_valid_local_settings_returns_local_settings", async () => {
    vi.stubEnv("ENVIRONMENT", "local");
    vi.stubEnv("DEV_BEARER_TOKEN", "test-token");

    const { loadSettings } = await import("../../http/settings.js");
    const settings = loadSettings();

    expect(settings.ENVIRONMENT).toBe("local");
    if (settings.ENVIRONMENT === "local") {
      expect(settings.DEV_BEARER_TOKEN).toBe("test-token");
    }
  });

  it("test_valid_nonlocal_settings_returns_nonlocal_settings", async () => {
    vi.stubEnv("ENVIRONMENT", "development");
    vi.stubEnv("ENTRA_TENANT_ID", "tenant-123");
    vi.stubEnv("ENTRA_CLIENT_ID", "client-456");
    vi.stubEnv("ENTRA_CLIENT_SECRET", "entra-secret-value");
    vi.stubEnv("MCP_SERVER_URL", "https://xero-mcp.example.com");
    vi.stubEnv("ENTRA_REQUIRED_SCOPES", "mcp");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");

    const { loadSettings } = await import("../../http/settings.js");
    const settings = loadSettings();

    expect(settings.ENVIRONMENT).toBe("development");
    if (settings.ENVIRONMENT !== "local") {
      expect(settings.ENTRA_TENANT_ID).toBe("tenant-123");
      expect(settings.ENTRA_CLIENT_ID).toBe("client-456");
      expect(settings.ENTRA_CLIENT_SECRET).toBe("entra-secret-value");
    }
  });

  it("test_nonlocal_missing_entra_client_secret_throws_naming_field", async () => {
    vi.stubEnv("ENVIRONMENT", "development");
    vi.stubEnv("ENTRA_TENANT_ID", "tenant-123");
    vi.stubEnv("ENTRA_CLIENT_ID", "client-456");
    vi.stubEnv("ENTRA_CLIENT_SECRET", "");
    vi.stubEnv("MCP_SERVER_URL", "https://xero-mcp.example.com");
    vi.stubEnv("ENTRA_REQUIRED_SCOPES", "mcp");
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");

    const { loadSettings } = await import("../../http/settings.js");
    expect(() => loadSettings()).toThrow(ZodError);

    try {
      loadSettings();
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const zodErr = err as ZodError;
      const paths = zodErr.issues.map((i) => i.path.join("."));
      expect(paths).toContain("ENTRA_CLIENT_SECRET");
    }
  });

  it("test_defaults_applied", async () => {
    vi.stubEnv("ENVIRONMENT", "local");
    vi.stubEnv("DEV_BEARER_TOKEN", "tok");

    const { loadSettings } = await import("../../http/settings.js");
    const settings = loadSettings();

    expect(settings.MCP_BIND_HOST).toBe("0.0.0.0");
    expect(settings.MCP_BIND_PORT).toBe(8000);
    expect(settings.LOG_LEVEL).toBe("info");
    expect(settings.MCP_SESSION_IDLE_TIMEOUT_SECONDS).toBe(1800);
    expect(settings.MCP_MAX_SESSIONS).toBe(100);
  });
});
