import type { BrokerConfig } from "./config.js";
import { sameUserName } from "./identity.js";

export { sameUserName } from "./identity.js";

interface JwtHeader {
  alg?: unknown;
}

interface ExternalClaims extends Record<string, unknown> {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
}

interface TokenExchangeResponse {
  access_token?: string;
  expires_in?: number;
}

export interface FederatedIdentity {
  accessToken: string;
  externalUserName: string;
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
  expectedActorUserName: string,
  config: BrokerConfig,
): Promise<FederatedIdentity> {
  const { claims, externalUserName } = parseFederatedAssertion(assertion, config);
  assertSameUser(expectedActorUserName, externalUserName);

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
    const rejected = response.status === 400 || response.status === 401 || response.status === 403;
    throw new DatabricksError(rejected ? "federation_rejected" : "token_exchange_failed", rejected ? 401 : 502);
  }

  const identity = await currentUser(payload.access_token, config);
  assertSameUser(expectedActorUserName, externalUserName, identity.userName);

  const tokenExpiry = accessTokenExpiry(payload.access_token);
  const lifetimeSeconds = Number.isFinite(payload.expires_in) && Number(payload.expires_in) > 0
    ? Number(payload.expires_in)
    : 3_600;
  const exchangeExpiry = Date.now() + lifetimeSeconds * 1_000;
  const externalExpiry = Number(claims.exp) * 1_000;
  const expiresAt = Math.min(tokenExpiry, exchangeExpiry, externalExpiry, Date.now() + 3_600_000);

  return {
    accessToken: payload.access_token,
    externalUserName,
    userName: identity.userName,
    displayName: identity.displayName,
    expiresAt,
  };
}

export function federatedAssertionUserName(assertion: string, config: BrokerConfig): string {
  return parseFederatedAssertion(assertion, config).externalUserName;
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

function parseFederatedAssertion(
  assertion: string,
  config: BrokerConfig,
): { claims: ExternalClaims; externalUserName: string } {
  if (assertion.length > 16_384) throw new DatabricksError("invalid_external_token", 401);
  const parts = assertion.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new DatabricksError("invalid_external_token", 401);
  }
  const header = decodeJwtPart<JwtHeader>(parts[0]);
  const claims = decodeJwtPart<ExternalClaims>(parts[1]);
  if (header.alg !== "RS256" && header.alg !== "ES256") {
    throw new DatabricksError("invalid_external_token", 401);
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== config.federatedTokenIssuer
    || !audiences.some((audience) => typeof audience === "string" && config.federatedTokenAudiences.has(audience))
  ) {
    throw new DatabricksError("invalid_external_token", 401);
  }

  const identityClaim = claims[config.federatedUsernameClaim];
  if (typeof identityClaim !== "string" || !identityClaim.trim()) {
    throw new DatabricksError("missing_user_identity", 401);
  }
  const nowSeconds = Date.now() / 1_000;
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds + 30) {
    throw new DatabricksError("external_token_expired", 401);
  }
  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds + 60) {
    throw new DatabricksError("invalid_external_token", 401);
  }

  // This is only a defensive precheck. Databricks validates the JWT signature
  // and the account federation policy before returning an access token.
  return { claims, externalUserName: identityClaim.trim() };
}

function assertSameUser(vaultUserName: string, externalUserName: string, databricksUserName?: string): void {
  const identities = databricksUserName
    ? [vaultUserName, externalUserName, databricksUserName]
    : [vaultUserName, externalUserName];
  if (!sameUserName(...identities)) throw new DatabricksError("identity_mismatch", 403);
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

function decodeJwtPart<T>(value: string): T {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_an_object");
    return parsed as T;
  } catch {
    throw new DatabricksError("invalid_external_token", 401);
  }
}

function accessTokenExpiry(token: string): number {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return Number.POSITIVE_INFINITY;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1_000 : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function workspaceBase(config: BrokerConfig): string {
  return `https://${config.workspaceHost}`;
}
