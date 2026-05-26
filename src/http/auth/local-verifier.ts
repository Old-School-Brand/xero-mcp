import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export class LocalBearerVerifier implements OAuthTokenVerifier {
  private readonly devBearerToken: string;

  constructor(devBearerToken: string) {
    this.devBearerToken = devBearerToken;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token === this.devBearerToken) {
      return { token, clientId: "dev-local", scopes: ["mcp"], expiresAt: undefined };
    }
    throw new InvalidTokenError("Invalid dev bearer token");
  }
}
