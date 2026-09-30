import type { BrokerConfig } from "./config.js";

export interface VaultActorIdentity {
  userName: string;
  displayName: string | null;
  subject: string;
}

export class VeevaError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code);
  }
}

export async function verifyVaultSession(
  sessionId: string,
  vaultUrl: string,
  config: BrokerConfig,
): Promise<VaultActorIdentity> {
  if (!/^[\x21-\x7e]{16,8192}$/.test(sessionId)) {
    throw new VeevaError("invalid_vault_session", 401);
  }

  let origin: string;
  try {
    origin = new URL(vaultUrl).origin;
  } catch {
    throw new VeevaError("vault_origin_not_allowed", 403);
  }
  if (!config.veevaVaultOrigins.has(origin)) {
    throw new VeevaError("vault_origin_not_allowed", 403);
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
    throw new VeevaError("vault_identity_unavailable", 502);
  }
  if (response.status === 401 || response.status === 403) {
    throw new VeevaError("invalid_vault_session", 401);
  }
  if (!response.ok) throw new VeevaError("vault_identity_unavailable", 502);

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (hasVaultError(payload, "INVALID_SESSION_ID")) {
    throw new VeevaError("invalid_vault_session", 401);
  }
  if (payload.responseStatus !== "SUCCESS") {
    throw new VeevaError("vault_identity_unavailable", 502);
  }

  const user = currentVaultUser(payload);
  const userName = typeof user?.user_name__v === "string" ? user.user_name__v.trim() : "";
  const subject = typeof user?.id === "string" || typeof user?.id === "number" ? String(user.id) : "";
  if (!user || !userName || !subject) throw new VeevaError("vault_identity_unavailable", 502);
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
