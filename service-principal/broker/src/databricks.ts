import type { BrokerConfig } from "./config.js";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export interface ActorIdentity {
  userName: string;
  displayName: string | null;
  subject: string;
}

export interface ServicePrincipalIdentity {
  accessToken: string;
  applicationId: string;
  displayName: string;
  expiresAt: number;
}

export class DatabricksError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code);
  }
}

let cachedServicePrincipalToken: ServicePrincipalIdentity | undefined;
let tokenRequest: Promise<ServicePrincipalIdentity> | undefined;

export async function verifyVaultSession(
  sessionId: string,
  vaultUrl: string,
  config: BrokerConfig,
): Promise<ActorIdentity> {
  if (!/^[\x21-\x7e]{16,8192}$/.test(sessionId)) {
    throw new DatabricksError("invalid_vault_session", 401);
  }

  let origin: string;
  try {
    origin = new URL(vaultUrl).origin;
  } catch {
    throw new DatabricksError("vault_origin_not_allowed", 403);
  }
  if (!config.veevaVaultOrigins.has(origin)) {
    throw new DatabricksError("vault_origin_not_allowed", 403);
  }

  let response: Response;
  try {
    const endpoint = new URL(`/api/${config.veevaVaultApiVersion}/objects/users/me`, origin);
    response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        Authorization: sessionId,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new DatabricksError("vault_identity_unavailable", 502);
  }
  if (response.status === 401 || response.status === 403) {
    throw new DatabricksError("invalid_vault_session", 401);
  }
  if (!response.ok) throw new DatabricksError("vault_identity_unavailable", 502);

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (hasVaultError(payload, "INVALID_SESSION_ID")) {
    throw new DatabricksError("invalid_vault_session", 401);
  }
  const user = currentVaultUser(payload);
  const userName = typeof user?.user_name__v === "string" ? user.user_name__v : undefined;
  const subject = typeof user?.id === "string" || typeof user?.id === "number" ? String(user.id) : undefined;
  if (payload.responseStatus !== "SUCCESS") {
    throw new DatabricksError("vault_identity_unavailable", 502);
  }
  if (!user || !userName || !subject) throw new DatabricksError("vault_identity_unavailable", 502);
  return {
    userName,
    displayName: vaultDisplayName(user),
    subject,
  };
}

function currentVaultUser(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(payload.users) || !payload.users.length) return undefined;
  const entry = payload.users[0];
  if (!entry || typeof entry !== "object") return undefined;
  const user = (entry as Record<string, unknown>).user;
  return user && typeof user === "object" ? user as Record<string, unknown> : undefined;
}

function hasVaultError(payload: Record<string, unknown>, expected: string): boolean {
  if (!Array.isArray(payload.errors)) return false;
  return payload.errors.some((error) => Boolean(
    error && typeof error === "object" && (error as Record<string, unknown>).type === expected,
  ));
}

function vaultDisplayName(user: Record<string, unknown>): string | null {
  const parts = [user.user_first_name__v, user.user_last_name__v]
    .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
    .map((part) => part.trim());
  return parts.length ? parts.join(" ") : null;
}

export async function getServicePrincipalIdentity(config: BrokerConfig): Promise<ServicePrincipalIdentity> {
  if (cachedServicePrincipalToken && cachedServicePrincipalToken.expiresAt > Date.now() + 120_000) {
    return cachedServicePrincipalToken;
  }
  if (tokenRequest) return tokenRequest;
  tokenRequest = requestServicePrincipalToken(config);
  try {
    cachedServicePrincipalToken = await tokenRequest;
    return cachedServicePrincipalToken;
  } finally {
    tokenRequest = undefined;
  }
}

async function requestServicePrincipalToken(config: BrokerConfig): Promise<ServicePrincipalIdentity> {
  const credentials = Buffer.from(
    `${config.servicePrincipalClientId}:${config.servicePrincipalClientSecret}`,
    "utf8",
  ).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: config.servicePrincipalOauthScope,
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
  const lifetimeSeconds = Math.max(60, payload.expires_in ?? 3_600);
  return {
    accessToken: payload.access_token,
    applicationId: config.servicePrincipalClientId,
    displayName: config.servicePrincipalDisplayName,
    expiresAt: Date.now() + lifetimeSeconds * 1_000,
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

export function clearIdentityCachesForTests(): void {
  cachedServicePrincipalToken = undefined;
  tokenRequest = undefined;
}

function workspaceBase(config: BrokerConfig): string {
  return `https://${config.workspaceHost}`;
}
