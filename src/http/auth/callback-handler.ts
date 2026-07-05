import { randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { OAuthTokensSchema, type OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type pino from "pino";
import type { RedisOAuthCodeStore } from "./redis-code-store.js";
import type { EntraConfig } from "./bridge-provider.js";

export type CallbackEntraConfig = EntraConfig & { tokenUrl: string };

const SERVER_CODE_TTL_SECONDS = 60;

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * `GET /auth/callback` — the OAuth-proxy bridge's own fixed Entra redirect target. Loads the
 * transaction stored by `EntraBridgeProvider.authorize`, exchanges the Entra code server-side,
 * mints a single-use server authorization code, and bridges the browser back to the MCP client.
 * Error responses are always plain JSON, never a redirect — an invalid request must not be able
 * to trigger a redirect to an attacker-influenced `clientRedirectUri`.
 */
export function createCallbackHandler(
  codeStore: RedisOAuthCodeStore,
  entraConfig: CallbackEntraConfig,
  logger: pino.Logger,
): RequestHandler {
  return async (req: Request, res: Response) => {
    const code = queryString(req.query["code"]);
    const state = queryString(req.query["state"]);
    const upstreamError = queryString(req.query["error"]);
    const upstreamErrorDescription = queryString(req.query["error_description"]);

    if (upstreamError) {
      logger.warn({ txnId: state, error: upstreamError }, "auth_callback_upstream_error");
      res.status(502).json({ error: "upstream_error", error_description: upstreamErrorDescription ?? upstreamError });
      return;
    }

    if (!state) {
      logger.warn({}, "auth_callback_missing_state");
      res.status(400).json({ error: "invalid_request", error_description: "Missing state parameter" });
      return;
    }

    const txn = await codeStore.get("txn", state);
    if (!txn) {
      logger.warn({ txnId: state }, "auth_callback_txn_not_found");
      res.status(400).json({
        error: "invalid_request",
        error_description: "Authorization transaction expired or not found",
      });
      return;
    }

    // A callback with no `error` and no `code` intentionally falls through here with an
    // empty code — Entra rejects it and the upstream-failure 502 path below handles it.
    const tokenRequestBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      client_id: entraConfig.clientId,
      client_secret: entraConfig.clientSecret,
      code_verifier: txn.serverCodeVerifier,
      redirect_uri: entraConfig.callbackUrl,
    });

    let tokens: OAuthTokens;
    try {
      const response = await fetch(entraConfig.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenRequestBody.toString(),
      });
      if (!response.ok) throw new Error(`Entra token endpoint returned ${response.status}`);
      tokens = OAuthTokensSchema.parse(await response.json());
    } catch {
      logger.warn({ txnId: state }, "auth_callback_upstream_token_exchange_failed");
      res.status(502).json({ error: "upstream_error", error_description: "Upstream token exchange failed" });
      return;
    }

    await codeStore.del("txn", state);

    const serverCode = randomBytes(32).toString("base64url");
    await codeStore.set(
      "code",
      serverCode,
      { clientCodeChallenge: txn.clientCodeChallenge, clientRedirectUri: txn.clientRedirectUri, tokens },
      SERVER_CODE_TTL_SECONDS,
    );

    const redirect = new URL(txn.clientRedirectUri);
    redirect.searchParams.set("code", serverCode);
    redirect.searchParams.set("state", txn.clientState);
    res.redirect(302, redirect.toString());
  };
}
