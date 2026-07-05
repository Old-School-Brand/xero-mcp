/*
 * Task: 1.1 & 1.2 — src/http/auth/redis-code-store.ts — Redis-backed txn/code store
 * Source: .specs/003-oauth-proxy-bridge/backend/todo.md
 *
 * Examples covered:
 *   - Example 4: Server code is single-use (store half)
 *   - Example 5: Expired server code fails (store half — missing key returns undefined)
 *
 * Test plan:
 *   - test_set_then_get_txn_round_trips_record: set("txn", id, rec, 600) + get("txn", id) round-trips the exact record under key oauth:txn:<id> with { EX: 600 }
 *   - test_del_then_get_txn_returns_undefined: del("txn", id) then get("txn", id) returns undefined
 *   - test_set_then_getAndDelete_code_round_trips_once: set("code", c, rec, 60) + getAndDelete("code", c) returns the record
 *   - test_getAndDelete_code_replay_returns_undefined: a second getAndDelete("code", c) returns undefined (already consumed)
 */

import { describe, it, expect, vi } from "vitest";
import { RedisOAuthCodeStore } from "../../../http/auth/redis-code-store.js";
import type { OAuthTransaction, OAuthServerCode } from "../../../http/auth/redis-code-store.js";

function makeRedisFake(data: Record<string, string> = {}) {
  return {
    get: vi.fn(async (key: string) => data[key] ?? null),
    set: vi.fn(async (key: string, value: string) => {
      data[key] = value;
    }),
    del: vi.fn(async (key: string) => {
      delete data[key];
    }),
    getDel: vi.fn(async (key: string) => {
      const value = data[key] ?? null;
      delete data[key];
      return value;
    }),
  };
}

const txnRecord: OAuthTransaction = {
  clientRedirectUri: "http://localhost:9999/callback",
  clientState: "client-state-xyz",
  clientCodeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  serverCodeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
};

const codeRecord: OAuthServerCode = {
  clientCodeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  clientRedirectUri: "http://localhost:9999/callback",
  tokens: { access_token: "entra-at-789", token_type: "Bearer" },
};

describe("RedisOAuthCodeStore", () => {
  it("test_set_then_get_txn_round_trips_record", async () => {
    const redis = makeRedisFake();
    const store = new RedisOAuthCodeStore(redis);

    await store.set("txn", "txn-123", txnRecord, 600);
    const result = await store.get("txn", "txn-123");

    expect(result).toEqual(txnRecord);
    expect(redis.set).toHaveBeenCalledWith("oauth:txn:txn-123", JSON.stringify(txnRecord), { EX: 600 });
  });

  it("test_del_then_get_txn_returns_undefined", async () => {
    const redis = makeRedisFake();
    const store = new RedisOAuthCodeStore(redis);

    await store.set("txn", "txn-123", txnRecord, 600);
    await store.del("txn", "txn-123");
    const result = await store.get("txn", "txn-123");

    expect(result).toBeUndefined();
  });

  it("test_set_then_getAndDelete_code_round_trips_once", async () => {
    const redis = makeRedisFake();
    const store = new RedisOAuthCodeStore(redis);

    await store.set("code", "code-abc", codeRecord, 60);
    const result = await store.getAndDelete("code", "code-abc");

    expect(result).toEqual(codeRecord);
    expect(redis.getDel).toHaveBeenCalledWith("oauth:code:code-abc");
  });

  it("test_getAndDelete_code_replay_returns_undefined", async () => {
    const redis = makeRedisFake();
    const store = new RedisOAuthCodeStore(redis);

    await store.set("code", "code-abc", codeRecord, 60);
    await store.getAndDelete("code", "code-abc");
    const replay = await store.getAndDelete("code", "code-abc");

    expect(replay).toBeUndefined();
  });
});
