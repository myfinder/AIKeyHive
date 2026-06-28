import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { modelPrices, proxyKeyPolicies, proxyKeys } from "@/db/schema";
import type { ModelPrice, ProxyKey, ProxyKeyPolicy } from "@/db/schema";
import { hashProxyKeySecret } from "@/lib/proxy/key";
import type { OpenAIProxyPolicy } from "@/lib/proxy/types";

export type ProxyAuthResult =
  | {
      ok: true;
      proxyKey: ProxyKey;
      userId: string;
      policy: OpenAIProxyPolicy;
      policyRow: ProxyKeyPolicy;
      prices: ModelPrice[];
    }
  | {
      ok: false;
      status: 401 | 403 | 500;
      code: string;
      message: string;
    };

export async function authenticateOpenAIProxyKey(
  req: Pick<Request, "headers">
): Promise<ProxyAuthResult> {
  const tokenResult = parseBearerProxyKey(req.headers.get("authorization"));
  if (!tokenResult.ok) {
    return tokenResult;
  }

  const keyHash = hashProxyKeySecret(tokenResult.token);
  const proxyKey = await db
    .select()
    .from(proxyKeys)
    .where(eq(proxyKeys.keyHash, keyHash))
    .get();

  if (!proxyKey) {
    return authFailure(
      401,
      "invalid_proxy_key",
      "Proxy key is invalid or inactive."
    );
  }

  if (proxyKey.status === "revoked") {
    return authFailure(403, "proxy_key_revoked", "Proxy key has been revoked.");
  }

  if (proxyKey.status !== "active") {
    return authFailure(
      401,
      "invalid_proxy_key",
      "Proxy key is invalid or inactive."
    );
  }

  const policyRows = await db
    .select()
    .from(proxyKeyPolicies)
    .where(
      and(
        eq(proxyKeyPolicies.proxyKeyId, proxyKey.id),
        eq(proxyKeyPolicies.provider, "openai")
      )
    )
    .all();

  if (policyRows.length === 0) {
    return authFailure(
      403,
      "policy_not_configured",
      "OpenAI proxy policy is not configured for this key."
    );
  }

  if (policyRows.length !== 1) {
    return authFailure(
      500,
      "policy_invalid",
      "OpenAI proxy policy is invalid."
    );
  }

  const policyRow = policyRows[0];
  const allowedModels = parseAllowedModels(policyRow.allowedModelsJson);
  if (!allowedModels) {
    return authFailure(
      500,
      "policy_invalid",
      "OpenAI proxy policy is invalid."
    );
  }

  const prices = await db
    .select()
    .from(modelPrices)
    .where(and(eq(modelPrices.provider, "openai"), eq(modelPrices.active, 1)))
    .all();

  return {
    ok: true,
    proxyKey,
    userId: proxyKey.userId,
    policyRow,
    prices,
    policy: {
      allowedModels,
      maxRequestUsd: policyRow.maxRequestUsd,
      maxOutputTokens: policyRow.maxOutputTokens,
      allowTools: policyRow.allowTools === 1,
      prices,
    },
  };
}

function parseBearerProxyKey(
  authorization: string | null
):
  | { ok: true; token: string }
  | Extract<ProxyAuthResult, { ok: false }> {
  if (!authorization) {
    return authFailure(401, "missing_proxy_key", "Missing bearer proxy key.");
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return authFailure(
      401,
      "malformed_authorization",
      "Authorization must use Bearer proxy key credentials."
    );
  }

  const token = match[1].trim();
  if (!token.startsWith("akp_") || token.length <= "akp_".length) {
    return authFailure(
      401,
      "invalid_proxy_key",
      "Proxy key is invalid or inactive."
    );
  }

  return { ok: true, token };
}

function parseAllowedModels(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((model) => typeof model === "string" && model.length > 0)
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function authFailure(
  status: 401 | 403 | 500,
  code: string,
  message: string
): Extract<ProxyAuthResult, { ok: false }> {
  return { ok: false, status, code, message };
}
