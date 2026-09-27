import type { BrokerConfig } from "./config.js";

interface ExternalClaims {
  iss?: unknown;
  aud?: unknown;
  preferred_username?: unknown;
  exp?: unknown;
}

interface TokenExchangeResponse {
  access_token?: string;
  expires_in?: number;
}

export interface FederatedIdentity {
  accessToken: string;
  userName: string;
  displayName: string | null;
  expiresAt: number;
}

export class DatabricksError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code);
  }
}

export async function exchangeFederatedAssertion(
  assertion: string,
  config: BrokerConfig,
): Promise<FederatedIdentity> {
  const claims = decodeJwtPayload(assertion);
  assertExternalClaims(claims, config);

  const body = new URLSearchParams({
    subject_token: assertion,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    scope: "all-apis",
  });
  const response = await fetch(`${workspaceBase(config)}/oidc/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as TokenExchangeResponse;
  if (!response.ok || !payload.access_token) {
    throw new DatabricksError(response.status === 401 ? "federation_rejected" : "token_exchange_failed", response.status);
  }

  const identity = await currentUser(payload.access_token, config);
  const tokenClaims = decodeJwtPayload(payload.access_token);
  const tokenExpiry = typeof tokenClaims.exp === "number" ? tokenClaims.exp * 1_000 : Number.POSITIVE_INFINITY;
  const exchangeExpiry = Date.now() + Math.max(60, payload.expires_in ?? 3_600) * 1_000;
  const externalExpiry = typeof claims.exp === "number" ? claims.exp * 1_000 : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(tokenExpiry, exchangeExpiry, externalExpiry, Date.now() + 3_600_000);

  return {
    accessToken: payload.access_token,
    userName: identity.userName,
    displayName: identity.displayName,
    expiresAt,
  };
}

export async function databricksFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
}

export function workspaceUrl(config: BrokerConfig, path: string): string {
  return `${workspaceBase(config)}${path}`;
}

export function sanitizeDatabricksJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDatabricksJson);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value)) {
    if (["access_token", "refresh_token", "statement_id_signature", "external_links", "stack_trace"].includes(name)) continue;
    result[name] = sanitizeDatabricksJson(child);
  }
  return result;
}

function assertExternalClaims(claims: ExternalClaims, config: BrokerConfig): void {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== config.veevaSsoIssuer || !audiences.includes(config.veevaSsoAudience)) {
    throw new DatabricksError("invalid_external_token", 401);
  }
  if (typeof claims.preferred_username !== "string" || !claims.preferred_username) {
    throw new DatabricksError("missing_user_identity", 401);
  }
  if (typeof claims.exp !== "number" || claims.exp * 1_000 <= Date.now()) {
    throw new DatabricksError("external_token_expired", 401);
  }
}

async function currentUser(
  accessToken: string,
  config: BrokerConfig,
): Promise<{ userName: string; displayName: string | null }> {
  const response = await databricksFetch(
    workspaceUrl(config, "/api/2.0/preview/scim/v2/Me"),
    accessToken,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new DatabricksError("identity_resolution_failed", response.status);
  const payload = await response.json() as { userName?: string; displayName?: string };
  if (!payload.userName) throw new DatabricksError("identity_resolution_failed");
  return { userName: payload.userName, displayName: payload.displayName ?? null };
}

function decodeJwtPayload(token: string): ExternalClaims {
  if (token.length > 16_384) throw new DatabricksError("invalid_external_token", 401);
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new DatabricksError("invalid_external_token", 401);
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as ExternalClaims;
  } catch {
    throw new DatabricksError("invalid_external_token", 401);
  }
}

function workspaceBase(config: BrokerConfig): string {
  return `https://${config.workspaceHost}`;
}
