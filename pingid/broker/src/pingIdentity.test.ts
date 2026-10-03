import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import { extractIdentity } from "./pingIdentity.js";

const config: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
  identityClaimName: "mudid",
  servicePrincipalClientId: "service-principal-client-id",
  servicePrincipalClientSecret: "service-principal-client-secret",
  servicePrincipalDisplayName: "shared-genie-runtime",
  servicePrincipalOauthScope: "all-apis",
  brokerSessionTtlMs: 900_000,
  stateSecret: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  allowedParentOrigins: new Set(["https://caller.example.com"]),
  allowOpaqueParentOrigin: false,
  allowVeevaParentOrigins: false,
  port: 8787,
};

// Minimal unsigned JWT: the broker trusts Kong and only decodes the payload.
function bearer(payload: Record<string, unknown>): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `Bearer ${part({ alg: "RS256", typ: "JWT" })}.${part(payload)}.signature`;
}

test("extracts the identity claim from the Ping bearer token", () => {
  const actor = extractIdentity(bearer({ mudid: "US-10293", name: "Dana Rep" }), config);
  assert.equal(actor.identityClaim, "us-10293");
  assert.equal(actor.displayName, "Dana Rep");
});

test("reads a configurable claim name", () => {
  const actor = extractIdentity(bearer({ territory_id: "EMEA-77" }), { ...config, identityClaimName: "territory_id" });
  assert.equal(actor.identityClaim, "emea-77");
});

test("canonicalizes the claim value", () => {
  const actor = extractIdentity(bearer({ mudid: "  US-10293  " }), config);
  assert.equal(actor.identityClaim, "us-10293");
});

test("coerces a numeric claim to a string", () => {
  const actor = extractIdentity(bearer({ mudid: 10293 }), config);
  assert.equal(actor.identityClaim, "10293");
});

test("rejects a request with no bearer token", () => {
  assert.throws(() => extractIdentity(undefined, config), /missing_bearer_token/);
  assert.throws(() => extractIdentity("Basic abc", config), /missing_bearer_token/);
});

test("rejects a malformed bearer token", () => {
  assert.throws(() => extractIdentity("Bearer not-a-jwt", config), /invalid_bearer_token/);
});

test("rejects a token without the identity claim", () => {
  assert.throws(() => extractIdentity(bearer({ sub: "abc" }), config), /identity_claim_missing/);
  assert.throws(() => extractIdentity(bearer({ mudid: "" }), config), /identity_claim_missing/);
});

test("falls back through display-name claims and tolerates their absence", () => {
  assert.equal(extractIdentity(bearer({ mudid: "x1", given_name: "Dana" }), config).displayName, "Dana");
  assert.equal(extractIdentity(bearer({ mudid: "x1" }), config).displayName, null);
});
