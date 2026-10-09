export type IdentityClaimSource = "username" | "federation_id";

export interface BrokerConfig {
  workspaceHost: string;
  genieAgentId: string;
  salesforceOrigins: ReadonlySet<string>;
  salesforceOrgIds: ReadonlySet<string>;
  salesforceApiVersion: string;
  identityClaimSource: IdentityClaimSource;
  servicePrincipalClientId: string;
  servicePrincipalClientSecret: string;
  servicePrincipalDisplayName: string;
  servicePrincipalOauthScope: string;
  brokerSessionTtlMs: number;
  stateSecret: string;
  allowedParentOrigins: ReadonlySet<string>;
  allowOpaqueParentOrigin: boolean;
  allowSalesforceParentOrigins: boolean;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const workspaceHost = normalizeHost(required(env, "DBX_WORKSPACE_HOST"));
  if (!/^[a-z0-9.-]+$/i.test(workspaceHost)) throw new Error("DBX_WORKSPACE_HOST is invalid");

  const genieAgentId = required(env, "DBX_GENIE_AGENT_ID");
  if (!/^[a-z0-9_-]{8,128}$/i.test(genieAgentId)) throw new Error("DBX_GENIE_AGENT_ID is invalid");

  const salesforceOrigins = parseOrigins(required(env, "SALESFORCE_ALLOWED_ORIGINS"), "SALESFORCE_ALLOWED_ORIGINS");
  const salesforceOrgIds = parseOrgIds(required(env, "SALESFORCE_ORG_IDS"));
  const salesforceApiVersion = required(env, "SALESFORCE_API_VERSION");
  if (!/^v\d{2,3}\.0$/.test(salesforceApiVersion)) {
    throw new Error("SALESFORCE_API_VERSION must look like v62.0");
  }

  const identityClaimSource = env.IDENTITY_CLAIM_SOURCE?.trim() || "username";
  if (identityClaimSource !== "username" && identityClaimSource !== "federation_id") {
    throw new Error("IDENTITY_CLAIM_SOURCE must be username or federation_id");
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
  const allowSalesforceParentOrigins = parseBoolean(env.ALLOW_SALESFORCE_PARENT_ORIGINS ?? "false");
  if (origins.size === 0 && !allowOpaqueParentOrigin && !allowSalesforceParentOrigins) {
    throw new Error("Configure an allowed MyInsights origin policy");
  }

  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT is invalid");

  return {
    workspaceHost,
    genieAgentId,
    salesforceOrigins,
    salesforceOrgIds,
    salesforceApiVersion,
    identityClaimSource,
    servicePrincipalClientId,
    servicePrincipalClientSecret,
    servicePrincipalDisplayName: env.DBX_SP_DISPLAY_NAME?.trim() || servicePrincipalClientId,
    servicePrincipalOauthScope: env.DBX_SP_OAUTH_SCOPE?.trim() || "all-apis",
    brokerSessionTtlMs: brokerSessionTtlSeconds * 1_000,
    stateSecret,
    allowedParentOrigins: origins,
    allowOpaqueParentOrigin,
    allowSalesforceParentOrigins,
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
  if (origins.size === 0 && name === "SALESFORCE_ALLOWED_ORIGINS") {
    throw new Error("SALESFORCE_ALLOWED_ORIGINS must contain at least one origin");
  }
  return origins;
}

// Salesforce returns 18-character IDs from its APIs, while Setup shows the
// 15-character form. Both share the case-sensitive 15-character prefix.
function parseOrgIds(value: string): Set<string> {
  const orgIds = new Set<string>();
  for (const raw of value.split(",")) {
    const candidate = raw.trim();
    if (!candidate) continue;
    if (!/^00D[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(candidate)) {
      throw new Error(`SALESFORCE_ORG_IDS entries must be Salesforce organization IDs: ${candidate}`);
    }
    orgIds.add(candidate.slice(0, 15));
  }
  if (orgIds.size === 0) throw new Error("SALESFORCE_ORG_IDS must contain at least one organization ID");
  return orgIds;
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected true or false, received ${value}`);
}
