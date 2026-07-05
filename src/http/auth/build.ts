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
 * ProxyOAuthServerProvider forwards the DCR client's identity (`client_id`/`client_secret`),
 * `scope`, and RFC 8707 `resource` to the upstream verbatim. Microsoft Entra rejects all of
 * these as-is:
 *   - the random per-client DCR `client_id` isn't a registered app (invalid_client),
 *   - the bare `mcp` scope + the MCP server URL as `resource` fail with AADSTS9010010.
 * Entra only knows the App Registration (`ENTRA_CLIENT_ID`) and needs a fully-qualified scope
 * (`api://<client_id>/mcp`) + an App-ID-URI `resource` (`api://<client_id>`). This subclass
 * rewrites all of them on every outbound authorize/token request, substituting the real app
 * identity while the DCR id stays in use locally (getClient / redirect-uri / PKCE bookkeeping).
 * The token Entra returns still carries `aud=api://<client_id>` and `scp="mcp"` (Entra strips
 * the `api://<client_id>/` prefix in `scp`) — exactly what EntraVerifier checks, so the verifier
 * and ENTRA_REQUIRED_SCOPES=mcp are unaffected.
 */
export class EntraProxyOAuthServerProvider extends ProxyOAuthServerProvider {
  private readonly entraClientId: string;
  private readonly entraClientSecret?: string;
  private readonly entraResource: URL;
  private readonly entraScopes: string[];

  constructor(options: ProxyOptions, clientId: string, scopeName: string, clientSecret?: string) {
    super(options);
    this.entraClientId = clientId;
    this.entraClientSecret = clientSecret;
    this.entraResource = new URL(`api://${clientId}`);
    this.entraScopes = [`api://${clientId}/${scopeName}`];
  }

  /**
   * Swap the local DCR client identity for the real Entra app identity on upstream calls.
   * `client_secret` is set *exclusively* from `entraClientSecret` — assigning it
   * unconditionally (undefined clears it) ensures a DCR client's own generated secret is
   * never forwarded to Entra. Guard: unset keeps the flow public/PKCE (loopback redirects
   * with any port); set makes it confidential.
   */
  private toEntraClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    return {
      ...client,
      client_id: this.entraClientId,
      client_secret: this.entraClientSecret,
    };
  }

  override authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    return super.authorize(this.toEntraClient(client), { ...params, scopes: this.entraScopes, resource: this.entraResource }, res);
  }

  // Narrower override signatures: the incoming `resource`/`scopes` are intentionally
  // dropped and replaced with the Entra values, so they are omitted from the params.
  override exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    return super.exchangeAuthorizationCode(this.toEntraClient(client), authorizationCode, codeVerifier, redirectUri, this.entraResource);
  }

  override exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    return super.exchangeRefreshToken(this.toEntraClient(client), refreshToken, this.entraScopes, this.entraResource);
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

  const { ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_REQUIRED_SCOPES } = settings;
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
    ENTRA_CLIENT_SECRET,
  );

  // Override clientsStore so mcpAuthRouter sees registerClient and mounts /register.
  // ProxyOAuthServerProvider only includes registerClient when endpoints.registrationUrl
  // is provided (we don't pass one — DCR is local). Without this override, /register
  // is silently absent.
  Object.defineProperty(provider, "clientsStore", { value: store });

  return { provider, verifier, requiredScopes };
}
