import assert from "node:assert/strict";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import { exchangeFederatedAssertion, sameUserName } from "./databricks.js";

const baseConfig: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
  federatedTokenIssuer: "https://idp.example.com/oauth2/default",
  federatedTokenAudiences: new Set(["veeva-xpage"]),
  federatedUsernameClaim: "email",
  veevaVaultOrigins: new Set(["https://vault.example.com"]),
  veevaVaultApiVersion: "v26.1",
  brokerSessionTtlMs: 900_000,
  stateSecret: "this-is-a-test-secret-with-more-than-thirty-two-bytes",
  allowedParentOrigins: new Set(["https://vault.example.com"]),
  allowOpaqueParentOrigin: false,
  allowVeevaParentOrigins: false,
  port: 8787,
};

test("exchanges an IdP JWT through account-wide federation without a client ID", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests += 1;
    if (String(input).endsWith("/oidc/v1/token")) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
      assert.equal(body.get("subject_token_type"), "urn:ietf:params:oauth:token-type:jwt");
      assert.equal(body.get("scope"), "all-apis");
      assert.equal(body.has("client_id"), false);
      return Response.json({ access_token: "opaque-databricks-token", expires_in: 600 });
    }
    assert.equal(String(input), "https://workspace.example.com/api/2.0/preview/scim/v2/Me");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer opaque-databricks-token");
    return Response.json({ userName: "Person@Example.com", displayName: "Person Example" });
  };

  const assertion = jwt({
    iss: baseConfig.federatedTokenIssuer,
    aud: ["another-audience", "veeva-xpage"],
    email: "person@example.com",
    exp: Math.floor(Date.now() / 1_000) + 600,
  });
  const identity = await exchangeFederatedAssertion(assertion, "person@example.com", baseConfig);
  assert.equal(identity.externalUserName, "person@example.com");
  assert.equal(identity.userName, "Person@Example.com");
  assert.equal(identity.displayName, "Person Example");
  assert.equal(requests, 2);
});

test("rejects a Vault-to-IdP identity mismatch before token exchange", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return new Response(null, { status: 500 });
  };
  const assertion = jwt({
    iss: baseConfig.federatedTokenIssuer,
    aud: "veeva-xpage",
    email: "other@example.com",
    exp: Math.floor(Date.now() / 1_000) + 600,
  });
  await assert.rejects(
    exchangeFederatedAssertion(assertion, "person@example.com", baseConfig),
    /identity_mismatch/,
  );
  assert.equal(requested, false);
});

test("rejects a Databricks identity that differs from the bound Vault and IdP user", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => String(input).endsWith("/oidc/v1/token")
    ? Response.json({ access_token: "opaque-databricks-token", expires_in: 600 })
    : Response.json({ userName: "different@example.com", displayName: "Different User" });
  const assertion = jwt({
    iss: baseConfig.federatedTokenIssuer,
    aud: "veeva-xpage",
    email: "person@example.com",
    exp: Math.floor(Date.now() / 1_000) + 600,
  });
  await assert.rejects(
    exchangeFederatedAssertion(assertion, "person@example.com", baseConfig),
    /identity_mismatch/,
  );
});

test("rejects expired and unsupported-algorithm assertions locally", async () => {
  const claims = {
    iss: baseConfig.federatedTokenIssuer,
    aud: "veeva-xpage",
    email: "person@example.com",
    exp: Math.floor(Date.now() / 1_000) - 1,
  };
  await assert.rejects(exchangeFederatedAssertion(jwt(claims), "person@example.com", baseConfig), /external_token_expired/);
  await assert.rejects(exchangeFederatedAssertion(jwt({ ...claims, exp: claims.exp + 600 }, "none"), "person@example.com", baseConfig), /invalid_external_token/);
});

test("compares mapped usernames case-insensitively after trimming whitespace", () => {
  assert.equal(sameUserName("Person@Example.com", " person@example.com ", "PERSON@EXAMPLE.COM"), true);
  assert.equal(sameUserName("person@example.com", "other@example.com"), false);
});

function jwt(claims: Record<string, unknown>, alg = "RS256"): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg, typ: "JWT" })}.${encode(claims)}.signature`;
}
