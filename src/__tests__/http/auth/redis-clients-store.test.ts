/*
 * Task: 3.1 — src/http/auth/redis-clients-store.ts — Redis-backed OAuthRegisteredClientsStore
 * Source: .specs/002-http-transport-and-oauth/backend/todo.md
 *
 * Examples covered:
 *   - Example 23: Redis-backed DCR store: getClient returns undefined for unknown ID (AC AC-11 prerequisite)
 *   - Example 24: Redis-backed DCR store: registerClient round-trips (AC AC-11)
 *
 * Test plan:
 *   - test_getClient_unknown_id_returns_undefined: getClient("nonexistent") returns undefined when get() returns null
 *   - test_registerClient_returns_full_client_with_uuid: registerClient() returns object with UUID client_id and unix timestamp
 *   - test_registerClient_calls_set_with_correct_key: registerClient() calls redis.set with key "oauth:clients:{uuid}"
 *   - test_getClient_returns_registered_client: getClient(client_id) returns the object stored by registerClient
 */

import { describe, it, expect, vi } from "vitest";
import { InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { RedisOAuthClientsStore } from "../../../http/auth/redis-clients-store.js";

function makeRedisFake(data: Record<string, string> = {}) {
  return {
    get: vi.fn(async (key: string) => data[key] ?? null),
    set: vi.fn(async (key: string, value: string) => {
      data[key] = value;
    }),
  };
}

describe("RedisOAuthClientsStore", () => {
  it("test_getClient_unknown_id_returns_undefined", async () => {
    const redis = makeRedisFake(); // empty store
    const store = new RedisOAuthClientsStore(redis);

    const result = await store.getClient("nonexistent-id");

    expect(result).toBeUndefined();
    expect(redis.get).toHaveBeenCalledWith("oauth:clients:nonexistent-id");
  });

  it("test_registerClient_returns_full_client_with_uuid", async () => {
    const redis = makeRedisFake();
    const store = new RedisOAuthClientsStore(redis);

    const clientInput = {
      client_name: "test-client",
      redirect_uris: ["http://localhost/callback"],
    };

    const result = await store.registerClient(clientInput);

    expect(result.client_id).toBeDefined();
    expect(typeof result.client_id).toBe("string");
    // UUID format: 8-4-4-4-12 hex chars
    expect(result.client_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(typeof result.client_id_issued_at).toBe("number");
    expect(result.client_id_issued_at).toBeGreaterThan(0);
    expect(result.client_name).toBe("test-client");
    expect(result.redirect_uris).toEqual(["http://localhost/callback"]);
  });

  it("test_registerClient_calls_set_with_correct_key", async () => {
    const redis = makeRedisFake();
    const store = new RedisOAuthClientsStore(redis);

    const result = await store.registerClient({
      client_name: "test",
      redirect_uris: ["http://localhost/cb"],
    });

    expect(redis.set).toHaveBeenCalledOnce();
    const [key, value] = redis.set.mock.calls[0]!;
    expect(key).toBe(`oauth:clients:${result.client_id}`);
    expect(JSON.parse(value as string)).toMatchObject({ client_id: result.client_id });
  });

  it("test_getClient_returns_registered_client", async () => {
    const data: Record<string, string> = {};
    const redis = makeRedisFake(data);
    const store = new RedisOAuthClientsStore(redis);

    // Register a client (writes to our in-memory data object)
    const registered = await store.registerClient({
      client_name: "round-trip-test",
      redirect_uris: ["http://localhost/callback"],
    });

    // get() stub uses the data object, so it returns the value written by set()
    const retrieved = await store.getClient(registered.client_id);

    expect(retrieved).toMatchObject({
      client_id: registered.client_id,
      client_name: "round-trip-test",
      redirect_uris: ["http://localhost/callback"],
    });
  });
});

// The OAuth-proxy bridge (ADR-0004) removes Entra from the client-redirect decision, so the
// server must vet redirect_uris at DCR registration. Loopback is always allowed (resolves to the
// client's own machine); non-loopback must exactly match the allow-list; anything else is rejected.
describe("RedisOAuthClientsStore — redirect_uri allow-list", () => {
  it("test_allows_loopback_localhost_dynamic_port", async () => {
    const store = new RedisOAuthClientsStore(makeRedisFake());
    const result = await store.registerClient({
      client_name: "claude-code",
      redirect_uris: ["http://localhost:53821/callback"], // Claude Code picks a random port
    });
    expect(result.redirect_uris).toEqual(["http://localhost:53821/callback"]);
  });

  it("test_allows_loopback_127_and_ipv6", async () => {
    const store = new RedisOAuthClientsStore(makeRedisFake());
    const r1 = await store.registerClient({ redirect_uris: ["http://127.0.0.1:8000/callback"] });
    const r2 = await store.registerClient({ redirect_uris: ["http://[::1]:9000/callback"] });
    expect(r1.redirect_uris).toEqual(["http://127.0.0.1:8000/callback"]);
    expect(r2.redirect_uris).toEqual(["http://[::1]:9000/callback"]);
  });

  it("test_allows_exact_claude_ai_callback", async () => {
    const store = new RedisOAuthClientsStore(makeRedisFake());
    const result = await store.registerClient({
      client_name: "claude-ai",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    });
    expect(result.redirect_uris).toEqual(["https://claude.ai/api/mcp/auth_callback"]);
  });

  it("test_rejects_arbitrary_https_host", async () => {
    const redis = makeRedisFake();
    const store = new RedisOAuthClientsStore(redis);
    await expect(
      store.registerClient({ redirect_uris: ["https://attacker.example/cb"] }),
    ).rejects.toBeInstanceOf(InvalidClientMetadataError);
    expect(redis.set).not.toHaveBeenCalled(); // rejected before persisting
  });

  it("test_rejects_mixed_good_and_evil_array_as_a_whole", async () => {
    const redis = makeRedisFake();
    const store = new RedisOAuthClientsStore(redis);
    await expect(
      store.registerClient({
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback", "https://attacker.example/cb"],
      }),
    ).rejects.toBeInstanceOf(InvalidClientMetadataError);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("test_rejects_non_loopback_http", async () => {
    const store = new RedisOAuthClientsStore(makeRedisFake());
    // http:// to a non-loopback host must be rejected (only the exact allow-list or loopback pass)
    await expect(
      store.registerClient({ redirect_uris: ["http://evil.example/callback"] }),
    ).rejects.toBeInstanceOf(InvalidClientMetadataError);
  });

  it("test_rejects_malformed_uri", async () => {
    const store = new RedisOAuthClientsStore(makeRedisFake());
    await expect(
      store.registerClient({ redirect_uris: ["not a url"] }),
    ).rejects.toBeInstanceOf(InvalidClientMetadataError);
  });

  it("test_rejects_empty_redirect_uris", async () => {
    const store = new RedisOAuthClientsStore(makeRedisFake());
    await expect(store.registerClient({ redirect_uris: [] })).rejects.toBeInstanceOf(
      InvalidClientMetadataError,
    );
  });

  it("test_accepts_custom_injected_allow_list", async () => {
    const store = new RedisOAuthClientsStore(makeRedisFake(), ["https://my.internal/cb"]);
    const result = await store.registerClient({ redirect_uris: ["https://my.internal/cb"] });
    expect(result.redirect_uris).toEqual(["https://my.internal/cb"]);
    // and the default claude.ai URI is NOT allowed when a custom list is injected
    await expect(
      store.registerClient({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }),
    ).rejects.toBeInstanceOf(InvalidClientMetadataError);
  });
});
