import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { BrokerConfig } from "./config.js";
import {
  clearIdentityCachesForTests,
  getServicePrincipalIdentity,
  verifyVaultSession,
} from "./databricks.js";

const baseConfig: BrokerConfig = {
  workspaceHost: "workspace.example.com",
  genieAgentId: "01f1b7b1764a1a04adc67a648599a233",
  veevaVaultOrigins: new Set(["https://vault.example.com"]),
  veevaVaultApiVersion: "v26.1",
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

test("verifies the native Vault session and resolves the current user", async (context) => {
  clearIdentityCachesForTests();
  const server = createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/api/v26.1/objects/users/me");
    assert.equal(req.headers.authorization, "vault-session-value-123");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      responseStatus: "SUCCESS",
      users: [{
        user: {
          id: 61579,
          user_name__v: "person@example.com",
          user_first_name__v: "Person",
          user_last_name__v: "Example",
        },
      }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const config = { ...baseConfig, veevaVaultOrigins: new Set([origin]) };

  const actor = await verifyVaultSession("vault-session-value-123", origin, config);
  assert.equal(actor.userName, "person@example.com");
  assert.equal(actor.displayName, "Person Example");
  assert.equal(actor.subject, "61579");
});

test("rejects Vault URLs outside the configured allowlist", async () => {
  await assert.rejects(
    verifyVaultSession("vault-session-value-123", "https://other-vault.example.com", baseConfig),
    /vault_origin_not_allowed/,
  );
});

test("obtains and caches a workspace service-principal token", async (context) => {
  clearIdentityCachesForTests();
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    clearIdentityCachesForTests();
  });
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    assert.match(String(new Headers(init?.headers).get("Authorization")), /^Basic /);
    assert.match(String(init?.body), /grant_type=client_credentials/);
    return new Response(JSON.stringify({ access_token: "shared-token", expires_in: 3_600 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const first = await getServicePrincipalIdentity(baseConfig);
  const second = await getServicePrincipalIdentity(baseConfig);
  assert.equal(first.accessToken, "shared-token");
  assert.equal(first.applicationId, baseConfig.servicePrincipalClientId);
  assert.equal(second.accessToken, first.accessToken);
  assert.equal(requests, 1);
});
