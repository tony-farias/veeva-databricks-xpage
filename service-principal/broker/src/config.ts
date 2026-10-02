export type IdentityClaimSource = "user_name" | "federated_id";

export interface BrokerConfig {
  workspaceHost: string;
  genieAgentId: string;
  veevaVaultOrigins: ReadonlySet<string>;
  veevaVaultApiVersion: string;
  identityClaimSource: IdentityClaimSource;
  servicePrincipalClientId: string;
  servicePrincipalClientSecret: string;
  servicePrincipalDisplayName: string;
  servicePrincipalOauthScope: string;
  brokerSessionTtlMs: number;
  stateSecret: string;
  allowedParentOrigins: ReadonlySet<string>;
  allowOpaqueParentOrigin: boolean;
  allowVeevaParentOrigins: boolean;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const workspaceHost = normalizeHost(required(env, "DBX_WORKSPACE_HOST"));
  if (!/^[a-z0-9.-]+$/i.test(workspaceHost)) throw new Error("DBX_WORKSPACE_HOST is invalid");

  const genieAgentId = required(env, "DBX_GENIE_AGENT_ID");
  if (!/^[a-z0-9_-]{8,128}$/i.test(genieAgentId)) throw new Error("DBX_GENIE_AGENT_ID is invalid");

  const veevaVaultOrigins = parseOrigins(required(env, "VEEVA_VAULT_ALLOWED_ORIGINS"), "VEEVA_VAULT_ALLOWED_ORIGINS");
  const veevaVaultApiVersion = required(env, "VEEVA_VAULT_API_VERSION");
  if (!/^v\d{2}\.\d$/.test(veevaVaultApiVersion)) {
    throw new Error("VEEVA_VAULT_API_VERSION must look like v26.1");
  }

  const identityClaimSource = env.IDENTITY_CLAIM_SOURCE?.trim() || "user_name";
  if (identityClaimSource !== "user_name" && identityClaimSource !== "federated_id") {
    throw new Error("IDENTITY_CLAIM_SOURCE must be user_name or federated_id");
  }

  const servicePrincipalClientId = required(env, "DBX_SP_CLIENT_ID");
  if (!/^[a-z0-9_-]{8,128}$/i.test(servicePrincipalClientId)) throw new Error("DBX_SP_CLIENT_ID is invalid");
  const servicePrincipalClientSecret = required(env, "DBX_SP_CLIENT_SECRET");
  if (servicePrincipalClientSecret.length < 16) throw new Error("DBX_SP_CLIENT_SECRET is invalid");

  const stateSecret = required(env, "STATE_ENCRYPTION_SECRET");
  if (Buffer.byteLength(stateSecret, "utf8") < 32) {
    throw new Error("STATE_ENCRYPTION_SECRET must contain at least 32 bytes");
  }

  const brokerSessionTtlSeconds = Number(env.BROKER_SESSION_TTL_SECONDS ?? "900");
  if (!Number.isInteger(brokerSessionTtlSeconds) || brokerSessionTtlSeconds < 60 || brokerSessionTtlSeconds > 3_600) {
    throw new Error("BROKER_SESSION_TTL_SECONDS must be an integer between 60 and 3600");
  }

  const origins = parseOrigins(env.ALLOWED_PARENT_ORIGINS ?? "", "ALLOWED_PARENT_ORIGINS");

  const allowOpaqueParentOrigin = parseBoolean(env.ALLOW_OPAQUE_PARENT_ORIGIN ?? "false");
  const allowVeevaParentOrigins = parseBoolean(env.ALLOW_VEEVA_PARENT_ORIGINS ?? "false");
  if (origins.size === 0 && !allowOpaqueParentOrigin && !allowVeevaParentOrigins) {
    throw new Error("Configure an allowed X-Page origin policy");
  }

  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT is invalid");

  return {
    workspaceHost,
    genieAgentId,
    veevaVaultOrigins,
    veevaVaultApiVersion,
    identityClaimSource,
    servicePrincipalClientId,
    servicePrincipalClientSecret,
    servicePrincipalDisplayName: env.DBX_SP_DISPLAY_NAME?.trim() || servicePrincipalClientId,
    servicePrincipalOauthScope: env.DBX_SP_OAUTH_SCOPE?.trim() || "all-apis",
    brokerSessionTtlMs: brokerSessionTtlSeconds * 1_000,
    stateSecret,
    allowedParentOrigins: origins,
    allowOpaqueParentOrigin,
    allowVeevaParentOrigins,
    port,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeHost(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function parseOrigins(value: string, name: string): Set<string> {
  const origins = new Set<string>();
  for (const raw of value.split(",")) {
    const candidate = raw.trim();
    if (!candidate) continue;
    const url = new URL(candidate);
    if (url.origin !== candidate.replace(/\/$/, "")) {
      throw new Error(`${name} must contain origins only: ${candidate}`);
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname))) {
      throw new Error(`${name} entries must use HTTPS: ${candidate}`);
    }
    origins.add(url.origin);
  }
  if (origins.size === 0 && name === "VEEVA_VAULT_ALLOWED_ORIGINS") {
    throw new Error("VEEVA_VAULT_ALLOWED_ORIGINS must contain at least one origin");
  }
  return origins;
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected true or false, received ${value}`);
}
