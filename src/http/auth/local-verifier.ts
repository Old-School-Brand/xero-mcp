import { timingSafeEqual } from "node:crypto";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

// Far-future Unix timestamp used as expiresAt for local-dev bearer tokens.
// The SDK's requireBearerAuth requires expiresAt to be a number; local dev
// tokens have no real expiry so we inject a non-expiring sentinel constant here.
export const LOCAL_DEV_EXPIRES_AT = Math.floor(new Date("2099-01-01").getTime() / 1000);

export class LocalBearerVerifier implements OAuthTokenVerifier {
  private readonly devBearerToken: string;

  constructor(devBearerToken: string) {
    this.devBearerToken = devBearerToken;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // Use constant-time comparison to prevent timing side-channel attacks.
    // Guard against same-length requirement of timingSafeEqual.
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(this.devBearerToken);
    const match =
      tokenBuf.byteLength === secretBuf.byteLength && timingSafeEqual(tokenBuf, secretBuf);

    if (match) {
      return { token, clientId: "dev-local", scopes: ["mcp"], expiresAt: LOCAL_DEV_EXPIRES_AT };
    }
    throw new InvalidTokenError("Invalid dev bearer token");
  }
}
