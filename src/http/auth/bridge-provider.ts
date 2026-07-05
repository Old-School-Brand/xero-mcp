import { randomBytes, createHash } from "node:crypto";
import type { Response } from "express";
import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { ProxyOptions } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { RedisOAuthCodeStore } from "./redis-code-store.js";

export interface EntraConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  scope: string;
}

const TXN_TTL_SECONDS = 600;

/**
 * OAuth-proxy bridge (ADR-0004): terminates the Entra authorization-code flow at the
 * server's own fixed callback, holding the MCP client's redirect+PKCE in a short-lived
 * Redis transaction, then issues its own single-use code back to the client. Entra only
 * ever sees the server's fixed confidential callback — never the MCP client's redirect.
 */
export class EntraBridgeProvider extends ProxyOAuthServerProvider {
  private readonly authorizationUrl: string;

  constructor(
    options: ProxyOptions,
    private readonly codeStore: RedisOAuthCodeStore,
    private readonly entraConfig: EntraConfig,
  ) {
    super(options);
    this.authorizationUrl = options.endpoints.authorizationUrl;
    // The SDK will call challengeForAuthorizationCode and validate the client's PKCE locally.
    this.skipLocalPkceValidation = false;
  }

  override async authorize(_client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const txnId = randomBytes(32).toString("base64url");
    const serverVerifier = randomBytes(32).toString("base64url");
    const serverChallenge = createHash("sha256").update(serverVerifier).digest("base64url");

    await this.codeStore.set(
      "txn",
      txnId,
      {
        clientRedirectUri: params.redirectUri,
        clientState: params.state ?? "",
        clientCodeChallenge: params.codeChallenge,
        serverCodeVerifier: serverVerifier,
      },
      TXN_TTL_SECONDS,
    );

    const authorizeUrl = new URL(this.authorizationUrl);
    authorizeUrl.searchParams.set("client_id", this.entraConfig.clientId);
    authorizeUrl.searchParams.set("redirect_uri", this.entraConfig.callbackUrl);
    authorizeUrl.searchParams.set("state", txnId);
    authorizeUrl.searchParams.set("code_challenge", serverChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("scope", this.entraConfig.scope);
    authorizeUrl.searchParams.set("response_type", "code");
    res.redirect(authorizeUrl.toString());
  }

  override async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    // Peek only — do NOT delete. The SDK calls this before exchangeAuthorizationCode, which
    // consumes the code (see ADR-0004 Consequences for the accepted peek-then-consume trade-off).
    const record = await this.codeStore.get("code", authorizationCode);
    if (!record) {
      throw new InvalidGrantError("Unknown or expired authorization code");
    }
    return record.clientCodeChallenge;
  }

  override async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    // Single atomic GETDEL — a concurrent replay cannot also read the record (AC 4).
    const record = await this.codeStore.getAndDelete("code", authorizationCode);
    if (!record) {
      throw new InvalidGrantError("Authorization code already used or expired");
    }
    return record.tokens;
  }

  override exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const entraClient: OAuthClientInformationFull = {
      ...client,
      client_id: this.entraConfig.clientId,
      client_secret: this.entraConfig.clientSecret,
    };
    // No `resource` — Entra v2.0 does not support RFC 8707; it was silently ignored before.
    return super.exchangeRefreshToken(entraClient, refreshToken, [this.entraConfig.scope]);
  }
}
