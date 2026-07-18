import type { RedisClientType } from "redis";
import type express from "express";
import type pino from "pino";
import type { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { LocalBearerVerifier } from "./local-verifier.js";
import { EntraVerifier } from "./entra-verifier.js";
import { RedisOAuthClientsStore } from "./redis-clients-store.js";
import { RedisOAuthCodeStore } from "./redis-code-store.js";
import { EntraBridgeProvider } from "./bridge-provider.js";
import { createCallbackHandler } from "./callback-handler.js";
import type { LocalSettings, NonLocalSettings, Settings } from "../settings.js";

// Local-only overload
export function buildAuth(settings: LocalSettings): { verifier: OAuthTokenVerifier; requiredScopes: string[] };
// Non-local overload — returns EntraVerifier directly (not just OAuthTokenVerifier) so callers
// can access EntraVerifier-specific properties such as .jwksUrl without a type cast.
export function buildAuth(
  settings: NonLocalSettings,
  redisClient: RedisClientType,
  logger: pino.Logger,
): {
  provider: ProxyOAuthServerProvider;
  verifier: EntraVerifier;
  requiredScopes: string[];
  callbackHandler: express.RequestHandler;
};
// Implementation signature
export function buildAuth(
  settings: Settings,
  redisClient?: RedisClientType,
  logger?: pino.Logger,
):
  | { verifier: OAuthTokenVerifier; requiredScopes: string[] }
  | {
      provider: ProxyOAuthServerProvider;
      verifier: EntraVerifier;
      requiredScopes: string[];
      callbackHandler: express.RequestHandler;
    } {
  if (settings.ENVIRONMENT === "local") {
    const verifier = new LocalBearerVerifier(settings.DEV_BEARER_TOKEN);
    return { verifier, requiredScopes: ["mcp"] };
  }

  // Non-local branch: Entra + Redis
  // Fail loud if redisClient/logger are missing — the overloads guarantee their presence at
  // every non-local call site; this guard converts a type assertion into a runtime check.
  if (!redisClient) throw new Error("redisClient is required in non-local mode");
  if (!logger) throw new Error("logger is required in non-local mode");

  const { ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REQUIRED_SCOPES, MCP_SERVER_URL } = settings;
  const requiredScopes = ENTRA_REQUIRED_SCOPES.split(",");

  const verifier = new EntraVerifier({
    tenantId: ENTRA_TENANT_ID,
    clientId: ENTRA_CLIENT_ID,
    requiredScopes,
  });

  const store = new RedisOAuthClientsStore({
    get: redisClient.get.bind(redisClient),
    set: redisClient.set.bind(redisClient),
  });

  const codeStore = new RedisOAuthCodeStore({
    get: redisClient.get.bind(redisClient),
    set: redisClient.set.bind(redisClient),
    del: redisClient.del.bind(redisClient),
    getDel: redisClient.getDel.bind(redisClient),
  });

  const entraConfig = {
    clientId: ENTRA_CLIENT_ID,
    clientSecret: ENTRA_CLIENT_SECRET,
    callbackUrl: `${MCP_SERVER_URL}/auth/callback`,
    scope: `openid offline_access api://${ENTRA_CLIENT_ID}/${requiredScopes[0] ?? "mcp"}`,
    tokenUrl: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/oauth2/v2.0/token`,
  };

  const provider = new EntraBridgeProvider(
    {
      endpoints: {
        authorizationUrl: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/oauth2/v2.0/authorize`,
        tokenUrl: entraConfig.tokenUrl,
      },
      verifyAccessToken: (token) => verifier.verifyAccessToken(token),
      getClient: (id) => store.getClient(id),
    },
    codeStore,
    entraConfig,
  );

  // Override clientsStore so mcpAuthRouter sees registerClient and mounts /register.
  // ProxyOAuthServerProvider only includes registerClient when endpoints.registrationUrl
  // is provided (we don't pass one — DCR is local). Without this override, /register
  // is silently absent.
  Object.defineProperty(provider, "clientsStore", { value: store });

  const callbackHandler = createCallbackHandler(codeStore, entraConfig, logger);

  return { provider, verifier, requiredScopes, callbackHandler };
}
