import { z } from "zod";
import dotenv from "dotenv";

const BaseSettingsSchema = z
  .object({
    ENVIRONMENT: z.enum(["local", "development", "production"]),
    MCP_BIND_HOST: z.string().default("0.0.0.0"),
    MCP_BIND_PORT: z.coerce.number().default(8000),
    LOG_LEVEL: z.string().default("info"),
    MCP_SESSION_IDLE_TIMEOUT_SECONDS: z.coerce.number().default(1800),
    MCP_MAX_SESSIONS: z.coerce.number().default(100),
    DEV_BEARER_TOKEN: z.string().optional(),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    // Optional (guard): when set, the OAuth proxy sends it to Entra on token exchange
    // (confidential client). Absent = public/PKCE flow. Not in nonLocalRequired.
    ENTRA_CLIENT_SECRET: z.string().optional(),
    MCP_SERVER_URL: z.string().optional(),
    ENTRA_REQUIRED_SCOPES: z.string().optional(),
    REDIS_URL: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.ENVIRONMENT === "local") {
      if (!val.DEV_BEARER_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DEV_BEARER_TOKEN"],
          message: "DEV_BEARER_TOKEN is required when ENVIRONMENT=local",
        });
      }
    } else {
      const nonLocalRequired = [
        "ENTRA_TENANT_ID",
        "ENTRA_CLIENT_ID",
        "MCP_SERVER_URL",
        "ENTRA_REQUIRED_SCOPES",
        "REDIS_URL",
      ] as const;
      for (const field of nonLocalRequired) {
        if (!val[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when ENVIRONMENT is not local`,
          });
        }
      }
    }
  });

// Discriminated types for type-safe narrowing
export type LocalSettings = {
  ENVIRONMENT: "local";
  MCP_BIND_HOST: string;
  MCP_BIND_PORT: number;
  LOG_LEVEL: string;
  MCP_SESSION_IDLE_TIMEOUT_SECONDS: number;
  MCP_MAX_SESSIONS: number;
  DEV_BEARER_TOKEN: string;
};

export type NonLocalSettings = {
  ENVIRONMENT: "development" | "production";
  MCP_BIND_HOST: string;
  MCP_BIND_PORT: number;
  LOG_LEVEL: string;
  MCP_SESSION_IDLE_TIMEOUT_SECONDS: number;
  MCP_MAX_SESSIONS: number;
  ENTRA_TENANT_ID: string;
  ENTRA_CLIENT_ID: string;
  ENTRA_CLIENT_SECRET?: string;
  MCP_SERVER_URL: string;
  ENTRA_REQUIRED_SCOPES: string;
  REDIS_URL: string;
};

export type Settings = LocalSettings | NonLocalSettings;

export function loadSettings(): Settings {
  dotenv.config(); // idempotent — no-op if already loaded
  const parsed = BaseSettingsSchema.parse(process.env);
  return parsed as unknown as Settings;
}
