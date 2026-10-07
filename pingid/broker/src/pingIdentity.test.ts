import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import { extractIdentity } from "./pingIdentity.js";

const config: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
  identityClaimName: "sub",
  servicePrincipalClientId: "service-principal-client-id",
  servicePrincipalClientSecret: "service-principal-client-secret",
  servicePrincipalDisplayName: "shared-genie-runtime",
  servicePrincipalOauthScope: "all-apis",
  stateSecret: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  allowedParentOrigins: new Set(["https://caller.example.com"]),
  allowOpaqueParentOrigin: false,
  allowVeevaParentOrigins: false,
  port: 8787,
};

const NOW = 1_800_000_000_000;

// Minimal unsigned JWT: the broker trusts Kong and only decodes the payload.
function bearer(payload: Record<string, unknown>): string {
  const part = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `Bearer ${part({ alg: "RS256", typ: "JWT" })}.${part(payload)}.signature`;
}

test("extracts the sub claim from the Ping bearer token", () => {
  const actor = extractIdentity(bearer({ sub: "US-10293", name: "Dana Rep" }), config, NOW);
  assert.equal(actor.identityClaim, "us-10293");
  assert.equal(actor.displayName, "Dana Rep");
});

test("derives the identity from each request's own token", () => {
  assert.equal(extractIdentity(bearer({ sub: "rep-a" }), config, NOW).identityClaim, "rep-a");
  assert.equal(extractIdentity(bearer({ sub: "rep-b" }), config, NOW).identityClaim, "rep-b");
});

test("reads a configurable claim name", () => {
  const actor = extractIdentity(bearer({ sub: "ignored", territory_id: "EMEA-77" }), { ...config, identityClaimName: "territory_id" }, NOW);
  assert.equal(actor.identityClaim, "emea-77");
});

test("canonicalizes the claim value", () => {
  const actor = extractIdentity(bearer({ sub: "  US-10293  " }), config, NOW);
  assert.equal(actor.identityClaim, "us-10293");
});

test("coerces a numeric claim to a string", () => {
  const actor = extractIdentity(bearer({ sub: 10293 }), config, NOW);
  assert.equal(actor.identityClaim, "10293");
});

test("rejects a request with no bearer token", () => {
  assert.throws(() => extractIdentity(undefined, config, NOW), /missing_bearer_token/);
  assert.throws(() => extractIdentity("Basic abc", config, NOW), /missing_bearer_token/);
});

test("rejects a malformed bearer token", () => {
  assert.throws(() => extractIdentity("Bearer not-a-jwt", config, NOW), /invalid_bearer_token/);
  assert.throws(() => extractIdentity("Bearer a.bm90LWpzb24.c", config, NOW), /invalid_bearer_token/);
});

test("rejects an expired token even though Kong validates expiry", () => {
  const expired = Math.floor(NOW / 1_000) - 1;
  assert.throws(() => extractIdentity(bearer({ sub: "x1", exp: expired }), config, NOW), /bearer_token_expired/);
  const valid = Math.floor(NOW / 1_000) + 300;
  assert.equal(extractIdentity(bearer({ sub: "x1", exp: valid }), config, NOW).identityClaim, "x1");
});

test("rejects a token without the identity claim", () => {
  assert.throws(() => extractIdentity(bearer({ name: "No Subject" }), config, NOW), /identity_claim_missing/);
  assert.throws(() => extractIdentity(bearer({ sub: "" }), config, NOW), /identity_claim_missing/);
});

test("falls back through display-name claims and tolerates their absence", () => {
  assert.equal(extractIdentity(bearer({ sub: "x1", given_name: "Dana" }), config, NOW).displayName, "Dana");
  assert.equal(extractIdentity(bearer({ sub: "x1" }), config, NOW).displayName, null);
});
