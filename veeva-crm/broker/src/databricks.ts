import type { BrokerConfig } from "./config.js";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export interface ServicePrincipalIdentity {
  accessToken: string;
  applicationId: string;
  displayName: string;
  identityClaim: string;
  expiresAt: number;
}

export class DatabricksError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code);
  }
}

// Each token carries one user's identity claim, so a cached token must only
// ever be reused for that same claim.
const MAX_CACHED_TOKENS = 2_000;
const cachedTokens = new Map<string, ServicePrincipalIdentity>();
const tokenRequests = new Map<string, Promise<ServicePrincipalIdentity>>();

export async function getServicePrincipalIdentity(
  config: BrokerConfig,
  identityClaim: string,
): Promise<ServicePrincipalIdentity> {
  const cached = cachedTokens.get(identityClaim);
  if (cached && cached.expiresAt > Date.now() + 120_000) return cached;
  const pending = tokenRequests.get(identityClaim);
  if (pending) return pending;
  const request = requestServicePrincipalToken(config, identityClaim);
  tokenRequests.set(identityClaim, request);
  try {
    const identity = await request;
    cacheToken(identity);
    return identity;
  } finally {
    tokenRequests.delete(identityClaim);
  }
}

async function requestServicePrincipalToken(
  config: BrokerConfig,
  identityClaim: string,
): Promise<ServicePrincipalIdentity> {
  const credentials = Buffer.from(
    `${config.servicePrincipalClientId}:${config.servicePrincipalClientSecret}`,
    "utf8",
  ).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: config.servicePrincipalOauthScope,
    custom_claim: identityClaim,
  });
  const response = await fetch(`${workspaceBase(config)}/oidc/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new DatabricksError("service_principal_token_failed", response.status || 502);
  }
  // Fail closed unless Databricks echoed the exact claim back for this service
  // principal; a token without it would bypass claim-scoped views.
  const claims = decodeJwtPayload(payload.access_token);
  const custom = claims?.custom as Record<string, unknown> | undefined;
  if (claims?.sub !== config.servicePrincipalClientId || custom?.claim !== identityClaim) {
    throw new DatabricksError("identity_claim_rejected", 502);
  }
  const lifetimeSeconds = Math.max(60, payload.expires_in ?? 3_600);
  return {
    accessToken: payload.access_token,
    applicationId: config.servicePrincipalClientId,
    displayName: config.servicePrincipalDisplayName,
    identityClaim,
    expiresAt: Date.now() + lifetimeSeconds * 1_000,
  };
}

function cacheToken(identity: ServicePrincipalIdentity): void {
  cachedTokens.delete(identity.identityClaim);
  cachedTokens.set(identity.identityClaim, identity);
  if (cachedTokens.size <= MAX_CACHED_TOKENS) return;
  const now = Date.now();
  for (const [claim, entry] of cachedTokens) {
    if (entry.expiresAt <= now) cachedTokens.delete(claim);
  }
  for (const claim of cachedTokens.keys()) {
    if (cachedTokens.size <= MAX_CACHED_TOKENS) break;
    cachedTokens.delete(claim);
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const segment = token.split(".")[1];
  if (!segment) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
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

export function clearIdentityCachesForTests(): void {
  cachedTokens.clear();
  tokenRequests.clear();
}

function workspaceBase(config: BrokerConfig): string {
  return `https://${config.workspaceHost}`;
}
