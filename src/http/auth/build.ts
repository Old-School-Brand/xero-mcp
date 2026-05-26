import type { RedisClientType } from "redis";
import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { LocalBearerVerifier } from "./local-verifier.js";
import type { LocalSettings, NonLocalSettings, Settings } from "../settings.js";

// Local-only overload
export function buildAuth(settings: LocalSettings): { verifier: OAuthTokenVerifier; requiredScopes: string[] };
// Non-local overload (added in Task 3.3)
export function buildAuth(
  settings: NonLocalSettings,
  redisClient: RedisClientType,
): { provider: ProxyOAuthServerProvider; verifier: OAuthTokenVerifier; requiredScopes: string[] };
// Implementation signature
export function buildAuth(
  settings: Settings,
  _redisClient?: RedisClientType,
): { verifier: OAuthTokenVerifier; requiredScopes: string[] } | { provider: ProxyOAuthServerProvider; verifier: OAuthTokenVerifier; requiredScopes: string[] } {
  if (settings.ENVIRONMENT === "local") {
    const verifier = new LocalBearerVerifier(settings.DEV_BEARER_TOKEN);
    return { verifier, requiredScopes: ["mcp"] };
  }

  // Non-local branch is implemented in Task 3.3
  throw new Error("Non-local auth not yet implemented");
}
