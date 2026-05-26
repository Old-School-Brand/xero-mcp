import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import { InvalidTokenError, InsufficientScopeError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * Structurally-valid JWT used for the JWKS startup probe.
 *
 * Header: { alg: "RS256", kid: "startup-probe" }
 * Payload: { iss: "startup-probe" }
 * Signature: junk (invalid)
 *
 * Must be structurally valid — an arbitrary string would fail jose's parse
 * before any JWKS fetch is attempted, defeating the probe.
 * When the JWKS endpoint is reachable:
 *   - No matching kid → JWKSNoMatchingKey (a JOSEError) → caught → InvalidTokenError
 * When the JWKS endpoint is unreachable:
 *   - TypeError("fetch failed") → NOT caught (not JOSEError) → propagates to server.ts
 */
export const STARTUP_PROBE_JWT =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6InN0YXJ0dXAtcHJvYmUifQ.eyJpc3MiOiJzdGFydHVwLXByb2JlIn0.invalid";

type EntraVerifierOptions = {
  tenantId: string;
  clientId: string;
  requiredScopes: string[];
};

export class EntraVerifier implements OAuthTokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly requiredScopes: string[];

  constructor({ tenantId, clientId, requiredScopes }: EntraVerifierOptions) {
    const jwksUrl = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
    // Store JWKS as instance field — same fetch path at startup (probe) and runtime
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    this.issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    this.audience = `api://${clientId}`;
    this.requiredScopes = requiredScopes;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });

      // Extract scp claim (space-delimited string for delegated permissions)
      const scp = typeof payload["scp"] === "string" ? payload["scp"].split(" ") : [];

      // Verify all required scopes are present
      const missingScopes = this.requiredScopes.filter((s) => !scp.includes(s));
      if (missingScopes.length > 0) {
        throw new InsufficientScopeError(`Missing required scopes: ${missingScopes.join(", ")}`);
      }

      return {
        token,
        clientId:
          (payload["sub"] as string | undefined) ??
          (payload["oid"] as string | undefined) ??
          "unknown",
        scopes: scp,
        expiresAt: payload["exp"] as number | undefined,
      };
    } catch (err) {
      // Selective catch: only JOSEError instances become InvalidTokenError.
      // Network failures (TypeError("fetch failed"), DNS errors, HTTP errors)
      // are NOT JOSEError instances — they propagate so the startup probe in
      // server.ts can discriminate "JWKS unreachable" from "token rejected".
      if (err instanceof joseErrors.JOSEError) {
        throw new InvalidTokenError(err.message);
      }
      // InsufficientScopeError is not a JOSEError — re-throw as-is
      throw err;
    }
  }
}
