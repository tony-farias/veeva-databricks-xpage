import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import { clearIdentityCachesForTests, getServicePrincipalIdentity } from "./databricks.js";

const baseConfig: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
  veevaVaultOrigins: new Set(["https://vault.example.com"]),
  veevaVaultApiVersion: "v26.1",
  identityClaimSource: "user_name",
  servicePrincipalClientId: "service-principal-client-id",
  servicePrincipalClientSecret: "service-principal-client-secret",
  servicePrincipalDisplayName: "shared-genie-runtime",
  servicePrincipalOauthScope: "all-apis",
  brokerSessionTtlMs: 900_000,
  stateSecret: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  allowedParentOrigins: new Set(["https://vault.example.com"]),
  allowOpaqueParentOrigin: false,
  allowVeevaParentOrigins: false,
  port: 8787,
};

function fakeJwt(payload: Record<string, unknown>): string {
  return ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");
}

function mockTokenEndpoint(
  context: test.TestContext,
  issue: (claim: string) => string,
): string[] {
  clearIdentityCachesForTests();
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    clearIdentityCachesForTests();
  });
  const requestedClaims: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://workspace.example.com/oidc/v1/token");
    assert.match(String(new Headers(init?.headers).get("Authorization")), /^Basic /);
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "client_credentials");
    assert.equal(body.get("scope"), "all-apis");
    const claim = body.get("custom_claim") ?? "";
    requestedClaims.push(claim);
    return new Response(JSON.stringify({ access_token: issue(claim), expires_in: 3_600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return requestedClaims;
}

test("requests a service-principal token that carries the identity claim", async (context) => {
  const requested = mockTokenEndpoint(context, (claim) => fakeJwt({
    sub: baseConfig.servicePrincipalClientId,
    custom: { claim },
  }));

  const identity = await getServicePrincipalIdentity(baseConfig, "person@example.com");
  assert.deepEqual(requested, ["person@example.com"]);
  assert.equal(identity.identityClaim, "person@example.com");
  assert.equal(identity.applicationId, baseConfig.servicePrincipalClientId);
});

test("caches tokens per identity claim and never shares them across claims", async (context) => {
  const requested = mockTokenEndpoint(context, (claim) => fakeJwt({
    sub: baseConfig.servicePrincipalClientId,
    custom: { claim },
  }));

  const alice = await getServicePrincipalIdentity(baseConfig, "alice@example.com");
  const bob = await getServicePrincipalIdentity(baseConfig, "bob@example.com");
  const aliceAgain = await getServicePrincipalIdentity(baseConfig, "alice@example.com");
  assert.deepEqual(requested, ["alice@example.com", "bob@example.com"]);
  assert.notEqual(alice.accessToken, bob.accessToken);
  assert.equal(aliceAgain.accessToken, alice.accessToken);
});

test("shares one in-flight token request per identity claim", async (context) => {
  const requested = mockTokenEndpoint(context, (claim) => fakeJwt({
    sub: baseConfig.servicePrincipalClientId,
    custom: { claim },
  }));

  const [first, second] = await Promise.all([
    getServicePrincipalIdentity(baseConfig, "alice@example.com"),
    getServicePrincipalIdentity(baseConfig, "alice@example.com"),
  ]);
  assert.equal(first.accessToken, second.accessToken);
  assert.deepEqual(requested, ["alice@example.com"]);
});

test("rejects a token whose identity claim differs from the request", async (context) => {
  mockTokenEndpoint(context, () => fakeJwt({
    sub: baseConfig.servicePrincipalClientId,
    custom: { claim: "someone-else@example.com" },
  }));
  await assert.rejects(getServicePrincipalIdentity(baseConfig, "alice@example.com"), /identity_claim_rejected/);
});

test("rejects a token without an identity claim", async (context) => {
  mockTokenEndpoint(context, () => fakeJwt({ sub: baseConfig.servicePrincipalClientId }));
  await assert.rejects(getServicePrincipalIdentity(baseConfig, "alice@example.com"), /identity_claim_rejected/);
});

test("rejects a token issued to another principal", async (context) => {
  mockTokenEndpoint(context, (claim) => fakeJwt({ sub: "other-principal", custom: { claim } }));
  await assert.rejects(getServicePrincipalIdentity(baseConfig, "alice@example.com"), /identity_claim_rejected/);
});

test("rejects an opaque token whose claim cannot be confirmed", async (context) => {
  mockTokenEndpoint(context, () => "opaque-token-value");
  await assert.rejects(getServicePrincipalIdentity(baseConfig, "alice@example.com"), /identity_claim_rejected/);
});
