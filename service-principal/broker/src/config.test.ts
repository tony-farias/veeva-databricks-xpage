import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

const baseEnv: NodeJS.ProcessEnv = {
  DBX_WORKSPACE_HOST: "workspace.example.com",
  DBX_GENIE_AGENT_ID: "01f1b7b1764a1a04adc67a648599a233",
  DBX_SP_CLIENT_ID: "service-principal-client-id",
  DBX_SP_CLIENT_SECRET: "service-principal-client-secret",
  DBX_SP_DISPLAY_NAME: "shared-genie-runtime",
  VEEVA_VAULT_ALLOWED_ORIGINS: "https://vault.example.com",
  VEEVA_VAULT_API_VERSION: "v26.1",
  STATE_ENCRYPTION_SECRET: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  ALLOWED_PARENT_ORIGINS: "https://vault.example.com",
};

test("loads the fixed service-principal configuration", () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.genieAgentId, "01f1b7b1764a1a04adc67a648599a233");
  assert.equal(config.servicePrincipalClientId, "service-principal-client-id");
  assert.equal(config.servicePrincipalDisplayName, "shared-genie-runtime");
  assert.equal(config.servicePrincipalOauthScope, "all-apis");
  assert.equal(config.brokerSessionTtlMs, 900_000);
});

test("derives identity claims from the Vault username by default", () => {
  assert.equal(loadConfig(baseEnv).identityClaimSource, "user_name");
  assert.equal(loadConfig({ ...baseEnv, IDENTITY_CLAIM_SOURCE: "federated_id" }).identityClaimSource, "federated_id");
});

test("rejects an unknown identity claim source", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, IDENTITY_CLAIM_SOURCE: "email" }),
    /IDENTITY_CLAIM_SOURCE must be user_name or federated_id/,
  );
});

test("bounds the application session lifetime", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, BROKER_SESSION_TTL_SECONDS: "7200" }),
    /between 60 and 3600/,
  );
});

test("requires an HTTPS Vault origin", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, VEEVA_VAULT_ALLOWED_ORIGINS: "http://vault.example.com" }),
    /entries must use HTTPS/,
  );
});

test("requires a versioned Vault API path", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, VEEVA_VAULT_API_VERSION: "latest" }),
    /must look like v26.1/,
  );
});

test("requires a server-side service-principal secret", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, DBX_SP_CLIENT_SECRET: "short" }),
    /DBX_SP_CLIENT_SECRET is invalid/,
  );
});

test("allows opaque native X-Page origins only when explicitly enabled", () => {
  const config = loadConfig({
    ...baseEnv,
    ALLOWED_PARENT_ORIGINS: "",
    ALLOW_OPAQUE_PARENT_ORIGIN: "true",
  });
  assert.equal(config.allowOpaqueParentOrigin, true);
});

test("allows trusted Veeva HTTPS origins only when explicitly enabled", () => {
  const config = loadConfig({
    ...baseEnv,
    ALLOWED_PARENT_ORIGINS: "",
    ALLOW_VEEVA_PARENT_ORIGINS: "true",
  });
  assert.equal(config.allowVeevaParentOrigins, true);
});
