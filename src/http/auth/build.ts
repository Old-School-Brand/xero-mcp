import type { Response } from "express";
import type { RedisClientType } from "redis";
import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { ProxyOptions } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { AuthorizationParams, OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { LocalBearerVerifier } from "./local-verifier.js";
import { EntraVerifier } from "./entra-verifier.js";
import { RedisOAuthClientsStore } from "./redis-clients-store.js";
import type { LocalSettings, NonLocalSettings, Settings } from "../settings.js";

/**
 * ProxyOAuthServerProvider forwards the MCP client's `scope` and RFC 8707 `resource`
 * to the upstream verbatim. Microsoft Entra rejects the bare `mcp` scope plus the MCP
 * server URL as `resource` (AADSTS9010010) — it needs a fully-qualified scope
 * (`api://<client_id>/mcp`) and an App-ID-URI `resource` (`api://<client_id>`). This
 * subclass rewrites both on every outbound authorize/token request. The token Entra
 * returns still carries `aud=api://<client_id>` and `scp="mcp"` (Entra strips the
 * `api://<client_id>/` prefix in `scp`), which is exactly what EntraVerifier checks —
 * so the verifier and ENTRA_REQUIRED_SCOPES=mcp are unaffected.
 */
export class EntraProxyOAuthServerProvider extends ProxyOAuthServerProvider {
  private readonly entraResource: URL;
  private readonly entraScopes: string[];

  constructor(options: ProxyOptions, clientId: string, scopeName: string) {
    super(options);
    this.entraResource = new URL(`api://${clientId}`);
    this.entraScopes = [`api://${clientId}/${scopeName}`];
  }

  override authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    return super.authorize(client, { ...params, scopes: this.entraScopes, resource: this.entraResource }, res);
  }

  // Narrower override signatures: the incoming `resource`/`scopes` are intentionally
  // dropped and replaced with the Entra values, so they are omitted from the params.
  override exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    return super.exchangeAuthorizationCode(client, authorizationCode, codeVerifier, redirectUri, this.entraResource);
  }

  override exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    return super.exchangeRefreshToken(client, refreshToken, this.entraScopes, this.entraResource);
  }
}

// Local-only overload
export function buildAuth(settings: LocalSettings): { verifier: OAuthTokenVerifier; requiredScopes: string[] };
// Non-local overload — returns EntraVerifier directly (not just OAuthTokenVerifier) so callers
// can access EntraVerifier-specific properties such as .jwksUrl without a type cast.
export function buildAuth(
  settings: NonLocalSettings,
  redisClient: RedisClientType,
): { provider: ProxyOAuthServerProvider; verifier: EntraVerifier; requiredScopes: string[] };
// Implementation signature
export function buildAuth(
  settings: Settings,
  redisClient?: RedisClientType,
):
  | { verifier: OAuthTokenVerifier; requiredScopes: string[] }
  | { provider: ProxyOAuthServerProvider; verifier: EntraVerifier; requiredScopes: string[] } {
  if (settings.ENVIRONMENT === "local") {
    const verifier = new LocalBearerVerifier(settings.DEV_BEARER_TOKEN);
    return { verifier, requiredScopes: ["mcp"] };
  }

  // Non-local branch: Entra + Redis
  // Fail loud if redisClient is missing — the overloads guarantee its presence at every
  // non-local call site; this guard converts a type assertion into a runtime check.
  if (!redisClient) throw new Error("redisClient is required in non-local mode");

  const { ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_REQUIRED_SCOPES } = settings;
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

  const provider = new EntraProxyOAuthServerProvider(
    {
      endpoints: {
        authorizationUrl: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/oauth2/v2.0/token`,
      },
      verifyAccessToken: (token) => verifier.verifyAccessToken(token),
      getClient: (id) => store.getClient(id),
    },
    ENTRA_CLIENT_ID,
    requiredScopes[0] ?? "mcp",
  );

  // Override clientsStore so mcpAuthRouter sees registerClient and mounts /register.
  // ProxyOAuthServerProvider only includes registerClient when endpoints.registrationUrl
  // is provided (we don't pass one — DCR is local). Without this override, /register
  // is silently absent.
  Object.defineProperty(provider, "clientsStore", { value: store });

  return { provider, verifier, requiredScopes };
}
