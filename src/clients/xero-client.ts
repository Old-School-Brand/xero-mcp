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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub until Task 2.4
  private async exchangeToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  }> {
    // Uses axios and AxiosError — referenced explicitly to suppress import warnings until full implementation
    void axios;
    void AxiosError;
    throw new Error("not implemented");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub until Task 2.6
  private persistRefreshToken(token: string): void {
    throw new Error("not implemented");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub until Task 2.8
  private scheduleRefresh(expiresIn: number): void {
    throw new Error("not implemented");
  }

  public async authenticate(): Promise<void> {
    throw new Error("not implemented");
  }
}

export const xeroClient = new RefreshTokenXeroClient({
  clientId: client_id,
  clientSecret: client_secret,
});
