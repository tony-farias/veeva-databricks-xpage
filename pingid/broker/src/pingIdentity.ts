import type { BrokerConfig } from "./config.js";
import { canonicalIdentityClaim } from "./identity.js";

export interface EndUserIdentity {
  identityClaim: string;
  displayName: string | null;
}

export class IdentityError extends Error {
  constructor(readonly code: string, readonly status = 401) {
    super(code);
  }
}

// Trust model: Kong authenticates the Ping Federate bearer token (signature,
// issuer, audience, expiry) and forwards it on the Authorization header. The
// broker trusts that validation and only reads the identity claim from the
// token payload — it does not re-verify the token. The claim value becomes the
// Databricks OAuth custom claim that drives row scoping.
export function extractIdentity(authorizationHeader: string | undefined, config: BrokerConfig): EndUserIdentity {
  const token = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new IdentityError("missing_bearer_token", 401);

  const payload = decodeJwtPayload(token);
  if (!payload) throw new IdentityError("invalid_bearer_token", 401);

  const raw = payload[config.identityClaimName];
  const value = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
  const identityClaim = value ? canonicalIdentityClaim(value) : null;
  if (!identityClaim) throw new IdentityError("identity_claim_missing", 403);

  const displayName = pickDisplayName(payload);
  return { identityClaim, displayName };
}

function pickDisplayName(payload: Record<string, unknown>): string | null {
  for (const key of ["name", "given_name", "preferred_username"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const segment = token.split(".")[1];
  if (!segment) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
