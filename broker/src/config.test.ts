import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

const baseEnv: NodeJS.ProcessEnv = {
  DBX_WORKSPACE_HOST: "workspace.example.com",
  DBX_GENIE_AGENT_ID: "01f1b7b1764a1a04adc67a648599a233",
  VEEVA_SSO_ISSUER: "https://login.example.com/tenant/v2.0",
  VEEVA_SSO_AUDIENCE: "veeva-xpage-client-id",
  VEEVA_SSO_USERNAME_CLAIM: "email",
  VEEVA_VAULT_ALLOWED_ORIGINS: "https://vault.example.com",
  VEEVA_VAULT_API_VERSION: "v26.1",
  STATE_ENCRYPTION_SECRET: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  ALLOWED_PARENT_ORIGINS: "https://vault.example.com",
};

test("loads account-wide user federation configuration without a Databricks client secret", () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.genieAgentId, "01f1b7b1764a1a04adc67a648599a233");
  assert.equal(config.federatedTokenIssuer, "https://login.example.com/tenant/v2.0");
  assert.deepEqual([...config.federatedTokenAudiences], ["veeva-xpage-client-id"]);
  assert.equal(config.federatedUsernameClaim, "email");
  assert.equal(config.brokerSessionTtlMs, 900_000);
});

test("supports more than one accepted audience", () => {
  const config = loadConfig({
    ...baseEnv,
    VEEVA_SSO_AUDIENCE: "",
    VEEVA_SSO_AUDIENCES: "api://veeva, databricks",
  });
  assert.deepEqual([...config.federatedTokenAudiences], ["api://veeva", "databricks"]);
});

test("defaults the identity mapping to preferred_username", () => {
  const config = loadConfig({ ...baseEnv, VEEVA_SSO_USERNAME_CLAIM: "" });
  assert.equal(config.federatedUsernameClaim, "preferred_username");
});

test("requires an HTTPS token issuer", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, VEEVA_SSO_ISSUER: "http://login.example.com/tenant/v2.0" }),
    /must use HTTPS/,
  );
});

test("bounds the encrypted broker session lifetime", () => {
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
