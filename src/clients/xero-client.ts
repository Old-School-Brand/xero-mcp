import axios, { AxiosError } from "axios";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import dotenv from "dotenv";
import {
  IXeroClientConfig,
  Organisation,
  XeroClient,
} from "xero-node";

import { ensureError } from "../helpers/ensure-error.js";

dotenv.config();

const client_id = process.env.XERO_CLIENT_ID;
const client_secret = process.env.XERO_CLIENT_SECRET;

if (!client_id) throw new Error("XERO_CLIENT_ID is required");
if (!client_secret) throw new Error("XERO_CLIENT_SECRET is required");

abstract class MCPXeroClient extends XeroClient {
  public tenantId: string;
  private shortCode: string;

  protected constructor(config?: IXeroClientConfig) {
    super(config);
    this.tenantId = "";
    this.shortCode = "";
  }

  public abstract authenticate(): Promise<void>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async updateTenants(fullOrgDetails?: boolean): Promise<any[]> {
    await super.updateTenants(fullOrgDetails);
    if (this.tenants && this.tenants.length > 0) {
      this.tenantId = this.tenants[0].tenantId;
    }
    return this.tenants;
  }

  private async getOrganisation(): Promise<Organisation> {
    await this.authenticate();

    const organisationResponse = await this.accountingApi.getOrganisations(
      this.tenantId || "",
    );

    const organisation = organisationResponse.body.organisations?.[0];

    if (!organisation) {
      throw new Error("Failed to retrieve organisation");
    }

    return organisation;
  }

  public async getShortCode(): Promise<string | undefined> {
    if (!this.shortCode) {
      try {
        const organisation = await this.getOrganisation();
        this.shortCode = organisation.shortCode ?? "";
      } catch (error: unknown) {
        const err = ensureError(error);

        throw new Error(
          `Failed to get Organisation short code: ${err.message}`,
        );
      }
    }
    return this.shortCode;
  }
}

class RefreshTokenXeroClient extends MCPXeroClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenFilePath: string;
  private currentRefreshToken: string = "";
  private initialised = false;
  private authPromise: Promise<void> | null = null;

  constructor(config: { clientId: string; clientSecret: string }) {
    super({ clientId: config.clientId, clientSecret: config.clientSecret });
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.tokenFilePath =
      process.env.XERO_TOKEN_FILE ||
      path.join(os.homedir(), ".xero-mcp", "refresh_token");
  }

  private resolveRefreshToken(): string {
    try {
      const token = fs.readFileSync(this.tokenFilePath, "utf-8").trim();
      if (token) return token;
    } catch {
      // File does not exist or is unreadable — fall through to env var.
    }

    const envToken = process.env.XERO_REFRESH_TOKEN;
    if (envToken) return envToken;

    throw new Error(
      "No refresh token found. Set XERO_REFRESH_TOKEN to a valid Xero refresh token, or obtain one at https://api-explorer.xero.com",
    );
  }

  private async exchangeToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    try {
      const response = await axios.post(
        "https://identity.xero.com/connect/token",
        `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
        },
      );

      const { access_token, refresh_token, expires_in, token_type } =
        response.data as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number | null;
          token_type: string;
        };

      if (!access_token || !refresh_token) {
        throw new Error(
          "Xero response missing required token fields",
        );
      }

      if (expires_in === undefined || expires_in === null) {
        throw new Error(
          "Xero response missing expires_in — cannot schedule token refresh",
        );
      }

      return { access_token, refresh_token, expires_in, token_type };
    } catch (error) {
      if (error instanceof AxiosError) {
        const data = error.response?.data as
          | Record<string, unknown>
          | undefined;
        const xeroError = data ? JSON.stringify(data) : error.message;
        throw new Error(
          `Refresh token is invalid or expired. Obtain a new one at https://api-explorer.xero.com. Xero error: ${xeroError}`,
        );
      }
      throw error;
    }
  }

  private persistRefreshToken(token: string): void {
    const dir = path.dirname(this.tokenFilePath);
    if (!fs.existsSync(dir)) {
      throw new Error(
        `Token file directory does not exist: ${dir}. Create it with: mkdir -p ${dir}`,
      );
    }
    const tmpPath = `${this.tokenFilePath}.tmp`;
    fs.writeFileSync(tmpPath, token, { mode: 0o600 });
    fs.renameSync(tmpPath, this.tokenFilePath);
  }

  private scheduleRefresh(expiresIn: number): void {
    const delayMs = (expiresIn - 300) * 1000;
    setTimeout(async () => {
      try {
        const tokenData = await this.exchangeToken(this.currentRefreshToken);
        this.persistRefreshToken(tokenData.refresh_token);
        this.currentRefreshToken = tokenData.refresh_token;
        this.setTokenSet({
          access_token: tokenData.access_token,
          expires_in: tokenData.expires_in,
          token_type: tokenData.token_type,
        });
        this.scheduleRefresh(tokenData.expires_in);
      } catch (error) {
        console.error("Scheduled token refresh failed:", error);
        process.exit(1);
      }
    }, delayMs).unref();
  }

  public async authenticate(): Promise<void> {
    if (this.initialised) return;
    // Concurrency guard: share a single in-flight promise so concurrent callers
    // do not each run the full startup flow independently.
    if (this.authPromise) return this.authPromise;
    this.authPromise = this._doAuthenticate();
    return this.authPromise;
  }

  private async _doAuthenticate(): Promise<void> {
    const refreshToken = this.resolveRefreshToken();
    const tokenData = await this.exchangeToken(refreshToken);
    this.persistRefreshToken(tokenData.refresh_token);
    this.currentRefreshToken = tokenData.refresh_token;
    this.setTokenSet({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
    });
    await this.updateTenants();
    this.scheduleRefresh(tokenData.expires_in);
    this.initialised = true;
  }
}

export const xeroClient = new RefreshTokenXeroClient({
  clientId: client_id,
  clientSecret: client_secret,
});
