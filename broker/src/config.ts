export interface BrokerConfig {
  workspaceHost: string;
  genieSpaceId: string;
  veevaSsoIssuer: string;
  veevaSsoAudience: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  genieRedirectUrl: string;
  oauthScopes: string;
  stateSecret: string;
  allowedParentOrigins: ReadonlySet<string>;
  allowOpaqueParentOrigin: boolean;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const workspaceHost = normalizeHost(required(env, "DBX_WORKSPACE_HOST"));
  if (!/^[a-z0-9.-]+$/i.test(workspaceHost)) throw new Error("DBX_WORKSPACE_HOST is invalid");

  const genieSpaceId = required(env, "DBX_GENIE_SPACE_ID");
  if (!/^[a-z0-9_-]{8,128}$/i.test(genieSpaceId)) throw new Error("DBX_GENIE_SPACE_ID is invalid");

  const veevaSsoIssuer = new URL(required(env, "VEEVA_SSO_ISSUER"));
  if (veevaSsoIssuer.protocol !== "https:") throw new Error("VEEVA_SSO_ISSUER must use HTTPS");
  const veevaSsoAudience = required(env, "VEEVA_SSO_AUDIENCE");

  const redirectUri = required(env, "DBX_REDIRECT_URI");
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== "https:" && !(redirect.protocol === "http:" && isLocalhost(redirect.hostname))) {
    throw new Error("DBX_REDIRECT_URI must use HTTPS (except localhost development)");
  }

  const genieRedirect = new URL(required(env, "DBX_GENIE_REDIRECT_URL"));
  if (genieRedirect.protocol !== "https:" || genieRedirect.hostname !== workspaceHost) {
    throw new Error("DBX_GENIE_REDIRECT_URL must be an HTTPS URL on DBX_WORKSPACE_HOST");
  }
  if (!/^\/genie\/rooms\/[a-z0-9_-]+\/?$/i.test(genieRedirect.pathname)) {
    throw new Error("DBX_GENIE_REDIRECT_URL must point to a full Genie room");
  }

  const stateSecret = required(env, "STATE_ENCRYPTION_SECRET");
  if (Buffer.byteLength(stateSecret, "utf8") < 32) {
    throw new Error("STATE_ENCRYPTION_SECRET must contain at least 32 bytes");
  }

  const origins = new Set<string>();
  for (const raw of (env.ALLOWED_PARENT_ORIGINS ?? "").split(",")) {
    const value = raw.trim();
    if (!value) continue;
    const url = new URL(value);
    if (url.origin !== value.replace(/\/$/, "")) {
      throw new Error(`ALLOWED_PARENT_ORIGINS must contain origins only: ${value}`);
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost(url.hostname))) {
      throw new Error(`Parent origin must use HTTPS: ${value}`);
    }
    origins.add(url.origin);
  }

  const allowOpaqueParentOrigin = parseBoolean(env.ALLOW_OPAQUE_PARENT_ORIGIN ?? "false");
  if (origins.size === 0 && !allowOpaqueParentOrigin) {
    throw new Error("Configure ALLOWED_PARENT_ORIGINS or explicitly enable opaque X-Page origins");
  }

  const port = Number(env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid");

  return {
    workspaceHost,
    genieSpaceId,
    veevaSsoIssuer: veevaSsoIssuer.toString().replace(/\/$/, ""),
    veevaSsoAudience,
    clientId: required(env, "DBX_CLIENT_ID"),
    clientSecret: required(env, "DBX_CLIENT_SECRET"),
    redirectUri: redirect.toString(),
    genieRedirectUrl: genieRedirect.toString(),
    oauthScopes: env.DBX_OAUTH_SCOPES?.trim() || "iam.current-user:read",
    stateSecret,
    allowedParentOrigins: origins,
    allowOpaqueParentOrigin,
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

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected true or false, received ${value}`);
}
