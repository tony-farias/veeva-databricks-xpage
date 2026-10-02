import type { BrokerConfig, IdentityClaimSource } from "./config.js";
import { canonicalIdentityClaim } from "./identity.js";

export interface VaultActorIdentity {
  userName: string;
  displayName: string | null;
  subject: string;
  identityClaim: string;
  identityClaimSource: IdentityClaimSource;
}

export class VeevaError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code);
  }
}

export async function verifyVaultIdentity(
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

  const payload = await vaultGet(`/api/${config.veevaVaultApiVersion}/objects/users/me`, origin, sessionId, true);
  const user = currentVaultUser(payload);
  const userName = typeof user?.user_name__v === "string" ? user.user_name__v.trim() : "";
  const subject = typeof user?.id === "string" || typeof user?.id === "number" ? String(user.id) : "";
  if (!user || !userName || !subject) throw new VeevaError("vault_identity_unavailable", 502);

  const claimSourceValue = config.identityClaimSource === "federated_id"
    ? await retrieveVaultFederatedId(sessionId, origin, subject, config)
    : userName;
  const identityClaim = claimSourceValue ? canonicalIdentityClaim(claimSourceValue) : null;
  if (!identityClaim) throw new VeevaError("identity_claim_unavailable", 403);

  return {
    userName,
    displayName: vaultDisplayName(user),
    subject,
    identityClaim,
    identityClaimSource: config.identityClaimSource,
  };
}

async function retrieveVaultFederatedId(
  sessionId: string,
  origin: string,
  subject: string,
  config: BrokerConfig,
): Promise<string | null> {
  const payload = await vaultGet(
    `/api/${config.veevaVaultApiVersion}/vobjects/user__sys/${encodeURIComponent(subject)}`,
    origin,
    sessionId,
    false,
  );
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new VeevaError("vault_identity_unavailable", 502);
  }
  const record = data as Record<string, unknown>;
  if (String(record.id ?? "") !== subject) {
    throw new VeevaError("vault_identity_unavailable", 502);
  }
  return typeof record.federated_id__sys === "string" && record.federated_id__sys.trim()
    ? record.federated_id__sys.trim()
    : null;
}

// A 403 from users/me means the session itself is unusable; a 403 from a record
// lookup means the user cannot read that object, which is not a session problem.
async function vaultGet(
  path: string,
  origin: string,
  sessionId: string,
  forbiddenIsInvalidSession: boolean,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(new URL(path, origin), {
      headers: {
        Accept: "application/json",
        Authorization: sessionId,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new VeevaError("vault_identity_unavailable", 502);
  }
  if (response.status === 401 || (forbiddenIsInvalidSession && response.status === 403)) {
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
  return payload;
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
