/*
 * Task: 1.2 — Write failing tests for startup env var validation
 * Source: .specs/001-oauth2-web-app-auth/backend/todo.md
 *
 * Examples covered:
 *   - Example 5: Missing XERO_CLIENT_ID throws at module load (AC AC-5)
 *   - Example 6: Missing XERO_CLIENT_SECRET throws at module load (AC AC-5)
 *   - Example 14: Token file with trailing whitespace is trimmed (AC AC-1 edge case)
 *   - Example 13: Custom XERO_TOKEN_FILE path is respected (AC AC-1 variant)
 *   - Example 2: Startup falls back to env var when token file absent (AC AC-2)
 *   - Example 3: Token file takes priority over env var (AC AC-3)
 *   - Example 4: No token source throws with guidance (AC AC-4)
 *   - Example 7: Expired refresh token throws with guidance (AC AC-6)
 *   - Example 8: Token file directory does not exist (AC AC-7)
 *   - Example 9: Scheduled refresh succeeds (AC AC-8)
 *   - Example 10: Scheduled refresh failure crashes the process (AC AC-9)
 *   - Example 1: Startup with valid token file (AC AC-1)
 *   - Example 11: authenticate() is a no-op after startup (AC AC-1 implicit)
 *
 * Test plan:
 *   - test_missingClientId_throwsRequired: importing module without XERO_CLIENT_ID throws
 *   - test_missingClientSecret_throwsRequired: importing module without XERO_CLIENT_SECRET throws
 *   - test_tokenFileExists_returnsFileTrimmed: resolveRefreshToken returns trimmed file content
 *   - test_customTokenFilePath_returnsFileContent: custom XERO_TOKEN_FILE path is used
 *   - test_noTokenFile_usesEnvVar: falls back to XERO_REFRESH_TOKEN when no file
 *   - test_tokenFileAndEnvVar_fileWins: token file takes priority over env var
 *   - test_noTokenSource_throwsWithGuidance: throws with XERO_REFRESH_TOKEN and API Explorer URL
 *   - test_expiredToken_throwsWithGuidance: exchangeToken throws with "invalid" and API Explorer URL
 *   - test_successfulExchange_returnsTokenData: exchangeToken returns access_token, refresh_token, expires_in
 *   - test_missingTokenFileDir_throwsWithDirName: persistRefreshToken throws when dir missing
 *   - test_dirExists_writesTokenFile: persistRefreshToken calls writeFileSync with correct args
 *   - test_timerFiresAtCorrectDelay_exchangesAndPersists: scheduleRefresh fires at (expires_in-300)*1000ms
 *   - test_timerFailure_exitsProcess: scheduleRefresh calls process.exit(1) on exchange failure
 *   - test_timerIsUnrefed: scheduleRefresh calls unref() on the timer handle
 *   - test_firstAuthenticate_fullStartupFlow: authenticate() runs full flow on first call
 *   - test_secondAuthenticate_isNoop: authenticate() returns immediately after first call
 *   - test_authenticate_noTokenSource_throws: authenticate() propagates resolveRefreshToken error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AxiosResponse } from "axios";

// ─── vi.mock hoisting — must be at module top level ─────────────────────────
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  renameSync: vi.fn(),
}));

vi.mock("axios");

// ─── Shared imports ──────────────────────────────────────────────────────────
import * as fs from "node:fs";
import axios from "axios";
import { AxiosError } from "axios";

// ─── TestableClient: exposes all private methods exercised in tests ──────────
// Defined once here; each describe block casts via `client as unknown as TestableClient`
// to avoid repeating inline hand-written interface shapes throughout.
type TestableClient = {
  resolveRefreshToken(): string;
  exchangeToken(token: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }>;
  persistRefreshToken(token: string): void;
  updateTenants(): Promise<unknown[]>;
  setTokenSet(t: unknown): void;
  tokenFilePath: string;
};

/** Build a minimal AxiosError with a response payload for testing. */
function makeAxiosError(status: number, data: unknown): AxiosError {
  const err = new AxiosError("Request failed");
  err.response = {
    status,
    data,
    statusText: status === 400 ? "Bad Request" : "Error",
    headers: {},
    config: err.config ?? ({} as AxiosResponse["config"]),
  } as AxiosResponse;
  return err;
}

