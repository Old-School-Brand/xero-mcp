import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** The MCP client's redirect/state/PKCE plus the server's own PKCE for the Entra leg. */
export interface OAuthTransaction {
  clientRedirectUri: string;
  clientState: string;
  clientCodeChallenge: string;
  serverCodeVerifier: string;
}

/** A single-use server authorization code bound to the client's PKCE challenge and Entra tokens. */
export interface OAuthServerCode {
  clientCodeChallenge: string;
  clientRedirectUri: string;
  tokens: OAuthTokens;
}

export type RedisCodeInterface = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  getDel: (key: string) => Promise<string | null>;
};

// Couples each namespace to its record type so a wrong <T>/namespace pairing or a
// typo'd namespace fails to compile (make illegal states unrepresentable).
type NamespaceRecord = { txn: OAuthTransaction; code: OAuthServerCode };

export class RedisOAuthCodeStore {
  constructor(private readonly redis: RedisCodeInterface) {}

  private key<K extends keyof NamespaceRecord>(namespace: K, id: string): string {
    return `oauth:${namespace}:${id}`;
  }

  private parse<T>(raw: string | null): T | undefined {
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async set<K extends keyof NamespaceRecord>(
    namespace: K,
    id: string,
    value: NamespaceRecord[K],
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(this.key(namespace, id), JSON.stringify(value), { EX: ttlSeconds });
  }

  async get<K extends keyof NamespaceRecord>(namespace: K, id: string): Promise<NamespaceRecord[K] | undefined> {
    return this.parse<NamespaceRecord[K]>(await this.redis.get(this.key(namespace, id)));
  }

  async del(namespace: keyof NamespaceRecord, id: string): Promise<void> {
    await this.redis.del(this.key(namespace, id));
  }

  /** Atomic read-and-delete (Redis GETDEL) — the single-use consumption primitive for server codes. */
  async getAndDelete<K extends keyof NamespaceRecord>(namespace: K, id: string): Promise<NamespaceRecord[K] | undefined> {
    return this.parse<NamespaceRecord[K]>(await this.redis.getDel(this.key(namespace, id)));
  }
}
