import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

const baseEnv: NodeJS.ProcessEnv = {
  DBX_WORKSPACE_HOST: "workspace.example.com",
  DBX_GENIE_AGENT_ID: "01f1b7b1764a1a04adc67a648599a233",
  DBX_SP_CLIENT_ID: "service-principal-client-id",
  DBX_SP_CLIENT_SECRET: "service-principal-client-secret",
  DBX_SP_DISPLAY_NAME: "shared-genie-runtime",
  SALESFORCE_ALLOWED_ORIGINS: "https://crm.example.my.salesforce.com",
  SALESFORCE_ORG_IDS: "00D5g000004XyZaEAK",
  SALESFORCE_API_VERSION: "v62.0",
  STATE_ENCRYPTION_SECRET: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  ALLOWED_PARENT_ORIGINS: "https://crm.example--c.vf.force.com",
};

test("loads the fixed service-principal configuration", () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.genieAgentId, "01f1b7b1764a1a04adc67a648599a233");
  assert.equal(config.servicePrincipalClientId, "service-principal-client-id");
  assert.equal(config.servicePrincipalDisplayName, "shared-genie-runtime");
  assert.equal(config.servicePrincipalOauthScope, "all-apis");
  assert.equal(config.brokerSessionTtlMs, 900_000);
});

test("derives identity claims from the Salesforce username by default", () => {
  assert.equal(loadConfig(baseEnv).identityClaimSource, "username");
  assert.equal(loadConfig({ ...baseEnv, IDENTITY_CLAIM_SOURCE: "federation_id" }).identityClaimSource, "federation_id");
});

test("rejects an unknown identity claim source", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, IDENTITY_CLAIM_SOURCE: "email" }),
    /IDENTITY_CLAIM_SOURCE must be username or federation_id/,
  );
});

test("bounds the application session lifetime", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, BROKER_SESSION_TTL_SECONDS: "7200" }),
    /between 60 and 3600/,
  );
});

test("requires an HTTPS Salesforce origin", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, SALESFORCE_ALLOWED_ORIGINS: "http://crm.example.my.salesforce.com" }),
    /entries must use HTTPS/,
  );
});

test("requires a versioned Salesforce API path", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, SALESFORCE_API_VERSION: "62" }),
    /must look like v62.0/,
  );
});

test("stores organization IDs by their 15-character prefix", () => {
  const config = loadConfig({ ...baseEnv, SALESFORCE_ORG_IDS: "00D5g000004XyZaEAK, 00D3x000001AbCd" });
  assert.deepEqual([...config.salesforceOrgIds], ["00D5g000004XyZa", "00D3x000001AbCd"]);
});

test("requires at least one valid Salesforce organization ID", () => {
  assert.throws(() => loadConfig({ ...baseEnv, SALESFORCE_ORG_IDS: "" }), /SALESFORCE_ORG_IDS is required/);
  assert.throws(
    () => loadConfig({ ...baseEnv, SALESFORCE_ORG_IDS: "005xx000001SwiUAAS" }),
    /must be Salesforce organization IDs/,
  );
});

test("requires a server-side service-principal secret", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, DBX_SP_CLIENT_SECRET: "short" }),
    /DBX_SP_CLIENT_SECRET is invalid/,
  );
});

test("allows opaque native MyInsights origins only when explicitly enabled", () => {
  const config = loadConfig({
    ...baseEnv,
    ALLOWED_PARENT_ORIGINS: "",
    ALLOW_OPAQUE_PARENT_ORIGIN: "true",
  });
  assert.equal(config.allowOpaqueParentOrigin, true);
});

test("allows trusted Salesforce HTTPS origins only when explicitly enabled", () => {
  const config = loadConfig({
    ...baseEnv,
    ALLOWED_PARENT_ORIGINS: "",
    ALLOW_SALESFORCE_PARENT_ORIGINS: "true",
  });
  assert.equal(config.allowSalesforceParentOrigins, true);
});