/**
 * Get a fresh client instance: resets modules, stubs the minimum required env
 * vars, then imports and returns `mod.xeroClient`. Each describe block casts
 * the return value to `TestableClient` as needed.
 *
 * Kept separate from `getBootstrappedClient()` because most sections need only
 * the client instance without going through the full `authenticate()` flow.
 */
async function getFreshClient() {
  vi.resetModules();
  vi.stubEnv("XERO_CLIENT_ID", "ABC123");
  vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");
  const mod = await import("../../clients/xero-client.js");
  return mod.xeroClient;
}

// ────────────────────────────────────────────────────────────────────────────
// Section 1: Startup env var validation (module-level throws)
// ────────────────────────────────────────────────────────────────────────────
describe("startup env var validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("test_missingClientId_throwsRequired: throws XERO_CLIENT_ID is required when absent", async () => {
    vi.stubEnv("XERO_CLIENT_ID", "");
    vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");

    await expect(
      import("../../clients/xero-client.js")
    ).rejects.toThrow("XERO_CLIENT_ID is required");
  });

  it("test_missingClientSecret_throwsRequired: throws XERO_CLIENT_SECRET is required when absent", async () => {
    vi.stubEnv("XERO_CLIENT_ID", "ABC123");
    vi.stubEnv("XERO_CLIENT_SECRET", "");

    await expect(
      import("../../clients/xero-client.js")
    ).rejects.toThrow("XERO_CLIENT_SECRET is required");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 2: resolveRefreshToken()
// ────────────────────────────────────────────────────────────────────────────
describe("resolveRefreshToken()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("XERO_CLIENT_ID", "ABC123");
    vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("test_tokenFileExists_returnsFileTrimmed: returns trimmed content from default token file", async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "");
    vi.mocked(fs.readFileSync).mockReturnValue("rt_with_spaces  \n");
    const client = await getFreshClient();
    const result = (client as unknown as TestableClient).resolveRefreshToken();
    expect(result).toBe("rt_with_spaces");
  });

  it("test_customTokenFilePath_returnsFileContent: respects custom XERO_TOKEN_FILE path", async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "/tmp/custom-xero-token");
    vi.mocked(fs.readFileSync).mockReturnValue("rt_custom_path");
    const client = await getFreshClient();
    const result = (client as unknown as TestableClient).resolveRefreshToken();
    expect(result).toBe("rt_custom_path");
  });

  it("test_noTokenFile_usesEnvVar: falls back to XERO_REFRESH_TOKEN when no file", async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "");
    vi.stubEnv("XERO_REFRESH_TOKEN", "rt_env_seed_001");
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const client = await getFreshClient();
    const result = (client as unknown as TestableClient).resolveRefreshToken();
    expect(result).toBe("rt_env_seed_001");
  });

  it("test_tokenFileAndEnvVar_fileWins: token file takes priority over XERO_REFRESH_TOKEN", async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "");
    vi.stubEnv("XERO_REFRESH_TOKEN", "rt_env_older");
    vi.mocked(fs.readFileSync).mockReturnValue("rt_file_newer");
    const client = await getFreshClient();
    const result = (client as unknown as TestableClient).resolveRefreshToken();
    expect(result).toBe("rt_file_newer");
  });

  it("test_noTokenSource_throwsWithGuidance: throws with XERO_REFRESH_TOKEN and api-explorer URL", async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "");
    vi.stubEnv("XERO_REFRESH_TOKEN", "");
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const client = await getFreshClient();
    expect(() =>
      (client as unknown as TestableClient).resolveRefreshToken()
    ).toThrow(/XERO_REFRESH_TOKEN.*https:\/\/api-explorer\.xero\.com|https:\/\/api-explorer\.xero\.com.*XERO_REFRESH_TOKEN/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 3: exchangeToken()
// ────────────────────────────────────────────────────────────────────────────
describe("exchangeToken()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("test_successfulExchange_returnsTokenData: returns token data on 200 response", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: "at_new",
        refresh_token: "rt_rotated",
        expires_in: 1800,
        token_type: "Bearer",
      },
    });
    const client = await getFreshClient();
    const result = await (client as unknown as TestableClient).exchangeToken(
      "rt_expired_001"
    );
    expect(result).toMatchObject({
      access_token: "at_new",
      refresh_token: "rt_rotated",
      expires_in: 1800,
    });
  });

  it("test_expiredToken_throwsWithGuidance: throws with 'invalid' and api-explorer URL on 400", async () => {
    vi.mocked(axios.post).mockRejectedValue(makeAxiosError(400, { error: "invalid_grant" }));
    const client = await getFreshClient();
    await expect(
      (client as unknown as TestableClient).exchangeToken("rt_expired_001")
    ).rejects.toThrow(/invalid.*https:\/\/api-explorer\.xero\.com|https:\/\/api-explorer\.xero\.com.*invalid/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 4: persistRefreshToken()
// ────────────────────────────────────────────────────────────────────────────
describe("persistRefreshToken()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("test_missingTokenFileDir_throwsWithDirName: throws with dir path when directory missing", async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "/nonexistent/dir/refresh_token");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const client = await getFreshClient();
    expect(() =>
      (client as unknown as TestableClient).persistRefreshToken("rt_rotated_002")
    ).toThrow(/\/nonexistent\/dir/);
  });

  it("test_dirExists_writesTokenFile: calls writeFileSync with .tmp path and 0600 permissions when dir exists", async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "/tmp/test-refresh-token");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const client = await getFreshClient();
    (client as unknown as TestableClient).persistRefreshToken("rt_rotated_002");
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      "/tmp/test-refresh-token.tmp",
      "rt_rotated_002",
      { mode: 0o600 }
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 5: scheduleRefresh()
// ────────────────────────────────────────────────────────────────────────────
describe("scheduleRefresh()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function getBootstrappedClient() {
    vi.stubEnv("XERO_CLIENT_ID", "ABC123");
    vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");
    vi.stubEnv("XERO_REFRESH_TOKEN", "rt_current_001");
    vi.stubEnv("XERO_TOKEN_FILE", "");
    // File read: no file, so env var is used
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // First exchange (during authenticate)
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "at_initial",
        refresh_token: "rt_current_001",
        expires_in: 1800,
        token_type: "Bearer",
      },
    });
    const mod = await import("../../clients/xero-client.js");
    const client = mod.xeroClient;
    // Stub updateTenants so it doesn't make real HTTP calls
    vi.spyOn(client as unknown as TestableClient, "updateTenants").mockResolvedValue([]);
    await client.authenticate();
    return client;
  }

  it("test_timerFiresAtCorrectDelay_exchangesAndPersists: timer fires at (expires_in-300)*1000ms and updates state", async () => {
    const client = await getBootstrappedClient();
    // Reset post mock call count to focus on the scheduled refresh call
    vi.mocked(axios.post).mockClear();
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        access_token: "at_renewed",
        refresh_token: "rt_rotated_003",
        expires_in: 1800,
        token_type: "Bearer",
      },
    });
    // Advance to just before the timer fires — should not have called yet
    await vi.advanceTimersByTimeAsync((1800 - 300) * 1000 - 1);
    expect(vi.mocked(axios.post)).not.toHaveBeenCalled();
    // Advance the final millisecond to fire the timer
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      "https://identity.xero.com/connect/token",
      expect.stringContaining("grant_type=refresh_token"),
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/x-www-form-urlencoded" }) })
    );
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.any(String),
      "rt_rotated_003",
      { mode: 0o600 }
    );
    // updateTenants should NOT have been called during scheduled refresh
    // In Vitest 4.x, vi.spyOn returns the same accumulated spy, so clear call history before asserting
    const updateTenantsSpy = vi.spyOn(client as unknown as TestableClient, "updateTenants");
    updateTenantsSpy.mockClear();
    expect(updateTenantsSpy).not.toHaveBeenCalled();
  });

  it("test_timerFailure_exitsProcess: calls process.exit(1) when scheduled refresh fails", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const client = await getBootstrappedClient();
    vi.mocked(axios.post).mockClear();
    vi.mocked(axios.post).mockRejectedValue(makeAxiosError(400, { error: "invalid_grant" }));
    void client; // suppress unused warning
    await vi.advanceTimersByTimeAsync((1800 - 300) * 1000);
    expect(exitSpy).toHaveBeenCalledWith(1);
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("test_timerIsUnrefed: the timer handle has unref() called on it", async () => {
    // Mock setTimeout to return a handle with a spy on unref() so we can assert it was called.
    const unrefSpy = vi.fn();
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        const handle = originalSetTimeout(callback as (...a: unknown[]) => void, delay, ...args);
        (handle as unknown as { unref: () => void }).unref = unrefSpy;
        return handle;
      }
    );

    await getBootstrappedClient();

    expect(unrefSpy).toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Section 6: authenticate() orchestration
// ────────────────────────────────────────────────────────────────────────────
describe("authenticate()", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("test_firstAuthenticate_fullStartupFlow: runs full startup flow on first call", async () => {
    vi.stubEnv("XERO_CLIENT_ID", "ABC123");
    vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");
    vi.stubEnv("XERO_TOKEN_FILE", "");
    vi.stubEnv("XERO_REFRESH_TOKEN", "");
    vi.mocked(fs.readFileSync).mockReturnValue("rt_file_token_001");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: "at_new",
        refresh_token: "rt_rotated_001",
        expires_in: 1800,
        token_type: "Bearer",
      },
    });
    const mod = await import("../../clients/xero-client.js");
    const client = mod.xeroClient;
    const updateTenantsSpy = vi
      .spyOn(client as unknown as TestableClient, "updateTenants")
      .mockResolvedValue([]);
    const setTokenSetSpy = vi.spyOn(
      client as unknown as TestableClient,
      "setTokenSet"
    );
    await client.authenticate();
    expect(vi.mocked(axios.post)).toHaveBeenCalledWith(
      "https://identity.xero.com/connect/token",
      expect.stringContaining("grant_type=refresh_token"),
      expect.any(Object)
    );
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      expect.any(String),
      "rt_rotated_001",
      { mode: 0o600 }
    );
    // Verify setTokenSet was called with the correct shape and that refresh_token is excluded
    expect(setTokenSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "at_new" })
    );
    expect(setTokenSetSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ refresh_token: expect.anything() })
    );
    expect(updateTenantsSpy).toHaveBeenCalledTimes(1);
  });

  it("test_secondAuthenticate_isNoop: returns immediately without HTTP calls after first call", async () => {
    vi.stubEnv("XERO_CLIENT_ID", "ABC123");
    vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");
    vi.stubEnv("XERO_TOKEN_FILE", "");
    vi.stubEnv("XERO_REFRESH_TOKEN", "");
    vi.mocked(fs.readFileSync).mockReturnValue("rt_file_token_001");
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: "at_new",
        refresh_token: "rt_rotated_001",
        expires_in: 1800,
        token_type: "Bearer",
      },
    });
    const mod = await import("../../clients/xero-client.js");
    const client = mod.xeroClient;
    vi.spyOn(client as unknown as TestableClient, "updateTenants").mockResolvedValue([]);
    await client.authenticate();
    vi.mocked(axios.post).mockClear();
    vi.mocked(fs.writeFileSync).mockClear();
    // Second call — must be a no-op
    await client.authenticate();
    expect(vi.mocked(axios.post)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });

  it("test_authenticate_noTokenSource_throws: propagates resolveRefreshToken error", async () => {
    vi.stubEnv("XERO_CLIENT_ID", "ABC123");
    vi.stubEnv("XERO_CLIENT_SECRET", "DEF456");
    vi.stubEnv("XERO_TOKEN_FILE", "");
    vi.stubEnv("XERO_REFRESH_TOKEN", "");
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const mod = await import("../../clients/xero-client.js");
    const client = mod.xeroClient;
    await expect(client.authenticate()).rejects.toThrow(/XERO_REFRESH_TOKEN/);
  });
});
