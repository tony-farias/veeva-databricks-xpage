import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

const baseEnv: NodeJS.ProcessEnv = {
  DBX_WORKSPACE_HOST: "workspace.example.com",
  DBX_GENIE_AGENT_ID: "01f1b7b1764a1a04adc67a648599a233",
  DBX_SP_CLIENT_ID: "service-principal-client-id",
  DBX_SP_CLIENT_SECRET: "service-principal-client-secret",
  DBX_SP_DISPLAY_NAME: "shared-genie-runtime",
  STATE_ENCRYPTION_SECRET: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  ALLOWED_PARENT_ORIGINS: "https://caller.example.com",
};

test("loads the fixed service-principal configuration", () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.genieAgentId, "01f1b7b1764a1a04adc67a648599a233");
  assert.equal(config.servicePrincipalClientId, "service-principal-client-id");
  assert.equal(config.servicePrincipalDisplayName, "shared-genie-runtime");
  assert.equal(config.servicePrincipalOauthScope, "all-apis");
  assert.equal(config.brokerSessionTtlMs, 900_000);
});

test("defaults the identity claim name to mudid and allows an override", () => {
  assert.equal(loadConfig(baseEnv).identityClaimName, "mudid");
  assert.equal(loadConfig({ ...baseEnv, IDENTITY_CLAIM_NAME: "territory_id" }).identityClaimName, "territory_id");
});

test("rejects an invalid identity claim name", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, IDENTITY_CLAIM_NAME: "has spaces" }),
    /IDENTITY_CLAIM_NAME must be a valid JWT claim name/,
  );
});

test("bounds the application session lifetime", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, BROKER_SESSION_TTL_SECONDS: "7200" }),
    /between 60 and 3600/,
  );
});

test("requires a server-side service-principal secret", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, DBX_SP_CLIENT_SECRET: "short" }),
    /DBX_SP_CLIENT_SECRET is invalid/,
  );
});

test("requires an allowed caller origin policy", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, ALLOWED_PARENT_ORIGINS: "" }),
    /Configure an allowed caller origin policy/,
  );
});

test("allows opaque native caller origins only when explicitly enabled", () => {
  const config = loadConfig({
    ...baseEnv,
    ALLOWED_PARENT_ORIGINS: "",
    ALLOW_OPAQUE_PARENT_ORIGIN: "true",
  });
  assert.equal(config.allowOpaqueParentOrigin, true);
});

test("requires HTTPS caller origins", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, ALLOWED_PARENT_ORIGINS: "http://caller.example.com" }),
    /entries must use HTTPS/,
  );
});
