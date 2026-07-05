import { randomUUID } from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

type RedisInterface = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<unknown>;
};

// Non-loopback client redirect URIs permitted at DCR registration. The OAuth-proxy bridge
// (ADR-0004) makes Entra see only the server's fixed callback, so Entra no longer vets the
// MCP client's redirect — the server must. Without this allow-list, an attacker could
// self-register (open DCR) a redirect to a host they control and exfiltrate a victim's
// bridged code/tokens. Loopback is always allowed (see isAllowedRedirectUri); add other
// client callbacks (e.g. a future claude.com) here.
export const ALLOWED_EXACT_REDIRECT_URIS = ["https://claude.ai/api/mcp/auth_callback"] as const;

// Loopback delivery is structurally safe: it resolves to the client's own machine, so a
// remote attacker can never receive the code there (covers Claude Code's dynamic port + local Docker).
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isAllowedRedirectUri(uri: string, allowedExact: readonly string[]): boolean {
  if (allowedExact.includes(uri)) return true;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false; // unparseable → reject
  }
  return LOOPBACK_HOSTS.has(parsed.hostname);
}

export class RedisOAuthClientsStore implements OAuthRegisteredClientsStore {
  private readonly redis: RedisInterface;
  private readonly allowedExact: readonly string[];

  // allowedExact defaults to the hardcoded production set; the parameter exists so tests can
  // inject a custom allow-list. Production wiring in build.ts needs no change.
  constructor(redis: RedisInterface, allowedExact: readonly string[] = ALLOWED_EXACT_REDIRECT_URIS) {
    this.redis = redis;
    this.allowedExact = allowedExact;
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const raw = await this.redis.get(`oauth:clients:${clientId}`);
    if (raw === null) {
      return undefined;
    }
    return JSON.parse(raw) as OAuthClientInformationFull;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    // Reject the whole registration if ANY redirect_uri is not allow-listed — a [good, evil]
    // array must not slip through and let the client later pick `evil` at /authorize.
    if (client.redirect_uris.length === 0) {
      throw new InvalidClientMetadataError("at least one redirect_uri is required");
    }
    for (const uri of client.redirect_uris) {
      if (!isAllowedRedirectUri(uri, this.allowedExact)) {
        throw new InvalidClientMetadataError(`redirect_uri not allowed: ${uri}`);
      }
    }

    const client_id = randomUUID();
    const client_id_issued_at = Math.floor(Date.now() / 1000);
    const full: OAuthClientInformationFull = {
      ...client,
      client_id,
      client_id_issued_at,
    };
    await this.redis.set(`oauth:clients:${client_id}`, JSON.stringify(full));
    return full;
  }
}
