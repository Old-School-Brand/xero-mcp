import { randomUUID } from "node:crypto";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

type RedisInterface = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<unknown>;
};

export class RedisOAuthClientsStore implements OAuthRegisteredClientsStore {
  private readonly redis: RedisInterface;

  constructor(redis: RedisInterface) {
    this.redis = redis;
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const raw = await this.redis.get(`oauth:clients:${clientId}`);
    if (raw === null) {
      return undefined;
    }
    return JSON.parse(raw) as OAuthClientInformationFull;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    const client_id = randomUUID();
    const client_id_issued_at = Math.floor(Date.now() / 1000);
    const full: OAuthClientInformationFull = {
      ...client,
      client_id,
      client_id_issued_at,
    };
    await this.redis.set(`oauth:clients:${client_id}`, JSON.stringify(full));
    return full;
  }
}
